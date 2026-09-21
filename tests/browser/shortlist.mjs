// The shortlist: adding from search and from a program page, the side by side
// comparison on the student file, removal, who may change it, and isolation
// between branches. Wants the real catalogue loaded and published.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-shortlist";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, path) { await page.goto(BASE + path); return main(page); }
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (re.test(await page.locator("main").innerText())) return true; await page.waitForTimeout(300); }
  return false;
}

const partner = await signIn("kottayam@medcity.test", "10.80.1.1");
const pp = partner.page;

// Pick Arathi from the student selector so the test does not depend on ids.
await go(pp, "/search?q=Hull");
const option = pp.locator('select[name="student"] option', { hasText: "Arathi Krishnan" });
const studentId = await option.getAttribute("value");
check(!!studentId, "search: the student is in the selector");

let text = await go(pp, `/search?q=Hull&student=${studentId}`);
// The buttons are client components; a click before hydration does nothing.
await pp.waitForLoadState("networkidle");
check(await pp.getByRole("button", { name: "Shortlist", exact: true }).count() > 1, "search: rows offer Shortlist once a student is picked");
await pp.getByRole("button", { name: "Shortlist", exact: true }).first().click();
check(await waitText(pp, /Shortlisted ✓/), "search: the first row flips to Shortlisted");
await pp.getByRole("button", { name: "Shortlist", exact: true }).first().click();
const two = async () => (await pp.getByRole("button", { name: "Shortlisted ✓" }).count()) === 2;
let t0 = Date.now(); while (!(await two()) && Date.now() - t0 < 15000) await pp.waitForTimeout(300);
check(await two(), "search: a second program shortlisted");

text = await go(pp, "/search?q=Mohawk");
await pp.locator('a[href^="/programs/"]').first().click();
await pp.waitForURL(/\/programs\//);
await pp.goto(pp.url().split("?")[0] + `?student=${studentId}`);
await main(pp);
await pp.getByRole("button", { name: "Add to shortlist" }).click();
check(await waitText(pp, /Shortlisted ✓/), "program page: adds to the shortlist");
check(await waitText(pp, /Compare 3/), "program page: links to the comparison with the count");

text = await go(pp, `/students/${studentId}/shortlist`);
check(/Shortlist \(3\)/.test(await pp.locator("body").innerText()), "student file: the tab carries the count");
const heads = await pp.locator("thead th a[href^='/programs/']").count();
check(heads === 3, `compare: three programs side by side (${heads})`);
for (const label of ["Fit", "Tuition", "Application fee", "Post-study work", "Intakes"]) check(text.includes(label.toUpperCase()) || text.includes(label), `compare: row ${label}`);
check(/Not recorded/.test(text), "compare: unverified figures say not recorded");
check(/Eligible|On track|Not yet|No rules recorded/.test(text), "compare: shows the student's fit");
await pp.screenshot({ path: `${OUT}/compare.png`, fullPage: true });

await pp.getByRole("button", { name: "Remove" }).first().click();
t0 = Date.now(); while ((await pp.locator("thead th a[href^='/programs/']").count()) !== 2 && Date.now() - t0 < 15000) await pp.waitForTimeout(300);
check((await pp.locator("thead th a[href^='/programs/']").count()) === 2, "compare: Remove takes a program off");

// Another branch cannot see Arathi at all.
const kochi = await signIn("kochi@medcity.test", "10.80.1.2");
// Student pages stream, so the status is 200 and the not-found page is the content.
text = await go(kochi.page, `/students/${studentId}/shortlist`);
check(/could not be found/.test(text) && !/Arathi/.test(text), "isolation: another branch gets not found");

// Management reads but does not change.
const mgmt = await signIn("management@medcityoverseas.test", "10.80.1.3");
text = await go(mgmt.page, `/students/${studentId}/shortlist`);
check((await mgmt.page.locator("thead th a[href^='/programs/']").count()) === 2, "management: sees the comparison");
check((await mgmt.page.getByRole("button", { name: "Remove" }).count()) === 0, "management: no Remove button");

// A student with nothing shortlisted gets a way in, not a blank table.
const option2 = await (await go(pp, "/search"), pp.locator('select[name="student"] option', { hasText: "Aswin Anil" }).getAttribute("value"));
text = await go(pp, `/students/${option2}/shortlist`);
check(/Nothing shortlisted yet/.test(text) && /Search programs for this student/.test(text), "empty shortlist: explains how to add");

for (const [who, e] of [["partner", partner.errors], ["management", mgmt.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
