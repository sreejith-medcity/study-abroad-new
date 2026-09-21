// The catalogue pages: a program page, a university page, the admin edit
// screen, and the rule that an unverified fee never reads as "no fee".
// Wants the real catalogue loaded and published:
//   npm run db:seed && npx tsx scripts/import-catalogue.ts, then publish all.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-programs";
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

// ---------------- Partner ----------------
const partner = await signIn("kottayam@medcity.test", "10.70.1.1");
const pp = partner.page;

let text = await go(pp, "/search?q=Advanced+Clinical+Practice");
check(/App\. fee not recorded/.test(text), "search: a blank application fee reads as not recorded");
check(/Tuition not recorded/.test(text), "search: a blank tuition reads as not recorded");
check(!/No tuition fee/.test(text), "search: nothing unverified reads as free");

text = await go(pp, "/search?noAppFee=1");
const freeCount = Number((text.match(/([\d,]+) live program/) || [])[1]?.replace(/,/g, ""));
check(freeCount > 0 && freeCount < 100, `search: "No application fee" keeps only verified zeros (${freeCount})`);

await go(pp, "/search?q=Advanced+Clinical+Practice");
await pp.getByRole("link", { name: "MSc Advanced Clinical Practice" }).first().click();
await pp.waitForURL(/\/programs\//);
text = await main(pp);
const programUrl = pp.url().split("?")[0];
check(/At a glance/.test(text) && /University of Hull/.test(text), "program page: opens from the search result");
check(/Application fee\s*Not recorded/.test(text), "program page: unverified fee says not recorded");
check(/Post-study work/.test(text) && /Not confirmed/.test(text), "program page: unknown work rights say not confirmed");
check(!/Edit program/.test(text), "program page: partners get no edit button");
await pp.screenshot({ path: `${OUT}/program.png`, fullPage: true });

await pp.locator('select[name="student"]').selectOption({ index: 1 });
await pp.getByRole("button", { name: "Check" }).click();
await pp.waitForURL(/student=/);
text = await main(pp);
check(/Eligible|On track|Not yet|No rules recorded/.test(text), "program page: checking a student shows a verdict");
check(await pp.getByRole("link", { name: /^Apply for / }).count() === 1 && /No intakes are recorded/.test(text), "program page: with no intake on record, Apply is offered with a note");
const checkedUrl = pp.url();

await pp.getByRole("link", { name: "University page" }).click();
await pp.waitForURL(/\/universities\//);
text = await main(pp);
const uniUrl = pp.url().split("?")[0];
check(/University of Hull/.test(text) && /Live programs/.test(text), "university page: opens from the program page");
check(/MSc Civil Engineering/.test(text), "university page: lists the other programs");
await pp.screenshot({ path: `${OUT}/university.png`, fullPage: true });

// Mohawk runs one programme twice, and only one of the two keeps post-study
// work, which the summary must warn about.
await go(pp, "/search?q=Mohawk");
const georgian = pp.locator('a[href^="/universities/"]').first();
if (await georgian.count()) {
  await georgian.click();
  await pp.waitForURL(/\/universities\//);
  text = await main(pp);
  check(/Confirmed not eligible\s*[1-9]/.test(text) && /carry no post-study work/.test(text), "university page: warns when some programs lose work rights");
} else bad("university page: could not find Mohawk in search");

// The Mohawk trap: one program name, two campuses, opposite work rights.
await go(pp, "/search?q=Mohawk");
await pp.getByRole("link", { name: "Supply Chain Management", exact: true }).first().click();
await pp.waitForURL(/\/programs\//);
text = await main(pp);
check(/Campus\s*Hamilton, Canada/.test(text), "program page: shows its own campus, not the university's last one");
check(/Same program, different campus, different work rights/.test(text) && /Mississauga/.test(text), "program page: warns about the twin at the other campus");
await go(pp, "/search?q=Mohawk");
text = await main(pp);
check(/Hamilton, Canada/.test(text) && /Mississauga, Canada/.test(text), "search: each Mohawk row shows its own campus");

await pp.goto(`${BASE}/admin/programs/${programUrl.split("/").pop()}`);
await pp.waitForURL(/\/forbidden/, { timeout: 10000 }).then(() => ok("admin edit: partners are kept out"), () => bad("admin edit: partners are kept out"));

// ---------------- Admin ----------------
const admin = await signIn("admin@medcityoverseas.test", "10.70.1.2");
const ap = admin.page;
const id = programUrl.split("/").pop();
text = await go(ap, `/programs/${id}`);
check(/Edit program/.test(text), "program page: admins get an edit button");

await go(ap, `/admin/programs/${id}`);
await ap.fill('input[name="applicationFee"]', "60");
await ap.selectOption('select[name="workRights"]', "ELIGIBLE");
await ap.fill('textarea[name="workRightsNote"]', "");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.waitForTimeout(1500);
text = await main(ap);
check(/Say where this comes from/.test(text), "admin edit: a work rights verdict needs its evidence");

await ap.fill('textarea[name="workRightsNote"]', "Test evidence note");
for (const box of await ap.locator('input[name="intake"]').all()) await box.uncheck();
await ap.getByRole("button", { name: "Save program" }).click();
await ap.waitForTimeout(1500);
text = await main(ap);
check(/needs at least one intake/.test(text), "admin edit: a live program needs an intake");

await ap.locator('input[name="intake"][value="9"]').check();
await ap.getByRole("button", { name: "Save program" }).click();
const toast = await ap.locator('[role="status"]').filter({ hasText: /Saved/ }).first().innerText({ timeout: 10000 }).catch(() => "");
check(/Saved 4 changes/.test(toast), `admin edit: saves and counts the changes (${toast.trim()})`);

await ap.reload();
text = await main(ap);
check(/applicationFee/.test(text) && /workRights/.test(text), "admin edit: the change history names the fields");

text = await go(pp, programUrl.replace(BASE, ""));
check(/Application fee\s*£60/.test(text) || /Application fee\s*GBP\s*60/.test(text) || /Application fee\s*[^\n]*60/.test(text), "program page: partners see the corrected fee");
check(/Test evidence note/.test(text), "program page: partners see the evidence note");
text = await go(pp, checkedUrl.replace(BASE, ""));
check(await pp.getByRole("link", { name: /^Apply for / }).count() === 1 && !/No intakes are recorded/.test(text), "program page: once an intake exists, the note goes");

await ap.fill('input[name="applicationFee"]', "");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.locator('[role="status"]').filter({ hasText: /Saved 1 change/ }).first().waitFor({ timeout: 10000 }).then(() => ok("admin edit: clearing a fee saves it as not recorded"), () => bad("admin edit: clearing a fee"));
text = await go(pp, programUrl.replace(BASE, ""));
check(/Application fee\s*Not recorded/.test(text), "program page: a cleared fee goes back to not recorded");

// A draft is invisible to partners but visible to the team.
await go(ap, `/admin/programs/${id}`);
await ap.selectOption('select[name="status"]', "DRAFT");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.locator('[role="status"]').filter({ hasText: /Saved/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
const r = await pp.goto(programUrl);
check(r && r.status() === 404, "program page: partners get a 404 for a draft");
text = await go(ap, `/programs/${id}`);
check(/Draft: partners cannot see this yet/.test(text), "program page: the team sees a draft banner");
text = await go(ap, uniUrl.replace(BASE, ""));
check(/Draft/.test(text) && /not live/.test(text), "university page: the team sees drafts marked as such");
await go(ap, `/admin/programs/${id}`);
await ap.selectOption('select[name="status"]', "LIVE");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.locator('[role="status"]').filter({ hasText: /Saved/ }).first().waitFor({ timeout: 10000 }).catch(() => {});

text = await go(ap, "/admin/programs?q=Advanced+Clinical");
check(/Not recorded/.test(text) && !/None/.test(text.split("Program")[1] ?? ""), "admin list: blank tuition reads as not recorded");
await ap.getByRole("link", { name: "MSc Advanced Clinical Practice" }).first().click();
await ap.waitForURL(/\/admin\/programs\/[^?]+$/).then(() => ok("admin list: a program name opens its edit screen"), () => bad("admin list: program link"));

for (const [who, e] of [["partner", partner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);

await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
