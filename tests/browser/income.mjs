// Income per student: the sheet and its totals, lines with no amount reading Not
// recorded, rate cards that are added rather than edited, a booked service
// writing its own line, writing money off, the departure board and the leakage
// report, and who may see money at all. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-income";
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
const toast = (page, re, timeout = 15000) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}
const tag = String(Date.now()).slice(-5);

// --- The sheet.
const admin = await signIn("admin@medcityoverseas.test", "10.180.1.1");
const ap = admin.page;
// A student whose service fee is still owed and who has a line nobody has
// priced, so both halves of the sheet can be tested on one file.
const student = sql(`select l.student_id from income_lines l where l.kind = 'SERVICE_FEE' and l.state = 'EXPECTED' and exists (select 1 from income_lines f where f.student_id = l.student_id and f.expected_amount is null and f.commission_id is null) limit 1`);
const studentName = sql(`select first_name from students where id = '${student}'`);
let text = await go(ap, `/students/${student}/income`);
check(/expected/i.test(text) && /received/i.test(text) && /still to come in/i.test(text), "sheet: it opens on what is expected, what is in and what is owed");
check(/Not recorded/.test(text), "sheet: a line with no amount reads Not recorded");
check(/with no amount on them/.test(text), "sheet: and the sheet says how many there are");
check(/Service fee/.test(text), "sheet: the lines are named in plain words");
check(/matches the bank/.test(text), "sheet: it says why nothing is converted into rupees");
await ap.screenshot({ path: `${OUT}/01-sheet.png`, fullPage: true });

// Commission is read from the placement rather than copied.
const commissionStudent = sql("select student_id from income_lines where kind = 'COMMISSION' limit 1");
text = await go(ap, `/students/${commissionStudent}/income`);
check(/Read from the commission on the placement/.test(text), "sheet: a commission line says the figure is read, not copied");
const copied = sql("select count(*) from income_lines where kind = 'COMMISSION' and expected_amount is not null");
check(copied === "0", "sheet: and no commission figure is stored twice");

// --- Money in, part payment and all.
const feeLine = sql(`select id from income_lines where student_id = '${student}' and kind = 'SERVICE_FEE'`);
const feeAmount = sql(`select expected_amount from income_lines where id = '${feeLine}'`);
await go(ap, `/students/${student}/income`);
let row = ap.locator("tr").filter({ hasText: "Service fee" }).first();
await row.getByRole("button", { name: "Money in" }).click();
await ap.locator('input[name="receivedAmount"]').first().fill(String(Math.floor(Number(feeAmount) / 2)));
await ap.getByRole("button", { name: "Record it" }).click();
check(await toast(ap, /Part payment/), "money in: a part payment is called one");
check((await waitSql(`select state from income_lines where id = '${feeLine}'`, "EXPECTED")) === "EXPECTED", "money in: the line stays open until the whole of it is in");
text = await go(ap, `/students/${student}/income`);
check(/still to come in/i.test(text), "money in: and what is left shows as owed");
row = ap.locator("tr").filter({ hasText: "Service fee" }).first();
await row.getByRole("button", { name: "Money in" }).click();
await ap.locator('input[name="receivedAmount"]').first().fill(feeAmount);
await ap.getByRole("button", { name: "Record it" }).click();
check(await toast(ap, /received in full/), "money in: the whole of it closes the line");
check((await waitSql(`select state from income_lines where id = '${feeLine}'`, "RECEIVED")) === "RECEIVED", "money in: and it is recorded as received");

// --- A line by hand.
await go(ap, `/students/${student}/income`);
await ap.getByRole("button", { name: "Add a line" }).click();
await ap.locator('select[name="kind"]').first().selectOption("PICKUP");
await ap.locator('input[name="expectedAmount"]').first().fill("1200");
await ap.locator('textarea[name="note"]').first().fill(`Airport pickup through Sample Cabs ${tag}`);
await ap.getByRole("button", { name: "Add the line" }).click();
check(await toast(ap, /Airport pickup saved/), "line: adding one by hand is confirmed");
check((await waitSql(`select count(*) from income_lines where student_id = '${student}' and kind = 'PICKUP'`, "1")) === "1", "line: it is recorded");

// Laying out the usual lines from the rate card.
await go(ap, `/students/${student}/income`);
const before = sql(`select count(*) from income_lines where student_id = '${student}'`);
await ap.getByRole("button", { name: "Lay out the usual lines" }).click();
check(/priced from your branch/.test(await main(ap)), "lay out: it says where the figures come from");
await ap.getByRole("button", { name: "Add them" }).click();
check(await toast(ap, /line|lines/), "lay out: it says what it did");
const after = sql(`select count(*) from income_lines where student_id = '${student}'`);
check(Number(after) > Number(before), `lay out: the lines are added (${before} to ${after})`);
check(sql(`select count(*) from income_lines where student_id = '${student}' and expected_amount is null`) !== "0", "lay out: a kind with no rate is still added, with no amount");

// --- Rate cards: added, never edited.
text = await go(ap, "/admin/income?tab=rates");
check(/added rather than edited/.test(text), "rates: the screen says a rate is added, not edited");
check(/Service fee/.test(text) && /medcity keeps/i.test(text), "rates: the cards are listed with what Medcity keeps");
await ap.locator("#rc-kind").selectOption("SIM");
await ap.locator("#rc-amount").fill("900");
await ap.locator("#rc-note").fill(`New SIM rate ${tag}`);
await ap.getByRole("button", { name: "Record the rate" }).click();
check(await toast(ap, /rate recorded from/), "rates: a new rate is recorded");
check((await waitSql(`select count(*) from rate_cards where note = 'New SIM rate ${tag}'`, "1")) === "1", "rates: and kept");
check(sql("select count(*) from rate_cards where kind = 'SIM'") === "2", "rates: the old one is kept beside it rather than overwritten");
// Both a flat amount and a percentage is refused.
await ap.locator("#rc-kind").selectOption("PICKUP");
await ap.locator("#rc-amount").fill("500");
await ap.locator("#rc-percent").fill("2");
await ap.getByRole("button", { name: "Record the rate" }).click();
check(await waitText(ap, /One or the other, not both/), "rates: a flat amount and a percentage together is refused");

// --- A booked service writes its own line.
const svcStudent = sql("select id from students order by created_at limit 1");
const svcOrg = sql(`select org_id from students where id = '${svcStudent}'`);
sql(`insert into service_requests (id, student_id, org_id, type, status, details) values ('svc${tag}', '${svcStudent}', '${svcOrg}', 'FLIGHT', 'IN_PROGRESS', 'Needs a one-way ticket for September')`);
text = await go(ap, "/admin/services");
const svcRow = ap.locator("form").filter({ has: ap.locator(`input[value="svc${tag}"]`) }).first();
if ((await svcRow.count()) > 0) {
  await svcRow.locator('select[name="status"]').selectOption("DONE");
  await svcRow.locator('input[name="provider"]').fill("Sample Travel");
  await svcRow.getByRole("button").last().click();
  check(
  (await toast(ap, /income line/)) || (await waitSql(`select count(*) from income_lines where service_request_id = 'svc${tag}'`, "1")) === "1",
  "service: booking one writes its income line",
);
  check((await waitSql(`select count(*) from income_lines where service_request_id = 'svc${tag}'`, "1")) === "1", "service: the line exists");
  check(sql(`select kind from income_lines where service_request_id = 'svc${tag}'`) === "TICKET", "service: of the right kind");
  check(sql(`select expected_amount is not null from income_lines where service_request_id = 'svc${tag}'`) === "t", "service: priced from the rate card");
} else {
  bad("service: the request did not appear on the team's screen");
}

// --- The departure board and leakage.
sql("update applications set visa_decision = 'GRANTED', visa_decision_on = current_date - 10 where id in (select id from applications order by created_at limit 4)");
text = await go(ap, "/admin/income");
check(/Leaving soon/.test(text), "departures: the board exists");
check(/not booked/i.test(text), "departures: what each has not bought is beside them");
check(/before they buy it somewhere else/.test(text), "departures: and it says why anybody should care");
await ap.screenshot({ path: `${OUT}/02-departures.png`, fullPage: true });
text = await go(ap, "/admin/income?tab=leakage");
check(/What was left on the table/.test(text), "leakage: the report exists");
check(/A shortlist is not a missed sale/.test(text), "leakage: it says who is counted and who is not");
check(/Forex card|Ticket|SIM/.test(text), "leakage: by kind");

// --- Writing money off: a super admin only, with a reason.
const offLine = sql(`select id from income_lines where student_id = '${student}' and kind = 'PICKUP'`);
await go(ap, `/students/${student}/income`);
check((await ap.getByRole("button", { name: "Write off" }).count()) === 0, "write off: an admin is not offered it");
const sup = await signIn("sreejith@miak.in", "10.180.1.2");
await go(sup.page, `/students/${student}/income`);
const offRow = sup.page.locator("tr").filter({ hasText: "Airport pickup" }).first();
await offRow.getByRole("button", { name: "Write off" }).click();
await sup.page.getByRole("button", { name: "Write it off" }).last().click();
check(await waitText(sup.page, /Say why it will never come in/), "write off: a reason is required");
await sup.page.locator('textarea[name="reason"]').first().fill("The cab company has shut down and will not pay.");
await sup.page.getByRole("button", { name: "Write it off" }).last().click();
check(await toast(sup.page, /Written off/), "write off: with a reason it goes through");
check((await waitSql(`select state from income_lines where id = '${offLine}'`, "WRITTEN_OFF")) === "WRITTEN_OFF", "write off: the state is recorded");
text = await go(sup.page, `/students/${student}/income`);
check(/cab company has shut down/.test(text), "write off: the reason stays on the sheet rather than the line vanishing");
check(sql(`select count(*) from audit_logs where action = 'income.write_off' and entity_id = '${offLine}'`) === "1", "write off: and it is in the audit log");

// --- Who may see money at all.
const owner = sql("select org_id from users where email = 'kottayam@medcity.test'");
sql(`update organizations set counsellors_see_commission = false where id = '${owner}'`);
const counsellor = await signIn("uk.docs@medcity.test", "10.180.1.3");
const theirs = sql(`select id from students where org_id = '${owner}' limit 1`);
text = await go(counsellor.page, `/students/${theirs}/income`);
check(/Not for counsellors at this branch/.test(text), "roles: the income sheet follows the owner's switch, not a second one");
sql(`update organizations set counsellors_see_commission = true where id = '${owner}'`);
text = await go(counsellor.page, `/students/${theirs}/income`);
check(/expected/i.test(text), "roles: and opens again when the owner allows it");
const mgmt = await signIn("management@medcityoverseas.test", "10.180.1.4");
text = await go(mgmt.page, "/admin/income?tab=rates");
check((await mgmt.page.getByRole("button", { name: "Record the rate" }).count()) === 0, "roles: management reads the rates and changes nothing");

for (const [who, e] of [["admin", admin.errors], ["super admin", sup.errors], ["counsellor", counsellor.errors], ["management", mgmt.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
