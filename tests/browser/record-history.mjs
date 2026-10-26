// Version history and the ownership ledger. A branch head edits a student's
// city twice and sees both changes, field by field with who and when, on the
// student's History tab; compares the version before both edits with the
// latest; restores the city from one change, which is itself a new version;
// and is told why the assignment is not restored from there. Reassigning the
// student from the list writes the ownership ledger, shown on the History tab.
// An enquiry edit and claim, and an application's priority, have the same
// history. The admin verifies the chain intact, the database refuses to edit
// an entry, and an entry edited behind the guard by SQL is caught by Verify by
// number. A counsellor cannot read another counsellor's student's history, on
// the tab or in the change feed, nor open the ledger; another branch's head
// never sees this branch's changes. The feed filters and its CSV. Wants the
// plain seed.
import { chromium } from "playwright";
import { hydrated, knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-record-history";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const psql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" }, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const sql = (q) => psql(q);
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => {
  console.log("FAIL  " + m);
  fails.push(m);
};
const check = (c, m) => (c ? ok(m) : bad(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitSql(q, want, ms = 10000) {
  let got = sql(q);
  for (let t = 0; t < ms && got !== want; t += 250) {
    await sleep(250);
    got = sql(q);
  }
  return got;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
let ip = 10;
const allErrors = [];
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.211.6.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    if (knownWarning(e, page.url())) return;
    allErrors.push(`${email} on ${page.url().replace(BASE, "")}: ${String(e).slice(0, 160)} ${String(e?.stack ?? "").slice(0, 200)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().startsWith(BASE)) allErrors.push(`${email}: ${r.status()} ${r.url()}`);
  });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page };
}
async function go(page, path) {
  const res = await page.goto(`${BASE}${path}`);
  await hydrated(page).catch(() => {});
  return res;
}
const main = (page) => page.locator("main").innerText();
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);

/** Presses Verify chain and returns the answer the page was sent to. Pressed again if the first press landed before the page was ready. */
async function verifyChain(page) {
  await go(page, "/admin/ledger");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Verify chain" }).click();
    if (await page.waitForURL(/intact=|broken=/, { timeout: 20000 }).then(() => true, () => false)) break;
  }
  await page.locator("[data-verify]").first().waitFor({ timeout: 10000 }).catch(() => {});
  return decodeURIComponent(page.url());
}

// ---------- The plain seed, set to a known start ----------
const sid = sql("select s.id from students s join organizations o on o.id = s.org_id where o.name ilike '%kottayam%' and s.first_name = 'Aswin'");
const other = sql("select s.id from students s join organizations o on o.id = s.org_id where o.name ilike '%kottayam%' and s.first_name = 'Akshara'");
const appId = sql(`select id from applications where student_id = '${sid}' order by created_at limit 1`);
const ukDocs = sql("select id from users where email = 'uk.docs@medcity.test'");
const germany = sql("select id from users where email = 'germany@medcity.test'");
const head = sql("select id from users where email = 'kottayam@medcity.test'");
const enquiryId = sql("select e.id from enquiries e join organizations o on o.id = e.org_id where o.name ilike '%kottayam%' and e.name = 'Abhijith Menon'");
sql(`update students set city = 'Kottayam', profile_locked = false, assigned_to_id = '${germany}' where id = '${sid}'`);
sql(`update students set city = 'Kottayam', profile_locked = false where id = '${other}'`);
sql(`update applications set priority = 'NORMAL' where id = '${appId}'`);
sql(`update enquiries set city = 'Changanassery', assigned_to_id = '${germany}' where id = '${enquiryId}'`);
check(!!sid && !!other && !!appId && !!enquiryId, "the seed has the student, a colleague's student, an application and an enquiry");
const versions = (entity, id) => Number(sql(`select count(*) from record_versions where entity = '${entity}' and entity_id = '${id}'`));

// ---------- A branch head edits a student twice ----------
const { page: hp } = await signIn("kottayam@medcity.test");
async function saveCity(city) {
  await go(hp, `/students/${sid}/profile`);
  await hp.evaluate(() => document.querySelectorAll("main details:not([open]) > summary").forEach((e) => e.click()));
  const personal = hp.locator("#personal");
  await personal.locator('input[name="city"]').fill(city);
  await personal.getByRole("button", { name: "Save personal details" }).click();
  return toast(hp, /Saved/);
}
check(await saveCity("Pala"), "the profile saves the first city");
check(await saveCity("Ettumanoor"), "and the second");
check((await waitSql(`select city from students where id = '${sid}'`, "Ettumanoor")) === "Ettumanoor", "the student's city is the second one");
check(versions("student", sid) === 2, `each save is one version, not one per field (${versions("student", sid)})`);
const stored = sql(`select changes::text from record_versions where entity = 'student' and entity_id = '${sid}' order by created_at desc limit 1`);
check(/"field": ?"city"/.test(stored) && /"before": ?"Pala"/.test(stored) && /"after": ?"Ettumanoor"/.test(stored) && !/updatedAt/.test(stored), "the version keeps the field, the before and the after, and nothing else");

await go(hp, `/students/${sid}/history`);
let text = await main(hp);
check(/Version 2/.test(text) && /Version 1/.test(text), "the History tab lists both versions");
const v2 = hp.locator('li[data-version="2"]');
const v2text = await v2.innerText();
check(/City:\s*Pala\s*to\s*Ettumanoor/.test(v2text), "version 2 reads City: Pala to Ettumanoor");
check(/Kottayam Branch Head/.test(v2text), "with the person who made it");
check(/City:\s*Kottayam\s*to\s*Pala/.test(await hp.locator('li[data-version="1"]').innerText()), "version 1 reads City: Kottayam to Pala");
await hp.screenshot({ path: `${OUT}/history.png`, fullPage: true });

// Compare the record before both edits with now.
await go(hp, `/students/${sid}/history?a=0&b=2`);
const compared = await hp.locator("[data-compare-result]").innerText();
check(/City\s+Kottayam\s+Ettumanoor/.test(compared), "comparing version 0 with version 2 shows City Kottayam then Ettumanoor");
await go(hp, `/students/${sid}/history?a=1&b=1`);
check(/are the same/.test(await hp.locator("[data-compare-result]").innerText()), "a version compared with itself is the same");

// Restoring version 1's change now would throw Ettumanoor away: the city was changed since.
await go(hp, `/students/${sid}/history`);
await Promise.all([hp.waitForURL(/done=|why=/, { timeout: 15000 }).catch(() => {}), hp.locator('li[data-version="1"] li[data-field="city"] button:has-text("Restore")').click()]);
check(/changed again since, to Ettumanoor/.test(decodeURIComponent(hp.url())), "a field changed since is left alone, and the page says why");
check(sql(`select city from students where id = '${sid}'`) === "Ettumanoor", "and the city is untouched");
check(versions("student", sid) === 2, "and nothing is written");

// Restore the city from version 2: it goes back to Pala, as a new version.
await go(hp, `/students/${sid}/history`);
await Promise.all([hp.waitForURL(/done=|why=/, { timeout: 15000 }).catch(() => {}), hp.locator('li[data-version="2"] li[data-field="city"] button:has-text("Restore")').click()]);
check(decodeURIComponent(hp.url()).includes("City is back to Pala"), `restore says what it did (${decodeURIComponent(hp.url()).split("?")[1] ?? ""})`);
check(sql(`select city from students where id = '${sid}'`) === "Pala", "the city is back to Pala");
check(versions("student", sid) === 3, "the restore is itself a version");
await go(hp, `/students/${sid}/history`);
check(/Restored from the history/.test(await hp.locator('li[data-version="3"]').innerText()), "and reads as a restore");
check(sql(`select count(*) from audit_logs where action = 'history.restore' and entity_id = '${sid}'`) === "1", "the restore is in the audit log");

// ---------- Reassign from the list: the ownership ledger ----------
await go(hp, "/students");
const row = hp.locator("tr", { has: hp.locator(`a[href="/students/${sid}/profile"]`) });
const picker = row.locator('select[name="assignedToId"]');
const saveButton = row.locator('form:has(select[name="assignedToId"]) button');
for (let t0 = Date.now(); (await saveButton.count()) > 0 && Date.now() - t0 < 10000; ) await hp.waitForTimeout(200);
await picker.selectOption(ukDocs);
check((await waitSql(`select assigned_to_id from students where id = '${sid}'`, ukDocs, 15000)) === ukDocs, "the student is reassigned from the list");
const kinds = await waitSql(`select string_agg(kind, ',' order by seq) from ownership_ledger where entity = 'student' and entity_id = '${sid}'`, "OPENING,ASSIGNED");
check(kinds === "OPENING,ASSIGNED", `the ledger opens the student's line and records the change (${kinds})`);
const link = sql(`select (select hash from ownership_ledger where seq = l.seq - 1) = l.prev_hash from ownership_ledger l where entity = 'student' and entity_id = '${sid}' and kind = 'ASSIGNED'`);
check(link === "t", "the entry carries the hash of the one before it");

await go(hp, `/students/${sid}/history`);
const own = await hp.locator("[data-ownership]").innerText();
check(/On record when the ledger started/.test(own) && /Germany Counsellor to UK Documentation/.test(own), "the History tab shows the ownership record: Germany Counsellor to UK Documentation");
const assignLine = await hp.locator('li[data-version="4"]').innerText();
check(/Assigned to:\s*Germany Counsellor\s*to\s*UK Documentation/.test(assignLine), "the reassignment is a version too");
check(/Not restored from here\./.test(assignLine) && /Reassign/.test(assignLine) && (await hp.locator('li[data-version="4"] button:has-text("Restore")').count()) === 0, "and is not offered for restore, saying why");

// ---------- An application's history ----------
await go(hp, `/students/${sid}/applications?app=${appId}`);
await hp.getByLabel("Priority", { exact: true }).selectOption("HIGH");
await hp.getByRole("button", { name: "Set", exact: true }).click();
check((await waitSql(`select priority from applications where id = '${appId}'`, "HIGH")) === "HIGH", "the application's priority is set");
await go(hp, `/students/${sid}/applications/${appId}/history`);
text = await main(hp);
check(/Priority:\s*Normal\s*to\s*High/.test(text), "the application's History shows Priority: Normal to High");
await Promise.all([hp.waitForURL(/done=|why=/, { timeout: 15000 }).catch(() => {}), hp.locator('li[data-field="priority"] button:has-text("Restore")').first().click()]);
check(sql(`select priority from applications where id = '${appId}'`) === "NORMAL", "and the priority can be restored");

// ---------- An enquiry's history and ownership ----------
await go(hp, `/enquiries/${enquiryId}`);
await hp.locator('input[name="city"]').fill("Pala Town");
await hp.getByRole("button", { name: "Save changes" }).click();
check((await waitSql(`select city from enquiries where id = '${enquiryId}'`, "Pala Town")) === "Pala Town", "the enquiry's town is saved");
await go(hp, `/enquiries/${enquiryId}`);
await hp.getByRole("button", { name: "Assign this to me" }).click();
check((await waitSql(`select assigned_to_id from enquiries where id = '${enquiryId}'`, head)) === head, "the branch head takes the enquiry");
await go(hp, `/enquiries/${enquiryId}/history`);
text = await main(hp);
check(/Town:\s*Changanassery\s*to\s*Pala Town/.test(text), "the enquiry's History shows Town: Changanassery to Pala Town");
check(/Owner:\s*Germany Counsellor\s*to\s*Kottayam Branch Head/.test(text), "and the change of owner");
check(/Germany Counsellor to Kottayam Branch Head/.test(await hp.locator("[data-ownership]").innerText()), "and its ownership record");
await go(hp, `/enquiries/${enquiryId}`);
check(/Ownership record/.test(await main(hp)), "the enquiry page carries the ownership record too");

// A colleague's student, edited by the head, for the scope checks below.
await go(hp, `/students/${other}/profile`);
await hp.evaluate(() => document.querySelectorAll("main details:not([open]) > summary").forEach((e) => e.click()));
await hp.locator("#personal").locator('input[name="city"]').fill("Vaikom");
await hp.locator("#personal").getByRole("button", { name: "Save personal details" }).click();
check(await toast(hp, /Saved/), "the head edits a colleague's student as well");

// ---------- The head office: feed, filters, CSV, ledger ----------
const { page: ap } = await signIn("admin@medcityoverseas.test");
await go(ap, "/admin/history?entity=student");
text = await main(ap);
check(/Aswin Anil/.test(text) && /Akshara Anilkumar/.test(text), "the head office's change feed lists both students' changes");
check(/City:\s*Pala\s*to\s*Ettumanoor/.test(text), "field by field");
await go(ap, `/admin/history?entity=enquiry&by=${head}`);
text = await main(ap);
check(/Abhijith Menon/.test(text) && !/Aswin Anil/.test(text), "filtering by record type and person narrows it");
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
await go(ap, `/admin/history?from=2000-01-01&to=2000-01-02`);
check(/No changes for these filters/.test(await main(ap)), "a date range with nothing in it says so");
await go(ap, `/admin/history?from=${today}&to=${today}`);
check(/Aswin Anil/.test(await main(ap)), "today's range holds today's changes");
const csv = await (await ap.request.get(`${BASE}/api/history/export?entity=student`)).text();
check(/When \(IST\),Who,Record type/.test(csv) && /Ettumanoor/.test(csv) && /City/.test(csv), "the CSV has a line per field changed");

check(/Chain intact/.test(await verifyChain(ap)) && (await ap.locator('[data-verify="intact"]').count()) === 1, "Verify chain: intact");
check((await ap.locator(`[data-ledger-row]`).count()) >= 4, "the ledger lists its entries");

// The database refuses to change an entry.
let refused = "";
try {
  psql(`update ownership_ledger set owner_name = 'Someone else' where entity_id = '${sid}' and kind = 'ASSIGNED'`);
} catch (e) {
  refused = String(e.stderr ?? e.message);
}
check(/append-only/.test(refused), "the database refuses to edit a ledger entry");
try {
  psql(`delete from ownership_ledger where entity_id = '${sid}'`);
  refused = "";
} catch (e) {
  refused = String(e.stderr ?? e.message);
}
check(/append-only/.test(refused), "or to delete one");

// Somebody with the rights switches the guard off and edits an entry: Verify names it.
const seq = sql(`select seq from ownership_ledger where entity_id = '${sid}' and kind = 'ASSIGNED'`);
const was = sql(`select owner_name from ownership_ledger where seq = ${seq}`);
psql(`begin; alter table ownership_ledger disable trigger ownership_ledger_guard; update ownership_ledger set owner_name = 'Someone else' where seq = ${seq}; alter table ownership_ledger enable trigger ownership_ledger_guard; commit;`);
const verdict = await verifyChain(ap);
check(new RegExp(`Entry ${seq} was changed after it was written`).test(verdict) && (await ap.locator('[data-verify="broken"]').count()) === 1, `Verify chain flags entry ${seq} as changed`);
await ap.screenshot({ path: `${OUT}/ledger-broken.png`, fullPage: true });
psql(`begin; alter table ownership_ledger disable trigger ownership_ledger_guard; update ownership_ledger set owner_name = '${was.replace(/'/g, "''")}' where seq = ${seq}; alter table ownership_ledger enable trigger ownership_ledger_guard; commit;`);
check(/Chain intact/.test(await verifyChain(ap)), "putting the entry back makes the chain whole again");
check(Number(sql("select count(*) from audit_logs where action = 'ledger.verify'")) >= 3, "every verify is in the audit log");

// ---------- Who may read what ----------
// uk.docs now carries Aswin, and has never touched Akshara.
const { page: cp } = await signIn("uk.docs@medcity.test");
let res = await go(cp, `/students/${other}/history`);
check(res.status() === 404 || /not found/i.test(await cp.locator("body").innerText()), "a counsellor cannot open a colleague's student's history");
await go(cp, "/admin/history");
text = await main(cp);
check(/Aswin Anil/.test(text), "a counsellor's change feed has their own student");
check(!/Akshara/.test(text) && !/Vaikom/.test(text), "and never a colleague's");
const theirCsv = await (await cp.request.get(`${BASE}/api/history/export`)).text();
check(!/Vaikom/.test(theirCsv), "nor in the CSV");
await go(cp, "/admin/ledger");
check(cp.url().includes("/forbidden"), "a counsellor cannot open the ownership ledger");
res = await go(cp, `/students/${sid}/history`);
check(res.status() === 200 && /Ownership record/.test(await main(cp)), "but reads the history of the student they carry");

const { page: kp } = await signIn("kochi@medcity.test");
await go(kp, "/admin/history");
text = await main(kp);
check(!/Aswin/.test(text) && !/Akshara/.test(text) && !/Abhijith/.test(text), "another branch's head never sees this branch's changes");
res = await go(kp, `/students/${sid}/history`);
check(res.status() === 404 || /not found/i.test(await kp.locator("body").innerText()), "nor opens its students' history");

check(allErrors.length === 0, `no page errors (${allErrors.slice(0, 3).join(" | ")})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
