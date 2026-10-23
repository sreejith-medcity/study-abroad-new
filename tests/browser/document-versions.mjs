// Document versions: a replaced file is kept as an earlier version instead of
// being overwritten. A branch head uploads a statement of purpose and replaces
// it; the list shows one document with "Version 2, replaced ... by ...", the
// earlier version is listed and opens, and the document count does not double.
// Earlier versions open for exactly the people the current one opens for, and
// never for another branch. The desk brings version one back (audited), a
// removed file keeps its stored copy and can be put back, and the student
// replaces the shared file from the portal. Wants the plain seed.
import { chromium } from "playwright";
import { hydrated, knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-document-versions";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls a query until it returns what is wanted, or gives up after ten seconds and returns the last answer. */
async function waitSql(q, want, ms = 10000) {
  let got = sql(q);
  for (let t = 0; t < ms && got !== want; t += 250) {
    await sleep(250);
    got = sql(q);
  }
  return got;
}
/** Polls a query until it returns anything at all, for the id of a row about to be written. */
async function waitValue(q, ms = 10000) {
  let got = sql(q);
  for (let t = 0; t < ms && !got; t += 250) {
    await sleep(250);
    got = sql(q);
  }
  return got;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
let ip = 10;
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.97.4.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
async function go(page, p) {
  await page.goto(BASE + p);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
}
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
/** The number in the "Documents (n)" step on the student's file. */
async function tabCount(page) {
  const label = await page.getByText(/^Documents \(\d+\)$/).first().innerText().catch(() => "");
  return Number((label.match(/\((\d+)\)/) || [])[1] ?? NaN);
}
const pdf = (marker) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);

// A tag per run, so the suite can run twice against one database without the
// second run finding the first run's files.
const tag = Date.now().toString(36);
const v1Name = `sop-first-${tag}.pdf`;
const v2Name = `sop-second-${tag}.pdf`;
const v3Name = `sop-from-student-${tag}.pdf`;

const sid = sql("select id from students where first_name = 'Fathima'");
const partnerId = sql("select id from users where email = 'kottayam@medcity.test'");
const adminId = sql("select id from users where email = 'admin@medcityoverseas.test'");
const studentUserId = sql(`select id from users where role = 'STUDENT' and student_id = '${sid}' limit 1`);
const sopLabel = sql("select label from document_types where code = 'SOP'");
const currentCount = () => Number(sql(`select count(*) from documents where student_id = '${sid}' and superseded_at is null and removed_at is null`));
check(!!sid && !!partnerId && !!adminId && !!studentUserId, "seed: the student, the branch head, the desk and the student's sign-in exist");

/* ---------------- The branch head uploads and replaces ---------------- */
const partner = await signIn("kottayam@medcity.test");
const pp = partner.page;
await go(pp, `/students/${sid}/documents`);
const up = pp.locator("div.rounded-md.border-dashed").filter({ hasText: "Upload another document" });
await up.locator("select").selectOption("SOP");
await up.locator('input[type="file"]').setInputFiles({ name: v1Name, mimeType: "application/pdf", buffer: pdf(`first ${tag}`) });
await up.getByRole("button", { name: "Upload", exact: true }).click();
const v1Id = await waitValue(`select id from documents where student_id = '${sid}' and file_name = '${v1Name}'`);
check(!!v1Id, "upload: the first file is on the record");

await go(pp, `/students/${sid}/documents`);
const countBefore = currentCount();
const tabBefore = await tabCount(pp);
check(tabBefore === countBefore, `count: the Documents step counts current files (${tabBefore} against ${countBefore})`);

const v1Row = pp.locator(`li[data-document-id="${v1Id}"]`);
check((await v1Row.count()) === 1, "list: the first file is listed as a document");
await v1Row.locator("summary", { hasText: "Replace" }).click();
await v1Row.locator('input[type="file"]').setInputFiles({ name: v2Name, mimeType: "application/pdf", buffer: pdf(`second ${tag}`) });
await v1Row.getByRole("button", { name: "Upload replacement" }).click();
check(await toast(pp, /replaced/), "replace: the screen says it was replaced");
const v2Id = await waitValue(`select id from documents where replaces_id = '${v1Id}' and file_name = '${v2Name}'`);
check(!!v2Id, "replace: the new file is a new row pointing at the one it replaced");
check(sql(`select (superseded_at is not null)::text || '|' || coalesce(superseded_by_id, '') || '|' || (removed_at is null)::text from documents where id = '${v1Id}'`) === `true|${partnerId}|true`, "replace: the old row is marked superseded by the branch head, not removed");
check(sql(`select storage_key <> '' from documents where id = '${v1Id}'`) === "t", "replace: the old row keeps its stored file");

// A bad file is refused by the same guard as any upload, and nothing changes.
await go(pp, `/students/${sid}/documents`);
const v2RowForGuard = pp.locator(`li[data-document-id="${v2Id}"]`);
await v2RowForGuard.locator("summary", { hasText: "Replace" }).click();
await v2RowForGuard.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a document") });
await v2RowForGuard.getByRole("button", { name: "Upload replacement" }).click();
check(await v2RowForGuard.getByText(/Upload a PDF, JPG, PNG or WebP/).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "replace: a text file is refused by the usual upload rules");
check(sql(`select count(*) from documents where replaces_id = '${v2Id}'`) === "0" && sql(`select superseded_at is null from documents where id = '${v2Id}'`) === "t", "replace: the refused file changed nothing");

/* ---------------- The list shows one document with its history ---------------- */
await go(pp, `/students/${sid}/documents`);
const v2Row = pp.locator(`li[data-document-id="${v2Id}"]`);
check((await v2Row.count()) === 1 && (await pp.locator(`li[data-document-id="${v1Id}"]`).count()) === 0, "list: only the current version is listed as a document");
const line = await v2Row.locator("[data-version-line]").innerText().catch(() => "");
check(/^Version 2, replaced \d{1,2} [A-Z][a-z]{2} \d{4} by Kottayam Branch Head$/.test(line), `list: "${line}"`);
const earlier = v2Row.locator("details[data-earlier-versions]");
check(/Earlier versions \(1\)/.test(await earlier.locator("summary").innerText().catch(() => "")), "list: one earlier version");
await earlier.locator("summary").click();
const v1Entry = earlier.locator(`li[data-version-id="${v1Id}"]`);
const v1Text = await v1Entry.innerText().catch(() => "");
check(/Version 1/.test(v1Text) && v1Text.includes(v1Name) && /Kottayam Branch Head/.test(v1Text), "list: the earlier version shows its number, file, date and uploader");
check((await v1Entry.locator(`a[href="/api/documents/${v1Id}"]`).count()) === 1, "list: the earlier version has a download link");
let res = await pp.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 200 && (await res.text()).includes(`first ${tag}`), "download: the earlier version opens, and it is the first file");
res = await pp.request.get(`${BASE}/api/documents/${v2Id}`);
check(res.status() === 200 && (await res.text()).includes(`second ${tag}`), "download: the current version is the second file");
check((await v1Entry.getByRole("button", { name: /Make version 1/ }).count()) === 0, "restore: a branch head is not offered bringing a version back");

const tabAfter = await tabCount(pp);
check(currentCount() === countBefore && tabAfter === tabBefore, `count: replacing does not add a document (${tabBefore} before, ${tabAfter} after)`);
await pp.screenshot({ path: `${OUT}/replaced.png`, fullPage: true });

/* ---------------- Who can open an earlier version ---------------- */
const kochi = await signIn("kochi@medcity.test");
res = await kochi.page.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 404, "access: another branch cannot open the earlier version");
res = await kochi.page.request.get(`${BASE}/api/documents/${v2Id}`);
check(res.status() === 404, "access: nor the current one");
await kochi.ctx.close();

const student = await signIn("fathima.rahman@example.com");
const sp = student.page;
res = await sp.request.get(`${BASE}/api/documents/${v1Id}`);
const studentOldBefore = res.status();
res = await sp.request.get(`${BASE}/api/documents/${v2Id}`);
check(studentOldBefore === 404 && res.status() === 404, "access: before sharing, the student opens neither version");

await go(pp, `/students/${sid}/documents`);
await pp.getByRole("button", { name: `Share ${v2Name} with the student` }).click();
await pp.getByRole("button", { name: `Stop sharing ${v2Name}` }).waitFor({ timeout: 10000 }).catch(() => {});
check((await waitSql(`select string_agg(shared_with_student::text, ',' order by created_at) from documents where id in ('${v1Id}', '${v2Id}')`, "true,true")) === "true,true", "share: sharing the document shares every version");
res = await sp.request.get(`${BASE}/api/documents/${v1Id}`);
const studentOld = res.status();
res = await sp.request.get(`${BASE}/api/documents/${v2Id}`);
check(studentOld === 200 && res.status() === 200, "access: once shared, the student opens both versions, as for the current one");

/* ---------------- The desk brings version one back ---------------- */
const admin = await signIn("admin@medcityoverseas.test");
const ap = admin.page;
await go(ap, `/students/${sid}/documents`);
const adminRow = ap.locator(`li[data-document-id="${v2Id}"]`);
await adminRow.locator("details[data-earlier-versions] summary").click();
await adminRow.getByRole("button", { name: `Make version 1 of ${sopLabel} current` }).click();
check(await toast(ap, /current version again/), "restore: the screen says version one is current again");
check((await waitSql(`select superseded_at is null from documents where id = '${v1Id}'`, "t")) === "t", "restore: version one is current");
check(sql(`select (superseded_at is not null)::text || '|' || coalesce(superseded_by_id, '') from documents where id = '${v2Id}'`) === `true|${adminId}`, "restore: version two is set aside by the desk, not deleted");
check(sql(`select count(*) from audit_logs where action = 'document.restore' and entity_id = '${v1Id}' and actor_id = '${adminId}'`) === "1", "restore: recorded in the audit log");

await go(ap, `/students/${sid}/documents`);
const restoredRow = ap.locator(`li[data-document-id="${v1Id}"]`);
const restoredLine = await restoredRow.locator("[data-version-line]").innerText().catch(() => "");
check(/^Version 1, restored \d{1,2} [A-Z][a-z]{2} \d{4} by UK Desk$/.test(restoredLine), `restore: "${restoredLine}"`);
await restoredRow.locator("details[data-earlier-versions] summary").click();
check((await restoredRow.locator(`li[data-version-id="${v2Id}"]`).count()) === 1, "restore: version two is now listed as the earlier version");
check(currentCount() === countBefore && (await tabCount(ap)) === countBefore, "count: restoring does not change the count either");

/* ---------------- Removing keeps the file, and it can be put back ---------------- */
await restoredRow.getByRole("button", { name: `Delete ${v1Name}` }).click();
check((await waitSql(`select (removed_at is not null)::text || '|' || coalesce(removed_by_id, '') from documents where id = '${v1Id}'`, `true|${adminId}`)) === `true|${adminId}`, "remove: the row is marked removed, not deleted");
check(currentCount() === countBefore - 1, "remove: it no longer counts");
res = await ap.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 200 && (await res.text()).includes(`first ${tag}`), "remove: the stored file is still there for the desk");
res = await pp.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 404, "remove: the branch head no longer opens a removed file");
res = await sp.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 404, "remove: nor does the student");

await go(ap, `/students/${sid}/documents`);
const removedSection = ap.locator("section[data-removed-documents]");
await removedSection.locator("summary").click();
await removedSection.getByRole("button", { name: `Put back ${v1Name}` }).click();
check((await waitSql(`select removed_at is null from documents where id = '${v1Id}'`, "t")) === "t", "put back: the file is on the record again");
check(currentCount() === countBefore, "put back: it counts again");
check(sql(`select count(*) from audit_logs where entity_id = '${v1Id}' and action in ('document.remove', 'document.unremove')`) === "2", "remove and put back: both recorded in the audit log");

/* ---------------- The student replaces the shared file from the portal ---------------- */
await go(sp, "/portal/documents");
const replaceBox = sp.locator(`details:has(input[name="replacesId"][value="${v1Id}"])`);
check((await replaceBox.count()) === 1, "portal: the shared file offers Replace");
await replaceBox.locator("summary").click();
await replaceBox.locator('input[type="file"]').setInputFiles({ name: v3Name, mimeType: "application/pdf", buffer: pdf(`student ${tag}`) });
await replaceBox.locator('button[type="submit"]').click();
await sp.waitForURL(/uploaded=/, { timeout: 15000 }).catch(() => {});
const v3Id = await waitValue(`select id from documents where replaces_id = '${v1Id}' and file_name = '${v3Name}'`);
check(!!v3Id && sql(`select uploaded_by_id from documents where id = '${v3Id}'`) === studentUserId, "portal: the student's file replaces the shared one");
check(currentCount() === countBefore, "portal: still one statement of purpose");
await go(sp, "/portal/documents");
const studentEarlier = sp.locator(`[data-portal-document="SOP"] details[data-earlier-versions]`);
await studentEarlier.locator("summary").click().catch(() => {});
check((await studentEarlier.locator(`a[href="/api/documents/${v1Id}"]`).count()) === 1, "portal: the student sees the earlier version they may open");
res = await sp.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 200, "portal: and it opens");
await sp.screenshot({ path: `${OUT}/portal.png`, fullPage: true });

await go(pp, `/students/${sid}/documents`);
const studentLine = await pp.locator(`li[data-document-id="${v3Id}"] [data-version-line]`).innerText().catch(() => "");
check(/^Version 3, replaced .* by the student$/.test(studentLine), `staff list: "${studentLine}"`);

for (const [who, e] of [["partner", partner.errors], ["admin", admin.errors], ["student", student.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
