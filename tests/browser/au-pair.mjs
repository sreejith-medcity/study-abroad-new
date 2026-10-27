// Au pair: one student walked through the written process, from the enquiry
// to the happy call in Germany, through the guide's decision branches.
//
// Counselling and registration with the email the branch sends (steps 1 and
// 2); the hand-over blocked on the documents and details, then let through
// (3); the mentor (4); mock interviews and the profile with consent (5 and
// 6); a host family not selecting, back to interview preparation, the same
// family refused, another family selecting (6 and 7); the contract (8); the
// gate before the visa appointment, from the tab and the status picker, the
// payment verification (9 and 10); processing, a follow-up and the approval
// (11 and 12); the travel desk, the departure and the arrival (13 to 15). The
// tab, the tracker (head office and branch) and the student portal are read
// at the not-selected loop and at the end. Wants the plain seed with
// deploy/au-pair-pathway.sql loaded.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = process.env.DB ?? (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
const wait = async (q, want, ms = 45000) => {
  let got = sql(q);
  for (let t0 = Date.now(); got !== want && Date.now() - t0 < ms; ) {
    await new Promise((r) => setTimeout(r, 300));
    got = sql(q);
  }
  return got;
};
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const today = day();
// Each run walks a student of its own, so a second run reads only its own notices.
const tag = Array.from({ length: 5 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
const first = `Aupair${tag[0].toUpperCase()}${tag.slice(1)}`;
const name = `${first} Suite`;
const mail = `aupair.${tag}@example.com`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
const all = [];
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.243.9.${ip++}` } });
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
  const res = await page.goto(BASE + path, { timeout: 90000 });
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return { status: res?.status() ?? 0, text: (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ") };
};

/** Fills one step's form on the Au pair tab and presses its button. Checkboxes are given as a list of values to tick. */
async function step(page, op, fields, button, nth = 0) {
  const form = page.locator(`[data-au-pair-op="${op}"]`).nth(nth);
  await form.waitFor({ timeout: 45000 });
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) await form.locator(`input[name="${name}"][value="${v}"]`).check();
      continue;
    }
    const el = form.locator(`[name="${name}"]`).first();
    const tag = await el.evaluate((e) => (e.tagName === "INPUT" ? `INPUT:${e.type}` : e.tagName));
    if (tag === "SELECT") await el.selectOption(value);
    else await el.fill(value);
  }
  await form.getByRole("button", { name: button }).click();
  return form;
}
const refusal = async (form) => (await form.locator('[role="alert"]').first().innerText({ timeout: 45000 }).catch(() => "")).replace(/\s+/g, " ");

/* ---------------- The course ---------------- */
const klinik = sql("select id from universities where name like 'Rhein-Main Klinikverbund%' limit 1");
sql(`insert into programs (id, name, university_id, pathway, level, intake_months, status, application_fee, tuition_per_year) values
  ('aupairsuiteprog', 'Au pair year, Germany (suite)', '${klinik}', 'AU_PAIR', 'VOCATIONAL', '{}', 'LIVE', 0, 0) on conflict (id) do nothing`);
check(sql("select count(*) from status_definitions where pathway = 'AU_PAIR' and active and code = 'MENTOR_ASSIGNMENT'") === "1", "the written Au pair statuses are in the database");

const counsellor = await signIn("germany@medcity.test");
const head = "kottayam@medcity.test";
const noticeSql = (email, like) => `select count(*) from notifications n join users u on u.id = n.user_id where u.email = '${email}' and n.title like '${like.replace(/'/g, "''")}'`;
const noticed = async (email, like) => Number(await wait(noticeSql(email, like), "1")) >= 1;
let sid;
{
  const page = counsellor.page;
  await go(page, "/students/new");
  await page.locator('input[name="firstName"]').fill(first);
  await page.locator('input[name="lastName"]').fill("Suite");
  await page.locator('input[name="email"]').fill(mail);
  await page.locator('input[name="phone"]').fill("+91 98470 66601");
  await page.locator('select[name="aim"]').selectOption("AU_PAIR");
  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: "Create student" }).click();
  await page.waitForURL(/\/students\/[^/]+\/profile/, { timeout: 20000 }).catch(() => {});
  sid = sql(`select id from students where email = '${mail}'`);
  check(!!sid && sql(`select preferred_pathway from students where id = '${sid}'`) === "AU_PAIR", "the student is registered for Au pair");
  await go(page, `/students/${sid}/profile`);
  check((await page.locator(`main a[href="/students/${sid}/au-pair"]`).count()) > 0, "an Au pair file has an Au pair tab");
  const t = await go(page, `/students/${sid}/au-pair`);
  check(/No open Au pair application yet/.test(t.text) && /Usually 18 to 26 years/.test(t.text), "with no application the tab says where to start, and shows the guide's facts");

  await go(page, `/students/${sid}/applications?tab=apply`);
  const box = page.locator('input[role="combobox"]').first();
  await box.click();
  await box.fill("Au pair year");
  await page.locator('[role="option"]', { hasText: "Au pair year" }).first().click({ timeout: 15000 });
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
const tab = `/students/${sid}/au-pair`;
check(statusOf() === "ASSESSMENT", "a new Au pair application opens at the enquiry and counselling (step 1), with the documents still to come");

/* ---------------- Steps 1 and 2 ---------------- */
{
  const page = counsellor.page;
  let t = await go(page, tab);
  check(/Step 1 of 15: Student enquiry and initial counselling/.test(t.text), "the tab places the file on step 1 of 15");
  let form = await step(page, "counselling", {}, "The candidate decides to proceed", 1);
  check(/still has to cover/.test(await refusal(form)), "the candidate cannot proceed before the counselling points are covered");
  await go(page, tab);
  await step(page, "counselling", { done: ["ap1.profile", "ap1.programme", "ap1.finance", "ap1.preferences", "ap1.intake", "ap1.refund", "ap1.german"] }, "Save the counselling");
  await wait(`select array_length(fsj_done, 1) from applications where id = '${app}'`, "7");
  await go(page, tab);
  await step(page, "counselling", {}, "The candidate decides to proceed", 1);
  check((await waitStatus("REGISTRATION")) === "REGISTRATION", "with them covered, the decision moves the file to registration (step 2)");

  await go(page, tab);
  form = await step(page, "registration", { registrationFeePaidOn: today, agreementSignedOn: today }, "Record registration");
  check(/registration form/.test(await refusal(form)), "registration needs the candidate form");
  await go(page, tab);
  await step(page, "registration", { registrationFeePaidOn: today, agreementSignedOn: today, done: ["ap2.form"] }, "Record registration");
  check((await waitStatus("DOCUMENT_COLLECTION")) === "DOCUMENT_COLLECTION", "registration moves the file to document collection (step 3)");
  check(sql(`select fsj_registration_fee_paid_on || '|' || fsj_agreement_signed_on from applications where id = '${app}'`) === `${today}|${today}`, "the fee and agreement days are on the application");
  check(await noticed(head, `${name}: Au pair registration email to send`), "the branch is told the registration email is theirs to send");
  check(Number(sql(noticeSql("documentation@medcityoverseas.test", `${name}%`))) === 0, "the documentation team, who cannot open the file before the hand-over, is sent nothing yet");
  t = await go(page, tab);
  const to = (await page.locator("[data-au-pair-email] [data-email-to]").innerText()).replace(/\s+/g, " ");
  check(to.includes("aupair@miak.in") && to.includes(head), `the email card shows aupair@miak.in with the branch head in copy (${to})`);
  await page.locator('[data-copy-email="AU_PAIR_REGISTERED"]').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check(copied.includes(`Subject: Au pair registration: ${name}`), "'Copy email text' copies the draft");
}

/* ---------------- Step 3: the hand-over ---------------- */
{
  const page = counsellor.page;
  await go(page, tab);
  const blocked = (await page.locator("[data-handover-blocked]").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/Birth certificate/.test(blocked) && /German level/.test(blocked) && /German language certificates/.test(blocked), `the hand-over names what is still needed (${blocked.slice(0, 160)})`);
  check(/CHILDCARE_EXPERIENCE/.test(sql(`select string_agg(type_code, ',') from checklist_items where student_id = '${sid}'`)), "the guide's own documents are on the student's list (childcare experience)");
  await page.locator('[data-module="A2"] select[name="state"]').selectOption("COMPLETED");
  await page.locator('[data-module="A2"]').getByRole("button", { name: "Save" }).click();
  await wait(`select state from german_modules where student_id = '${sid}' and level = 'A2'`, "COMPLETED");
  if (!sql(`select coalesce(medcity_id, '') from students where id = '${sid}'`)) sql(`update students set medcity_id = 'MC-KTM-26-9951' where id = '${sid}'`);
  sql(`update checklist_items set state = 'ACCEPTED' where student_id = '${sid}' and stage = 'PROFILE'`);
  await go(page, tab);
  await step(page, "handover", { note: "A2 done, loves children." }, "Hand to the Documentation Department");
  check((await waitStatus("MENTOR_ASSIGNMENT")) === "MENTOR_ASSIGNMENT", "the hand-over moves the file to the documentation department (step 4)");
  check(sql(`select (handed_over_at is not null)::text from applications where id = '${app}'`) === "true", "and marks it handed over");
  check(await noticed("documentation@medcityoverseas.test", `${name}: Au pair file handed to the documentation department`), "the documentation department is told");
}

/* ---------------- Steps 4 to 7, with a family not selecting ---------------- */
const docs = await signIn("documentation@medcityoverseas.test");
const docsId = sql("select id from users where email = 'documentation@medcityoverseas.test'");
{
  const page = docs.page;
  await go(page, tab);
  await step(page, "mentor", { mentorId: docsId }, "Assign the mentor");
  check((await waitStatus("INTERVIEW_PREPARATION")) === "INTERVIEW_PREPARATION", "naming the mentor moves the file to interview preparation (step 5)");
  check(sql(`select count(*) from student_people where student_id = '${sid}' and part = 'Au pair mentor'`) === "1", "the mentor is on the file");
  check(await noticed(head, `${name}: Au pair mentor is%`), "the counsellor's branch is told who the mentor is");

  await go(page, tab);
  let form = await step(page, "profile", { consentOn: today, done: ["ap6.updated"] }, "Submit the profile to host families");
  check(/mock interview/.test(await refusal(form)), "the profile does not go out before a mock interview");
  await go(page, tab);
  await step(page, "mock", { result: "NEEDS_WORK", feedback: "Speak slower; more on daily routines." }, "Record the mock interview");
  await wait(`select count(*) from fsj_events where application_id = '${app}' and kind = 'MOCK_INTERVIEW'`, "1");
  await go(page, tab);
  await step(page, "mock", { result: "READY", feedback: "Confident now.", done: ["ap5.general", "ap5.situation"] }, "Record the mock interview");
  await wait(`select count(*) from fsj_events where application_id = '${app}' and kind = 'MOCK_INTERVIEW'`, "2");
  await go(page, tab);
  await step(page, "profile", { consentOn: today, done: ["ap6.updated"] }, "Submit the profile to host families");
  check((await waitStatus("PROFILE_SUBMITTED")) === "PROFILE_SUBMITTED", "after a ready mock interview, with consent, the profile is submitted (step 6)");

  await go(page, tab);
  await step(page, "hostFamily", { family: "Familie Weber", platform: "AuPair.com", done: ["ap6.introduced", "ap6.shared"] }, "Record the interested host family");
  check((await waitStatus("HOST_FAMILY_FOUND")) === "HOST_FAMILY_FOUND", "an interested family is recorded");
  await go(page, tab);
  await step(page, "handover", {}, "Hand to the Placement Team");
  check((await waitStatus("FAMILY_INTERVIEW")) === "FAMILY_INTERVIEW", "and the candidate is handed to the placement team (step 7)");
  await go(page, tab);
  await step(page, "interview", { interviewAt: `${day(3)}T15:30`, link: "https://meet.example/weber" }, "Schedule the interview");
  await wait(`select (fsj_interview_at is not null)::text from applications where id = '${app}'`, "true");
  await go(page, tab);
  form = await step(page, "outcome", { outcome: "NOT_SELECTED" }, "Record the outcome");
  check(/feedback/.test(await refusal(form)), "not selected needs the family's feedback");
  await go(page, tab);
  await step(page, "outcome", { outcome: "NOT_SELECTED", note: "They wanted a driver's licence." }, "Record the outcome");
  check((await waitStatus("INTERVIEW_PREPARATION")) === "INTERVIEW_PREPARATION", "not selected goes back to interview preparation (step 5)");
  check(events("FEEDBACK") === "1" && events("INTERVIEW") === "1", "the round is kept");
}

/* ---------------- The tab, the trackers and the portal at the loop ---------------- */
const admin = await signIn("sreejith@miak.in");
const branch = await signIn(head);
const hash = "(select password_hash from users where email = 'fathima.rahman@example.com')";
sql(`insert into users (id, name, email, phone, password_hash, role, org_id, student_id, locale)
     select 'aupairsuite' || '${tag}', first_name || ' ' || last_name, email, phone, ${hash}, 'STUDENT', org_id, id, 'en' from students where id = '${sid}' on conflict do nothing`);
sql(`update users set must_change_password = false, active = true where id = 'aupairsuite' || '${tag}'`);
const student = await signIn(mail);
async function readEverywhere(stepNo, team, line) {
  let t = await go(admin.page, tab);
  check(new RegExp(`Step ${stepNo} of 15`).test(t.text), `the tab says step ${stepNo} of 15`);
  for (const [who, s] of [["head office", admin], ["branch", branch]]) {
    await go(s.page, "/au-pair");
    const row = s.page.locator(`[data-au-pair-row="${sid}"]`);
    check((await row.getAttribute("data-step").catch(() => null)) === String(stepNo) && (await row.getAttribute("data-team").catch(() => null)) === team, `the ${who} tracker lists the file at step ${stepNo} with the ${team} team`);
  }
  await go(admin.page, `/au-pair?team=${team}`);
  check((await admin.page.locator(`[data-au-pair-row="${sid}"]`).count()) === 1, "and the team filter finds it");
  await go(student.page, "/portal");
  const card = student.page.locator("[data-au-pair-journey]");
  check((await card.getAttribute("data-current-step").catch(() => null)) === String(stepNo) && (await card.innerText().catch(() => "")).includes(line), `the student portal shows step ${stepNo}: "${line}"`);
  check(!/miak\.in|Placement team|Visa team/.test(await card.innerText().catch(() => "")), "and nothing internal");
}
await readEverywhere(5, "MENTOR", "Practising for your host family interviews with your mentor");

/* ---------------- Another family, selected, and the contract ---------------- */
{
  const page = docs.page;
  await go(page, tab);
  await step(page, "profile", { consentOn: today, done: ["ap6.updated"] }, "Submit the profile to host families");
  await waitStatus("PROFILE_SUBMITTED");
  await go(page, tab);
  let form = await step(page, "hostFamily", { family: "familie weber", platform: "AuPair.com", done: ["ap6.shared"] }, "Record the interested host family");
  check(/did not select/.test(await refusal(form)), "the family that did not select is not put forward again");
  await go(page, tab);
  await step(page, "hostFamily", { family: "Familie Schmidt", platform: "Au-pair Vermittlung", done: ["ap6.introduced", "ap6.shared"] }, "Record the interested host family");
  await waitStatus("HOST_FAMILY_FOUND");
  await go(page, tab);
  await step(page, "handover", {}, "Hand to the Placement Team");
  await waitStatus("FAMILY_INTERVIEW");
  await go(page, tab);
  await step(page, "interview", { interviewAt: `${day(5)}T14:00` }, "Schedule the interview");
  await wait(`select (fsj_interview_at is not null)::text from applications where id = '${app}'`, "true");
  await go(page, tab);
  await step(page, "outcome", { outcome: "SELECTED" }, "Record the outcome");
  check((await waitStatus("OFFER_RECEIVED")) === "OFFER_RECEIVED", "selected goes to the host family contract (step 8)");
  check(events("INTERVIEW") === "2" && events("FEEDBACK") === "2", "both rounds are kept");

  await go(page, tab);
  form = await step(page, "contract", { pocketMoney: "280", durationMonths: "12", signedOn: today, done: ["ap8.explained"] }, "Save the contract");
  check(/hours/.test(await refusal(form)), "the signature needs the weekly hours as well");
  await go(page, tab);
  await step(page, "contract", { pocketMoney: "280", weeklyHours: "30", durationMonths: "12", signedOn: today, done: ["ap8.received", "ap8.duties", "ap8.explained", "ap8.returned"] }, "Save the contract");
  check((await waitStatus("CONTRACT_SIGNED")) === "CONTRACT_SIGNED", "the signed contract is recorded");
  check(sql(`select au_pair_pocket_money || '|' || au_pair_weekly_hours || '|' || au_pair_duration_months from applications where id = '${app}'`) === "280|30|12", "with its terms");
  await go(page, tab);
  await step(page, "handover", {}, "Hand to the Visa Team");
  check((await waitStatus("PRE_VISA_DOCUMENTS")) === "PRE_VISA_DOCUMENTS", "and handed to the visa team (step 9)");
  check(await noticed(head, `${name}: payments to verify before the visa appointment`), "the branch is asked to verify the payments");
}

/* ---------------- Steps 9 to 12: the gate, the appointment, the visa ---------------- */
{
  const page = docs.page;
  await go(page, tab);
  check((await page.locator('[data-visa-gate="blocked"]').count()) === 1, "the tab says the appointment is not yet possible");
  let form = await step(page, "appointment", { appointmentAt: `${day(20)}T09:30`, place: "VFS Global, Bengaluru" }, "Book the appointment");
  check(/payments are not verified/.test(await refusal(form)) && /Cover letter/.test(await refusal(form)), "booking is refused: payments not verified, documents missing");
  // Not from the status picker either, unless an admin gives the reason.
  await go(admin.page, `/students/${sid}/applications?app=${app}`);
  await admin.page.locator(`#status-${app}`).selectOption({ label: "Visa appointment booked" });
  await admin.page.getByRole("button", { name: "Update status" }).click();
  const said = await admin.page.locator('[role="alert"]').filter({ hasText: /not ready for the visa appointment/ }).first().innerText({ timeout: 10000 }).catch(() => "");
  check(/give the reason for the override/.test(said) && statusOf() === "PRE_VISA_DOCUMENTS", "the status picker is refused too, and asks an admin for the reason to override");

  await go(counsellor.page, tab);
  await step(counsellor.page, "payments", { verifiedOn: today }, "Payments verified");
  await wait(`select coalesce(fsj_pre_visa_payment_on::text, '') from applications where id = '${app}'`, today);
  check(events("FEE_CHECK") === "1", "the counsellor verifies the payments (no fee invoice is open)");
  sql(`update checklist_items set state = 'ACCEPTED' where student_id = '${sid}' and stage in ('PROFILE', 'APPLICATION', 'OFFER', 'VISA')`);
  await go(page, tab);
  await step(page, "appointment", { appointmentAt: `${day(20)}T09:30`, place: "VFS Global, Bengaluru" }, "Book the appointment");
  check((await waitStatus("VISA_APPOINTMENT")) === "VISA_APPOINTMENT", "with the payments, contract and documents in, the appointment is booked (step 10)");
  await go(page, tab);
  form = await step(page, "submitted", { submittedOn: day(20) }, "Submitted at the appointment");
  check(/biometrics/.test(await refusal(form)), "the submission waits on the biometrics");
  await go(page, tab);
  await step(page, "submitted", { submittedOn: day(20), done: ["ap10.order", "ap10.guided", "ap10.biometrics"] }, "Submitted at the appointment");
  check((await waitStatus("VISA_PROCESSING")) === "VISA_PROCESSING", "then the visa is processing (step 11)");
  await go(page, tab);
  await step(page, "followUp", { kind: "DOCUMENTS", note: "Embassy asks for the family's registration certificate." }, "Record the follow-up");
  await wait(`select count(*) from fsj_events where application_id = '${app}' and kind = 'FOLLOW_UP'`, "1");
  await go(page, tab);
  await step(page, "visaDecision", { outcome: "APPROVED", decidedOn: day(30) }, "Record the visa decision");
  check((await waitStatus("VISA_RECEIVED")) === "VISA_RECEIVED", "the visa is approved (step 12)");
  await go(page, tab);
  form = await step(page, "handover", {}, "Hand to the Travel Desk");
  check(/joining date/.test(await refusal(form)), "the travel desk hand-over waits on the joining date");
  await go(page, tab);
  await step(page, "approval", { joiningOn: day(45), done: ["ap12.passport", "ap12.details", "ap12.family"] }, "Save the visa approval");
  await wait(`select coalesce(fsj_joining_on::text, '') from applications where id = '${app}'`, day(45));
  await go(page, tab);
  await step(page, "handover", {}, "Hand to the Travel Desk");
  check((await waitStatus("PRE_DEPARTURE")) === "PRE_DEPARTURE", "and the file goes to the travel desk (step 13)");
}

/* ---------------- Steps 13 to 15 ---------------- */
const lead = await signIn("teamlead@medcityoverseas.test");
{
  const page = lead.page;
  await go(page, tab);
  await step(page, "checklist", { done: ["ap13.flight", "ap13.orientation", "ap13.requirements", "ap13.schedule"] }, "Save step 13");
  await go(page, tab);
  await step(page, "departure", { departedOn: day(44) }, "Record the departure");
  check((await waitStatus("JOINED")) === "JOINED", "the departure is recorded (step 14)");
  await go(page, tab);
  const form = page.locator('[data-au-pair-op="checklist"]').filter({ hasText: "Step 15" });
  await form.locator('input[value="ap15.happyCall"]').check();
  await form.locator('input[value="ap15.safe"]').check();
  await form.locator('input[value="ap15.received"]').check();
  await form.locator('textarea[name="note"]').fill("Settled in well; testimonial video promised.");
  await form.getByRole("button", { name: "Save step 15" }).click();
  check((await waitStatus("HAPPY_CALL")) === "HAPPY_CALL", "the happy call starts the arrival follow-up (step 15)");
}
await readEverywhere(15, "TRAVEL", "Settling in with your host family: we stay in touch");
check(Number(sql(`select count(*) from record_versions where entity = 'application' and entity_id = '${app}' and action like 'au_pair.%'`)) >= 12, "every step's fields went through the tracked update");
check(sql(`select count(*) from audit_logs where entity_id = '${app}' and action = 'au_pair.visa_gate_override'`) === "0", "no override was recorded");

for (const s of [counsellor, docs, admin, branch, student, lead]) await s.ctx.close();
for (const a of all) if (a.errors.length) check(false, `${a.email}: no page errors (${a.errors.slice(0, 3).join(" | ")})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
