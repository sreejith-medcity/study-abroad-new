// Program options: a partner asks the team what fits a student, the team
// builds the list and sends it, and the partner shortlists all of it for the
// student in one step. A request for someone not yet registered needs their
// marksheets and can be linked to the student later.
// Wants the real catalogue loaded and published (see programs.mjs).
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));
const PDF = "/tmp/marksheet-test.pdf";
fs.writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
const go = async (page, path) => { await page.goto(BASE + path); return main(page); };

const partner = await signIn("kottayam@medcity.test", "10.79.1.1");
const pp = partner.page;
await pp.getByRole("link", { name: "Request program options" }).first().click();
await pp.waitForURL(/\/program-options\/new/);
await pp.waitForLoadState("networkidle");
// Someone not registered yet: marksheets are required.
await pp.fill('input[name="studentName"]', "Nikhil Varma");
await pp.selectOption('select[name="highestLevel"]', "Bachelor's");
await pp.locator("label").filter({ hasText: /^United Kingdom$/ }).click();
await pp.locator("label").filter({ hasText: /^Master's$/ }).click();
await pp.fill('input[name="studyArea0"]', "Data science");
await pp.getByRole("button", { name: "Send request to the Overseas team" }).click();
await pp.waitForTimeout(1200);
check(/The student's marksheets/.test(await main(pp)), "new student: marksheets are required");
await pp.setInputFiles('input[name="files"]', PDF);
await pp.getByRole("button", { name: "Send request to the Overseas team" }).click();
await pp.waitForURL(/\/program-options\?id=/, { timeout: 15000 }).then(() => ok("new student: the request is sent"), () => bad("new student: the request is sent"));
let text = await main(pp);
check(/Nikhil Varma/.test(text) && /Requested/.test(text) && /Not registered yet/.test(text) && /marksheet-test\.pdf/.test(text), "detail: the request shows its profile, file and that the student is not registered");
const nikhilUrl = pp.url();

// A registered student.
await go(pp, "/program-options/new");
await pp.waitForLoadState("networkidle");
await pp.getByText("A student already registered").click();
const arathi = await pp.locator('select[name="studentId"] option', { hasText: "Arathi Krishnan" }).getAttribute("value");
await pp.selectOption('select[name="studentId"]', arathi);
await pp.selectOption('select[name="highestLevel"]', "Bachelor's");
for (const c of ["United Kingdom", "Ireland", "Canada", "Germany"]) await pp.locator("label").filter({ hasText: new RegExp(`^${c}$`) }).click();
await pp.locator("label").filter({ hasText: /^Master's$/ }).click();
await pp.fill('input[name="studyArea0"]', "Computer science");
await pp.fill('textarea[name="additionalInfo"]', "Budget about 25 lakh a year.");
await pp.getByRole("button", { name: "Send request to the Overseas team" }).click();
await pp.waitForURL(/\/program-options\?id=/, { timeout: 15000 });
text = await main(pp);
const dests = text.split("Destinations\n")[1]?.split("\n")[0] ?? "";
check(/Arathi Krishnan/.test(text) && ["United Kingdom", "Ireland", "Canada"].every((c) => dests.includes(c)) && !dests.includes("Germany"), `existing student: sent, and only three destinations are taken (${dests})`);
const arathiUrl = pp.url();

const admin = await signIn("admin@medcityoverseas.test", "10.79.1.2");
const ap = admin.page;
text = await go(ap, "/notifications");
check(/Program options requested: Arathi Krishnan/.test(text), "admin: notified");
await go(ap, arathiUrl.replace(BASE, "").replace("?", "?pq=Hull&"));
await ap.waitForLoadState("networkidle");
for (let i = 0; i < 2; i++) { await ap.getByRole("button", { name: "Add", exact: true }).first().click(); await ap.waitForTimeout(1200); }
text = await main(ap);
check(/Recommended programs \(2\)/.test(text), "admin: two programs added from the finder");
await ap.getByRole("button", { name: /Send 2 options to the partner/ }).click();
await ap.waitForTimeout(1500);
check(/Program options sent/.test(await main(ap)), "admin: the list is sent");

text = await go(pp, "/notifications");
check(/2 program options for Arathi Krishnan/.test(text), "partner: notified the options are ready");
await go(pp, arathiUrl.replace(BASE, ""));
await pp.waitForLoadState("networkidle");
check((await pp.getByRole("link", { name: "Apply" }).count()) === 2, "partner: each option can be applied to");
await pp.fill('textarea[name="body"]', "Thanks, can you add one in Ireland?");
await pp.getByRole("button", { name: "Send", exact: true }).click();
await pp.waitForTimeout(1200);
check(/can you add one in Ireland/.test(await main(pp)), "partner: messages the team");
await pp.getByRole("button", { name: "Shortlist all 2 for Arathi" }).click();
await pp.waitForURL(/\/shortlist/, { timeout: 15000 }).then(() => ok("partner: shortlist all goes to the student's shortlist"), () => bad("partner: shortlist all"));
check(/University of Hull/.test(await main(pp)), "shortlist: holds the team's options");

// Link the new-student request once the student is registered (Arathi stands in).
await go(pp, nikhilUrl.replace(BASE, ""));
await pp.waitForLoadState("networkidle");
await pp.selectOption('select[name="studentId"]', arathi);
await pp.getByRole("button", { name: "Link" }).click();
await pp.waitForTimeout(1500);
check(/Student file:\s*Arathi Krishnan/.test(await main(pp)), "a request can be linked to a registered student");
await pp.getByRole("button", { name: "Archive" }).click();
await pp.waitForTimeout(1500);
text = await go(pp, "/program-options?tab=archived");
check(/Nikhil Varma/.test(text), "archive: moves to the Archived tab");

const other = await signIn("kochi@medcity.test", "10.79.1.3");
text = await go(other.page, "/program-options");
check(!/Arathi Krishnan/.test(text), "another branch does not see these requests");

for (const [who, e] of [["partner", partner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
