// Bulk upload: students (fill blanks only, locked profiles left alone, CGPA
// kept), enquiries from Excel, and the team's application and commission
// updates, each checked before anything is saved. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import ExcelJS from "exceljs";

const OUT = "/tmp/smoke-bulk";
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
const main = (page) => page.locator("main").innerText();
async function go(page, p) { await page.goto(BASE + p); return main(page); }
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);



const upload = async (page, kind, name, content) => {
  await go(page, `/imports?kind=${kind}`);
  await page.waitForLoadState("networkidle");
  const buffer = typeof content === "string" ? Buffer.from(content) : content;
  await page.locator(`#file-${kind}`).setInputFiles({ name, mimeType: name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", buffer });
  await page.getByRole("button", { name: "Check the file" }).click();
  await page.getByTestId("import-result").or(page.getByRole("alert")).first().waitFor({ timeout: 20000 }).catch(() => {});
  return page.getByTestId("import-result").innerText().catch(() => "");
};
const confirm = async (page) => {
  await page.getByRole("button", { name: /^Import \d/ }).click();
  await page.getByText(/^Imported from/).waitFor({ timeout: 30000 }).catch(() => {});
  return page.getByTestId("import-result").innerText().catch(() => "");
};

const tag = String(Date.now()).slice(-6);
const newEmail = `bulk.${tag}@example.com`;
sql(`update students set address_line2 = null where email = 'aswin.anil@example.com'`);

// --- A branch owner: students.
const owner = await signIn("kottayam@medcity.test", "10.106.1.1");
const op = owner.page;
let text = await go(op, "/imports");
check(/Students/.test(text) && /Enquiries/.test(text) && !/Application updates/.test(text) && !/Commission payments/.test(text), "owner: students and enquiries only");
check(/Bulk upload/.test(await op.locator("nav").first().innerText()), "nav: Bulk upload for the owner");
const tpl = await (await op.request.get(`${BASE}/api/imports/template/students`)).text();
check(tpl.startsWith("﻿name,first_name,last_name,email,phone") && !tpl.includes("branch"), "template: the owner's has no branch column");
check((await op.request.get(`${BASE}/api/imports/template/commissions`)).status() === 404, "template: team templates are not the owner's");

const csv = [
  "first_name,last_name,email,phone,consent,date_of_birth,twelfth_percent,twelfth_year,twelfth_institution,bachelors_score,bachelors_grading,bachelors_institution,bachelors_course,ielts,address_line2,S.No",
  `Anjali,Menon,${newEmail},+91 98470 12345,yes,18/04/2003,86,2021,St. Mary's HSS,7.8,cgpa10,CMS College,BSc Nursing,6.5,,1`,
  `No,Consent,noconsent.${tag}@example.com,+91 98470 12346,,,,,,,,,,,,2`,
  `Changed,Name,aswin.anil@example.com,,,,,,,,,,,,Near Temple Road,3`,
  `Arathi,Krishnan,arathi.krishnan@example.com,,,,,,,,,,,,Should not land,4`,
  `Bad,Date,baddate.${tag}@example.com,+91 98470 12347,yes,31/02/2003,,,,,,,,,,5`,
  `No,Grading,nograde.${tag}@example.com,+91 98470 12348,yes,,,,,8,,Some College,,,,6`,
  `Anjali,Again,${newEmail},+91 98470 12349,yes,,,,,,,,,,,7`,
].join("\n");
text = await upload(op, "students", "students.csv", csv);
check(/1 new/.test(text) && /1 to update/.test(text) && /1 left as they are/.test(text) && /4 with problems/.test(text), `students: preview counts (${text.split("\n").slice(0, 2).join(" | ")})`);
check(/Line 3: .*consent/.test(text) && /Line 6: .*not a real date/.test(text) && /Line 7: .*bachelors_grading/.test(text) && /Line 8: .*twice/.test(text), "students: each problem named by line");
check(/Line 5: .*locked/.test(text) && /ignored: s_no/.test(text), "students: locked profile and unknown column explained");
check(sql(`select count(*) from students where email = '${newEmail}'`) === "0", "students: nothing saved by the check");
text = await confirm(op);
check(/Imported from students\.csv/.test(text), "students: imported");
const created = sql(`select s.org_id = o.id, s.consent_at is not null, s.source, to_char(s.date_of_birth, 'YYYY-MM-DD') from students s join organizations o on o.name = 'Medcity Kottayam' where s.email = '${newEmail}'`);
check(created === "t|t|import|2003-04-18", `students: new student in the owner's branch with consent (${created})`);
check(sql(`select string_agg(level || ':' || grading_system || ':' || score, ',' order by level) from academic_records a join students s on s.id = a.student_id where s.email = '${newEmail}'`) === "SCHOOL:percentage:86,UG:cgpa10:7.8", "students: qualifications stored, CGPA kept as CGPA");
check(sql(`select test || ' ' || overall from test_scores t join students s on s.id = t.student_id where s.email = '${newEmail}'`) === "IELTS 6.5", "students: IELTS stored");
check(sql(`select first_name || '|' || address_line2 from students where email = 'aswin.anil@example.com'`) === "Aswin|Near Temple Road", "students: blanks filled, the name already there kept");
check(sql(`select coalesce(address_line2, '-') from students where email = 'arathi.krishnan@example.com'`) === "-", "students: locked profile untouched");
text = await upload(op, "students", "students.csv", csv);
check(/0 new|already up to date/.test(text) && !/1 new/.test(text), "students: the same file again changes nothing new");

// --- Enquiries from Excel.
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Leads");
ws.addRow(["Name", "Phone", "Source", "Interest Pathway", "Intake Month", "Intake Year", "Next Follow Up"]);
ws.addRow([`Excel Lead ${tag}`, `+91 90${tag}01`, "walk in", "Ausbildung", 9, 2027, new Date("2026-10-05T00:00:00Z")]);
ws.addRow([`Bad Lead ${tag}`, "12", "billboard", "", "", "", ""]);
const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
text = await upload(op, "enquiries", "leads.xlsx", xlsx);
check(/1 new/.test(text) && /1 with problems/.test(text) && /phone/.test(text) && /source/.test(text), "enquiries: Excel read, headers with spaces accepted, problems named");
await confirm(op);
check(sql(`select source || '|' || interest_pathway || '|' || intake_month || '|' || to_char(next_follow_up_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') from enquiries where name = 'Excel Lead ${tag}'`) === "WALK_IN|AUSBILDUNG|9|2026-10-05", "enquiries: saved with source, pathway, intake and follow-up");

// --- The team: branch column, applications and commissions.
const admin = await signIn("admin@medcityoverseas.test", "10.106.1.2");
const ap = admin.page;
text = await go(ap, "/imports");
check(/Application updates/.test(text) && /Commission payments/.test(text), "team: all four uploads");
text = await upload(ap, "students", "team.csv", `branch,first_name,last_name,email,phone,consent\n,Team,NoBranch,team.nobranch.${tag}@example.com,+91 98470 22222,yes\nMedcity Kochi,Team,Kochi,team.kochi.${tag}@example.com,+91 98470 22223,yes\nNowhere,Team,Lost,team.lost.${tag}@example.com,+91 98470 22224,yes`);
check(/1 new/.test(text) && /Line 2: branch/.test(text) && /no branch called "Nowhere"/.test(text), "team: rows need a real branch");
await confirm(ap);
check(sql(`select o.name from students s join organizations o on o.id = s.org_id where s.email = 'team.kochi.${tag}@example.com'`) === "Medcity Kochi", "team: student lands in the named branch");

// --- The branch column forgives what it safely can, and says what exists.
text = await upload(ap, "students", "branch.csv", `branch,first_name,last_name,email,phone,consent
KOCHI,Part,Name,part.${tag}@example.com,+91 98470 22225,yes
Medcity,Two,Ways,ambiguous.${tag}@example.com,+91 98470 22226,yes
Ernakulam,Not,Here,missing.${tag}@example.com,+91 98470 22227,yes`);
check(/1 new/.test(text), "branch: KOCHI is taken as the one branch whose name holds it");
check(/could mean Medcity Kochi or Medcity Kottayam/.test(text), "branch: a word two branches share is refused, naming both");
check(/Branches are: Horizon Consultants, Thrissur, Medcity Kochi, Medcity Kottayam/.test(text), "branch: an unknown branch lists the ones that exist");
await confirm(ap);
check(sql(`select o.name from students s join organizations o on o.id = s.org_id where s.email = 'part.${tag}@example.com'`) === "Medcity Kochi", "branch: the row landed in Medcity Kochi");

// --- The same problem on many rows reads as one line with a count.
const manyBad = ["branch,first_name,last_name,email,phone,consent", ...Array.from({ length: 12 }, (_, i) => `Ernakulam,Many,Bad${i},many${i}.${tag}@example.com,+91 98470 3${String(i).padStart(4, "0")},yes`)].join("\n");
text = await upload(ap, "students", "many.csv", manyBad);
check(/Lines 2, 3, 4 and 9 more: branch: no branch called "Ernakulam"/.test(text), `errors: identical problems are gathered (${(text.match(/Lines [^\n]+/) || [])[0] ?? "none"})`);
check((text.match(/no branch called "Ernakulam"/g) || []).length === 1, "errors: the message is printed once, not twelve times");

// --- The whole name in one column, and one confirmation of consent for the file.
text = await upload(op, "students", "wholename.csv", `name,email,phone,consent\nDeepa Maria Nair,deepa.${tag}@example.com,+91 98470 55551,yes\nSingleword,single.${tag}@example.com,+91 98470 55552,yes`);
check(/1 new/.test(text) && /1 with problems/.test(text), "whole name: the name column is read, a single name is not guessed at");
check(/has no surname to take/.test(text), "whole name: says why the single name failed");
await confirm(op);
check(sql(`select first_name || '|' || last_name from students where email = 'deepa.${tag}@example.com'`) === "Deepa Maria|Nair", "whole name: split at the last space");

const noConsent = `name,email,phone\nConsent Missing,noconsent2.${tag}@example.com,+91 98470 55553`;
text = await upload(op, "students", "consent.csv", noConsent);
check(/1 with problems/.test(text) && /a new student needs "yes"/.test(text), "consent: without the column or the tick, a new student is left out");
await op.locator('input[name="consentAll"]').check();
await op.getByRole("button", { name: "Check the file" }).click();
{
  const until = Date.now() + 20000;
  text = "";
  while (Date.now() < until) {
    text = await op.getByTestId("import-result").innerText().catch(() => "");
    if (/1 new/.test(text)) break;
    await op.waitForTimeout(300);
  }
}
check(/1 new/.test(text) && !/with problems/.test(text), `consent: the tick above the file stands for every row (${text.split("\n").slice(1, 3).join(" ")})`);
await confirm(op);
const consentText = sql(`select consent_text from students where email = 'noconsent2.${tag}@example.com'`);
check(/Consent confirmed for the whole upload by .*kottayam@medcity.test/.test(consentText), `consent: whose confirmation it was is recorded (${consentText.slice(0, 60)})`);
check(sql(`select count(*) from audit_logs where action = 'import.run' and meta->>'consentConfirmedForWholeFile' = 'true'`) !== "0", "consent: the audit log keeps the confirmation");

// --- A preference nobody can act on does not cost a student.
text = await upload(op, "students", "pathway.csv", `first_name,last_name,email,phone,consent,preferred_pathway\nPath,Way,pathway.${tag}@example.com,+91 98470 44444,yes,MSc Supply Chain Management`);
check(/1 new/.test(text) && !/with problems/.test(text), "pathway: a course name in preferred_pathway does not stop the row");
check(/is not degree, Ausbildung or nursing, so it was left blank/.test(text), "pathway: the file says what was left out");
await confirm(op);
check(sql(`select coalesce(preferred_pathway::text, '-') from students where email = 'pathway.${tag}@example.com'`) === "-", "pathway: nothing was invented in its place");

// --- A student with no email at all: the phone number is who they are.
const noMail = `+91 97${tag}1`;
text = await upload(op, "students", "nomail.csv", `first_name,last_name,email,phone,consent
Rahul,Pillai,,${noMail},yes
Meera,Pillai,,${noMail},yes`);
check(/2 new/.test(text), "no email: both rows on one family number are new students");
check(/cannot use the student portal until an address is added/.test(text), "no email: the file says what they lose");
await confirm(op);
check(sql(`select count(*) from students where phone = '${noMail}' and email is null`) === "2", "no email: two students kept apart by their names");

// The same people again, now with an email each: matched on the number and the name.
text = await upload(op, "students", "nomail2.csv", `first_name,last_name,email,phone,consent
Rahul,Pillai,rahul.${tag}@example.com,${noMail},yes
Meera,Pillai,meera.${tag}@example.com,${noMail},yes`);
check(/2 to update/.test(text) && !/new/.test(text.split("\n")[1] ?? ""), `no email: the second file fills them in rather than making more (${text.split("\n").slice(1, 2)})`);
await confirm(op);
check(sql(`select count(*) from students where phone = '${noMail}'`) === "2", "no email: still two students");
check(sql(`select email from students where phone = '${noMail}' and first_name = 'Rahul'`) === `rahul.${tag}@example.com`, "no email: the address was filled in on the right one");

const ack = sql("select a.ack_no from applications a join students s on s.id = a.student_id where s.email = 'aswin.anil@example.com' limit 1");
const target = sql(`select label from status_definitions where pathway = 'DEGREE' and not requires_reason and id <> (select status_id from applications where ack_no = '${ack}') order by sort_order limit 1 offset 2`);
const reasonStatus = sql("select label from status_definitions where pathway = 'DEGREE' and requires_reason limit 1");
text = await upload(ap, "applications", "apps.csv", `ack_no,status,priority,offer_type,offer_date,offer_accept_by\n${ack},${target},HIGH,CONDITIONAL,2026-09-20,2026-10-15\nNOPE-1,${target},,,,\n${ack}x,,,,,\n`);
check(/1 to update/.test(text) && /no application with acknowledgement number NOPE-1/.test(text), "applications: preview");
await confirm(ap);
const after = sql(`select sd.label || '|' || a.priority || '|' || a.offer_type || '|' || a.offer_accept_by from applications a join status_definitions sd on sd.id = a.status_id where a.ack_no = '${ack}'`);
check(after === `${target}|HIGH|CONDITIONAL|2026-10-15`, `applications: status, priority and offer saved (${after})`);
check(sql(`select count(*) from application_deadlines d join applications a on a.id = d.application_id where a.ack_no = '${ack}' and d.type = 'OFFER_ACCEPTANCE'`) === "1", "applications: accept-by became a deadline");
check(sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'kottayam@medcity.test' and n.title like '${ack}:%'`) !== "0", "applications: the branch was told");
if (reasonStatus) {
  text = await upload(ap, "applications", "apps2.csv", `ack_no,status\n${ack},${reasonStatus}\n`);
  check(/status_reason is required/.test(text), "applications: a status that needs a reason asks for one");
}
text = await upload(ap, "applications", "apps3.csv", `ack_no,offer_accept_by\n${ack},2026-09-01\n`);
check(/offerAcceptBy/.test(text), "applications: the offer rules still apply to a merged row");

const inrAck = sql("select a.ack_no from commissions c join applications a on a.id = c.application_id where c.status = 'EXPECTED' and c.currency = 'INR' limit 1");
const gbpAck = sql("select a.ack_no from commissions c join applications a on a.id = c.application_id where c.status = 'EXPECTED' and c.currency <> 'INR' and c.partner_amount_inr is null limit 1");
const orgOf = sql(`select c.org_id from commissions c join applications a on a.id = c.application_id where a.ack_no = '${inrAck}'`);
const walletBefore = Number(sql(`select coalesce(sum(amount_inr), 0) from wallet_entries where org_id = '${orgOf}'`));
text = await upload(ap, "commissions", "pay.csv", `ack_no,status,invoice_ref\n${inrAck},paid,INV-${tag}\nNOPE-2,received,\n${inrAck},nonsense,\n`);
check(/1 to update/.test(text) && /NOPE-2 has no commission yet/.test(text) && /twice/.test(text), "commissions: preview");
await confirm(ap);
check(sql(`select c.status || '|' || c.invoice_ref from commissions c join applications a on a.id = c.application_id where a.ack_no = '${inrAck}'`) === `SETTLED|INV-${tag}`, "commissions: settled with the invoice reference");
check(Number(sql(`select coalesce(sum(amount_inr), 0) from wallet_entries where org_id = '${orgOf}'`)) > walletBefore, "commissions: the branch wallet credited");
if (gbpAck) {
  text = await upload(ap, "commissions", "pay2.csv", `ack_no,status\n${gbpAck},SETTLED\n`);
  check(/partner_amount_inr is needed/.test(text), "commissions: a foreign-currency settlement needs the rupee amount");
}

// Counsellors cannot upload.
const counsellor = await signIn("germany@medcity.test", "10.106.1.3");
const r = await counsellor.page.goto(`${BASE}/imports`);
check(r.status() >= 300 || !/Bulk upload/.test(await counsellor.page.locator("main").innerText()), "access: counsellors cannot upload");

for (const [who, e] of [["owner", owner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
