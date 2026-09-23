/**
 * Turns one drizzle migration into SQL that is safe to paste into the Supabase
 * SQL editor twice, and records the migration so `drizzle-kit migrate` later
 * treats it as applied.
 *   npx tsx scripts/supabase-part.ts 0021_service_requests "Part 19: service requests" > part19.sql
 * Handles what drizzle-kit generates here: CREATE TYPE, CREATE TABLE, ADD
 * COLUMN, ADD CONSTRAINT and CREATE INDEX. Anything else stops the script.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [tag, title] = process.argv.slice(2);
if (!tag || !title) {
  console.error('Usage: npx tsx scripts/supabase-part.ts <migration tag> "<title>"');
  process.exit(1);
}
const file = new URL(`../drizzle/${tag}.sql`, import.meta.url).pathname;
const raw = readFileSync(file, "utf8");
const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url).pathname, "utf8")) as { entries: { tag: string; when: number }[] };
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) throw new Error(`${tag} is not in the journal`);
const hash = createHash("sha256").update(raw).digest("hex");

const out: string[] = [`-- ${title}`, "-- Run in the Supabase SQL editor BEFORE pushing the code that uses it. Safe to run twice.", ""];
for (const part of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
  const stmt = part.replace(/"public"\./g, "").replace(/;$/, "");
  if (/^CREATE TYPE/i.test(stmt) || /^ALTER TABLE .* ADD CONSTRAINT/i.test(stmt)) {
    out.push(`DO $$ BEGIN\n  ${stmt};\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  } else if (/^CREATE TABLE /i.test(stmt)) {
    out.push(stmt.replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ") + ";");
  } else if (/^ALTER TABLE .* ADD COLUMN /i.test(stmt)) {
    out.push(stmt.replace(/ ADD COLUMN /i, " ADD COLUMN IF NOT EXISTS ") + ";");
  } else if (/^ALTER TABLE .* ALTER COLUMN .* (DROP|SET) NOT NULL$/i.test(stmt)) {
    // Dropping or setting NOT NULL is already safe to run twice.
    out.push(stmt + ";");
  } else if (/^CREATE (UNIQUE )?INDEX /i.test(stmt)) {
    out.push(stmt.replace(/^CREATE (UNIQUE )?INDEX /i, (m) => `${m}IF NOT EXISTS `) + ";");
  } else {
    throw new Error(`Not handled, write this part by hand: ${stmt.slice(0, 80)}`);
  }
  out.push("");
}
out.push(
  "INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)",
  `SELECT (SELECT coalesce(max(id), 0) + 1 FROM drizzle.__drizzle_migrations), '${hash}', ${entry.when}`,
  `WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '${hash}');`,
  "",
  `SELECT count(*) AS migrations_recorded FROM drizzle.__drizzle_migrations;`,
);
console.log(out.join("\n"));
