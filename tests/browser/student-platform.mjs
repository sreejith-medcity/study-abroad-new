// Student platform settings: the branch's name, colour and logo on its portal
// and enquiry form, the WhatsApp switches, and the sign-up question builder
// with answers on the enquiry. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-student-platform";
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
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${String(e).slice(0, 80)}`));
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


const PNG = { name: "logo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") };
sql("update organizations set portal_name = null, portal_color = null, portal_logo_key = null, portal_logo_mime_type = null, student_whatsapp_milestones = true, student_whatsapp_messages = true, signup_questions = '[]'::jsonb");
const org = sql("select id from organizations where name = 'Medcity Kottayam'");
const slug = sql(`select public_slug from organizations where id = '${org}'`);
sql(`update organizations set public_form_enabled = true where id = '${org}'`);

const owner = await signIn("kottayam@medcity.test", "10.101.1.1");
const op = owner.page;
await go(op, "/settings/students");
await op.waitForLoadState("networkidle");
const look = op.locator("form").filter({ has: op.getByRole("button", { name: "Save portal look" }) });
await look.locator('[name="portalName"]').fill("Kottayam Study Abroad");
await look.getByLabel("Use our own colour").check();
await look.locator('[name="portalColor"]').fill("#f7ec22");
await look.getByRole("button", { name: "Save portal look" }).click();
check(await look.getByText(/Too light/).waitFor({ timeout: 10000 }).then(() => true, () => false), "look: a colour too light for white text is refused");
await look.locator('[name="portalColor"]').fill("#0b6e4f");
await look.locator('input[type="file"]').setInputFiles({ name: "logo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
await look.getByRole("button", { name: "Save portal look" }).click();
check(await look.getByText("A PNG, JPG or WebP image").waitFor({ timeout: 10000 }).then(() => true, () => false), "look: only images as a logo");
await look.locator('input[type="file"]').setInputFiles(PNG);
await look.getByRole("button", { name: "Save portal look" }).click();
await toast(op, /Saved\. Your students/);
check(sql(`select portal_name || '|' || portal_color || '|' || portal_logo_mime_type from organizations where id = '${org}'`) === "Kottayam Study Abroad|#0b6e4f|image/png", "look: saved");

// Anyone may fetch the logo, as the public form needs it.
const anon = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.101.1.9" } });
let res = await anon.request.get(`${BASE}/api/org-logo/${org}`);
check(res.status() === 200 && res.headers()["content-type"] === "image/png", "logo: served without signing in");

// Notifications.
const notes = op.locator("form").filter({ has: op.getByRole("button", { name: "Save notifications" }) });
await notes.getByLabel(/Messages to the student on WhatsApp too/).uncheck();
await notes.getByRole("button", { name: "Save notifications" }).click();
await toast(op, /^Saved\.$/);
check(sql(`select student_whatsapp_messages from organizations where id = '${org}'`) === "f", "notifications: saved");

// Questions.
const qs = op.locator("form").filter({ has: op.getByRole("button", { name: "Save questions" }) });
await qs.getByRole("button", { name: "Add a question" }).click();
await qs.locator('[name="q0_label"]').fill("Your highest qualification");
await qs.locator('[name="q0_kind"]').selectOption("choice");
await qs.locator('[name="q0_options"]').fill("12th");
await qs.locator('[name="q0_required"]').check();
await qs.getByRole("button", { name: "Save questions" }).click();
check(await qs.getByText(/at least two options/).waitFor({ timeout: 10000 }).then(() => true, () => false), "questions: a choice needs two options");
await qs.locator('[name="q0_options"]').fill("12th, Diploma, Degree");
await qs.getByRole("button", { name: "Add a question" }).click();
await qs.locator('[name="q1_label"]').fill("Have you taken IELTS?");
await qs.locator('[name="q1_kind"]').selectOption("yesno");
await qs.getByRole("button", { name: "Save questions" }).click();
await toast(op, /Saved 2 questions/);
check(sql(`select jsonb_array_length(signup_questions) from organizations where id = '${org}'`) === "2", "questions: saved");

// The public form in the branch's colours, with its questions.
const pub = await anon.newPage();
await pub.goto(`${BASE}/apply/${slug}`);
let html = await pub.content();
check(html.includes("--color-brand-600: #0b6e4f") && html.includes(`/api/org-logo/${org}`), "form: branch colour and logo");
check(/Your highest qualification/i.test(await pub.locator("main").innerText()), "form: asks the branch's question");
const tag = String(Date.now()).slice(-6);
await pub.fill('input[name="name"]', `Question Tester ${tag}`);
await pub.fill('input[name="phone"]', `+91 8${tag}111`);
await pub.check('input[name="consent"]');
await pub.click('button[type="submit"]');
check(await pub.getByText("Please answer this").waitFor({ timeout: 10000 }).then(() => true, () => false), "form: a required question must be answered");
await pub.getByLabel(/Your highest qualification/).selectOption("Degree");
await pub.getByLabel(/Have you taken IELTS/).selectOption("Yes");
await pub.click('button[type="submit"]');
await pub.waitForURL(/\/thanks$/, { timeout: 20000 }).catch(() => {});
const eq = sql(`select id from enquiries where name = 'Question Tester ${tag}'`);
check(sql(`select answers::text from enquiries where id = '${eq}'`).includes('"answer": "Degree"'), "form: answers stored with their questions");
let text = await go(op, `/enquiries/${eq}`);
check(/Answers on your form/.test(text) && /Your highest qualification\s*Degree/.test(text) && /Have you taken IELTS\?\s*Yes/.test(text), "enquiry: answers shown");

// The student portal.
const student = await signIn("fathima.rahman@example.com", "10.101.1.2");
await student.page.goto(`${BASE}/portal`);
html = await student.page.content();
check(html.includes("--color-brand-600: #0b6e4f") && /Kottayam Study Abroad/.test(html) && /with Medcity/.test(await student.page.locator("header").innerText()), "portal: branch name, colour and logo, platform named beside");

// Composer follows the WhatsApp switch.
const sid = sql("select id from students where first_name = 'Fathima'");
const app = sql(`select id from applications where student_id = '${sid}' limit 1`);
await go(op, `/students/${sid}/applications?app=${app}&ch=STUDENT`);
check(/see it in their portal/.test(await op.locator("main").innerHTML()), "composer: says the portal only when WhatsApp is off");

// Another branch keeps the platform look; counsellors cannot open the tab.
const kochiSlug = sql("select public_slug from organizations where name = 'Medcity Kochi'");
if (kochiSlug) {
  sql("update organizations set public_form_enabled = true where name = 'Medcity Kochi'");
  await pub.goto(`${BASE}/apply/${kochiSlug}`);
  check(!(await pub.content()).includes("#0b6e4f"), "form: other branches keep the platform colours");
}
const counsellor = await signIn("uk.docs@medcity.test", "10.101.1.3");
const r = await counsellor.page.goto(`${BASE}/settings/students`);
check(r.status() >= 300 || !/Portal look/.test(await counsellor.page.locator("main").innerText()), "settings: counsellors cannot open the students tab");

for (const [who, e] of [["owner", owner.errors], ["student", student.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
