// Ausbildung and the service charge.
//
// Asked for together: for Ausbildung students and anybody bound for a country
// that collects a service charge, where the service charge received is
// recorded and what is still pending; which German levels are done and which
// are not; the date of registration, the branch and the counsellor; for
// Ausbildung, three preferences in order, when the application went in, when
// the interview is and when the contract came; and a document checklist for
// study abroad, Ausbildung and NCLEX-RN. Which countries collect a service
// charge is a setting. Then the written Ausbildung process: every step as a
// status in the picker, the desk and step on the tracker, the payment
// milestones on the file, and the guide's documents on the documentation tab.
// Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
const wait = async (q, want, ms = 12000) => {
  let got = sql(q);
  for (let t0 = Date.now(); got !== want && Date.now() - t0 < ms; ) {
    await new Promise((r) => setTimeout(r, 300));
    got = sql(q);
  }
  return got;
};
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 30;
const all = [];
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.241.3.${ip++}` } });
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
  all.push({ email, errors });
  return { ctx, page, errors };
}
const go = async (page, path) => {
  await page.goto(BASE + path);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);

const akshara = sql("select id from students where first_name = 'Akshara'");
const rihan = sql("select id from students where first_name = 'Rihan'");
const germany = sql("select id from countries where name = 'Germany'");

/* ---------------- The setting: which countries collect a service charge ---------------- */

const admin = await signIn("sreejith@miak.in");
{
  const page = admin.page;
  await go(page, "/admin/destinations");
  const fold = page.locator("#service-charge details");
  if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").click();
  const row = page.locator("form").filter({ has: page.locator(`input[name="countryId"][value="${germany}"]`) }).filter({ has: page.locator('input[name="collects"]') });
  await row.locator('input[name="collects"]').check();
  await row.locator('input[name="serviceChargeInr"]').fill("50000");
  await row.getByRole("button", { name: "Save" }).click();
  check((await wait(`select collects_service_charge::int || '|' || coalesce(service_charge_inr::text, '') from countries where id = '${germany}'`, "1|50000")) === "1|50000", "Germany is ticked as collecting a service charge, with its usual figure");
}

/* ---------------- The tracker ---------------- */
{
  const page = admin.page;
  let text = await go(page, "/ausbildung");
  check(text.includes("Akshara") && text.includes("Rihan"), "the tracker lists the Ausbildung students");
  const row = page.locator(`[data-tracker-row="${akshara}"]`);
  const line = (await row.innerText()).replace(/\s+/g, " ");
  const reg = sql(`select to_char(created_at, 'DD/MM/YYYY') from students where id = '${akshara}'`);
  check(line.includes(reg), `with the date of registration (${reg})`);
  const counsellor = sql(`select coalesce(u.desk_label, u.name) from students s join users u on u.id = s.assigned_to_id where s.id = '${akshara}'`);
  check(line.includes("Medcity Kottayam") && line.includes(counsellor), `with the branch and the counsellor (${counsellor})`);
  check(/1\. Nursing/.test(line) && /2\. Elderly care/.test(line) && /3\. Medical assistant/.test(line), "with the three preferences, in order");
  check(/Incomplete: B2/.test(line), "and the German level still to finish");
  check(/Not yet/.test(line) || /Applied|\/\d{4}/.test(line), "and where the application stands");

  text = await go(page, "/ausbildung?show=interview");
  check(text.includes("Akshara") && !text.includes("Rihan"), "'Interview coming up' shows the student with one, and not the one without");
  text = await go(page, "/ausbildung?show=german");
  check(text.includes("Akshara") && text.includes("Rihan"), "'German not finished' shows both");
}

/* ---------------- The file: Ausbildung details ---------------- */
const owner = await signIn("kottayam@medcity.test");
{
  const page = owner.page;
  const text = await go(page, `/students/${rihan}/profile`);
  const tab = page.locator(`main a[href="/students/${rihan}/ausbildung"]`);
  check((await tab.count()) > 0 && /Ausbildung/.test(await tab.first().innerText()), "an Ausbildung file has an Ausbildung tab");
  check(/Registered \d{2}\/\d{2}\/\d{4}/.test(text), "and the file says when the student registered");

  await go(page, `/students/${rihan}/ausbildung`);
  await page.locator('input[name="preference2"]').fill("Chef (Koch/Köchin)");
  await page.locator('input[name="preference3"]').fill("Retail (Kaufmann/-frau im Einzelhandel)");
  await page.locator('input[name="applicationSubmittedOn"]').fill(today);
  await page.locator('input[name="interviewOn"]').fill(`${today}T15:30`);
  await page.locator('input[name="interviewWith"]').fill("Sample Hotel GmbH");
  await page.locator('input[name="contractReceivedOn"]').fill(today);
  await page.getByRole("button", { name: "Save Ausbildung details" }).click();
  check(await page.getByText("Say which employer the contract is with").waitFor({ timeout: 10000 }).then(() => true, () => false), "a contract with no employer named is refused");
  await page.locator('input[name="contractEmployer"]').fill("Sample Hotel GmbH");
  await page.getByRole("button", { name: "Save Ausbildung details" }).click();
  const saved = await wait(
    `select concat_ws('|', preference_1, preference_2, preference_3, application_submitted_on, contract_received_on, contract_employer, to_char(interview_on at time zone 'Asia/Kolkata', 'HH24:MI')) from ausbildung_profiles where student_id = '${rihan}'`,
    `Hotel management (Hotelfachmann/-frau)|Chef (Koch/Köchin)|Retail (Kaufmann/-frau im Einzelhandel)|${today}|${today}|Sample Hotel GmbH|15:30`,
  );
  check(saved.endsWith("|15:30") && saved.includes("Chef"), `the preferences and the three dates are saved, the interview in IST (${saved})`);
}

/* ---------------- The file: German levels ---------------- */
{
  const page = owner.page;
  await go(page, `/students/${rihan}/ausbildung`);
  const a2 = page.locator('[data-module="A2"]');
  await a2.locator('select[name="state"]').selectOption("COMPLETED");
  await a2.getByRole("button", { name: "Save" }).click();
  check((await wait(`select state || '|' || completed_on from german_modules where student_id = '${rihan}' and level = 'A2'`, `COMPLETED|${today}`)) === `COMPLETED|${today}`, "finishing a German level records it, with today as the day when none is given");
  const text = await go(page, `/ausbildung?q=Rihan`);
  check(/Incomplete: B1, B2/.test(text), "and the tracker now says only B1 and B2 are left");
}

/* ---------------- The service charge ---------------- */
{
  const page = owner.page;
  sql(`delete from income_lines where student_id = '${akshara}' and kind = 'SERVICE_FEE'`);
  let text = await go(page, `/students/${akshara}/ausbildung`);
  check(/Not raised on this student yet/.test(text), "a file with no service charge says so");
  const amount = page.locator('input[name="expectedAmount"]');
  check((await amount.inputValue()) === "50000", "raising it starts from the destination's usual figure");
  await page.getByRole("button", { name: "Raise the service charge" }).click();
  await wait(`select count(*) from income_lines where student_id = '${akshara}' and kind = 'SERVICE_FEE' and expected_amount = 50000`, "1");
  const lineId = sql(`select id from income_lines where student_id = '${akshara}' and kind = 'SERVICE_FEE' limit 1`);
  check(!!lineId, "the service charge is raised, as an ordinary line on the Income tab");

  await go(page, `/students/${akshara}/ausbildung`);
  await page.locator(`input[name="receivedAmount"]`).fill("20000");
  await page.getByRole("button", { name: "Record" }).click();
  check((await wait(`select received_amount from income_lines where id = '${lineId}'`, "20000")) === "20000", "a part payment is recorded where it was asked for");

  text = await go(page, `/students/${akshara}/ausbildung`);
  check(/₹20,000 received of ₹50,000, ₹30,000 pending/.test(text), "the file says what came in and what is still pending");
  text = await go(page, "/ausbildung?show=unpaid");
  const row = (await page.locator(`[data-tracker-row="${akshara}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/₹20,000 received/.test(row) && /₹30,000 pending/.test(row), "and so does the tracker, under 'Service charge pending'");
}

/* ---------------- Service-charge countries, beyond Ausbildung ---------------- */
{
  const page = admin.page;
  const degree = sql(`select id from students where preferred_pathway = 'DEGREE' and not archived and not exists (select 1 from applications a where a.student_id = students.id) order by created_at limit 1`)
    || sql(`select id from students where (preferred_pathway is null or preferred_pathway = 'DEGREE') and not archived order by created_at limit 1`);
  const before = sql(`select coalesce(preferred_country, '') from students where id = '${degree}'`);
  sql(`update students set preferred_country = 'Germany' where id = '${degree}'`);
  const name = sql(`select first_name from students where id = '${degree}'`);
  let text = await go(page, "/ausbildung?tab=service");
  check(text.includes(name), `a study-abroad student bound for a ticked country is on the service-charge tab (${name})`);
  check(!text.includes("Akshara"), "an Ausbildung student is on the Ausbildung tab, not both");
  sql(`update countries set collects_service_charge = false where id = '${germany}'`);
  text = await go(page, "/ausbildung?tab=service");
  check(!text.includes(name), "untick the country and the student leaves the list");
  sql(`update countries set collects_service_charge = true where id = '${germany}'`);
  sql(`update students set preferred_country = ${before ? `'${before}'` : "null"} where id = '${degree}'`);
}

/* ---------------- Scoping ---------------- */
{
  const kochi = await signIn("kochi@medcity.test");
  const text = await go(kochi.page, "/ausbildung");
  check(!text.includes("Akshara"), "another branch does not see this branch's Ausbildung students");
  await kochi.ctx.close();
}
{
  const docs = await signIn("documentation@medcityoverseas.test");
  const text = await go(docs.page, "/ausbildung");
  check(text.includes("Akshara") && !/Service charge/.test((await docs.page.locator("main thead").innerText().catch(() => ""))), "the documentation team sees the tracker without the money");
  await docs.ctx.close();
}

/* ---------------- Checklists by journey ---------------- */
{
  const page = admin.page;
  let text = await go(page, "/checklists?for=AUSBILDUNG");
  check(/Motivation letter/.test(text) && /Ausbildung training contract/.test(text) && /German language certificate/.test(text), "the Ausbildung checklist asks for the motivation letter, the German certificate and the training contract");
  check(!/Statement of purpose/.test(text) && !/CAS \/ COE/.test(text), "and not for a degree's paper");
  check(/Passport/.test(text), "and still for what every journey shares");
  text = await go(page, "/checklists?for=NURSING");
  check(/Nursing council registration/.test(text) && /Credential evaluation/.test(text) && /Nursing degree or diploma/.test(text), "the NCLEX-RN checklist asks for the nursing degree, the council registration and the credential evaluation");
  text = await go(page, "/checklists?for=DEGREE");
  check(/Statement of purpose/.test(text) && !/Motivation letter/.test(text), "the study-abroad checklist is the degree list");
  check((await page.getByRole("button", { name: "Print this checklist" }).count()) === 1, "and it prints");

  // A student's own list follows their journey.
  text = await go(page, `/students/${akshara}/documentation`);
  const sop = sql(`select coalesce((select state from checklist_items where student_id = '${akshara}' and type_code = 'SOP' order by created_at desc limit 1)::text, 'absent')`);
  const motiv = sql(`select coalesce((select state from checklist_items where student_id = '${akshara}' and type_code = 'MOTIVATION_LETTER' order by created_at desc limit 1)::text, 'absent')`);
  check(sop === "absent" || sop === "NOT_NEEDED", `an Ausbildung student is not asked for a statement of purpose (${sop})`);
  check(motiv !== "absent", `and is asked for a motivation letter (${motiv})`);
  check(/Journey: Ausbildung/.test(text), "and the tab says which journey it is following");
}

/* ---------------- The written process: statuses ---------------- */
// The guide's nineteen steps, as statuses the desk can pick, in the guide's
// order. Akshara's open application is at the employer interview (placement).
const ausbApp = sql(`select a.id from applications a join programs p on p.id = a.program_id join status_definitions sd on sd.id = a.status_id where a.student_id = '${akshara}' and p.pathway = 'AUSBILDUNG' and sd."group" <> 'CLOSED' order by a.status_changed_at desc limit 1`);
const ausbStatusBefore = sql(`select status_id from applications where id = '${ausbApp}'`);
{
  const page = admin.page;
  await go(page, `/students/${akshara}/applications?app=${ausbApp}`);
  const picker = page.locator(`#status-${ausbApp}`);
  check((await picker.count()) === 1, "the admin sees the status picker on an Ausbildung application");
  const options = await picker.locator("option").allInnerTexts();
  const wanted = [
    "Document collection by the counsellor",
    "Mentor assigned",
    "Document preparation and translation",
    "Language assessment and interview preparation",
    "Mock interview passed: ready for employers",
    "Profile submitted to German employers",
    "Employer shortlisted the candidate",
    "Pre-visa documentation",
    "Visa processing",
    "Pre-departure process",
    "Destination Germany: happy call",
  ];
  const missing = wanted.filter((w) => !options.includes(w));
  check(missing.length === 0, `the picker offers every step of the written process ${missing.length ? `(missing: ${missing.join(", ")})` : ""}`);
  const at = (label) => options.indexOf(label);
  check(
    at("Mentor assigned") < at("German CV and profile in progress") &&
      at("Mock interview passed: ready for employers") < at("Employer matching") &&
      at("Employer matching") < at("Profile submitted to German employers") &&
      at("Profile submitted to German employers") < at("Employer interview scheduled") &&
      at("Training contract signed") < at("Pre-visa documentation") &&
      at("Pre-visa documentation") < at("Visa filed (VFS)") &&
      at("Visa filed (VFS)") < at("Visa processing") &&
      at("Visa processing") < at("Visa received") &&
      at("Visa received") < at("Pre-departure process") &&
      at("Pre-departure process") < at("Joined employer") &&
      at("Joined employer") < at("Destination Germany: happy call") &&
      at("Destination Germany: happy call") < at("Withdrawn"),
    "in the guide's order, with the old statuses kept in their places",
  );
  check(at("German A2 / B1 pending") === 0, "and the German level is still the first status");

  // Moving to a new status works like any other move, and the milestone note shows.
  await picker.selectOption({ label: "Mentor assigned" });
  check(await page.getByText("Milestone: the student gets a WhatsApp update.").waitFor({ timeout: 5000 }).then(() => true, () => false), "a mentor being assigned is a milestone the student hears about");
  await page.getByRole("button", { name: "Update status" }).click();
  const moved = await wait(`select sd.code from applications a join status_definitions sd on sd.id = a.status_id where a.id = '${ausbApp}'`, "MENTOR_ASSIGNED");
  check(moved === "MENTOR_ASSIGNED", "the application moves to 'Mentor assigned'");

  // The tracker reads the desk and the step off the status.
  await go(page, "/ausbildung");
  const line = (await page.locator(`[data-tracker-row="${akshara}"]`).innerText()).replace(/\s+/g, " ");
  check(/Documentation/i.test(line) && /Mentor assigned/.test(line) && /Step 4/.test(line), `the tracker puts the file with the documentation desk at step 4 (${line.slice(0, 160)})`);
  check(/guide: same day/i.test(line), "with the guide's turnaround beside it");
  let text = await go(page, "/ausbildung?dept=DOCUMENTATION");
  check(text.includes("Akshara"), "'Desk: Documentation' shows the file");
  text = await go(page, "/ausbildung?dept=VISA");
  check(!text.includes("Akshara"), "and 'Desk: Visa' does not");
  check(/Hand-overs in the written process/.test(text) && /ausbildung@miak\.in/.test(text) && /placementassistant@miak\.in/.test(text), "the tracker lists the hand-over addresses");

  // The file's own tab places it on the process too, with the payment milestones.
  text = await go(page, `/students/${akshara}/ausbildung`);
  const current = await page.locator('[data-process] [aria-current="step"]').getAttribute("data-department").catch(() => null);
  check(current === "DOCUMENTATION", `the Ausbildung tab marks the documentation desk as current (${current})`);
  check(/Step 4 of 19/.test(text), "and names the step");
  const milestones = (await page.locator("[data-payment-milestones]").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/Registration fee/.test(milestones) && /50% of the service charge/.test(milestones) && /80% of the service charge/.test(milestones) && /100% of the service charge/.test(milestones), "the service charge card lists the guide's payment milestones");
  check(/₹25,000/.test(milestones) && /₹40,000/.test(milestones), "with the amounts worked out from the charge raised (₹50,000)");
  check(/Later/.test(milestones) && !/Due now/.test(milestones), "nothing is due at step 4, which is before the first percentage milestone");

  // Back to where the seed left it, by the same action, so the rest of the suite reads the same file.
  await go(page, `/students/${akshara}/applications?app=${ausbApp}`);
  await page.locator(`#status-${ausbApp}`).selectOption({ label: "Employer interview scheduled" });
  await page.getByRole("button", { name: "Update status" }).click();
  check((await wait(`select status_id from applications where id = '${ausbApp}'`, ausbStatusBefore)) === ausbStatusBefore, "and back to the employer interview");
  text = await go(page, `/students/${akshara}/ausbildung`);
  const due = (await page.locator("[data-payment-milestones]").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/Due now/.test(due), "at the employer interview the guide's 50% is due, and ₹20,000 of ₹50,000 does not meet it");
}

/* ---------------- The written process: documents ---------------- */
{
  const page = admin.page;
  // Opening the tab brings the list into line with the requirements, so the
  // guide's paper appears on a file that existed before it was added.
  let text = await go(page, `/students/${akshara}/documentation`);
  for (const label of ["Consultancy agreement (declaration form)", "Aadhaar and PAN card", "CV in German format (Lebenslauf)", "Educational certificates, German translation", "Self-introduction video", "School contract (vocational school)", "EZB: declaration of employment relationship", "Biometric photo (35 x 40 mm)", "Legal representation form", "ZAV approval (Federal Employment Agency)"]) {
    check(text.includes(label), `the Ausbildung file asks for: ${label}`);
  }
  const zav = page.locator("tr").filter({ hasText: "ZAV approval" }).first();
  const zavLine = (await zav.innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/7\. Visa/.test(zavLine) && /Medcity/.test(zavLine), `the ZAV sits at the visa stage and is owed by Medcity, not the student (${zavLine.slice(0, 120)})`);
  const stage = sql(`select stage || '|' || owed_by || '|' || required from checklist_items where student_id = '${akshara}' and type_code = 'EZB' order by created_at desc limit 1`);
  check(stage === "OFFER|MEDCITY|true", `the EZB is on the list at the offer stage, owed by Medcity, required (${stage})`);
  await go(page, `/students/${akshara}/documentation?stage=VISA`);
  // The table alone: the gate alert above it names what the profile stage still wants.
  const visaRows = (await page.locator("tbody").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/Biometric photo/.test(visaRows) && /Legal representation form/.test(visaRows) && /Annex employment data/.test(visaRows), "the visa stage filter shows the pre-visa list");
  check(!/Consultancy agreement/.test(visaRows), "and not the registration paper");
  // A degree student is not asked for the employer's paper.
  const degree = sql(`select id from students where first_name = 'Fathima'`);
  await go(page, `/students/${degree}/documentation`);
  // The list of what the file is asked for, not the whole page: the "ask for
  // a document" picker offers every type on purpose.
  const degreeRows = (await page.locator("tbody").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(!/EZB/.test(degreeRows) && !/ZAV approval/.test(degreeRows), "a study-abroad file is not asked for the EZB or the ZAV");
}

/* ---------------- The hand-over and the mentor ---------------- */
// The branch collects the documents (step 3) and hands the file to the
// documentation desk, which can open it from that moment and names a mentor
// (step 4); the counsellor is told who. Akshara's file is put back where the
// branch has it first: at document collection, not handed over, no mentor.
// Everything this section changes about her applications, her paper and the
// notices it raises is restored at the end, so the other suites read the seed.
{
  const q = (v) => String(v).replace(/'/g, "''");
  const docsId = sql("select id from users where email = 'documentation@medcityoverseas.test'");
  const leadId = sql("select id from users where email = 'teamlead@medcityoverseas.test'");
  const headId = sql("select id from users where email = 'kottayam@medcity.test'");
  const adminId = sql("select id from users where email = 'sreejith@miak.in'");
  const counsellorId = sql(`select assigned_to_id from students where id = '${akshara}'`);
  const docCollection = sql("select id from status_definitions where pathway = 'AUSBILDUNG' and code = 'DOCUMENT_COLLECTION'");
  const appIds = sql(`select string_agg(id, ' ') from applications where student_id = '${akshara}'`).split(" ").filter(Boolean);
  const appsBefore = appIds.map((id) => sql(`select concat_ws(chr(9), status_id, status_changed_at::text, coalesce(handed_over_at::text, ''), coalesce(handed_over_by_id, ''), coalesce(handover_note, '')) from applications where id = '${id}'`).split("\t"));
  const paperBefore = sql(`select coalesce(string_agg(id || chr(9) || state || chr(9) || coalesce(valid_to::text, ''), chr(10)), '') from checklist_items where student_id = '${akshara}' and stage = 'PROFILE' and required`).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const noticesBefore = sql("select coalesce(max(created_at)::text, '1970-01-01') from notifications");
  const tabHref = `/students/${akshara}/ausbildung`;
  const mentorRowSql = `select coalesce(string_agg(user_id, ','), '') from student_people where student_id = '${akshara}' and part = 'Documentation mentor'`;
  const toldAbout = (userId, title) => sql(`select count(*) from notifications where user_id = '${userId}' and title = '${q(title)}' and href = '${tabHref}' and created_at > '${noticesBefore}'`);
  const lastBody = (userId, title) => sql(`select coalesce(body, '') from notifications where user_id = '${userId}' and title = '${q(title)}' and created_at > '${noticesBefore}' order by created_at desc limit 1`);
  const statusCodeSql = `select sd.code from applications a join status_definitions sd on sd.id = a.status_id where a.id = '${ausbApp}'`;
  const statusCode = () => sql(statusCodeSql);
  const reset = () => {
    sql(`update applications set handed_over_at = null, handed_over_by_id = null, handover_note = null where student_id = '${akshara}'`);
    sql(`update applications set status_id = '${docCollection}', status_changed_at = now() where id = '${ausbApp}'`);
    sql(`delete from student_people where student_id = '${akshara}' and part = 'Documentation mentor'`);
  };

  // Moving the status to the desk's first step hands the file over by itself.
  reset();
  {
    const page = admin.page;
    await go(page, `/students/${akshara}/applications?app=${ausbApp}`);
    await page.locator(`#status-${ausbApp}`).selectOption({ label: "Mentor assigned" });
    await page.getByRole("button", { name: "Update status" }).click();
    check((await wait(statusCodeSql, "MENTOR_ASSIGNED")) === "MENTOR_ASSIGNED", "an admin moves a file at document collection to 'Mentor assigned'");
    const handed = await wait(`select coalesce(handed_over_by_id, '') from applications where id = '${ausbApp}'`, adminId);
    check(handed === adminId, "and the move hands the file to the desk, by the person who moved it");
    check(sql(`select count(*) from audit_logs where action = 'application.handover' and entity_id = '${ausbApp}' and meta->>'via' = 'status' and meta->>'to' = 'MENTOR_ASSIGNED'`) !== "0", "with the hand-over in the audit log, marked as made by the status move");
    check(toldAbout(docsId, "Akshara Anilkumar: Ausbildung file handed to the documentation desk") !== "0", "and the documentation desk is told the file has arrived");
  }

  // Back to the branch's end: not handed over, at document collection.
  reset();
  const docs = await signIn("documentation@medcityoverseas.test");
  {
    await docs.page.goto(`${BASE}${tabHref}`);
    await docs.page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const body = await docs.page.locator("body").innerText();
    check(/could not be found/i.test(body), "before the hand-over a documentation officer cannot open the file");
  }

  // The branch head hands it over, once the profile paper is in.
  {
    const page = owner.page;
    let text = await go(page, tabHref);
    check(/Not handed over yet/.test(text) && /Named by the desk after the hand-over/.test(text), "the Ausbildung tab says the file is still the branch's, with no mentor to name yet");
    const short = sql(`select count(*) from checklist_items where student_id = '${akshara}' and stage = 'PROFILE' and required and state <> 'ACCEPTED'`);
    if (short !== "0") {
      const blocked = (await page.locator("[data-handover-blocked]").innerText().catch(() => "")).replace(/\s+/g, " ");
      check(/Still needed before this can go:/.test(blocked), `short of profile paper, the button is the list of what is missing (${blocked.slice(0, 100)})`);
      check((await page.locator("[data-hand-to-desk]").count()) === 0, "and there is no hand-over button");
    }
    sql(`update checklist_items set state = 'ACCEPTED', valid_to = null where student_id = '${akshara}' and stage = 'PROFILE' and required`);
    await go(page, tabHref);
    check((await page.locator("[data-hand-to-desk]").count()) === 1, "with the paper accepted, the branch head has the hand-over button");
    await page.locator("[data-hand-to-desk]").click();
    await page.locator('textarea[id^="hand-note-"]').fill("B1 done, B2 in progress. Wants nursing.");
    await page.getByRole("button", { name: "Hand it over" }).click();
    // The hand-over form leaves the page with the hand-over, so the page
    // itself is what says it is done.
    check(await page.locator('[data-handed-over="yes"]').first().waitFor({ timeout: 10000 }).then(() => true, () => false), "the branch head sees it is handed over");
    const handed = await wait(`select coalesce(handed_over_by_id, '') || '|' || coalesce(handover_note, '') from applications where id = '${ausbApp}'`, `${headId}|B1 done, B2 in progress. Wants nursing.`);
    check(handed === `${headId}|B1 done, B2 in progress. Wants nursing.`, "the application is marked handed over by the branch head, with the note");
    check(statusCode() === "DOCUMENT_COLLECTION", "and the status stays at document collection: no mentor is assumed");
    check(sql(`select count(*) from audit_logs where action = 'application.handover' and entity_id = '${ausbApp}' and meta->>'via' = 'ausbildung'`) !== "0", "the hand-over is in the audit log");
    check(toldAbout(docsId, "Akshara Anilkumar: Ausbildung file handed to the documentation desk") !== "0" && toldAbout(leadId, "Akshara Anilkumar: Ausbildung file handed to the documentation desk") !== "0", "the documentation officers and their team leader are told, with a link to the file");
    text = await go(page, tabHref);
    check(/With the desk since/.test(text) && /No mentor yet/.test(text), "the tab now says the file is with the desk, waiting for a mentor");
  }

  // The desk can open it now, and the tracker says it is waiting for a mentor.
  {
    const page = docs.page;
    const text = await go(page, tabHref);
    check(/The written process/.test(text) && (await page.locator('[data-handed-over="yes"]').count()) === 1, "after the hand-over the documentation officer opens the file");
    await go(page, "/ausbildung");
    const cell = (await page.locator(`[data-tracker-row="${akshara}"] [data-mentor]`).innerText().catch(() => "")).replace(/\s+/g, " ");
    check(/With the documentation desk, no mentor yet/.test(cell), `the tracker says the desk has it and no mentor is named (${cell})`);
  }

  // The desk names the mentor.
  {
    const page = docs.page;
    await go(page, tabHref);
    const picker = page.locator('select[name="mentorId"]');
    check((await picker.count()) === 1, "a documentation officer has the mentor picker");
    await picker.selectOption(docsId);
    await page.getByRole("button", { name: "Set the mentor" }).click();
    check(await toast(page, /Nithin Jose is the mentor/), "setting the mentor is confirmed by name");
    check((await wait(mentorRowSql, docsId)) === docsId, "the mentor is on the student's file as the documentation mentor");
    check((await wait(statusCodeSql, "MENTOR_ASSIGNED")) === "MENTOR_ASSIGNED", "and the application moves to 'Mentor assigned'");
    check(toldAbout(counsellorId, "Akshara Anilkumar: mentor assigned") !== "0" && /Nithin Jose/.test(lastBody(counsellorId, "Akshara Anilkumar: mentor assigned")), "the counsellor is told, with the mentor's name");
    check(toldAbout(headId, "Akshara Anilkumar: mentor assigned") !== "0", "and so is the branch head");
    check(toldAbout(docsId, "You are the mentor for Akshara Anilkumar") !== "0", "the mentor is told, with a link to the file");
    const text = await go(page, tabHref);
    check(/Mentor/.test(text) && (await page.locator(`[data-desk] [data-mentor="${docsId}"]`).count()) === 1 && /Nithin Jose/.test(text), "the tab shows the mentor");
    check((await page.getByRole("button", { name: "Change the mentor" }).count()) === 1, "and the button now reads 'Change the mentor'");
  }
  {
    const page = admin.page;
    await go(page, "/ausbildung");
    const cell = (await page.locator(`[data-tracker-row="${akshara}"] [data-mentor]`).innerText().catch(() => "")).replace(/\s+/g, " ");
    check(/Mentor: Nithin Jose/.test(cell), `the tracker's desk cell names the mentor (${cell})`);
    const line = (await page.locator(`[data-tracker-row="${akshara}"]`).innerText()).replace(/\s+/g, " ");
    check(/Mentor assigned/.test(line) && /Step 4/.test(line), "at step 4, mentor assigned");
  }

  // Changing the mentor replaces the row and tells the new one.
  {
    const page = admin.page;
    await go(page, tabHref);
    await page.locator('select[name="mentorId"]').selectOption(leadId);
    await page.getByRole("button", { name: "Change the mentor" }).click();
    check(await toast(page, /Jeslin Varghese is the mentor/), "the change is confirmed by name");
    check((await wait(mentorRowSql, leadId)) === leadId, "the new mentor replaces the old one on the file, one row only");
    check(toldAbout(leadId, "You are the mentor for Akshara Anilkumar") !== "0", "the new mentor is told");
    check(toldAbout(counsellorId, "Akshara Anilkumar: the mentor has changed") !== "0" && /Jeslin Varghese/.test(lastBody(counsellorId, "Akshara Anilkumar: the mentor has changed")), "and the counsellor hears the new name");
    check(toldAbout(docsId, "Akshara Anilkumar: Jeslin Varghese is the mentor now") !== "0", "the previous mentor hears they are off the file");
    check(statusCode() === "MENTOR_ASSIGNED", "the status does not move again");
    await go(page, "/ausbildung");
    const cell = (await page.locator(`[data-tracker-row="${akshara}"] [data-mentor]`).innerText().catch(() => "")).replace(/\s+/g, " ");
    check(/Mentor: Jeslin Varghese/.test(cell), "and the tracker names the new mentor");
  }
  await docs.ctx.close();

  // Back to the seed: applications, paper and the notices this raised.
  sql(`delete from student_people where student_id = '${akshara}' and part = 'Documentation mentor'`);
  for (const [i, id] of appIds.entries()) {
    const [statusId, changedAt, handedAt, handedBy, note] = appsBefore[i];
    sql(`update applications set status_id = '${statusId}', status_changed_at = '${changedAt}', handed_over_at = ${handedAt ? `'${handedAt}'` : "null"}, handed_over_by_id = ${handedBy ? `'${handedBy}'` : "null"}, handover_note = ${note ? `'${q(note)}'` : "null"} where id = '${id}'`);
  }
  for (const [id, state, validTo] of paperBefore) sql(`update checklist_items set state = '${state}', valid_to = ${validTo ? `'${validTo}'` : "null"} where id = '${id}'`);
  sql(`delete from notifications where href = '${tabHref}' and created_at > '${noticesBefore}'`);
  check(sql(`select status_id from applications where id = '${ausbApp}'`) === ausbStatusBefore, "and the application is back where the seed left it");
}

for (const a of all) check(a.errors.length === 0, `${a.email}: no page errors or 500s ${a.errors.slice(0, 2).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
