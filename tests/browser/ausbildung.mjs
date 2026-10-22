// Ausbildung and the service charge.
//
// Asked for together: for Ausbildung students and anybody bound for a country
// that collects a service charge, where the service charge received is
// recorded and what is still pending; which German levels are done and which
// are not; the date of registration, the branch and the counsellor; for
// Ausbildung, three preferences in order, when the application went in, when
// the interview is and when the contract came; and a document checklist for
// study abroad, Ausbildung and NCLEX-RN. Which countries collect a service
// charge is a setting. Wants the plain seed.
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

for (const a of all) check(a.errors.length === 0, `${a.email}: no page errors or 500s ${a.errors.slice(0, 2).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
