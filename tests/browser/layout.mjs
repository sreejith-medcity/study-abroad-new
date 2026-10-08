// Nothing makes the page wider than the window.
//
// A screen that scrolls sideways takes the header and the sidebar off with it,
// which is how a student file came to look half broken: seven steps in a row
// outgrew the card, the card outgrew the window, and the whole page shifted.
// This presses no buttons; it measures.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const student = sql("select id from students where not archived order by created_at limit 1");
const app = sql(`select coalesce((select id from applications where student_id = '${student}' limit 1), '')`);

const WHO = [
  ["admin@medcityoverseas.test", "admin"],
  ["documentation@medcityoverseas.test", "documentation"],
  ["uk.docs@medcity.test", "counsellor"],
];
const SCREENS = [
  "/dashboard",
  "/students",
  "/search",
  `/students/${student}/profile`,
  `/students/${student}/applications`,
  `/students/${student}/applications?tab=apply`,
  `/students/${student}/documents`,
  `/students/${student}/documentation`,
  `/students/${student}/timeline`,
  `/students/${student}/services`,
  `/students/${student}/shortlist`,
  app ? `/students/${student}/applications?app=${app}` : null,
].filter(Boolean);

// Laptop and the narrowest desktop anybody here uses. Phone width is its own
// layout and is not what was reported.
const SIZES = [[1280, 900], [1024, 800]];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 40;
for (const [email, label] of WHO) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.251.1.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  if (page.url().includes("/login")) { bad(`${label}: cannot sign in`); await ctx.close(); continue; }

  const wide = [];
  let checked = 0;
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const screen of SCREENS) {
      await page.goto(BASE + screen, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
      if (page.url().includes("/forbidden")) continue;
      checked += 1;
      const over = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= limit + 1) return null;
        // Name the widest thing sticking out, so the failure says where to look.
        let worst = null;
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= limit + 1) continue;
          const own = [...el.children].every((c) => c.getBoundingClientRect().right <= limit + 1);
          if (!own) continue;
          if (!worst || r.right > worst.right) worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70) };
        }
        return { page: document.documentElement.scrollWidth, limit, worst };
      });
      if (over) wide.push(`${screen} at ${w}px is ${over.page}px wide${over.worst ? ` (${over.worst.tag}.${over.worst.cls} reaches ${over.worst.right})` : ""}`);
    }
  }
  wide.length === 0
    ? ok(`${label}: all ${checked} screens fit the window`)
    : bad(`${label}: ${wide.join("; ")}`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
