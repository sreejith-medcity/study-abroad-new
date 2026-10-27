// FSJ and BFD: one student walked from registration to departure on the
// written process, through every decision branch the guide has.
//
// Registration and the registration email (step 2); the hand-over blocked on
// the documents and details, then let through (step 3); the cross-check with a
// missing document raised (step 4); a language assessment that is not
// sufficient, the improvement classes and a sufficient re-assessment (5 and 7);
// the payment check holding the application on the unpaid application fee,
// the status picker refusing to start it, and the check starting it once the
// counsellor marks the fee paid (6); an interview, the employer not selecting,
// the same employer refused and another one scheduled, a second round with the
// same employer, positive feedback (8 and 9); the offer and the contract, and
// the hand-over to the visa team (10); the VFS slot, the pre-visa payment
// gate, a refusal corrected and resubmitted, the approval (11 to 15); the
// hand-over to the travel desk, the departure and the follow-up (16 to 18).
// Then the scope: another branch, another counsellor and the desk before the
// hand-over cannot open the file, notices reach only people who can, and the
// tracker lists only what each person may see. The portal card and the
// dashboard figures read the same file. Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
const wait = async (q, want, ms = 15000) => {
  let got = sql(q);
  for (let t0 = Date.now(); got !== want && Date.now() - t0 < ms; ) {
    await new Promise((r) => setTimeout(r, 300));
    got = sql(q);
  }
  return got;
};
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const today = day();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 40;
const all = [];
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.243.7.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    if (knownWarning(e, page.url())) return;
    errors.push(String(e).slice(0, 160));
  });
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  all.push({ email, errors });
  return { ctx, page, errors };
}
const go = async (page, path) => {
  const res = await page.goto(BASE + path);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return { status: res?.status() ?? 0, text: (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ") };
};

/** Fills one step's form on the FSJ / BFD tab and presses its button. */
async function step(page, op, fields, button) {
  const form = page.locator(`[data-fsj-op="${op}"]`).first();
  await form.waitFor({ timeout: 15000 });
  for (const [name, value] of Object.entries(fields)) {
    const el = form.locator(`[name="${name}"]`).first();
    const tag = await el.evaluate((e) => (e.tagName === "INPUT" ? `INPUT:${e.type}` : e.tagName));
    if (tag === "SELECT") await el.selectOption(value);
    else if (tag === "INPUT:checkbox") await (value ? el.check() : el.uncheck());
    else await el.fill(value);
  }
  await form.getByRole("button", { name: button }).click();
  return form;
}
const refusal = async (form) => (await form.locator('[role="alert"]').first().innerText({ timeout: 12000 }).catch(() => "")).replace(/\s+/g, " ");

/* ---------------- The course the applications go on ---------------- */

// The guide names no institution, so the head office adds FSJ and BFD courses
// in the catalogue. These two stand in for them.
const klinik = sql("select id from universities where name like 'Rhein-Main Klinikverbund%' limit 1");
sql(`insert into programs (id, name, university_id, pathway, level, intake_months, status, application_fee, tuition_per_year) values
  ('fsjsuiteprog', 'FSJ placement, Rhein-Main (suite)', '${klinik}', 'FSJ', 'VOCATIONAL', '{}', 'LIVE', 0, 0),
  ('bfdsuiteprog', 'BFD placement, Rhein-Main (suite)', '${klinik}', 'BFD', 'VOCATIONAL', '{}', 'LIVE', 0, 0)
  on conflict (id) do nothing`);
check(sql("select count(*) from status_definitions where pathway in ('FSJ','BFD') and active") === "60", "the FSJ and BFD status flows are in the database");

/* ---------------- Step 2: registration ---------------- */

const counsellor = await signIn("germany@medcity.test");
const kottayamHead = "kottayam@medcity.test";
let sid;
{
  const page = counsellor.page;
  await go(page, "/students/new");
  await page.locator('input[name="firstName"]').fill("Fsjwalk");
  await page.locator('input[name="lastName"]').fill("Suite");
  await page.locator('input[name="email"]').fill("fsjwalk.suite@example.com");
  await page.locator('input[name="phone"]').fill("+91 98470 55501");
  const aims = await page.locator('select[name="aim"] option').evaluateAll((els) => els.map((e) => e.value));
  check(aims.includes("FSJ") && aims.includes("BFD"), "registration offers FSJ and BFD as what the student is aiming for");
  await page.locator('select[name="aim"]').selectOption("FSJ");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: "Create student" }).click();
  await page.waitForURL(/\/students\/[^/]+\/profile/, { timeout: 20000 }).catch(() => {});
  sid = sql("select id from students where first_name = 'Fsjwalk' and last_name = 'Suite'");
  check(!!sid && sql(`select preferred_pathway from students where id = '${sid}'`) === "FSJ", "the student is registered for FSJ");

  await go(page, `/students/${sid}/profile`);
  check((await page.locator(`main a[href="/students/${sid}/fsj"]`).count()) > 0, "an FSJ file has an FSJ / BFD tab");
  let t = await go(page, `/students/${sid}/fsj`);
  check(/No open FSJ \/ BFD application yet/.test(t.text), "with no application yet, the tab says where to start one");
  check(/18 to 26 years/.test(t.text) && /6 to 12 months/.test(t.text), "and shows the FSJ programme facts as information");

  // The application, from the Applications tab, on the FSJ course.
  await go(page, `/students/${sid}/applications?tab=apply`);
  const box = page.locator('input[role="combobox"]').first();
  await box.click();
  await box.fill("FSJ placement");
  await page.locator('[role="option"]', { hasText: "FSJ placement" }).first().click({ timeout: 15000 });
  await page.waitForFunction(() => (document.querySelector('select[name="intake"]')?.options.length ?? 0) > 1, null, { timeout: 10000 }).catch(() => {});
  const intakes = (await page.locator('select[name="intake"] option').evaluateAll((els) => els.map((e) => e.value))).filter(Boolean);
  await page.locator('select[name="intake"]').selectOption(intakes[1] ?? intakes[0]);
  await page.getByRole("button", { name: "Create application" }).click();
  await wait(`select count(*) from applications where student_id = '${sid}'`, "1");
}
const app = sql(`select id from applications where student_id = '${sid}'`);
const statusOf = () => sql(`select sd.code from applications a join status_definitions sd on sd.id = a.status_id where a.id = '${app}'`);
const waitStatus = (code) => wait(`select sd.code from applications a join status_definitions sd on sd.id = a.status_id where a.id = '${app}'`, code);
const events = (kind) => sql(`select count(*) from fsj_events where application_id = '${app}' and kind = '${kind}'`);
const noticeSql = (email, like) => `select count(*) from notifications n join users u on u.id = n.user_id where u.email = '${email}' and n.title like '${like.replace(/'/g, "''")}'`;
const notices = (email, like) => Number(sql(noticeSql(email, like)));
// Notices are written after the status moves, so they are waited for rather than read at once.
const noticed = async (email, like, want = 1) => (await wait(noticeSql(email, like), String(want))) === String(want);
check(statusOf() === "REGISTRATION", "a new FSJ application starts at registration and agreement (step 2)");
const tab = `/students/${sid}/fsj`;

{
  const page = counsellor.page;
  let t = await go(page, tab);
  check(/Step 2 of 18: Registration and agreement/.test(t.text), "the tab places the file on step 2 of 18");
  let form = await step(page, "registration", { registrationFeePaidOn: today }, "Record registration");
  check(/agreement/i.test(await refusal(form)), "registration needs the signed agreement as well as the fee");
  await go(page, tab);
  await step(page, "registration", { registrationFeePaidOn: today, agreementSignedOn: today }, "Record registration");
  check((await waitStatus("DOCUMENT_COLLECTION")) === "DOCUMENT_COLLECTION", "recording it moves the file to document collection (step 3)");
  check(sql(`select fsj_registration_fee_paid_on || '|' || fsj_agreement_signed_on from applications where id = '${app}'`) === `${today}|${today}`, "with the fee and the agreement dates on the application");
  check(Number(sql(`select count(*) from record_versions where entity = 'application' and entity_id = '${app}' and action = 'fsj.registration'`)) === 1, "written through the tracked update, so the History tab has it");
  check((await noticed(kottayamHead, "Fsjwalk Suite: registered for FSJ")) && (await wait(`select count(*) from fsj_events where application_id = '${app}' and kind = 'NOTICE'`, "1")) === "1", "the 'candidate registered' trigger is a notice to the branch head");

  t = await go(page, tab);
  const reg = page.locator('[data-email="REGISTERED"]');
  const to = (await reg.locator("[data-email-to]").innerText()).replace(/\s+/g, " ");
  check(to.includes("fsj.bfd@miak.in") && to.includes("nsg.ast@miak.in") && to.includes(kottayamHead), `the registration email is shown to fsj.bfd@ and nsg.ast@ with the branch head in copy (${to})`);
  check(/The portal does not send email/.test(t.text), "and the tab says plainly that the portal does not send it");
  await reg.locator('[data-copy-email="REGISTERED"]').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check(/Subject: FSJ registration: Fsjwalk Suite/.test(copied) && /Counsellor:/.test(copied), "'Copy email text' copies the addresses, subject and the candidate's details");
}

/* ---------------- Step 3: the hand-over, blocked then let through ---------------- */
{
  const page = counsellor.page;
  const t = await go(page, tab);
  const blocked = (await page.locator("[data-handover-blocked]").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/Birth certificate/.test(blocked) && /parent's contact number/.test(blocked) && /current German level/.test(blocked), `the hand-over names what is still needed (${blocked.slice(0, 140)})`);
  check((await page.locator('[data-fsj-op="handover"]').count()) === 0, "and offers no button until it is in");
  check(/AADHAAR_CARD/.test(sql(`select string_agg(type_code, ',') from checklist_items where student_id = '${sid}'`)), "the FSJ document list includes the guide's own items (Aadhaar card)");

  // The details, as the counsellor records them: the German level on the tab, the rest on the profile.
  await page.locator('[data-module="B1"] select[name="state"]').selectOption("COMPLETED");
  await page.locator('[data-module="B1"]').getByRole("button", { name: "Save" }).click();
  await wait(`select state from german_modules where student_id = '${sid}' and level = 'B1'`, "COMPLETED");
  sql(`insert into student_contacts (id, student_id, relation, name, phone) values ('fsjsuitecontact', '${sid}', 'Father', 'Suite Senior', '+91 98470 55502') on conflict do nothing`);
  sql(`update students set gap_years = 0 where id = '${sid}'`);
  if (!sql(`select coalesce(medcity_id, '') from students where id = '${sid}'`)) sql(`update students set medcity_id = 'MC-KTM-26-9901' where id = '${sid}'`);
  // The documents themselves are checked on the documentation tab; here they are taken as accepted.
  sql(`update checklist_items set state = 'ACCEPTED' where student_id = '${sid}' and stage = 'PROFILE'`);
  await go(page, tab);
  await step(page, "handover", { note: "B1 done, keen on elderly care." }, "Hand to the Documentation Department");
  check((await waitStatus("DOCUMENT_CROSS_CHECK")) === "DOCUMENT_CROSS_CHECK", "once everything is in, the hand-over moves the file to the documentation team (step 4)");
  check(sql(`select (handed_over_at is not null)::text || '|' || handover_note from applications where id = '${app}'`) === "true|B1 done, keen on elderly care.", "the application is marked handed over, with the branch's note");
  check(sql(`select count(*) from ownership_ledger where entity = 'student' and entity_id = '${sid}' and kind = 'HANDOVER'`) === "1", "and the hand-over is on the student's line of the ownership ledger");
  check((await noticed("documentation@medcityoverseas.test", "Fsjwalk Suite: FSJ / BFD file handed to the documentation team")), "the documentation team is told the file has arrived");
  check(sql(`select coalesce(officer_id, '') from applications where id = '${app}'`) === "", "the branch recording its own steps does not become the file's officer");
}

/* ---------------- Step 4: the cross-check ---------------- */
const docs = await signIn("documentation@medcityoverseas.test");
{
  const page = docs.page;
  const t = await go(page, tab);
  check(t.status === 200 && /Step 4 of 18: Document cross-check/.test(t.text), "the documentation team opens the handed-over file at step 4");
  await step(page, "missing", { missing: "Vaccination certificate: Hepatitis B page is blurred" }, "Tell the counsellor");
  await wait(`select count(*) from fsj_events where application_id = '${app}' and kind = 'DOCUMENTS_MISSING'`, "1");
  check((await noticed("germany@medcity.test", "Fsjwalk Suite: documents or details missing")), "a missing document is a notice to the counsellor");
  await go(page, tab);
  await step(page, "crosscheck", {}, "Cross-check complete");
  check((await waitStatus("LANGUAGE_ASSESSMENT")) === "LANGUAGE_ASSESSMENT", "the cross-check done moves the file to the language assessment (step 5)");
}

/* ---------------- Steps 5 and 7: not sufficient, improvement, re-assessed ---------------- */
{
  // The counsellor reads the file but does not record the desk's steps.
  await go(counsellor.page, tab);
  check((await counsellor.page.locator('[data-fsj-op="assessment"]').count()) === 0, "the counsellor is not offered the language assessment");

  const page = docs.page;
  await go(page, tab);
  await step(page, "assessment", { level: "A2", result: "NOT_SUFFICIENT", note: "Speaking needs work." }, "Record the assessment");
  check((await waitStatus("LANGUAGE_IMPROVEMENT")) === "LANGUAGE_IMPROVEMENT", "not sufficient sends the file to language improvement classes (step 7)");
  check(sql(`select fsj_language_level || '|' || fsj_language_result from applications where id = '${app}'`) === "A2|NOT_SUFFICIENT", "with the level and the result stored exactly as entered");
  await go(page, tab);
  await step(page, "assessment", { level: "B1", result: "SUFFICIENT" }, "Record the re-assessment");
  check((await waitStatus("PAYMENT_CHECK")) === "PAYMENT_CHECK", "the re-assessment recorded sufficient moves it on to the payment check (step 6)");
  check(events("LANGUAGE_ASSESSMENT") === "2", "both assessments are kept, so the re-assessment loop reads back");
  check((await noticed("germany@medcity.test", "Fsjwalk Suite: language re-assessment recorded")), "and the counsellor is told of the re-assessment");
  const t = await go(page, tab);
  check(/not sufficient/.test(t.text) && /level A2/.test(t.text) && /level B1/.test(t.text), "the file's history shows both rounds");
}

/* ---------------- Step 6: fee pending blocks, then paid ---------------- */
const admin = await signIn("sreejith@miak.in");
{
  const page = docs.page;
  await go(page, tab);
  check((await page.locator('[data-fee-gate="blocked"]').count()) === 1, "the payment check says the application fee is not marked paid");
  const form = await step(page, "feecheck", {}, "Run the payment check");
  check(/application fee is not marked paid/.test(await refusal(form)), "the check refuses to start the application");
  check((await waitStatus("APPLICATION_ON_HOLD")) === "APPLICATION_ON_HOLD", "and puts it on hold: application fee pending");
  check((await noticed("germany@medcity.test", "Fsjwalk Suite: application on hold, fee pending")) && (await noticed(kottayamHead, "Fsjwalk Suite: application on hold, fee pending")), "the counsellor and the branch head are told");

  // Not from the status picker either.
  await go(admin.page, `/students/${sid}/applications?app=${app}`);
  await admin.page.locator(`#status-${app}`).selectOption({ label: "Application started: interview preparation" });
  await admin.page.getByRole("button", { name: "Update status" }).click();
  const said = await admin.page.locator('[role="alert"]').filter({ hasText: /not marked paid/ }).first().innerText({ timeout: 10000 }).catch(() => "");
  check(/application fee is not marked paid/.test(said) && statusOf() === "APPLICATION_ON_HOLD", "an admin moving the status by hand is refused while the fee is pending");
  await go(page, tab);
  check((await page.locator('[data-fsj-op="interview"]').count()) === 0, "and no interview can be scheduled");

  // The counsellor marks the fee paid; the desk is told and starts the application.
  await go(counsellor.page, tab);
  await step(counsellor.page, "payments", { applicationFeePaidOn: today }, "Save payments");
  await wait(`select coalesce(fsj_application_fee_paid_on::text, '') from applications where id = '${app}'`, today);
  check((await noticed("documentation@medcityoverseas.test", "Fsjwalk Suite: fees received")), "marking the fee paid tells the documentation team to start the application");
  await go(page, tab);
  await step(page, "feecheck", {}, "Start the application");
  check((await waitStatus("INTERVIEW_PREPARATION")) === "INTERVIEW_PREPARATION", "with both fees in, the application starts: interview preparation (step 7)");
  check(sql(`select fsj_application_started_on from applications where id = '${app}'`) === today, "and the day it started is recorded");
}

/* ---------------- Steps 8 and 9: not selected, another employer, a second round ---------------- */
const at = `${day(14)}T15:30`;
{
  const page = docs.page;
  await go(page, tab);
  await step(page, "interview", { employer: "Caritas Köln", interviewAt: at, link: "https://meet.example/fsj-1", responsibilities: "Elderly care support", requirements: "B1 spoken German" }, "Schedule the interview");
  check((await waitStatus("INTERVIEW_SCHEDULED")) === "INTERVIEW_SCHEDULED", "the interview is scheduled (step 8)");
  check(sql(`select fsj_employer || '|' || fsj_interview_link || '|' || to_char(fsj_interview_at at time zone 'Asia/Kolkata', 'HH24:MI') from applications where id = '${app}'`) === "Caritas Köln|https://meet.example/fsj-1|15:30", "with the organisation, the link and the time in IST");
  let t = await go(page, tab);
  const draft = await page.locator('[data-email="INTERVIEW_SCHEDULED"] [data-email-text]').textContent();
  check(/Organisation \/ employer: Caritas Köln/.test(draft) && /https:\/\/meet\.example\/fsj-1/.test(draft) && /Elderly care support/.test(draft) && /B1 spoken German/.test(draft), "the interview email carries the link, organisation, responsibilities and requirements");
  check((await page.locator('[data-email="INTERVIEW_SCHEDULED"] [data-email-to]').innerText()).includes("fsjwalk.suite@example.com"), "addressed to the candidate");

  await step(page, "attended", {}, "Interview attended");
  check((await waitStatus("INTERVIEW_ATTENDED")) === "INTERVIEW_ATTENDED", "attended: waiting for the employer's feedback (step 9)");
  await go(page, tab);
  let form = await step(page, "feedback", { outcome: "NOT_SELECTED" }, "Record the feedback");
  check(/employer's feedback/.test(await refusal(form)), "not selected needs the employer's feedback to share");
  await go(page, tab);
  await step(page, "feedback", { outcome: "NOT_SELECTED", note: "Wanted more care experience." }, "Record the feedback");
  check((await waitStatus("INTERVIEW_PREPARATION")) === "INTERVIEW_PREPARATION", "not selected sends the file back to interview preparation");
  check(sql(`select coalesce(fsj_employer, '') from applications where id = '${app}'`) === "", "with the interview cleared for the next employer");
  check((await noticed("germany@medcity.test", "Fsjwalk Suite: not selected by Caritas Köln")), "and the feedback goes to the counsellor");

  await go(page, tab);
  form = await step(page, "interview", { employer: "caritas köln", interviewAt: at }, "Schedule the interview");
  check(/did not select the candidate/.test(await refusal(form)), "the employer that did not select is not offered again");
  await go(page, tab);
  await step(page, "interview", { employer: "Diakonie Bremen", interviewAt: at, link: "https://meet.example/fsj-2" }, "Schedule the interview");
  check((await waitStatus("INTERVIEW_SCHEDULED")) === "INTERVIEW_SCHEDULED", "another employer is scheduled");
  await go(page, tab);
  await step(page, "feedback", { outcome: "SECOND_ROUND" }, "Record the feedback");
  check((await waitStatus("SECOND_ROUND")) === "SECOND_ROUND", "several shortlisted: a second-round interview");
  await go(page, tab);
  form = await step(page, "interview", { employer: "AWO Berlin", interviewAt: at }, "Schedule the second round");
  check(/second round is with Diakonie Bremen/.test(await refusal(form)), "the second round is with the employer that shortlisted");
  await go(page, tab);
  await step(page, "interview", { employer: "Diakonie Bremen", interviewAt: `${day(21)}T11:00` }, "Schedule the second round");
  await waitStatus("INTERVIEW_SCHEDULED");
  await go(page, tab);
  await step(page, "feedback", { outcome: "POSITIVE", note: "Selected." }, "Record the feedback");
  check((await waitStatus("EMPLOYER_CONFIRMED")) === "EMPLOYER_CONFIRMED", "positive feedback: the employer confirms (step 10)");
  check(sql(`select string_agg(outcome, ',' order by created_at) from fsj_events where application_id = '${app}' and kind = 'FEEDBACK'`) === "NOT_SELECTED,SECOND_ROUND,POSITIVE", "every round's feedback is kept in order");
  t = await go(page, tab);
  check(/Caritas Köln/.test(t.text) && /Diakonie Bremen/.test(t.text), "and the history names both employers");
}

/* ---------------- Step 10: offer, contract, hand-over to the visa team ---------------- */
{
  const page = docs.page;
  await go(page, tab);
  let form = await step(page, "offer", { contractSignedOn: today }, "Save the offer and contract");
  check(/offer letter date before the contract/.test(await refusal(form)), "a contract without the offer letter is refused");
  await go(page, tab);
  await step(page, "offer", { offerOn: today }, "Save the offer and contract");
  check((await waitStatus("OFFER_RECEIVED")) === "OFFER_RECEIVED", "the offer letter is recorded");
  check((await noticed("germany@medcity.test", "Fsjwalk Suite: offer letter issued")), "and the counsellor is told to collect the offer-letter stage payment");
  await go(page, tab);
  await step(page, "offer", { offerOn: today, contractSignedOn: today }, "Save the offer and contract");
  check((await waitStatus("CONTRACT_SIGNED")) === "CONTRACT_SIGNED", "then the signed contract");
  await go(page, tab);
  await step(page, "handover", {}, "Hand to the Visa Team");
  check((await waitStatus("VFS_SLOT_BOOKING")) === "VFS_SLOT_BOOKING", "the file is handed to the visa team: VFS slot booking (step 11)");
  check(sql(`select count(*) from ownership_ledger where entity = 'student' and entity_id = '${sid}' and kind = 'HANDOVER' and detail like '%Visa team%'`) === "1", "the department hand-over is on the ownership ledger");
}

/* ---------------- Steps 11 to 15: VFS, a refusal resubmitted, the approval ---------------- */
{
  const page = docs.page;
  await go(page, tab);
  await step(page, "vfs", { vfsSlotOn: day(30) }, "Save the VFS slot");
  check((await waitStatus("PRE_VISA_DOCUMENTS")) === "PRE_VISA_DOCUMENTS", "the VFS slot booked: visa document preparation (step 12)");
  await go(page, tab);
  let form = await step(page, "visaReady", {}, "Visa file ready for VFS");
  check(/pre-visa payment is not marked received/.test(await refusal(form)), "the file is not ready for VFS until the pre-visa payment is in");
  await go(counsellor.page, tab);
  await step(counsellor.page, "payments", { offerPaymentOn: today, preVisaPaymentOn: today }, "Save payments");
  await wait(`select coalesce(fsj_pre_visa_payment_on::text, '') from applications where id = '${app}'`, today);
  await go(page, tab);
  await step(page, "visaReady", {}, "Visa file ready for VFS");
  check((await waitStatus("VISA_FILED")) === "VISA_FILED", "with it in, the candidate goes to VFS (step 13)");
  await go(page, tab);
  await step(page, "visaSubmitted", { submittedOn: day(30) }, "Submitted at VFS");
  check((await waitStatus("VISA_PROCESSING")) === "VISA_PROCESSING", "submitted: the visa is processing (step 14)");
  await go(page, tab);
  form = await step(page, "visaDecision", { outcome: "REJECTED" }, "Record the visa decision");
  check(/reason for the refusal/.test(await refusal(form)), "a refusal needs its reason");
  await go(page, tab);
  await step(page, "visaDecision", { outcome: "REJECTED", reason: "Accommodation proof unclear", employerStillWilling: true }, "Record the visa decision");
  check((await waitStatus("VISA_RESUBMISSION")) === "VISA_RESUBMISSION", "refused, with the employer still willing: the file is corrected to resubmit");
  check(sql(`select visa_decision || '|' || fsj_visa_reason from applications where id = '${app}'`) === "REFUSED|Accommodation proof unclear", "the refusal and its reason are on the application");
  await go(page, tab);
  await step(page, "visaReady", {}, "Visa file ready for VFS");
  await waitStatus("VISA_FILED");
  await go(page, tab);
  await step(page, "visaSubmitted", { submittedOn: day(45) }, "Submitted at VFS");
  await waitStatus("VISA_PROCESSING");
  check(sql(`select string_agg(outcome, ',' order by created_at) from fsj_events where application_id = '${app}' and kind = 'VISA_SUBMITTED'`) === "FIRST,RESUBMITTED", "the second submission is recorded as a resubmission");
  await go(page, tab);
  await step(page, "visaDecision", { outcome: "APPROVED", decidedOn: day(60) }, "Record the visa decision");
  check((await waitStatus("VISA_RECEIVED")) === "VISA_RECEIVED", "the resubmission is approved (step 15)");
  check((await noticed(kottayamHead, "Fsjwalk Suite: visa approved")), "the 'visa approved' trigger reaches the branch head");

  await go(page, tab);
  form = await step(page, "handover", {}, "Hand to the Travel Desk");
  check(/joining date/.test(await refusal(form)), "the travel desk does not take the file before the joining date is confirmed");
  await go(page, tab);
  const approval = page.locator('[data-fsj-op="approval"]');
  await approval.locator('input[name="joiningOn"]').fill(day(75));
  await approval.locator('input[value="s15.passport"]').check();
  await approval.locator('input[value="s15.employer"]').check();
  await approval.getByRole("button", { name: "Save the visa approval" }).click();
  await wait(`select coalesce(fsj_joining_on::text, '') from applications where id = '${app}'`, day(75));
  await go(page, tab);
  await step(page, "handover", { note: "Joining in Bremen." }, "Hand to the Travel Desk");
  check((await waitStatus("PRE_DEPARTURE")) === "PRE_DEPARTURE", "handed to the travel desk: pre-departure (step 16)");
  check(sql(`select count(*) from ownership_ledger where entity = 'student' and entity_id = '${sid}' and kind = 'HANDOVER'`) === "3", "three hand-overs on the ledger: documentation, visa team, travel desk");
}

/* ---------------- Steps 16 to 18: the travel desk ---------------- */
const lead = await signIn("teamlead@medcityoverseas.test");
{
  await go(docs.page, tab);
  check((await docs.page.locator('[data-fsj-op="departure"]').count()) === 0, "the documentation officer is not offered the travel desk's steps");
  const page = lead.page;
  await go(page, tab);
  const pre = page.locator('[data-fsj-op="checklist"]').filter({ has: page.locator('input[name="step"][value="16"]') });
  for (const k of ["s16.flight", "s16.accommodation", "s16.insurance", "s16.pickup"]) await pre.locator(`input[value="${k}"]`).check();
  await pre.getByRole("button", { name: "Save step 16" }).click();
  await wait(`select array_length(fsj_done, 1)::text from applications where id = '${app}'`, "6");
  await go(page, tab);
  await step(page, "departure", { departedOn: day(75) }, "Record the departure");
  check((await waitStatus("JOINED")) === "JOINED", "departed: started as an FSJ volunteer (step 17)");
  await go(page, tab);
  const follow = page.locator('[data-fsj-op="checklist"]').filter({ has: page.locator('input[name="step"][value="18"]') });
  await follow.locator('input[value="s18.happyCall"]').check();
  await follow.getByRole("button", { name: "Save step 18" }).click();
  check((await waitStatus("HAPPY_CALL")) === "HAPPY_CALL", "the happy call starts the post-arrival follow-up (step 18)");
  check(sql(`select array_to_string(fsj_done, ',') from applications where id = '${app}'`) === "s15.passport,s15.employer,s16.flight,s16.accommodation,s16.insurance,s16.pickup,s18.happyCall", "every step's ticks are kept apart on the file");
  const t = await go(page, tab);
  check(/Step 18 of 18: Post-arrival follow-up/.test(t.text), "the tab ends on step 18 of 18");
  check(Number(sql(`select count(*) from record_versions where entity = 'application' and entity_id = '${app}' and action like 'fsj.%'`)) >= 15, "every step's fields went through the tracked update");
}

/* ---------------- The student portal ---------------- */
{
  const hash = "(select password_hash from users where email = 'fathima.rahman@example.com')";
  sql(`insert into users (id, name, email, phone, password_hash, role, org_id, student_id, locale)
       select 'fsjsuitestudent', first_name || ' ' || last_name, email, phone, ${hash}, 'STUDENT', org_id, id, 'en' from students where id = '${sid}' on conflict do nothing`);
  sql(`update users set must_change_password = false, active = true where id = 'fsjsuitestudent'`);
  const s = await signIn("fsjwalk.suite@example.com");
  await s.page.waitForURL(/\/portal/, { timeout: 15000 }).catch(() => {});
  await go(s.page, "/portal");
  const card = s.page.locator("[data-fsj-journey]");
  check((await card.count()) === 1, "the student's portal shows the FSJ / BFD journey card");
  check((await card.getAttribute("data-current-step")) === "18" && /Settling in: we stay in touch/.test(await card.innerText()), "with their step in plain words");
  check(!/miak\.in|Documentation team|Visa team/.test(await card.innerText()), "and nothing internal: no addresses, no department owners");
  await s.ctx.close();
}

/* ---------------- Scope ---------------- */
{
  // Another branch, another counsellor at the same branch: not their file.
  const kochi = await signIn("kochi@medcity.test");
  let r = await go(kochi.page, tab);
  check(r.status === 404, `another branch's head cannot open the file (${r.status})`);
  r = await go(kochi.page, "/fsj");
  check((await kochi.page.locator(`[data-fsj-row="${sid}"]`).count()) === 0, "nor sees it on the FSJ / BFD tracker");
  check(notices("kochi@medcity.test", "%Fsjwalk%") === 0, "and was never sent a notice about it");
  const other = await signIn("uk.docs@medcity.test");
  r = await go(other.page, tab);
  check(r.status === 404, `another counsellor at the same branch cannot open it (${r.status})`);
  await go(other.page, "/fsj");
  check((await other.page.locator(`[data-fsj-row="${sid}"]`).count()) === 0, "nor sees it listed");

  // A BFD file at Kochi, not handed over: the desk cannot open it, Kottayam does not see it.
  const kochiOrg = sql("select id from organizations where name = 'Medcity Kochi'");
  sql(`insert into students (id, org_id, created_by_id, first_name, last_name, phone, portal_token, preferred_pathway)
       values ('bfdsuitestudent', '${kochiOrg}', (select id from users where email = 'kochi@medcity.test'), 'Bfdwalk', 'Suite', '+91 98470 55509', 'bfdsuitetoken', 'BFD') on conflict do nothing`);
  const kochiStudent = "bfdsuitestudent";
  sql(`insert into applications (id, ack_no, student_id, program_id, org_id, intake_month, intake_year, status_id, created_by_id)
       values ('bfdsuiteapp', 'BFD-SUITE-1', '${kochiStudent}', 'bfdsuiteprog', '${kochiOrg}', 10, ${new Date().getFullYear() + 1},
       (select id from status_definitions where pathway = 'BFD' and code = 'DOCUMENT_COLLECTION'), (select id from users where email = 'kochi@medcity.test')) on conflict do nothing`);
  r = await go(docs.page, `/students/${kochiStudent}/fsj`);
  check(r.status === 404, `the documentation team cannot open a BFD file the branch has not handed over (${r.status})`);
  r = await go(kochi.page, `/students/${kochiStudent}/fsj`);
  check(r.status === 200 && /BFD: Bundesfreiwilligendienst/.test(r.text) && /no upper limit/.test(r.text), "its own branch opens the BFD file, with the BFD programme facts");
  check((await kochi.page.locator('[data-fsj-op="handover"], [data-handover-blocked]').count()) === 1, "and is offered its hand-over (or told what it still needs)");
  const head = await signIn(kottayamHead);
  await go(head.page, "/fsj");
  check((await head.page.locator(`[data-fsj-row="${sid}"]`).count()) === 1 && (await head.page.locator(`[data-fsj-row="${kochiStudent}"]`).count()) === 0, "Kottayam's head sees their own FSJ file on the tracker and not Kochi's BFD file");
  await go(admin.page, "/fsj?programme=BFD");
  check((await admin.page.locator(`[data-fsj-row="${kochiStudent}"]`).count()) === 1 && (await admin.page.locator(`[data-fsj-row="${sid}"]`).count()) === 0, "the head office sees every file, and the programme filter narrows to BFD");
  for (const c of [kochi, other, head]) await c.ctx.close();
}

/* ---------------- The tracker's filters ---------------- */
{
  const page = admin.page;
  await go(page, "/fsj?dept=TRAVEL");
  const row = page.locator(`[data-fsj-row="${sid}"]`);
  check((await row.count()) === 1 && (await row.getAttribute("data-step")) === "18", "the tracker places the file at step 18 with the travel desk");
  await go(page, "/fsj?dept=VISA");
  check((await page.locator(`[data-fsj-row="${sid}"]`).count()) === 0, "and not with the visa team");
  await go(page, "/fsj?step=18");
  check((await page.locator(`[data-fsj-row="${sid}"]`).count()) === 1, "the step filter finds it");
  await go(page, "/fsj?stuck=7");
  check((await page.locator(`[data-fsj-row="${sid}"]`).count()) === 0, "a file that moved today is not stuck for 7 days");
  sql(`update applications set status_changed_at = now() - interval '10 days' where id = '${app}'`);
  await go(page, "/fsj?stuck=7");
  check((await page.locator(`[data-fsj-row="${sid}"] [data-days]`).innerText().catch(() => "")) === "10 days", "after ten days at the step it is, with the days shown");
  const kochiOrg = sql("select id from organizations where name = 'Medcity Kochi'");
  await go(page, `/fsj?branch=${kochiOrg}`);
  check((await page.locator(`[data-fsj-row="${sid}"]`).count()) === 0, "the branch filter leaves out another branch's file");
  const t = await go(page, "/ausbildung");
  check((await page.locator("[data-fsj-tracker-link]").count()) === 1 && /FSJ \/ BFD/.test(t.text), "the placement tracker links to the FSJ / BFD tracker");
}

/* ---------------- The dashboard ---------------- */
{
  const page = admin.page;
  await go(page, "/dashboard");
  const tile = page.locator('[data-placement="fsj-students"]');
  if ((await tile.count()) === 1) {
    const shown = Number((await tile.locator("[data-figure]").innerText()).replace(/[^0-9]/g, ""));
    await go(page, (await tile.getAttribute("href")).replace(BASE, ""));
    const rows = await page.locator("[data-fsj-row]").count();
    check(shown === rows && shown >= 2, `the placements card's FSJ / BFD figure is the list it opens (${shown} against ${rows})`);
  } else check(false, "the head office's dashboard shows the FSJ / BFD figures");
}

for (const s of [counsellor, docs, admin, lead]) await s.ctx.close();
for (const a of all) if (a.errors.length) check(false, `${a.email}: no page errors (${a.errors.slice(0, 3).join(" | ")})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
