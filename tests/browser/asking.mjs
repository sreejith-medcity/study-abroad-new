// Asking the student and packing the file: one message with the reason against
// each document, in English or Malayalam, what the student sees on a phone, the
// chasing that happens without anyone remembering, and the submission pack.
// Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import JSZip from "jszip";

const OUT = "/tmp/smoke-asking";
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
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (re.test(await page.locator("main").innerText())) return true; await page.waitForTimeout(300); }
  return false;
}
const toast = (page, re, timeout = 15000) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}

// --- The ask screen: everything outstanding, ticked, in one message.
const admin = await signIn("admin@medcityoverseas.test", "10.140.1.1");
const ap = admin.page;
const student = sql("select id from students order by created_at limit 1");
const firstName = sql(`select first_name from students where id = '${student}'`);
let text = await go(ap, `/students/${student}/documentation/ask`);
check(/Everything outstanding is ticked/.test(text), "ask: the screen says what it has done for you");
check(/One message goes out, with one link/.test(text), "ask: it says one message, not five");
const boxSelector = 'textarea[name="body"]';
let body = await ap.locator(boxSelector).inputValue();
check(body.includes(`Hello ${firstName},`), "ask: the message is addressed to the student");
check((body.match(/\/portal/g) ?? []).length === 1, "ask: one link, whatever the number of documents");
const ticked = await ap.locator('input[type="checkbox"]:checked').count();
check(ticked > 1, `ask: everything outstanding starts ticked (${ticked})`);
const lines = body.split("\n").filter((l) => l.startsWith("- ")).length;
check(lines === ticked, `ask: the message lists exactly what is ticked (${lines})`);

// The reason travels with the request.
const rejected = sql(`select dt.label from checklist_items ci join document_types dt on dt.code = ci.type_code where ci.student_id = '${student}' and ci.state = 'REJECTED' limit 1`);
if (rejected) {
  check(body.includes(rejected), `ask: a document sent back is in the list (${rejected})`);
  const reason = sql(`select coalesce(r.label, '') from checklist_items ci left join rejection_reasons r on r.code = ci.reason_code where ci.student_id = '${student}' and ci.state = 'REJECTED' limit 1`);
  check(reason.length === 0 || body.includes(reason.slice(0, 20)), "ask: the reason the team picked is in the message");
} else {
  bad("ask: the seed has no rejected document to check the reason against");
}

// Unticking one shortens the message.
await ap.locator('input[type="checkbox"]:checked').first().uncheck();
await ap.waitForTimeout(300);
const shorter = await ap.locator(boxSelector).inputValue();
check(shorter.split("\n").filter((l) => l.startsWith("- ")).length === lines - 1, "ask: unticking one takes it out of the message");
await ap.locator('input[type="checkbox"]').first().check();

// Malayalam is the whole message.
await ap.locator("#ask-locale").selectOption("ml");
await ap.waitForTimeout(400);
const malayalam = await ap.locator(boxSelector).inputValue();
check(/നമസ്കാരം/.test(malayalam) && !/Hello/.test(malayalam), "ask: Malayalam replaces the message rather than adding to it");
await ap.locator("#ask-locale").selectOption("en");
await ap.waitForTimeout(400);
await ap.screenshot({ path: `${OUT}/01-ask.png`, fullPage: true });

// Send it in the portal only.
await ap.locator("#ask-due").fill("2027-01-15");
await ap.waitForTimeout(400);
const withDate = await ap.locator(boxSelector).inputValue();
check(/15 January 2027/.test(withDate), "ask: the date goes into the message in words");
await ap.getByRole("button", { name: "Put it in the portal only" }).click();
check((await waitSql(`select count(*) from document_requests where student_id = '${student}'`, "1")) === "1", "ask: the request is recorded");
check(sql(`select channel from document_requests where student_id = '${student}'`) === "PORTAL", "ask: portal only is recorded as such");
check(sql(`select count(*) from checklist_items where student_id = '${student}' and state = 'ASKED' and due_on = '2027-01-15'`) !== "0", "ask: every ticked row carries the date");
const covered = sql(`select count(*) from document_request_items i join document_requests r on r.id = i.request_id where r.student_id = '${student}'`);
check(Number(covered) > 1, `ask: which documents it covered is recorded (${covered})`);

text = await go(ap, `/students/${student}/documentation/ask`);
check(/What has gone out before/.test(text) && /Portal only/.test(text), "ask: the history of what went out is on the screen");

// --- WhatsApp, where the student agreed to it.
const wa = sql("select s.id from students s join organizations o on o.id = s.org_id where s.whatsapp_opt_in and o.student_whatsapp_messages and s.id <> '" + student + "' limit 1");
if (wa) {
  await go(ap, `/students/${wa}/documentation/ask`);
  const before = sql("select count(*) from outbound_messages where channel = 'whatsapp'");
  await ap.getByRole("button", { name: "Send on WhatsApp" }).click();
  check(await toast(ap, /WhatsApp|Recorded/), "whatsapp: the counsellor is told what happened");
  const after = await waitSql("select count(*) from outbound_messages where channel = 'whatsapp'", String(Number(before) + 1));
  check(after === String(Number(before) + 1), "whatsapp: the message is queued and recorded");
  check(sql(`select channel from document_requests where student_id = '${wa}'`) === "WHATSAPP", "whatsapp: the request says which channel it went on");
  check(sql(`select count(*) from document_requests where student_id = '${wa}' and message_id is not null`) === "1", "whatsapp: the request keeps a reference to what was sent");
} else {
  bad("whatsapp: no student in the seed has agreed to WhatsApp");
}

// A student who has not agreed is told so rather than being messaged anyway.
sql(`update students set whatsapp_opt_in = false where id = '${student}'`);
text = await go(ap, `/students/${student}/documentation/ask`);
check(/has not agreed to WhatsApp/.test(text), "whatsapp: no consent means portal only, and the screen says why");
check((await ap.getByRole("button", { name: "Send on WhatsApp" }).count()) === 0, "whatsapp: the button is not even offered");
sql(`update students set whatsapp_opt_in = true where id = '${student}'`);

// --- What the student sees on a phone.
const portalStudent = sql("select student_id from users where role = 'STUDENT' and student_id is not null limit 1");
sql(`update checklist_items set state = 'ASKED', asked_at = now() - interval '4 days', due_on = current_date + 5 where student_id = '${portalStudent}' and type_code = 'CV'`);
const reasonCode = sql("select code from rejection_reasons where active order by sort_order limit 1");
sql(`update checklist_items set state = 'REJECTED', reason_code = '${reasonCode}', reason = 'Only five months are covered; the visa office wants six.', decided_at = now() - interval '3 days', version = 1 where student_id = '${portalStudent}' and type_code = 'MARKSHEET_10'`);
const learner = await browser.newContext({ viewport: { width: 420, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.140.1.9" } });
await learner.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const lp = await learner.newPage();
const learnerErrors = [];
lp.on("pageerror", (e) => learnerErrors.push(String(e)));
lp.on("response", (r) => { if (r.status() >= 500) learnerErrors.push(`${r.status()} ${r.url()}`); });
await lp.goto(`${BASE}/login`);
await lp.fill('input[name="email"]', sql(`select email from users where student_id = '${portalStudent}' and role = 'STUDENT' limit 1`));
await lp.fill('input[name="password"]', "Password@123");
await lp.click('button[type="submit"]');
await lp.waitForURL(/\/portal/, { timeout: 20000 }).catch(() => {});
text = await go(lp, "/portal/documents");
check(/ഇത് ഒന്നുകൂടി അയയ്ക്കണം|Please send this one again/.test(text), "portal: a document sent back says so, in the student's own language");
check(/Only five months are covered|അഞ്ച്/.test(text) || /six/.test(text), "portal: the reason the team picked is what the student reads");
check(!/rejection|internal|counsellor note/i.test(text), "portal: none of the team's own wording crosses over");
await lp.screenshot({ path: `${OUT}/02-portal.png`, fullPage: true });

// An upload from the portal joins the queue; the student cannot mark it good.
const uploadForm = lp.locator("form").filter({ has: lp.locator('input[name="typeCode"][value="MARKSHEET_10"]') }).first();
await uploadForm.locator('input[type="file"]').setInputFiles({ name: "marksheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
await uploadForm.locator('button[type="submit"]').click();
await lp.waitForTimeout(3000);
const landed = sql(`select state from checklist_items where student_id = '${portalStudent}' and type_code = 'MARKSHEET_10' and document_id is not null`);
check(landed === "UPLOADED", `portal: an upload lands in review, never accepted (${landed || "nothing"})`);
check(sql(`select version from checklist_items where student_id = '${portalStudent}' and type_code = 'MARKSHEET_10'`) === "2", "portal: the replacement is the next version, and the refused one is kept");
check(sql(`select count(*) from checklist_files where item_id = (select id from checklist_items where student_id = '${portalStudent}' and type_code = 'MARKSHEET_10')`) !== "0", "portal: what was sent is recorded against the item");

// --- The chasing, without anyone remembering.
text = await go(ap, "/documentation");
check(/Run the chasing now/.test(text), "chasing: an admin can run it by hand as well as on a schedule");
const nudgesBefore = sql("select count(*) from document_requests where kind = 'NUDGE' and sent_by_id is null");
await ap.getByRole("button", { name: "Run the chasing now" }).click();
check(await toast(ap, /reminder|Nothing needed|desk|flagged|gate/i), "chasing: it says what it did");
const nudgesAfter = sql("select count(*) from document_requests where kind = 'NUDGE' and sent_by_id is null");
check(Number(nudgesAfter) > Number(nudgesBefore), `chasing: reminders went out by themselves (${nudgesBefore} to ${nudgesAfter})`);
check(sql("select count(*) from checklist_items where last_chased_at is not null") !== "0", "chasing: the file records when it was last chased");
// Running it twice in a row does not chase the same student again.
const again = sql("select count(*) from document_requests where kind = 'NUDGE' and sent_by_id is null");
await ap.getByRole("button", { name: "Run the chasing now" }).click();
await ap.waitForTimeout(2500);
check(sql("select count(*) from document_requests where kind = 'NUDGE' and sent_by_id is null") === again, "chasing: a student chased today is left alone");

// Silence for a week reaches a person instead.
sql("update checklist_items set asked_at = now() - interval '9 days', last_chased_at = null, escalated_at = null where state = 'ASKED'");
await ap.getByRole("button", { name: "Run the chasing now" }).click();
await ap.waitForTimeout(3000);
check(sql("select count(*) from checklist_items where escalated_at is not null") !== "0", "chasing: at a week it becomes the counsellor's job");
check(sql("select count(*) from notifications where title like '%has not sent%'") !== "0", "chasing: the counsellor is told, once");

// --- The submission pack.
// A student with a real file in hand, so the folder has something in it: the one
// who just uploaded through the portal, where they have an application.
const packStudent = sql(`select case when exists (select 1 from applications where student_id = '${portalStudent}') then '${portalStudent}' else (select student_id from applications order by created_at limit 1) end`);
const appId = sql(`select id from applications where student_id = '${packStudent}' order by created_at limit 1`);
sql(`update checklist_items set state = 'ACCEPTED', decided_at = now() where student_id = '${packStudent}' and document_id is not null`);
sql(`update checklist_items set state = 'ACCEPTED', version = 1, decided_at = now() where student_id = '${packStudent}' and type_code in ('PASSPORT','MARKSHEET_12')`);
// The route this application goes down, and the rules the vendor on it sets: a
// pack is built the way they want it or it comes back.
sql(`update applications set route_id = coalesce(route_id, (select pr.id from program_routes pr where pr.program_id = applications.program_id limit 1)) where id = '${appId}'`);
const packVendor = sql(`select v.id from vendors v join program_routes pr on pr.vendor_id = v.id join applications a on a.route_id = pr.id where a.id = '${appId}'`);
check(packVendor !== "", "pack: the application has a route, so the vendor's own rules apply");
sql(`update vendors set pack_naming = '{SURNAME}_{GIVEN}_{TYPE}', pack_limit_mb = 25 where id = '${packVendor}'`);

text = await go(ap, `/students/${packStudent}/documentation/pack?app=${appId}`);
check(/What goes in/.test(text), "pack: the screen shows what would go in before anything is built");
check(/under the names this route uses/.test(text), "pack: it says an unchecked file stays out unless somebody ticks it in");
const surname = sql(`select upper(last_name) from students where id = '${packStudent}'`);
check(text.includes(`${surname}_`), `pack: the screen shows the names the vendor writes, not ours (${surname}_)`);
check(/Their system accepts 25 MB/.test(text), "pack: the vendor's upload limit is on the screen before anybody builds it");
check(!/^01 /m.test(text), "pack: the portal's own numbering gives way to the vendor's pattern");
await ap.locator('input[name="note"]').fill("Sent to the university with the bank statement to follow");
const [download] = await Promise.all([
  ap.waitForEvent("download", { timeout: 30000 }).catch(() => null),
  ap.getByRole("button", { name: "Build and download" }).click(),
]);
check((await waitSql(`select count(*) from submission_packs where application_id = '${appId}'`, "1")) === "1", "pack: building it is recorded on the file");
const packId = sql(`select id from submission_packs where application_id = '${appId}' limit 1`);
check(sql(`select note from submission_packs where id = '${packId}'`).includes("bank statement"), "pack: the note is kept with the record");
void download;

// The folder itself, read back.
const res = await ap.request.get(`${BASE}/api/packs/${packId}`);
check(res.status() === 200, `pack: the download works (${res.status()})`);
check((res.headers()["content-disposition"] ?? "").includes(".zip"), "pack: a vendor who takes a folder gets a zip");
const zip = await JSZip.loadAsync(await res.body());
const names = Object.keys(zip.files);
check(names.some((n) => n.startsWith("00 What is in this folder")), "pack: there is a front sheet");
check(names.length > 1, `pack: the accepted files are in it (${names.length - 1})`);
check(names.some((n) => n.startsWith(`${surname}_`)), `pack: the files inside carry the vendor's own names (${names.join(", ").slice(0, 80)})`);
const sheet = await zip.file(names.find((n) => n.startsWith("00 ")))?.async("string");
check(/Student {8}/.test(sheet) && sheet.includes(sql(`select first_name from students where id = '${packStudent}'`)), "pack: the sheet names the student");
check(/In this folder/.test(sheet), "pack: the sheet lists what is in the folder");
check(/Not in this folder, and still required|Nothing required is missing|running out too early/.test(sheet), "pack: the sheet is honest about what is not in it");
check(sheet.includes(`${surname}_`), "pack: the sheet names the files the way the folder does");
fs.writeFileSync(`${OUT}/cover-sheet.txt`, sheet);

// --- Something the desk has not accepted, sent on purpose and marked as such.
const unchecked = sql(`select ci.id from checklist_items ci where ci.student_id = '${packStudent}' and ci.document_id is not null order by ci.stage limit 1`);
sql(`update checklist_items set state = 'IN_REVIEW', decided_at = null where id = '${unchecked}'`);
text = await go(ap, `/students/${packStudent}/documentation/pack?app=${appId}`);
check(/Send something the desk has not accepted/.test(text), "pack: an unchecked file can be ticked in, rather than emailed around the portal");
await ap.locator(`input[name="include"][value="${unchecked}"]`).check();
const [secondDownload] = await Promise.all([
  ap.waitForEvent("download", { timeout: 30000 }).catch(() => null),
  ap.getByRole("button", { name: "Build and download" }).click(),
]);
void secondDownload;
check((await waitSql(`select count(*) from submission_packs where application_id = '${appId}'`, "2")) === "2", "pack: the second build is recorded too");
const tickedPack = sql(`select id from submission_packs where application_id = '${appId}' order by created_at desc limit 1`);
check(sql(`select included from submission_packs where id = '${tickedPack}'`).includes(unchecked), "pack: what was ticked in is kept, so the same link rebuilds what was sent");
const tickedRes = await ap.request.get(`${BASE}/api/packs/${tickedPack}`);
const tickedSheet = await (await JSZip.loadAsync(await tickedRes.body())).file(/^00 /)[0].async("string");
check(/NOT CHECKED, put in deliberately/.test(tickedSheet), "pack: the sheet says which file went out unchecked");

// --- A vendor whose system takes one upload gets one PDF.
sql(`update vendors set pack_shape = 'ONE_PDF' where id = '${packVendor}'`);
text = await go(ap, `/students/${packStudent}/documentation/pack?app=${appId}`);
check(/One PDF with everything in it/.test(text), "pack: the screen says it will be one PDF before anybody builds it");
const onePdf = await ap.request.get(`${BASE}/api/packs/${tickedPack}`);
check((onePdf.headers()["content-type"] ?? "").includes("pdf"), `pack: the download is a PDF (${onePdf.headers()["content-type"]})`);
check((await onePdf.body()).subarray(0, 5).toString() === "%PDF-", "pack: and it is a real PDF, not a zip with a new name");
sql(`update vendors set pack_shape = 'FOLDER' where id = '${packVendor}'`);

// --- Who cannot do any of this.
const mgmt = await signIn("management@medcityoverseas.test", "10.140.1.4");
text = await go(mgmt.page, `/students/${student}/documentation/ask`);
check(/Read only/.test(text), "ask: management is turned away");
const asStudent = await lp.request.get(`${BASE}/api/packs/${packId}`);
check(asStudent.status() === 404, `pack: a student cannot reach the folder (${asStudent.status()})`);

for (const [who, e] of [["team", admin.errors], ["student", learnerErrors], ["management", mgmt.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
