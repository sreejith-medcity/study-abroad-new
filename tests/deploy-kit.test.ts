import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The VPS kit in deploy/: the dump filter that makes a Supabase dump restore
 * into plain Postgres, and the agreement between the compose file, env.example
 * and the variables the code actually reads. None of this needs Docker or a
 * database; the filter is run through bash on a made-up dump.
 */
const root = new URL("../", import.meta.url).pathname;
const deploy = join(root, "deploy");
const read = (name: string) => readFileSync(join(deploy, name), "utf8");
const EM_DASH = String.fromCodePoint(0x2014);

function prepare(dump: string) {
  const res = spawnSync("bash", [join(deploy, "prepare-dump.sh")], { input: dump, encoding: "utf8" });
  return { status: res.status, out: res.stdout, err: res.stderr };
}

test("prepare-dump.sh drops what only Supabase can run and rewrites the trigram operator classes", () => {
  const dump = [
    "\\restrict abc",
    "SET statement_timeout = 0;",
    "SET transaction_timeout = 0;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "CREATE SCHEMA drizzle;",
    "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;",
    "COMMENT ON EXTENSION pg_trgm IS 'text similarity';",
    "CREATE TABLE public.users (",
    "    id text NOT NULL",
    ");",
    "ALTER TABLE public.users OWNER TO postgres;",
    "ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;",
    "CREATE POLICY \"own\" ON public.users FOR SELECT TO authenticated USING ((auth.uid() = id));",
    "CREATE POLICY \"wrapped\" ON public.users FOR UPDATE",
    "  TO service_role",
    "  USING (true);",
    "CREATE INDEX programs_name_trgm ON public.programs USING gin (name extensions.gin_trgm_ops);",
    "CREATE INDEX universities_name_trgm ON public.universities USING gin (name public.gin_trgm_ops);",
    "GRANT ALL ON TABLE public.users TO anon;",
    "\\unrestrict abc",
    "",
  ].join("\n");
  const { status, out, err } = prepare(dump);
  assert.equal(status, 0, err);
  assert.equal(
    out,
    [
      "SET statement_timeout = 0;",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      "CREATE SCHEMA IF NOT EXISTS drizzle;",
      "CREATE TABLE public.users (",
      "    id text NOT NULL",
      ");",
      "CREATE INDEX programs_name_trgm ON public.programs USING gin (name public.gin_trgm_ops);",
      "CREATE INDEX universities_name_trgm ON public.universities USING gin (name public.gin_trgm_ops);",
      "",
    ].join("\n"),
  );
  assert.match(err, /dropped 2 policies/);
  assert.match(err, /rewrote 1 trigram/);
});

test("prepare-dump.sh never touches table data, even when a row mentions a Supabase schema", () => {
  const row = "u1\tsee storage. and auth.uid() and extensions.gin_trgm_ops in a note";
  const dump = ["COPY public.notes (id, body) FROM stdin;", row, "\\.", "SELECT 1;", ""].join("\n");
  const { status, out } = prepare(dump);
  assert.equal(status, 0);
  assert.ok(out.includes(row));
});

test("prepare-dump.sh stops on a statement that still needs Supabase and says which line", () => {
  const dump = [
    "CREATE TRIGGER t BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);",
    "CREATE VIEW public.v AS SELECT * FROM auth.users;",
    "",
  ].join("\n");
  const { status, err } = prepare(dump);
  assert.equal(status, 1);
  assert.match(err, /line 1 still needs Supabase/);
  assert.match(err, /line 2 still needs Supabase/);
  assert.match(err, /2 line\(s\) refer to something only Supabase has/);
});

test("the shell scripts parse", () => {
  for (const name of ["move-database.sh", "prepare-dump.sh", "backup.sh"]) {
    const res = spawnSync("bash", ["-n", join(deploy, name)], { encoding: "utf8" });
    assert.equal(res.status, 0, `${name}: ${res.stderr}`);
    assert.ok(statSync(join(deploy, name)).mode & 0o111, `${name} is not executable`);
  }
});

/** Every process.env.NAME the running portal reads, from src/ (not scripts or tests). */
function envNamesInSource(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        for (const m of readFileSync(full, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
      }
    }
  };
  walk(join(root, "src"));
  return names;
}

test("docker-compose.yml hands the app every variable the code reads, and env.example explains each one", () => {
  const compose = read("docker-compose.yml");
  const appBlock = compose.slice(compose.indexOf("\n  app:"), compose.indexOf("\n  migrate:"));
  const handedToApp = new Set([...appBlock.matchAll(/^      ([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));

  // Set by Next or Docker, stamped at build time, or only read by the seed and
  // by one-off scripts: not settings anybody puts in .env.
  const notSettings = new Set(["NODE_ENV", "BUILD_STANDALONE", "APP_VERSION", "APP_BUILT_AT", "APP_COMMIT", "RAZORPAY_API_BASE", "ANTHROPIC_API_BASE"]);
  for (const name of envNamesInSource()) {
    if (notSettings.has(name)) continue;
    assert.ok(handedToApp.has(name), `src reads process.env.${name} but docker-compose.yml does not pass it to the app`);
  }

  const example = read("env.example");
  const inExample = new Set([...example.matchAll(/^#? ?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  // Built by the compose file itself, or fixed by the image.
  const composed = new Set(["DATABASE_URL", "UPLOAD_DIR", "TZ"]);
  for (const name of handedToApp) {
    if (composed.has(name)) continue;
    assert.ok(inExample.has(name), `docker-compose.yml reads ${name} from .env but env.example does not list it`);
  }
  for (const name of [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])) {
    assert.ok(inExample.has(name), `docker-compose.yml interpolates ${name} but env.example does not list it`);
  }
  // Each setting in env.example has a comment somewhere above it.
  const lines = example.split("\n");
  lines.forEach((line, i) => {
    if (!/^[A-Z][A-Z0-9_]*=/.test(line)) return;
    let j = i - 1;
    while (j >= 0 && /^[A-Z][A-Z0-9_]*=/.test(lines[j])) j--;
    assert.ok(j >= 0 && lines[j].startsWith("#"), `${line.split("=")[0]} in env.example has no comment above it`);
  });
  // No value is filled in.
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const allowed: Record<string, string> = { PUBLIC_BASE_URL: "https://doc.medcityoverseas.com", APP_PORT: "3200", WHATSAPP_PROVIDER: "console", SUPABASE_STORAGE_BUCKET: "student-documents" };
    assert.ok(m[2] === "" || allowed[m[1]] === m[2], `${m[1]} in env.example carries a value`);
  }
});

test("the compose health check, the Caddy health check and the runbook all point at /api/health", () => {
  assert.match(read("docker-compose.yml"), /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health'\)/);
  assert.match(read("Caddyfile.portal"), /health_uri \/api\/health/);
  assert.match(read("README.md"), /\/api\/health/);
});

test("the runbook holds no secret and no em dash, and reads secrets with read -rs", () => {
  const readme = read("README.md");
  assert.ok(!readme.includes(EM_DASH), "the runbook contains an em dash");
  assert.match(readme, /read -rs SUPABASE_DB_URL/);
  assert.match(readme, /read -rs SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(readme, /(eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]+|postgres(ql)?:\/\/[^\s:]+:[^\s@]+@)/);
  for (const name of ["move-database.sh", "move-documents.py", "docker-compose.yml", "env.example", "Caddyfile.portal", "backup.sh", "prepare-dump.sh"]) {
    assert.ok(!read(name).includes(EM_DASH), `${name} contains an em dash`);
  }
});
