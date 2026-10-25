// The consolidated day end report taken away: the day view downloads as an
// Excel workbook with a cover (the day, when and why the report went), a
// sheet of everybody issued a report and how they answered, and a sheet of
// the day's figures per counsellor with branch totals and the overall total,
// Not given left empty rather than written as 0. The page also has a print
// button, a print-only header with the organisation and the day, and a day
// picker beside the day before and day after links.
//
// The day looked at is yesterday, seeded with two answered reports and closed
// at its cutoff on the way in, so the sheets hold exactly what this seeds.
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

const today = sql("select (now() at time zone 'Asia/Kolkata')::date::text");
const yesterday = sql("select ((now() at time zone 'Asia/Kolkata')::date - 1)::text");
const dayBefore = sql("select ((now() at time zone 'Asia/Kolkata')::date - 2)::text");
// Everybody issued a report: Medcity's own active people, less the roles that are never issued one.
const staffCount = n("select count(*) from users u join organizations o on o.id = u.org_id where u.active and o.type in ('HQ','BRANCH') and u.role not in ('SUPER_ADMIN','MANAGEMENT','STUDENT','PARENT')");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.248.7.${ip++}` } });
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
/** Asks for the workbook the way the link does, with the session's cookies, and reads it back. */
async function download(page, query) {
  const res = await page.request.get(`${BASE}/api/journal/day${query}`);
  const body = Buffer.from(await res.body());
  const wb = new ExcelJS.Workbook();
  if (res.status() === 200) await wb.xlsx.load(body);
  return { res, body, wb, name: (res.headers()["content-disposition"] ?? "").match(/filename="([^"]+)"/)?.[1] ?? "" };
}
const sheets = (wb) => wb.worksheets.map((w) => w.name);
/** The first row whose cell in the given column reads the label. */
const rowWhere = (ws, col, label) => {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(col).value === label) return ws.getRow(r);
  return null;
};
const cells = (row, from, to) => {
  const out = [];
  for (let c = from; c <= to; c++) out.push(row.getCell(c).value ?? null);
  return out;
};

// The default clock, so a report answered at ten past five that day reads as verified in hours.
clock("17:00", "17:45", "23:59");

/* ---------------- Yesterday, seeded ---------------- */
const uk = idOf("uk.docs@medcity.test");
const germany = idOf("germany@medcity.test");
const trainee = idOf("trainee@medcity.test");
const figures = (leads, calls, connected, followUps, registrations) =>
  `'{"leadsReceived":${leads},"callsMade":${calls},"connectedCalls":${connected},"followUpsDone":${followUps},"registrationsDone":${registrations}}'::jsonb`;
// Journals began by yesterday, so yesterday is a day to close; whoever has not answered is written as missed on the way in.
sql(`insert into journal_days (day) values ('${yesterday}') on conflict do nothing`);
sql(`delete from daily_journals where user_id in ('${uk}', '${germany}', '${trainee}') and day = '${yesterday}'`);
sql(`insert into daily_journals (id, user_id, day, state, decided_at, note, entries, figures) values
  ('dx_uk', '${uk}', '${yesterday}', 'VERIFIED', '${yesterday} 17:10:00+05:30'::timestamptz, null, '[]'::jsonb, ${figures(4, 10, 3, 2, 1)}),
  ('dx_de', '${germany}', '${yesterday}', 'FLAGGED', '${yesterday} 17:25:00+05:30'::timestamptz, 'One call was logged twice.', '[]'::jsonb, ${figures(2, 8, 0, 1, 0)})`);
const exportsBefore = n("select count(*) from audit_logs where action = 'journal.export'");

/* ---------------- The report's readers ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  const text = await go(a.page, `/journal/report?day=${yesterday}`);
  check(/Closed\. Sent at/.test(text), "yesterday is closed and its report sent");

  // The controls around the day.
  check((await a.page.locator("[data-export-day]").getAttribute("href")) === `/api/journal/day?day=${yesterday}`, "Download as Excel asks for the day on screen");
  check((await a.page.locator('[data-day-picker] input[type="date"]').inputValue()) === yesterday, "the day picker holds the day shown");
  check((await a.page.locator('[data-day-picker] input[type="date"]').getAttribute("max")) === today, "and goes no further than today");
  check((await a.page.locator("[data-day-previous]").getAttribute("href")) === `/journal/report?day=${dayBefore}`, "the day before is a link");
  check((await a.page.locator("[data-day-next]").getAttribute("href")) === "/journal/report", "and the day after yesterday is today, at the plain address");
  const printButton = a.page.locator('button[data-print="hide"]', { hasText: "Print" });
  check((await printButton.count()) === 1, "there is a Print button, kept off the printed page itself");
  check((await a.page.locator("[data-print-header]").count()) === 1 && (await a.page.locator("[data-print-header]").isHidden()), "the printed page's header is on the page and hidden on screen");
  // textContent, not innerText: the header is display none on screen, and innerText of a hidden element is empty in some browsers.
  const header = (await a.page.locator("[data-print-header]").textContent()) ?? "";
  check(header.includes("Medcity") && header.includes(yesterday.slice(0, 4)), `it names the organisation and the day (${header.trim().slice(0, 80)})`);
  await a.page.locator('[data-day-picker] input[type="date"]').fill(dayBefore);
  await a.page.locator('[data-day-picker] button[type="submit"]').click();
  await a.page.waitForURL((u) => String(u).includes(`day=${dayBefore}`), { timeout: 15000 }).catch(() => {});
  check(a.page.url().includes(`/journal/report?day=${dayBefore}`), `picking a day reloads the page on it (${a.page.url()})`);
  await go(a.page, "/journal/report");
  check((await a.page.locator("[data-day-next]").count()) === 0 && (await a.page.locator('[data-day-picker] input[type="date"]').inputValue()) === today, "today has no day after, and the picker holds today");

  // The workbook.
  const d = await download(a.page, `?day=${yesterday}`);
  check(d.res.status() === 200 && (d.res.headers()["content-type"] ?? "").startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "the download is an Excel workbook");
  check(d.body[0] === 0x50 && d.body[1] === 0x4b, "and really is one: the file begins with PK");
  check(d.name === `day-end-report-${yesterday}.xlsx`, `named for the day (${d.name})`);
  check(sheets(d.wb).join(",") === "Cover,People,Figures", `with a cover, the people and the figures (${sheets(d.wb).join(", ")})`);

  const cover = d.wb.getWorksheet("Cover");
  check(rowWhere(cover, 1, "Day")?.getCell(2).value === yesterday, "the cover says which day");
  check(/^Closed\. Sent at/.test(String(rowWhere(cover, 1, "Where it stands")?.getCell(2).value)), "and that the day is closed and sent");
  check(rowWhere(cover, 1, "Report sent at")?.getCell(2).value instanceof Date, "with the time it went");
  check(/cutoff/.test(String(rowWhere(cover, 1, "Report sent because")?.getCell(2).value)), "and that it went at the cutoff");
  check(rowWhere(cover, 1, "People issued a report")?.getCell(2).value === staffCount, `and how many were issued one (${staffCount})`);
  check(rowWhere(cover, 1, "Downloaded by")?.getCell(2).value === "Anita Menon", "and who downloaded it");
  check(!!rowWhere(cover, 1, "Organisation")?.getCell(2).value, "and whose organisation it is");

  const people = d.wb.getWorksheet("People");
  check(people.rowCount === staffCount + 1, `the people sheet has a row for everybody issued a report (${people.rowCount - 1} of ${staffCount})`);
  check(cells(people.getRow(1), 1, 7).join("|") === "Branch|Name|Role|Report|Answered at (India time)|Signed in after hours at|Flag note", "headed branch, name, role, report, answered at, after hours, flag note");
  const ukRow = rowWhere(people, 2, "UK Documentation");
  check(ukRow && cells(ukRow, 1, 7).join("|") === "Medcity Kottayam|UK Documentation|Counsellor|Verified|5:10 PM||", `a verified report carries its standing and the India time it was answered (${ukRow && cells(ukRow, 1, 7).join("|")})`);
  const deRow = rowWhere(people, 2, "Germany Counsellor");
  check(deRow && deRow.getCell(4).value === "Flagged a problem" && deRow.getCell(7).value === "One call was logged twice.", "a flagged report carries its note");
  const missedRow = rowWhere(people, 2, "Rohit Das");
  check(missedRow && missedRow.getCell(4).value === "Missed" && missedRow.getCell(5).value === null && missedRow.getCell(7).value === null, "a missed report has no time and no note");
  check(people.getRow(2).getCell(4).value === "Missed", "the ones that need a look come first, as on screen");

  const fig = d.wb.getWorksheet("Figures");
  check(cells(fig.getRow(1), 1, 8).join("|") === "Branch|Counsellor|Role|Leads received|Calls made|Connected calls|Follow-ups done|Registrations done", "the figures sheet is headed with the five figures");
  const ukFig = rowWhere(fig, 2, "UK Documentation");
  check(ukFig && cells(ukFig, 4, 8).join(",") === "4,10,3,2,1", "a counsellor's five figures are numbers");
  const deFig = rowWhere(fig, 2, "Germany Counsellor");
  check(deFig && deFig.getCell(6).value === 0, "a typed 0 stays 0");
  const missedFig = rowWhere(fig, 2, "Rohit Das");
  check(missedFig && cells(missedFig, 4, 8).every((v) => v === null), "Not given is an empty cell, never 0");
  check(!rowWhere(fig, 2, "Nithin Jose"), "a documentation officer gives no figures and has no row");
  const ktm = rowWhere(fig, 2, "Medcity Kottayam total");
  check(ktm && ktm.getCell(4).value === 6 && ktm.getCell(5).value === 18 && ktm.getCell(6).value === 3 && /gave figures/.test(String(ktm.getCell(3).value)), "a branch total adds up its counsellors as numbers");
  const all = fig.getRow(fig.rowCount);
  check(all.getCell(1).value === "All branches" && all.getCell(4).value === 6 && all.getCell(8).value === 1, "and the last row is the overall total");
  check(!!ktm?.font?.bold && !!all.font?.bold, "the totals are bold");

  const plain = await download(a.page, "");
  check(plain.res.status() === 200 && plain.name === `day-end-report-${today}.xlsx`, `no day named means today (${plain.name})`);
  const ahead = await download(a.page, "?day=2999-01-01");
  check(ahead.res.status() === 200 && ahead.name === `day-end-report-${today}.xlsx`, "a day ahead falls back to today, as the page does");
  check(
    n(`select count(*) from audit_logs where action = 'journal.export' and entity_id = '${yesterday}' and meta->>'view' = 'day'`) >= 1 &&
      n("select count(*) from audit_logs where action = 'journal.export'") >= exportsBefore + 3,
    "every download is in the audit log, with the day",
  );
  check(a.errors.length === 0, `the day view draws without an error ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();

  const m = await open("management@medcityoverseas.test");
  const theirs = await download(m.page, `?day=${yesterday}`);
  check(theirs.res.status() === 200 && theirs.body[0] === 0x50 && theirs.body[1] === 0x4b, "management can download the day");
  await m.ctx.close();
}

/* ---------------- Who is kept out ---------------- */
{
  const c = await open("uk.docs@medcity.test");
  const refused = await c.page.request.get(`${BASE}/api/journal/day?day=${yesterday}`);
  check(refused.status() === 404, `a counsellor cannot download the day report (${refused.status()})`);
  await c.ctx.close();

  const h = await open("kottayam@medcity.test");
  check((await h.page.request.get(`${BASE}/api/journal/day?day=${yesterday}`)).status() === 404, "nor can a branch head, who reads the month and not the day");
  await h.ctx.close();

  const anon = await fetch(`${BASE}/api/journal/day?day=${yesterday}`);
  check(anon.status === 401, "nobody signed in gets nothing");
}

clock("17:00", "17:45", "23:59");
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
