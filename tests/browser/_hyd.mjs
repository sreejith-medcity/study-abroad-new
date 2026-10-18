// Drive a long session that posts forms and moves about, against the dev
// server, where React prints what actually disagreed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3300";
const DB = (fs.readFileSync("/home/claude/study-abroad-new/.env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.33.1.1" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const p = await ctx.newPage();
const hits = [];
p.on("console", (m) => {
  const t = m.text();
  if (/hydrat|did not match|Warning: Text content|server rendered|418|423|425/i.test(t)) hits.push(t.slice(0, 2200));
});
p.on("pageerror", (e) => { if (/hydrat|418/i.test(String(e))) hits.push("PAGEERROR " + String(e).slice(0, 2200)); });

await p.goto(`${BASE}/login`);
await p.fill('input[name="email"]', "sreejith@miak.in");
await p.fill('input[name="password"]', "Password@123");
await p.click('button[type="submit"]');
await p.waitForURL((u) => !String(u).includes("/login"), { timeout: 40000 });

const paths = (process.env.PATHS ?? "/dashboard|/students|/students/board|/applications|/my-day|/admin/queue|/documentation|/deadlines|/enquiries|/wallet|/search|/finder|/admin/partners|/notifications").split("|");
for (let round = 0; round < Number(process.env.ROUNDS ?? 2); round++) {
  for (const path of paths) {
    await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await p.waitForTimeout(900);
    if (hits.length) { console.log(`\n>>> after ${path} (round ${round})`); break; }
  }
  if (hits.length) break;
}
console.log(hits.length ? hits.join("\n---\n") : "no hydration complaint in this run");
await b.close();
