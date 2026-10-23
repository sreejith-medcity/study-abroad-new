// Document versions: a replaced file is kept as an earlier version instead of
// being overwritten. A branch head uploads a statement of purpose and replaces
// it; the list shows one document with "Version 2, replaced ... by ...", the
// earlier version is listed and opens, and the document count does not double.
// Earlier versions open for exactly the people the current one opens for, and
// never for another branch or a counsellor the student is not theirs, while the
// documentation desk still opens a handed-over file. The desk brings version
// one back (audited). Removing the file in use keeps its stored copy and hands
// the document, and its checklist item, to the newest earlier version; putting
// it back brings it in as an earlier version, never a second current file. The
// student replaces the shared file from the portal, but not once the team has
// accepted it. Wants the plain seed.
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
// The statement of purpose on the documentation list, which follows the current file.
const sopItem = sql(`select id from checklist_items where student_id = '${sid}' and type_code = 'SOP'`);
const sopItemFile = () => sql(`select coalesce(document_id, '') || '|' || state from checklist_items where id = '${sopItem}'`);
check(!!sid && !!partnerId && !!adminId && !!studentUserId, "seed: the student, the branch head, the desk and the student's sign-in exist");
check(!!sopItem, "seed: the statement of purpose is on the student's documentation list");

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

// The same branch is not enough: a counsellor the student is not assigned to
// opens nothing, as the student's page itself is closed to them.
const otherCounsellor = await signIn("germany@medcity.test");
res = await otherCounsellor.page.request.get(`${BASE}/api/documents/${v2Id}`);
const otherCurrent = res.status();
res = await otherCounsellor.page.request.get(`${BASE}/api/documents/${v1Id}`);
check(otherCurrent === 404 && res.status() === 404, "access: a counsellor at the same branch who is not on the student's file opens neither version");
await otherCounsellor.ctx.close();

// The documentation desk works files the branch handed over, and opens them.
const desk = await signIn("documentation@medcityoverseas.test");
res = await desk.page.request.get(`${BASE}/api/documents/${v2Id}`);
const deskCurrent = res.status();
res = await desk.page.request.get(`${BASE}/api/documents/${v1Id}`);
check(deskCurrent === 200 && res.status() === 200, "access: the documentation desk opens the handed-over file and its earlier version");
await desk.ctx.close();

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
check(sopItemFile().startsWith(`${v1Id}|`), `restore: the documentation list moves to the restored file (${sopItemFile()})`);

await go(ap, `/students/${sid}/documents`);
const restoredRow = ap.locator(`li[data-document-id="${v1Id}"]`);
const restoredLine = await restoredRow.locator("[data-version-line]").innerText().catch(() => "");
check(/^Version 1, restored \d{1,2} [A-Z][a-z]{2} \d{4} by UK Desk$/.test(restoredLine), `restore: "${restoredLine}"`);
await restoredRow.locator("details[data-earlier-versions] summary").click();
check((await restoredRow.locator(`li[data-version-id="${v2Id}"]`).count()) === 1, "restore: version two is now listed as the earlier version");
check(currentCount() === countBefore && (await tabCount(ap)) === countBefore, "count: restoring does not change the count either");

/* ---------------- Removing the file in use hands over to the earlier version ---------------- */
await restoredRow.getByRole("button", { name: `Delete ${v1Name}` }).click();
check((await waitSql(`select (removed_at is not null)::text || '|' || coalesce(removed_by_id, '') from documents where id = '${v1Id}'`, `true|${adminId}`)) === `true|${adminId}`, "remove: the row is marked removed, not deleted");
check(sql(`select (superseded_at is null and removed_at is null)::text from documents where id = '${v2Id}'`) === "true", "remove: version two, the newest earlier version, is current again");
check(sql(`select count(*) from documents where id in ('${v1Id}', '${v2Id}') and superseded_at is null and removed_at is null`) === "1", "remove: exactly one current file in the document");
check(currentCount() === countBefore, "remove: the document still counts, by its earlier version");
check(sopItemFile() === `${v2Id}|UPLOADED`, `remove: the documentation list follows to version two, to be checked again (${sopItemFile()})`);
res = await ap.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 200 && (await res.text()).includes(`first ${tag}`), "remove: the stored file is still there for the desk");
res = await pp.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 404, "remove: the branch head no longer opens a removed file");
res = await sp.request.get(`${BASE}/api/documents/${v1Id}`);
check(res.status() === 404, "remove: nor does the student");

await go(ap, `/students/${sid}/documents`);
check((await ap.locator(`li[data-document-id="${v2Id}"]`).count()) === 1 && (await ap.locator(`li[data-document-id="${v1Id}"]`).count()) === 0, "remove: the list shows the document by version two");
const removedSection = ap.locator("section[data-removed-documents]");
await removedSection.locator("summary").click();
await removedSection.getByRole("button", { name: `Put back ${v1Name}` }).click();
check((await waitSql(`select removed_at is null from documents where id = '${v1Id}'`, "t")) === "t", "put back: the file is on the record again");
check(sql(`select (superseded_at is not null)::text from documents where id = '${v1Id}'`) === "true", "put back: it comes back as an earlier version");
check(sql(`select count(*) from documents where id in ('${v1Id}', '${v2Id}') and superseded_at is null and removed_at is null`) === "1" && sql(`select superseded_at is null from documents where id = '${v2Id}'`) === "t", "put back: version two stays the one current file");
check(currentCount() === countBefore, "put back: the count does not change");
check(sopItemFile().startsWith(`${v2Id}|`), "put back: the documentation list stays on the current file");
check(sql(`select count(*) from audit_logs where entity_id = '${v1Id}' and action in ('document.remove', 'document.unremove')`) === "2", "remove and put back: both recorded in the audit log");
await ap.waitForURL(/putBack=/, { timeout: 10000 }).catch(() => {});
check(await ap.getByText(`${v1Name} is back, as an earlier version.`).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "put back: the page says it came back as an earlier version");
await ap.locator(`li[data-document-id="${v2Id}"] details[data-earlier-versions] summary`).click();
check((await ap.locator(`li[data-document-id="${v2Id}"] li[data-version-id="${v1Id}"]`).count()) === 1, "put back: version one is listed under version two");

/* ---------------- The student may not replace what the team has accepted ---------------- */
const sopStateBefore = sql(`select state from checklist_items where id = '${sopItem}'`);
sql(`update checklist_items set state = 'ACCEPTED' where id = '${sopItem}'`);
await go(sp, "/portal/documents");
const sopPortal = sp.locator(`[data-portal-document="SOP"]`);
check((await sopPortal.locator('input[name="replacesId"]').count()) === 0, "portal: an accepted file offers no Replace");
check(/ask your counsellor/i.test(await sopPortal.locator("[data-accepted-note]").innerText().catch(() => "")), "portal: and says to ask the counsellor instead");
res = await sp.request.post(`${BASE}/api/uploads/portal-document`, {
  multipart: { replacesId: v2Id, typeCode: "SOP", file: { name: `sneaky-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(`sneaky ${tag}`) } },
  failOnStatusCode: false,
});
const refusal = await res.json().catch(() => ({}));
check(res.status() === 409 && /ask your counsellor/i.test(refusal.error ?? ""), `portal: the server refuses a replacement of an accepted file (${res.status()})`);
res = await sp.request.post(`${BASE}/api/uploads/portal-document`, {
  multipart: { typeCode: "SOP", file: { name: `sneaky-new-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(`sneaky new ${tag}`) } },
  failOnStatusCode: false,
});
check(res.status() === 409, "portal: and a fresh upload of the same kind");
check(sql(`select count(*) from documents where student_id = '${sid}' and file_name like 'sneaky%${tag}.pdf'`) === "0" && sql(`select state from checklist_items where id = '${sopItem}'`) === "ACCEPTED", "portal: nothing was saved and the item is still accepted");
sql(`update checklist_items set state = '${sopStateBefore}' where id = '${sopItem}'`);

/* ---------------- The student replaces the shared file from the portal ---------------- */
await go(sp, "/portal/documents");
const replaceBox = sp.locator(`details:has(input[name="replacesId"][value="${v2Id}"])`);
check((await replaceBox.count()) === 1, "portal: the shared file offers Replace while it is still being checked");
await replaceBox.locator("summary").click();
await replaceBox.locator('input[type="file"]').setInputFiles({ name: v3Name, mimeType: "application/pdf", buffer: pdf(`student ${tag}`) });
await replaceBox.locator('button[type="submit"]').click();
await sp.waitForURL(/uploaded=/, { timeout: 15000 }).catch(() => {});
const v3Id = await waitValue(`select id from documents where replaces_id = '${v2Id}' and file_name = '${v3Name}'`);
check(!!v3Id && sql(`select uploaded_by_id from documents where id = '${v3Id}'`) === studentUserId, "portal: the student's file replaces the shared one");
check(currentCount() === countBefore, "portal: still one statement of purpose");
await go(sp, "/portal/documents");
const studentEarlier = sp.locator(`[data-portal-document="SOP"] details[data-earlier-versions]`);
await studentEarlier.locator("summary").click().catch(() => {});
check((await studentEarlier.locator(`a[href="/api/documents/${v2Id}"]`).count()) === 1 && (await studentEarlier.locator(`a[href="/api/documents/${v1Id}"]`).count()) === 1, "portal: the student sees the earlier versions they may open");
res = await sp.request.get(`${BASE}/api/documents/${v2Id}`);
check(res.status() === 200, "portal: and they open");
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
