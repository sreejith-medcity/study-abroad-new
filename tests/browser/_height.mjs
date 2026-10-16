// How tall is each screen, per role, measured in viewport-fulls.
//
// Not a pass or fail suite: a measuring tape, for finding which screens are
// worth folding up. Named with a leading underscore so the regression runs
// skip it. Run it against a database with real-looking data, because an empty
// student makes every screen look fine.
//
//   node tests/browser/_height.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h","localhost","-U","postgres","-d",DB,"-Atc",q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 90;
const rows = [];
for (const role of ["SUPER_ADMIN", "DOCUMENTATION", "COUNSELLOR"]) {
  const email = sql(`select email from users where role = '${role}' and active limit 1`);
  if (!email) continue;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.251.9.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  // The shell paints after the sign-in redirect settles; collected too early,
  // the menu is not there yet and only the pages named below get measured.
  await page.waitForTimeout(1500);
  const links = await page.locator("a[href^='/']").evaluateAll((as) =>
    [...new Set(as.map((a) => a.getAttribute("href")))].filter((h) => h && !h.includes("#") && !h.startsWith("/api/")),
  );
  // The fullest file there is, not the first one: an empty student makes every
  // screen look fine, which is how a long screen stays long.
  const student = sql(`
    select s.id from students s
    where not s.archived
    order by (select count(*) from applications a where a.student_id = s.id) desc,
             (select count(*) from documents d where d.student_id = s.id) desc
    limit 1`);
  const targets = [...links, `/students/${student}/profile`, `/students/${student}/documents`, `/students/${student}/applications`];
  for (const href of targets) {
    try {
      await page.goto(BASE + href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, v: window.innerHeight }));
      rows.push({ role, href, screens: +(m.h / m.v).toFixed(1) });
    } catch { /* a link this role cannot open */ }
  }
  await ctx.close();
}
await browser.close();
rows.sort((a, b) => b.screens - a.screens);
for (const r of rows.slice(0, 22)) console.log(`${String(r.screens).padStart(5)}x  ${r.role.padEnd(14)} ${r.href}`);
