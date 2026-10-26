// Every dashboard downloads as an Excel workbook of exactly what is on the
// screen: the role's own dashboard or the one viewed as, the branch or
// counsellor picked, and the period, with the lists behind the figures in full.
// Wants the plain seed.
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// One person's own students, as the portal's rule reads them: inside their
// branch, and registered by them, assigned to them, or worked by them in a
// recorded way. The counsellor's dashboard counts these, and so does its file.
const own = (id) => n(`select count(*) from students s where s.org_id = (select org_id from users where id = '${id}') and not s.archived and (
  s.created_by_id = '${id}' or s.assigned_to_id = '${id}'
  or exists (select 1 from applications a where a.student_id = s.id and a.officer_id = '${id}')
  or exists (select 1 from checklist_items c where c.student_id = s.id and (c.claimed_by_id = '${id}' or c.decided_by_id = '${id}'))
  or exists (select 1 from student_people p where p.student_id = s.id and p.user_id = '${id}'))`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 30;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.246.4.${ip++}` }, acceptDownloads: true });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page };
}
/** Downloads the workbook the way a person would: the dashboard's own Excel link. */
async function workbook(page, path = "/dashboard") {
  await page.goto(`${BASE}${path}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.locator("[data-export]").first().click()]);
  const file = await dl.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return { wb, name: dl.suggestedFilename() };
}
const cover = (wb, label) => {
  const ws = wb.getWorksheet("Cover");
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(1).value === label) return String(ws.getRow(r).getCell(2).value);
  return null;
};
const figure = (wb, label) => {
  const ws = wb.getWorksheet("Figures");
  for (let r = 2; r <= ws.rowCount; r++) if (String(ws.getRow(r).getCell(1).value).startsWith(label)) return ws.getRow(r).getCell(2).value;
  return null;
};
const sheets = (wb) => wb.worksheets.map((w) => w.name);

/* Leadership: the whole portal. */
{
  const { ctx, page } = await open("sreejith@miak.in");
  const { wb, name } = await workbook(page);
  check(/^dashboard-leadership-\d{4}-\d{2}-\d{2}\.xlsx$/.test(name), `the file is named for the dashboard and the day (${name})`);
  check(cover(wb, "Dashboard") === "Leadership", "the cover says which dashboard");
  check(figure(wb, "Total registrations") === n("select count(*) from students where not archived"), "registrations agree with the database");
  check(figure(wb, "Total applications") === n("select count(*) from applications"), "applications agree with the database");
  const live = n(`select count(*) from applications a join status_definitions d on d.id = a.status_id where d."group" in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER','SUCCESS')`);
  check(wb.getWorksheet("Applications by stage").rowCount - 1 === live, `every live application is listed in full, not the handful on screen (${live})`);
  check(sheets(wb).includes("Branches compared") && sheets(wb).includes("Placements"), `with the branches and the placements (${sheets(wb).join(", ")})`);
  check(wb.getWorksheet("Figures").getColumn(2).values.some((v) => typeof v === "number"), "figures are numbers, not text, so they can be summed");

  // Viewing as one counsellor downloads that counsellor's own.
  const who = sql(`select u.id from users u where u.role = 'COUNSELLOR' and u.active order by (select count(*) from students s where s.assigned_to_id = u.id) desc limit 1`);
  const theirs = await workbook(page, `/dashboard?as=counsellor&who=${who}`);
  check(cover(theirs.wb, "Dashboard") === "Counsellor", "viewing as a counsellor downloads the counsellor's dashboard");
  check(figure(theirs.wb, "Total registrations") === own(who), "counting only their own students");
  check(sheets(theirs.wb).includes("Follow-ups"), "with their follow-ups");

  // A period narrows what happened.
  const month = await workbook(page, "/dashboard?period=month");
  const monthStart = sql("select to_char(date_trunc('month', now()), 'YYYY-MM-DD')");
  check(figure(month.wb, "Total registrations") === n(`select count(*) from students where not archived and created_at >= '${monthStart}'`), "a period on screen is the period in the file");
  await ctx.close();
}

/* Finance: money only. */
{
  const { ctx, page } = await open("finance@medcityoverseas.test");
  const { wb } = await workbook(page);
  check(cover(wb, "Dashboard") === "Finance", "finance downloads the money");
  check(!sheets(wb).includes("Applications by stage") && sheets(wb).includes("Ageing"), `and no students (${sheets(wb).join(", ")})`);
  check(wb.getWorksheet("Latest payments").rowCount - 1 === Math.min(6, n("select count(*) from invoice_payments")), "with the latest payments");
  await ctx.close();
}

/* Documentation: no money anywhere. */
{
  const { ctx, page } = await open("documentation@medcityoverseas.test");
  const { wb } = await workbook(page);
  check(cover(wb, "Dashboard") === "Documentation", "the documentation desk downloads documents");
  const words = wb.worksheets.flatMap((w) => w.getSheetValues().flat().map(String)).join(" ");
  check(!/revenue|commission|rupees/i.test(words), "with no money in it");
  const inPlay = n(`select count(*) from checklist_items c join students s on s.id = c.student_id where not s.archived and (c.state in ('ASKED','UPLOADED','IN_REVIEW','REJECTED') or (c.state = 'ACCEPTED' and c.decided_at >= now() - interval '7 days'))`);
  check(wb.getWorksheet("Documents").rowCount - 1 === inPlay, `every document in play is listed (${inPlay})`);
  await ctx.close();
}

/* A counsellor gets their own, whatever the address asks for. */
{
  const { ctx, page } = await open("uk.docs@medcity.test");
  const me = sql("select id from users where email = 'uk.docs@medcity.test'");
  const { wb } = await workbook(page, "/dashboard?as=leadership");
  check(cover(wb, "Dashboard") === "Counsellor", "a counsellor cannot download leadership's by changing the address");
  check(figure(wb, "Total registrations") === own(me), "and their own counts only their students");
  const direct = await page.request.get(`${BASE}/api/dashboard/export?as=finance`);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await direct.body());
  check(cover(wb2, "Dashboard") === "Counsellor", "even when the file is asked for directly");
  await ctx.close();
}

/* A branch head: the branch, its team and who is not given to anyone. */
{
  const { ctx, page } = await open("kottayam@medcity.test");
  const { wb } = await workbook(page);
  const org = sql("select org_id from users where email = 'kottayam@medcity.test'");
  check(cover(wb, "Dashboard") === "Branch head", "a branch head downloads the branch");
  check(figure(wb, "Total registrations") === n(`select count(*) from students where org_id = '${org}' and not archived`), "counting the branch's students");
  check(sheets(wb).includes("The team"), "with the team");
  await ctx.close();
}

const anon = await fetch(`${BASE}/api/dashboard/export`);
check(anon.status === 401, "nobody signed in gets nothing");
check(n("select count(*) from audit_logs where action = 'dashboard.export'") >= 8, "every download is in the audit log");

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
