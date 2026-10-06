// Every link in a role's own sidebar opens for that role.
//
// Being shown a door and then refused by it is the worst of both: the person
// cannot tell whether they are allowed and nobody told them. This walks each
// role's own navigation and presses every link, and fails on a refusal, a 404
// or a redirect somewhere else. Wants the plain seed.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-nav";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const ROLES = [
  ["sreejith@miak.in", "super admin"],
  ["admin@medcityoverseas.test", "admin"],
  ["ops@medcityoverseas.test", "ops manager"],
  ["documentation@medcityoverseas.test", "documentation"],
  ["teamlead@medcityoverseas.test", "application team leader"],
  ["management@medcityoverseas.test", "management"],
  ["desk.counsellor@medcityoverseas.test", "desk counsellor"],
  ["kottayam@medcity.test", "branch head"],
  ["uk.docs@medcity.test", "counsellor"],
  ["senior@medcity.test", "senior counsellor"],
  ["trainee@medcity.test", "trainee counsellor"],
  ["owner@horizon.test", "sub-agent owner"],
  ["staff@horizon.test", "sub-agent counsellor"],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 10;
for (const [email, label] of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.252.1.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  if (page.url().includes("/login")) { bad(`${label}: cannot sign in`); await ctx.close(); continue; }

  // The shell streams, so the sidebar is waited for rather than assumed.
  await page.locator("aside a").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  const links = [...new Set(await page.locator("aside a").evaluateAll((els) => els.map((e) => e.getAttribute("href")).filter((h) => h && h.startsWith("/"))))];
  if (links.length === 0) { bad(`${label}: no sidebar at all`); await ctx.close(); continue; }

  const refused = [];
  for (const href of links) {
    await page.goto(BASE + href, { waitUntil: "domcontentloaded" });
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
    const landed = page.url().replace(BASE, "");
    const body = await page.locator("body").innerText().catch(() => "");
    if (landed.startsWith("/forbidden") || /isn.t open to your role/i.test(body)) refused.push(`${href} is refused`);
    else if (/This page could not be found/i.test(body)) refused.push(`${href} is a 404`);
    else if (!landed.startsWith(href.split("?")[0])) refused.push(`${href} sent them to ${landed}`);
  }
  refused.length === 0
    ? ok(`${label}: all ${links.length} links in their own sidebar open`)
    : bad(`${label}: ${refused.join("; ")}`);
  errors.length === 0 ? ok(`${label}: no page errors walking it`) : bad(`${label}: ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
