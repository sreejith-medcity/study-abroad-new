// Hunting the hydration warning.
//
// Loads the screens that have complained, under the conditions a suite makes:
// four people signed in at once, each walking their own list of screens. It
// prints anything the console says about hydration and counts the React
// errors, so a run says both how often it happened and, with a patched React
// in place, what it saw. scripts/hydration-diff.mjs holds what is known and
// how to patch React to make it talk.
//
//   npm run build && npm start &
//   ROUNDS=6 node tests/browser/_hydhunt.mjs
//
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3000";
const ROUNDS = Number(process.env.ROUNDS ?? 6);
const WHO = [
  ["kottayam@medcity.test", "/wallet|/my-day|/search|/finder|/students/board|/dashboard|/students"],
  ["admin@medcityoverseas.test", "/documentation|/admin/programs|/dashboard|/applications|/admin/partners|/deadlines"],
  ["uk.docs@medcity.test", "/students|/my-day|/dashboard|/search|/notifications"],
  ["management@medcityoverseas.test", "/dashboard|/insights|/students|/applications"],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let hits = 0;
let errs = 0;
let loads = 0;

async function one([email, paths], ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (/HYDRATION-DIFF|hydrat|server rendered|didn't match/i.test(t)) { hits += 1; console.log("\n=== " + email + "\n" + t.slice(0, 4000) + "\n"); }
  });
  page.on("pageerror", (e) => { const m = String(e).match(/#\d+/); if (m) { errs += 1; console.log("  pageerror " + m[0] + " on " + page.url().replace(BASE, "")); } });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 25000 }).catch(() => {});
  for (let r = 0; r < ROUNDS; r++) {
    for (const p of paths.split("|")) {
      await page.goto(BASE + p).catch(() => {});
      await page.waitForTimeout(250);
      loads += 1;
    }
  }
  await ctx.close();
}

await Promise.all(WHO.map((w, i) => one(w, `10.252.4.${10 + i}`)));
console.log(`\n${hits} mismatches described, ${errs} react errors, out of ${loads} loads`);
await browser.close();
