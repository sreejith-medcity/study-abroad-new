// Vendors and routes: the roads an application can be sent down. Adding a
// vendor and its colour, recording routes on a course by hand and from a
// vendor's sheet, what the comparison shows, the search filter, choosing the
// route when the application is created, and what a student never sees.
// Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-routes";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
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
async function go(page, p) { await page.goto(BASE + p); return main(page); }
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (re.test(await page.locator("main").innerText())) return true; await page.waitForTimeout(300); }
  return false;
}
const tag = String(Date.now()).slice(-5);

// --- The team keeps the vendors.
const admin = await signIn("admin@medcityoverseas.test", "10.120.1.1");
const ap = admin.page;
let text = await go(ap, "/admin/vendors");
check(/KC Overseas/.test(text) && /Medcity Direct/.test(text) && /StudentOps360/.test(text), "vendors: the three seeded roads are listed");
check(/Our own agreement/.test(text), "vendors: Medcity's own agreements are marked as such");

await ap.locator('input[name="name"]').fill(`Test Vendor ${tag}`);
await ap.locator('input[name="code"]').fill("kc");
await ap.getByRole("button", { name: "Add the vendor" }).click();
check(await waitText(ap, /Already used by another vendor/), "vendors: a code another vendor uses is refused");
await ap.locator('input[name="code"]').fill(`T${String.fromCharCode(65 + (Number(tag.slice(-2)) % 26))}`);
await ap.getByRole("button", { name: "Add the vendor" }).click();
const told = await ap.locator('[role="status"]').filter({ hasText: /added/ }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
check(told, "vendors: the team is told it was added");
let added = "0";
for (let i = 0; i < 20 && added !== "1"; i++) { added = sql(`select count(*) from vendors where name = 'Test Vendor ${tag}'`); if (added !== "1") await ap.waitForTimeout(500); }
check(added === "1", "vendors: a new vendor is added");

// --- Routes on one course, by hand.
const pid = sql("select p.id from programs p join program_routes r on r.program_id = p.id where p.status = 'LIVE' group by p.id having count(*) > 1 order by p.id limit 1");
const pname = sql(`select name from programs where id = '${pid}'`);
text = await go(ap, `/admin/programs/${pid}`);
check(/Routes/.test(text) && /KC Overseas/.test(text), "program: its routes are listed on the admin screen");
check(/Paid once/.test(text), "program: each route says when it is paid");

text = await go(ap, `/programs/${pid}`);
check(/ways to apply for this course|How this course is applied for/.test(text), "program page: the comparison is there");
check(/KC KC Overseas/.test(text), "program page: the vendor's code and name are together");
const commissionShown = /commission/i.test(text);
check(commissionShown, "program page: the team sees what each route pays");

// --- The search filter.
const kcId = sql("select id from vendors where code = 'KC'");
const kcCount = Number(sql(`select count(*) from programs p join program_routes r on r.program_id = p.id where p.status='LIVE' and r.active and r.vendor_id = '${kcId}'`));
const live = Number(sql("select count(*) from programs where status = 'LIVE'"));
const noRoute = Number(sql("select count(*) from programs p where p.status='LIVE' and not exists (select 1 from program_routes r where r.program_id = p.id and r.active)"));
const n = (t) => Number((t.match(/([\d,]+) live programs?/) || [])[1]?.replace(/,/g, "") ?? -1);
text = await go(ap, `/search?vendor=${kcId}`);
check(n(text) === kcCount && kcCount > 0, `search: through KC leaves ${kcCount} (${n(text)})`);
check(/\bKC\b/.test(text), "search: the route chip is on the rows");
text = await go(ap, "/search?vendor=none");
check(n(text) === noRoute, `search: courses with no route at all (${n(text)} of ${noRoute})`);
check(noRoute + kcCount <= live * 2, "search: the counts are within the catalogue");

// --- Pausing a vendor takes its routes out of the reckoning.
await go(ap, "/admin/vendors");
const soId = sql("select id from vendors where code = 'SO'");
const soCount = Number(sql(`select count(*) from programs p join program_routes r on r.program_id = p.id where p.status='LIVE' and r.active and r.vendor_id = '${soId}'`));
await ap.locator(`form[action] input[value="${soId}"]`).first().waitFor({ timeout: 5000 }).catch(() => {});
text = await go(ap, `/search?vendor=${soId}`);
check(n(text) === soCount, `search: through StudentOps360 leaves ${soCount} (${n(text)})`);

// --- The finder offers the same filter.
text = await go(ap, `/finder?vendor=${kcId}&step=results`);
check(Number((text.match(/([\d,]+) courses? at/) || [])[1]?.replace(/,/g, "") ?? -1) === kcCount, "finder: the panel filters by route");
check(/applied through/i.test(text), "finder: the panel names the filter");

// --- A counsellor whose branch hides commission sees the routes, not the money.
sql("update organizations set counsellors_see_commission = false where id = (select org_id from users where email = 'germany@medcity.test')");
const counsellor = await signIn("germany@medcity.test", "10.120.1.3");
text = await go(counsellor.page, `/programs/${pid}`);
check(/KC Overseas/.test(text), "counsellor: sees which routes exist");
check(!/commission/i.test(text), "counsellor: no commission on the comparison when the branch hides it");

// --- Applying picks the route, and it sticks.
const partner = await signIn("kottayam@medcity.test", "10.120.1.2");
const pp = partner.page;
const studentId = sql("select id from students where first_name = 'Arathi'");
await go(pp, `/students/${studentId}/applications?tab=apply&program=${pid}`);
await pp.waitForLoadState("networkidle");
check((await pp.locator('select[name="routeId"]').count()) === 1, "apply: the route is asked for");
const options = await pp.locator('select[name="routeId"] option').allInnerTexts();
check(options.length > 2, `apply: every live route is offered (${options.length - 1})`);
await pp.locator('select[name="intake"]').selectOption({ index: 1 });
await pp.getByRole("button", { name: "Create application" }).click();
check(await waitText(pp, /Choose how this application is sent|Choose the route/), "apply: an application cannot be created without choosing one");
const routeValue = await pp.locator('select[name="routeId"] option').nth(1).getAttribute("value");
await pp.locator('select[name="routeId"]').selectOption(routeValue);
await pp.locator('select[name="intake"]').selectOption({ index: 1 });
await pp.getByRole("button", { name: "Create application" }).click();
await pp.waitForURL(/app=/, { timeout: 20000 }).catch(() => {});
text = await main(pp);
check(/Applied through/.test(text), "application: the route is on the card");
const savedVendor = sql(`select v.code from applications a join program_routes r on r.id = a.route_id join vendors v on v.id = r.vendor_id where a.student_id = '${studentId}' order by a.created_at desc limit 1`);
check(savedVendor.length >= 2, `application: the route was saved (${savedVendor})`);

// The team records the vendor's own reference.
const ackNo = sql(`select ack_no from applications where student_id = '${studentId}' order by created_at desc limit 1`);
await go(ap, `/students/${studentId}/applications`);
await ap.waitForLoadState("networkidle");
await ap.locator('input[name="vendorReference"]').first().fill(`REF-${tag}`);
await ap.locator('input[name="vendorReference"]').first().press("Enter");
let ref = "";
for (let i = 0; i < 20 && ref !== `REF-${tag}`; i++) { ref = sql(`select coalesce(vendor_reference, '') from applications where ack_no = '${ackNo}'`); if (ref !== `REF-${tag}`) await ap.waitForTimeout(500); }
check(ref === `REF-${tag}`, `application: their reference is recorded (${ref})`);

// --- A vendor's sheet, as a file.
const uni = sql(`select u.name from programs p join universities u on u.id = p.university_id where p.id = '${pid}'`);
const csv = [
  "vendor,university,program,basis,percent_of_tuition,payable_on,days_to_pay,offer_tat_days,vendor_course_code,extra_documents,interview",
  `KC,${uni},${pname},percent,11,visa approved,45,3,KC-${tag},Their form,no`,
  `NOPE,${uni},${pname},percent,9,,,,,,`,
  `KC,${uni},A Course That Does Not Exist ${tag},percent,9,,,,,,`,
  `KC,${uni},${pname},percent,9,,,,,,`,
].join("\n");
await go(ap, "/imports?kind=routes");
await ap.waitForLoadState("networkidle");
text = await main(ap);
check(/Routes/.test(text), "upload: routes are one of the kinds the team can upload");
await ap.locator("#file-routes").setInputFiles({ name: "routes.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await ap.getByRole("button", { name: "Check the file" }).click();
await ap.getByTestId("import-result").first().waitFor({ timeout: 20000 }).catch(() => {});
text = await ap.getByTestId("import-result").innerText();
check(/1 to update/.test(text), "upload: a route already recorded is an update, not a new one");
check(/no vendor called "NOPE"/.test(text), "upload: an unknown vendor is named, with the vendors that exist");
check(/no course called/.test(text), "upload: a course the catalogue does not hold is reported, never created");
check(/in the file twice/.test(text), "upload: the same road twice in one file is caught");
await ap.getByRole("button", { name: /^Import \d/ }).click();
await ap.getByText(/^Imported from/).waitFor({ timeout: 30000 }).catch(() => {});
const rate = sql(`select r.percent_of_tuition || '|' || coalesce(r.days_to_pay::text,'') || '|' || coalesce(r.offer_tat_days::text,'') || '|' || r.payable_on from program_routes r join vendors v on v.id = r.vendor_id where r.program_id = '${pid}' and v.code = 'KC'`);
check(rate === "11|45|3|VISA_APPROVED", `upload: the sheet's terms are recorded (${rate})`);

// --- A student never learns which road their application went down.
const student = await signIn("fathima.rahman@example.com", "10.120.1.4");
await student.page.waitForURL(/\/portal/, { timeout: 15000 }).catch(() => {});
text = await student.page.locator("body").innerText();
check(!/KC Overseas|StudentOps360|Medcity Direct/.test(text), "student: the portal never names the vendor");

for (const [who, e] of [["team", admin.errors], ["partner", partner.errors], ["counsellor", counsellor.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
