// NCLEX-RN (USA) placement, step by step.
//
// From the USA placement sheet the Overseas team works to: every step is
// Completed or Pending, the ones marked "Browse and Upload" carry a file,
// the board state is chosen with its fee and a payment link is sent, the
// second service charge is a step of its own, and the result decides what
// comes next, visa screening after a pass and re-examination after a fail.
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

// A real one-pixel PNG, so the upload passes whatever checks the file.
const png = "/tmp/nclex-step.png";
fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
const all = [];
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.242.4.${ip++}` } });
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

const nurse = sql("select id from students where preferred_pathway = 'NURSING' order by created_at limit 1");
const orgEmail = sql(`select u.email from users u join students s on s.org_id = u.org_id where s.id = '${nurse}' and u.role = 'PARTNER' and u.active limit 1`);
const step = (key) => `[data-nclex-step="${key}"]`;

const owner = await signIn(orgEmail);
const page = owner.page;

/* ---------------- The steps, as the sheet has them ---------------- */
let text = await go(page, `/students/${nurse}/profile`);
const tab = page.locator(`main a[href="/students/${nurse}/ausbildung"]`);
check((await tab.count()) > 0 && /NCLEX-RN/.test(await tab.first().innerText()), "a nursing file has an NCLEX-RN tab");

text = await go(page, `/students/${nurse}/ausbildung`);
const keys = await page.locator("[data-nclex-step]").evaluateAll((els) => els.map((e) => e.getAttribute("data-nclex-step")));
check(keys.length === 18, `before a result, the eighteen steps up to the result are listed (${keys.length})`);
check(keys[0] === "REGISTERED" && keys[1] === "CGFNS_FORM" && keys[9] === "SECOND_SERVICE_CHARGE" && keys[17] === "EXAM_RESULTS", "in the sheet's order, with the second service charge as its own step");
check(/4 of 18 steps done/.test(text) && /Next: CGFNS account submitted/.test(text), "it says how far the student is and what is next");
check((await page.locator(`${step("CGFNS_FORM")} input[type="file"]`).count()) === 1 && (await page.locator(`${step("CGFNS_PROCESSING")} input[type="file"]`).count()) === 0, "a file can be put on the steps the sheet says, and not on the others");
check(!/German/.test(await page.locator("main").innerText()), "a nursing file is not asked about German levels");

/* ---------------- Completing a step ---------------- */
{
  const row = page.locator(step("CGFNS_SUBMISSION"));
  await row.locator('select[name="completed"]').selectOption("1");
  await row.getByRole("button", { name: "Save" }).click();
  check((await wait(`select completed || '|' || completed_on from nclex_steps where student_id = '${nurse}' and step = 'CGFNS_SUBMISSION'`, `true|${today}`)) === `true|${today}`, "marking a step completed records it, today when no day is given");
  text = await go(page, `/students/${nurse}/ausbildung`);
  check(/5 of 18 steps done/.test(text) && /Next: CGFNS processing/.test(text), "and the next step moves on");
}

/* ---------------- A file on a step ---------------- */
{
  const row = page.locator(step("REQUIRED_DOCUMENTS"));
  await row.locator('input[type="file"]').setInputFiles(png);
  await row.getByRole("button", { name: "Upload" }).click();
  const linked = await wait(
    `select d.label from nclex_steps n join documents d on d.id = n.document_id where n.student_id = '${nurse}' and n.step = 'REQUIRED_DOCUMENTS'`,
    "NCLEX-RN: Required documents",
  );
  check(linked === "NCLEX-RN: Required documents", "a file put up on a step is on the student's documents and linked to the step");
  await go(page, `/students/${nurse}/ausbildung`);
  check((await page.locator(`${step("REQUIRED_DOCUMENTS")} a[href^="/api/documents/"]`).count()) === 1, "and the step links to it");
  check(sql(`select completed from nclex_steps where student_id = '${nurse}' and step = 'REQUIRED_DOCUMENTS'`) === "f", "a file alone does not mark the step completed");
}

/* ---------------- The state, its fee, and the payment link ---------------- */
{
  await page.locator('select[name="boardState"]').selectOption("NY");
  check(await page.getByText("Fee for New York: $425").isVisible(), "choosing New York shows its $425 fee");
  await page.locator('input[name="paymentLink"]').fill("http://not-secure.example.com/pay");
  await page.getByRole("button", { name: "Save state and link" }).click();
  check(await page.getByText("A link starting with https://").waitFor({ timeout: 10000 }).then(() => true, () => false), "a payment link that is not https is refused");
  await page.locator('input[name="paymentLink"]').fill("https://pay.example.com/nclex/abc");
  await page.getByRole("button", { name: "Save state and link" }).click();
  check((await wait(`select board_state || '|' || payment_link from nclex_cases where student_id = '${nurse}'`, "NY|https://pay.example.com/nclex/abc")) === "NY|https://pay.example.com/nclex/abc", "the state and the payment link are saved");
}

/* ---------------- The result decides what comes next ---------------- */
{
  await go(page, `/students/${nurse}/ausbildung`);
  await page.locator('select[name="result"]').selectOption("FAIL");
  await page.getByRole("button", { name: "Save result" }).click();
  check((await wait(`select result from nclex_cases where student_id = '${nurse}'`, "FAIL")) === "FAIL", "a fail is recorded");
  check(sql(`select completed from nclex_steps where student_id = '${nurse}' and step = 'EXAM_RESULTS'`) === "t", "and the results step is done with it");
  await go(page, `/students/${nurse}/ausbildung`);
  check((await page.locator(step("REEXAMINATION")).count()) === 1 && (await page.locator(step("VISA_SCREENING")).count()) === 0, "after a fail the next step is re-examination, not visa screening");

  await page.locator('select[name="result"]').selectOption("PASS");
  await page.getByRole("button", { name: "Save result" }).click();
  await wait(`select result from nclex_cases where student_id = '${nurse}'`, "PASS");
  await go(page, `/students/${nurse}/ausbildung`);
  check((await page.locator(step("VISA_SCREENING")).count()) === 1 && (await page.locator(step("REEXAMINATION")).count()) === 0, "after a pass it is visa screening");
}

/* ---------------- The service charge comes with it ---------------- */
check(/Service charge/.test(await page.locator("main").innerText()), "an NCLEX-RN file shows the service charge");

/* ---------------- The tracker ---------------- */
{
  const admin = await signIn("sreejith@miak.in");
  text = await go(admin.page, "/ausbildung?tab=nclex");
  const name = sql(`select first_name from students where id = '${nurse}'`);
  const row = (await admin.page.locator(`[data-tracker-row="${nurse}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
  check(text.includes(name), `the tracker's NCLEX-RN tab lists the nursing student (${name})`);
  check(/New York/.test(row) && /\$425/.test(row), "with the board state and its fee");
  check(/of 19/.test(row) && /Pass/.test(row), "with how far they are and the result");
  check(!text.includes("Akshara"), "and not the Ausbildung students");
  await admin.ctx.close();
}

/* ---------------- Who sees it ---------------- */
{
  const other = sql(`select u.email from users u join organizations o on o.id = u.org_id where o.type = 'BRANCH' and u.role = 'PARTNER' and u.active and o.id <> (select org_id from students where id = '${nurse}') limit 1`);
  if (other) {
    const them = await signIn(other);
    const t = await go(them.page, "/ausbildung?tab=nclex");
    check(!t.includes(sql(`select first_name || ' ' || last_name from students where id = '${nurse}'`)), "another branch does not see this branch's NCLEX-RN students");
    await them.ctx.close();
  }
  const degree = sql(`select s.id from students s where s.org_id = (select org_id from students where id = '${nurse}') and s.preferred_pathway = 'DEGREE' and not s.archived limit 1`);
  if (degree) {
    await go(page, `/students/${degree}/ausbildung`);
    check((await page.locator("[data-nclex]").count()) === 0, "a study-abroad file has no NCLEX-RN steps");
  }
}

for (const a of all) check(a.errors.length === 0, `${a.email}: no page errors or 500s ${a.errors.slice(0, 2).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
