// Document guidance and samples, and sharing documents with the student:
// the admin writes guidance and uploads a sample, the partner sees both and
// shares one file, the student sees and opens only what was shared or what
// they uploaded, and stopping the share takes it away again. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-documents";
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
const PDF = { name: "sop-sample.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") };

const sid = sql("select id from students where first_name = 'Fathima'");
const other = sql("select id from students where first_name = 'Arathi'");
sql(`update documents set shared_with_student = false; update document_types set guidance = null, sample_file_name = null, sample_storage_key = null, sample_mime_type = null`);

// --- Admin: guidance and a sample for the statement of purpose.
const admin = await signIn("admin@medcityoverseas.test", "10.98.1.1");
const ap = admin.page;
await go(ap, "/admin/documents");
await ap.waitForLoadState("networkidle");
const sopCard = ap.locator("form").filter({ has: ap.getByLabel("Guidance for Statement of purpose") });
await sopCard.getByLabel("Guidance for Statement of purpose").fill("One to two pages, in the student's own words: why this course, why this country, and the plan after.");
await sopCard.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
await sopCard.getByRole("button", { name: "Save Statement of purpose" }).click();
check(await sopCard.getByText(/Upload a PDF, JPG, PNG or WebP/).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "admin: a text file is refused as a sample");
await sopCard.locator('input[type="file"]').setInputFiles(PDF);
await sopCard.getByRole("button", { name: "Save Statement of purpose" }).click();
check(await toast(ap, /Statement of purpose saved/), "admin: guidance and sample saved");
check(sql("select sample_file_name || '|' || left(guidance, 22) from document_types where code = 'SOP'") === "sop-sample.pdf|One to two pages, in t", "admin: stored");

// --- Partner: sees them, uploads a file and shares it.
const partner = await signIn("kottayam@medcity.test", "10.98.1.2");
const pp = partner.page;
let res = await pp.request.get(`${BASE}/api/document-samples/SOP`);
check(res.status() === 200 && res.headers()["content-type"] === "application/pdf", "partner: the sample opens");
await go(pp, `/students/${sid}/documents`);
await pp.waitForLoadState("networkidle");
const up = pp.locator("div.rounded-md.border-dashed").filter({ hasText: "Upload another document" });
await up.locator("select").selectOption("SOP");
await up.locator('input[type="file"]').setInputFiles({ name: "fathima-sop.pdf", mimeType: "application/pdf", buffer: PDF.buffer });
await up.getByRole("button", { name: "Upload" }).click();
await pp.getByText("fathima-sop.pdf").first().waitFor({ timeout: 10000 }).catch(() => {});
let text = await main(pp);
check(/One to two pages, in the student's own words/.test(text) && /See a sample/.test(text), "partner: guidance and sample link beside the upload");
const docId = sql(`select id from documents where student_id = '${sid}' and file_name = 'fathima-sop.pdf' order by created_at desc limit 1`);
await pp.getByRole("button", { name: "Share fathima-sop.pdf with the student" }).click();
await pp.getByRole("button", { name: "Stop sharing fathima-sop.pdf" }).waitFor({ timeout: 10000 }).catch(() => {});
check(sql(`select shared_with_student from documents where id = '${docId}'`) === "t", "partner: shared");

// --- Student portal.
const student = await signIn("fathima.rahman@example.com", "10.98.1.3");
const sp = student.page;
text = await go(sp, "/portal/documents");
check(/Shared with you|നിങ്ങൾക്കായി പങ്കിട്ടവ/.test(text), "portal: a shared section appears");
res = await sp.request.get(`${BASE}/api/documents/${docId}`);
check(res.status() === 200, "portal: the shared file opens");
const unshared = sql(`select id from documents where student_id = '${sid}' and id <> '${docId}' and shared_with_student = false and uploaded_by_id not in (select id from users where role = 'STUDENT') limit 1`);
if (unshared) {
  res = await sp.request.get(`${BASE}/api/documents/${unshared}`);
  check(res.status() === 404, "portal: an unshared file does not open");
}
const othersDoc = sql(`select id from documents where student_id = '${other}' limit 1`);
sql(`update documents set shared_with_student = true where id = '${othersDoc}'`);
res = await sp.request.get(`${BASE}/api/documents/${othersDoc}`);
check(res.status() === 404, "portal: another student's file never opens, shared or not");
sql(`update documents set shared_with_student = false where id = '${othersDoc}'`);
res = await sp.request.get(`${BASE}/api/document-samples/SOP`);
check(res.status() === 200, "portal: samples open for students too");
await sp.screenshot({ path: `${OUT}/portal.png`, fullPage: true });

// Stop sharing.
await go(pp, `/students/${sid}/documents`);
await pp.waitForLoadState("networkidle");
await pp.getByRole("button", { name: "Stop sharing fathima-sop.pdf" }).click();
await pp.getByRole("button", { name: "Share fathima-sop.pdf with the student" }).waitFor({ timeout: 10000 }).catch(() => {});
res = await sp.request.get(`${BASE}/api/documents/${docId}`);
check(res.status() === 404, "portal: gone once sharing stops");

// Another branch cannot share it.
const kochi = await signIn("kochi@medcity.test", "10.98.1.4");
res = await kochi.page.request.get(`${BASE}/api/documents/${docId}`);
check(res.status() === 404, "isolation: another branch cannot open it");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors], ["student", student.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
