// The month of day end figures: each counsellor's five figures added up over
// the reports they answered that month, with the days answered and missed,
// grouped by branch with totals, a day-by-day list per person, a branch
// filter for the report's readers, a branch head's own branch and nothing
// else, and the whole month as an Excel workbook with a sheet per branch.
//
// The month looked at is two months back, which no other suite writes to, so
// the sums here are exactly what this suite seeds.
// Wants the plain seed.
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const clock = (dayEnd, outOfHours, cutoff) =>
  sql(`insert into app_settings (id) values ('app') on conflict do nothing;
       update app_settings set journal_day_end = '${dayEnd}', journal_out_of_hours = '${outOfHours}', journal_cutoff = '${cutoff}', journal_on_sundays = true where id = 'app'`);
const idOf = (email) => sql(`select id from users where email = '${email}'`);

// The month two months back, in India time, and the ones either side of it.
const month = sql("select to_char(date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) - interval '2 months', 'YYYY-MM')");
const monthBefore = sql("select to_char(date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) - interval '3 months', 'YYYY-MM')");
const monthAfter = sql("select to_char(date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) - interval '1 month', 'YYYY-MM')");
const thisMonth = sql("select to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM')");
const day = (d) => `${month}-${String(d).padStart(2, "0")}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 40;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.247.5.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 120)); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const go = async (page, path) => {
  await page.goto(`${BASE}${path}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};
const cell = async (page, row, key) => (await page.locator(`${row} [data-col="${key}"]`).innerText()).trim();
/** Asks for the workbook the way the link does, with the session's cookies, and reads it back. */
async function download(page, query) {
  const res = await page.request.get(`${BASE}/api/journal/figures${query}`);
  const body = Buffer.from(await res.body());
  const wb = new ExcelJS.Workbook();
  if (res.status() === 200) await wb.xlsx.load(body);
  return { res, body, wb, name: (res.headers()["content-disposition"] ?? "").match(/filename="([^"]+)"/)?.[1] ?? "" };
}
const sheets = (wb) => wb.worksheets.map((w) => w.name);
const rowOf = (ws, label) => {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(1).value === label) return ws.getRow(r);
  return null;
};

// The default clock, so a report answered at ten past five that day reads as verified in hours.
clock("17:00", "17:45", "23:59");

/* ---------------- Two months back, seeded ---------------- */
const uk = idOf("uk.docs@medcity.test");
const germany = idOf("germany@medcity.test");
const trainee = idOf("trainee@medcity.test");
const kochiHead = idOf("kochi@medcity.test");
const kottayam = sql(`select org_id from users where id = '${uk}'`);
const kochi = sql(`select org_id from users where id = '${kochiHead}'`);
const figures = (leads, calls, connected, followUps, registrations) =>
  `'{"leadsReceived":${leads},"callsMade":${calls},"connectedCalls":${connected},"followUpsDone":${followUps},"registrationsDone":${registrations}}'::jsonb`;
const at = (d) => `'${day(d)} 17:10:00+05:30'::timestamptz`;
sql(`delete from daily_journals where user_id in ('${uk}', '${germany}', '${trainee}', '${kochiHead}') and day >= '${day(1)}' and day < '${monthAfter}-01'`);
sql(`insert into daily_journals (id, user_id, day, state, decided_at, note, entries, figures) values
  ('dm_uk1', '${uk}', '${day(1)}', 'VERIFIED', ${at(1)}, null, '[]'::jsonb, ${figures(4, 10, 3, 2, 1)}),
  ('dm_uk2', '${uk}', '${day(2)}', 'FLAGGED', ${at(2)}, 'One call was logged twice.', '[]'::jsonb, ${figures(1, 5, 2, 1, 0)}),
  ('dm_uk3', '${uk}', '${day(3)}', 'MISSED', null, null, '[]'::jsonb, null),
  ('dm_uk4', '${uk}', '${day(4)}', 'MISSED', null, null, '[]'::jsonb, ${figures(100, 100, 100, 100, 100)}),
  ('dm_de1', '${germany}', '${day(1)}', 'VERIFIED', ${at(1)}, null, '[]'::jsonb, ${figures(2, 8, 4, 0, 0)}),
  ('dm_de2', '${germany}', '${day(2)}', 'MISSED', null, null, '[]'::jsonb, null),
  ('dm_de3', '${germany}', '${day(3)}', 'MISSED', null, null, '[]'::jsonb, null),
  ('dm_ko1', '${kochiHead}', '${day(1)}', 'VERIFIED', ${at(1)}, null, '[]'::jsonb, ${figures(7, 20, 9, 3, 2)})`);
// The UK counsellor: 4 + 1 leads, 10 + 5 calls, 3 + 2 connected, 2 + 1 follow-ups, 1 + 0 registrations over two answered days, two
// missed, and the hundreds on the fourth, written against a missed day, count for nothing.

/* ---------------- The report's readers see every branch ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, "/journal/report");
  check((await a.page.locator("[data-month-view]").count()) === 1, "the day report has a link to the month");
  const text = await go(a.page, `/journal/report?view=month&month=${month}`);
  check((await a.page.locator(`[data-month-figures][data-month="${month}"]`).count()) === 1, "the month view opens on the month asked for");
  check(/Day end figures/.test(text), "and is headed Day end figures");
  const ukRow = `[data-month-row="${uk}"]`;
  check(
    (await cell(a.page, ukRow, "leadsReceived")) === "5" &&
      (await cell(a.page, ukRow, "callsMade")) === "15" &&
      (await cell(a.page, ukRow, "connectedCalls")) === "5" &&
      (await cell(a.page, ukRow, "followUpsDone")) === "3" &&
      (await cell(a.page, ukRow, "registrationsDone")) === "1",
    `a counsellor's five figures are summed over the days they answered (${await cell(a.page, ukRow, "leadsReceived")} leads, ${await cell(a.page, ukRow, "callsMade")} calls)`,
  );
  check((await cell(a.page, ukRow, "answered")) === "2" && (await cell(a.page, ukRow, "missed")) === "2", "with the days answered and the days missed");
  check((await cell(a.page, `[data-month-row="${germany}"]`, "leadsReceived")) === "2" && (await cell(a.page, `[data-month-row="${germany}"]`, "missed")) === "2", "a flagged day counts as answered and a missed day adds nothing");
  check((await a.page.locator(`[data-month-row="${trainee}"]`).innerText()).includes("Not given") && (await cell(a.page, `[data-month-row="${trainee}"]`, "answered")) === "0", "a counsellor who answered nothing that month reads Not given");
  check((await a.page.locator(`[data-month-row="${idOf("documentation@medcityoverseas.test")}"]`).count()) === 0, "a documentation officer has no row");
  const ktm = `[data-month-branch="${kottayam}"]`;
  check((await cell(a.page, ktm, "leadsReceived")) === "7" && (await cell(a.page, ktm, "callsMade")) === "23" && (await cell(a.page, ktm, "answered")) === "3" && (await cell(a.page, ktm, "missed")) === "4", "a branch total adds up its counsellors");
  check((await a.page.locator(`[data-month-row="${kochiHead}"]`).count()) === 1 && (await cell(a.page, `[data-month-row="${kochiHead}"]`, "leadsReceived")) === "7", "a branch head's own figures are in their branch");
  check((await cell(a.page, "[data-month-total]", "leadsReceived")) === "14" && (await cell(a.page, "[data-month-total]", "registrationsDone")) === "3", "the overall total adds up every branch");
  check((await a.page.locator("[data-month-branch-head]").count()) >= 2, "the branches are listed under their own headings");

  // Moving between months.
  check((await a.page.locator("[data-month-previous]").getAttribute("href")).includes(`month=${monthBefore}`), "the month before is a link");
  check((await a.page.locator("[data-month-next]").getAttribute("href")).includes(`month=${monthAfter}`), "and so is the month after");
  check((await a.page.locator('[data-month-picker] input[type="month"]').inputValue()) === month, "the month picker holds the month shown");
  await go(a.page, `/journal/report?view=month&month=${thisMonth}`);
  check((await a.page.locator("[data-month-next]").count()) === 0, "this month has no month after to go to");
  await go(a.page, `/journal/report?view=month&month=2999-01`);
  check((await a.page.locator(`[data-month-figures][data-month="${thisMonth}"]`).count()) === 1, "a month ahead falls back to this month");
  await go(a.page, "/journal/report?view=month");
  check((await a.page.locator(`[data-month-figures][data-month="${thisMonth}"]`).count()) === 1, "no month named means this month");

  // The branch filter.
  await go(a.page, `/journal/report?view=month&month=${month}&org=${kottayam}`);
  check((await a.page.locator(`[data-branch-filter] [data-branch-option="${kottayam}"]`).count()) === 1, "the report's readers have a branch filter");
  check((await a.page.locator(`[data-month-row="${kochiHead}"]`).count()) === 0 && (await a.page.locator(`[data-month-row="${uk}"]`).count()) === 1, "narrowed to one branch, the other branch's people are gone");
  check((await cell(a.page, "[data-month-total]", "leadsReceived")) === "7", "and the total is that branch's");

  // One person, day by day.
  await a.page.locator(`[data-month-person="${uk}"]`).click();
  await a.page.waitForURL((u) => String(u).includes(`user=${uk}`), { timeout: 15000 }).catch(() => {});
  await hydrated(a.page);
  check((await a.page.locator(`[data-month-days="${uk}"]`).count()) === 1, "a counsellor's name opens their month day by day");
  check((await a.page.locator("[data-month-day]").count()) === 4, "with a row for every day a report was issued");
  check((await cell(a.page, `[data-month-day="${day(1)}"]`, "leadsReceived")) === "4" && (await a.page.locator(`[data-month-day="${day(1)}"]`).getAttribute("data-standing")) === "VERIFIED", "a verified day shows what was given");
  check((await a.page.locator(`[data-month-day="${day(2)}"]`).getAttribute("data-standing")) === "FLAGGED" && (await a.page.locator(`[data-month-day="${day(2)}"]`).innerText()).includes("logged twice"), "a flagged day shows its reason");
  check((await a.page.locator(`[data-month-day="${day(4)}"]`).getAttribute("data-standing")) === "MISSED" && (await a.page.locator(`[data-month-day="${day(4)}"]`).innerText()).includes("Not given"), "a missed day reads Not given whatever is stored against it");
  check((await a.page.locator(`[data-month-day="${day(1)}"] a[href*="/journal?user=${uk}&day=${day(1)}"]`).count()) === 1, "and a day opens that day's report");
  await a.page.locator("[data-month-days-close]").click();
  await a.page.waitForURL((u) => !String(u).includes("user="), { timeout: 15000 }).catch(() => {});
  check((await a.page.locator("[data-month-days]").count()) === 0, "Close puts the list away");

  // The workbook.
  const link = await a.page.locator("[data-export-figures]").getAttribute("href");
  check(link === `/api/journal/figures?month=${month}&org=${kottayam}`, `Download as Excel asks for the month and branch on screen (${link})`);
  const whole = await download(a.page, `?month=${month}`);
  check(whole.res.status() === 200 && (whole.res.headers()["content-type"] ?? "").startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "the download is an Excel workbook");
  check(whole.body[0] === 0x50 && whole.body[1] === 0x4b, "and really is one: the file begins with PK");
  check(whole.name === `day-end-figures-${month}.xlsx`, `named for the month (${whole.name})`);
  check(sheets(whole.wb).includes("Cover") && sheets(whole.wb).includes("Totals") && sheets(whole.wb).includes("Medcity Kottayam") && sheets(whole.wb).includes("Medcity Kochi"), `with a cover, the totals and a sheet per branch (${sheets(whole.wb).join(", ")})`);
  check(sheets(whole.wb).every((s) => s.length <= 31), "no sheet name longer than Excel allows");
  const ktmTotals = rowOf(whole.wb.getWorksheet("Totals"), "Medcity Kottayam");
  check(ktmTotals && ktmTotals.getCell(3).value === 3 && ktmTotals.getCell(4).value === 4 && ktmTotals.getCell(5).value === 7 && ktmTotals.getCell(6).value === 23, "the totals sheet carries each branch's days and figures as numbers");
  const all = rowOf(whole.wb.getWorksheet("Totals"), "All branches");
  check(all && all.getCell(5).value === 14, "and the overall total");
  const ukSheet = rowOf(whole.wb.getWorksheet("Medcity Kottayam"), "UK Documentation");
  check(ukSheet && ukSheet.getCell(3).value === 2 && ukSheet.getCell(4).value === 2 && ukSheet.getCell(5).value === 5 && ukSheet.getCell(6).value === 15, "a branch sheet has a row per counsellor with their sums");
  check(!!rowOf(whole.wb.getWorksheet("Medcity Kottayam"), "Medcity Kottayam total"), "and the branch total under them");
  const one = await download(a.page, `?month=${month}&org=${kottayam}`);
  check(one.name === `day-end-figures-medcity-kottayam-${month}.xlsx` && !sheets(one.wb).includes("Medcity Kochi"), `narrowed to a branch, the file is named for it and holds only it (${one.name})`);
  check(n("select count(*) from audit_logs where action = 'journal.export'") >= 2, "every download is in the audit log");
  check(a.errors.length === 0, `the month view draws without an error ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();

  const m = await open("management@medcityoverseas.test");
  await go(m.page, `/journal/report?view=month&month=${month}`);
  check((await m.page.locator("[data-month-figures]").count()) === 1, "management can read the month");
  await m.ctx.close();
}

/* ---------------- A branch head sees their own branch ---------------- */
{
  const h = await open("kottayam@medcity.test");
  // The menu folds its groups away from the page being read; the Account
  // group is open on the day end report itself.
  await go(h.page, "/journal");
  check((await h.page.locator('nav[aria-label="Main"]').getByText("Day end figures", { exact: true }).count()) === 1, "a branch head has the day end figures in the menu");
  await go(h.page, `/journal/report?month=${month}`);
  check(h.page.url().includes("/journal/report") && (await h.page.locator(`[data-month-figures][data-month="${month}"]`).count()) === 1, "the report address opens the month view for a branch head, who has no day report to read");
  check((await h.page.locator(`[data-month-row="${uk}"]`).count()) === 1 && (await cell(h.page, `[data-month-row="${uk}"]`, "leadsReceived")) === "5", "with their own counsellors' sums");
  check((await h.page.locator(`[data-month-row="${kochiHead}"]`).count()) === 0 && (await h.page.locator("[data-month-branch-head]").count()) === 1, "and no other branch");
  check((await h.page.locator("[data-branch-filter]").count()) === 0 && (await h.page.locator("[data-day-view]").count()) === 0, "no branch filter and no day view for them");
  await go(h.page, `/journal/report?view=month&month=${month}&org=${kochi}`);
  check((await h.page.locator(`[data-month-row="${kochiHead}"]`).count()) === 0 && (await h.page.locator(`[data-month-row="${uk}"]`).count()) === 1, "asking for another branch in the address still shows their own");
  await go(h.page, `/journal/report?view=month&month=${month}&user=${kochiHead}`);
  check((await h.page.locator("[data-month-days]").count()) === 0, "and another branch's counsellor does not open day by day");
  await go(h.page, `/journal/report?view=month&month=${month}&user=${uk}`);
  check((await h.page.locator(`[data-month-days="${uk}"]`).count()) === 1 && (await h.page.locator(`[data-month-day="${day(1)}"] a`).count()) === 0, "their own counsellor does, without a link into the day report that is not theirs");
  const theirs = await download(h.page, `?month=${month}&org=${kochi}`);
  check(theirs.res.status() === 200 && theirs.body[0] === 0x50 && theirs.body[1] === 0x4b, "a branch head can download the workbook");
  check(theirs.name === `day-end-figures-medcity-kottayam-${month}.xlsx` && sheets(theirs.wb).includes("Medcity Kottayam") && !sheets(theirs.wb).includes("Medcity Kochi"), `and gets their own branch whatever the address asks for (${theirs.name})`);
  check(h.errors.length === 0, `no errors for the branch head ${h.errors.slice(0, 2).join(" | ")}`);
  await h.ctx.close();
}

/* ---------------- Who is kept out ---------------- */
{
  const c = await open("uk.docs@medcity.test");
  await c.page.goto(`${BASE}/journal/report?view=month&month=${month}`);
  await c.page.waitForLoadState("domcontentloaded");
  check(!c.page.url().includes("/journal/report"), "a counsellor cannot open the month view");
  const refused = await c.page.request.get(`${BASE}/api/journal/figures?month=${month}`);
  check(refused.status() === 404, `nor download the workbook (${refused.status()})`);
  await c.ctx.close();

  const sub = await open("owner@horizon.test");
  await sub.page.goto(`${BASE}/journal/report?view=month&month=${month}`);
  await sub.page.waitForLoadState("domcontentloaded");
  check(!sub.page.url().includes("/journal/report"), "a sub-agent's owner has no day end reports to read, so no month of them");
  check((await sub.page.request.get(`${BASE}/api/journal/figures?month=${month}`)).status() === 404, "and no workbook");
  await sub.ctx.close();

  const anon = await fetch(`${BASE}/api/journal/figures?month=${month}`);
  check(anon.status === 401, "nobody signed in gets nothing");
}

clock("17:00", "17:45", "23:59");
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
