// More than one person on a student, from the students list.
//
// Item six of the branches' own list: "options to assign to more than 2 if it
// can be made would be helpful". A file still belongs to one counsellor,
// because somebody has to be answerable for it, and that is what the dropdown
// sets. Everybody else working on it goes beside them, and until now saying
// so meant opening the file, finding the profile tab, picking the person and
// typing what they do: four moves, from a list where somebody wanted one.
//
// So the list does it. What it writes is the same row the profile writes,
// which is why the two have to agree, and this checks that they do.
// Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.locator("aside[data-nav]").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const shared = (id) => Number(sql(`select count(*) from student_people where student_id = '${id}'`));

const branch = await signIn("kottayam@medcity.test", "10.202.5.1");
const page = branch.page;
await page.goto(`${BASE}/students`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
await hydrated(page);

const row = page.locator("tbody tr").first();
const studentId = await row.locator('input[name="studentId"]').first().inputValue();
sql(`delete from student_people where student_id = '${studentId}'`);
await page.reload();
await hydrated(page);

// --- One more person, from the list.
const opener = row.getByRole("button", { name: /Share with somebody|Somebody else/ });
check((await opener.count()) > 0, "the list offers to share a student with somebody else");
await opener.first().click();
const picker = row.locator('select[name="userId"]');
const choices = await picker.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
check(choices.length > 0, `and offers the branch's own people (${choices.length})`);

// The counsellor it is already assigned to is not one of the choices.
const owner = sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`);
check(owner === "" || !choices.includes(owner), "but not the counsellor it is already assigned to");

await picker.selectOption(choices[0]);
for (let t0 = Date.now(); shared(studentId) < 1 && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(shared(studentId) === 1, `choosing a name puts them on the file (${shared(studentId)})`);
check(sql(`select user_id from student_people where student_id = '${studentId}'`) === choices[0], "and it is the person who was chosen");
check(sql(`select count(*) from audit_logs where entity_id = '${studentId}' and action = 'student.person.add'`) !== "0", "and it is in the audit log");

// --- And a second, which is the whole point of the thing.
await page.reload();
await hydrated(page);
await row.getByRole("button", { name: /Somebody else/ }).first().click();
const more = await row.locator('select[name="userId"] option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
check(!more.includes(choices[0]), "somebody already on the file is not offered again");
if (more.length) {
  await row.locator('select[name="userId"]').selectOption(more[0]);
  for (let t0 = Date.now(); shared(studentId) < 2 && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
}
check(shared(studentId) === 2, `a student can be shared with more than one person (${shared(studentId)})`);

// --- The names show on the row without opening anything.
await page.reload();
await hydrated(page);
const names = sql(`
  select string_agg(coalesce(u.desk_label, u.name), '|')
  from student_people sp join users u on u.id = sp.user_id
  where sp.student_id = '${studentId}'`).split("|");
const cell = (await row.innerText()).replace(/\s+/g, " ");
check(names.every((n) => cell.includes(n)), `the row names everybody on the file (${names.join(", ")})`);

// --- Taking one off again.
await row.getByRole("button", { name: new RegExp(`Take ${names[0]} off this file`) }).first().click();
for (let t0 = Date.now(); shared(studentId) > 1 && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(shared(studentId) === 1, `and one can be taken off again (${shared(studentId)})`);

// --- The file's own page agrees with the list, since it is one record.
await page.goto(`${BASE}/students/${studentId}/profile`);
await hydrated(page);
const left = sql(`
  select coalesce(u.desk_label, u.name) from student_people sp join users u on u.id = sp.user_id
  where sp.student_id = '${studentId}' limit 1`);
const profile = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check(profile.includes(left), `the file's own page shows the same person (${left})`);

// Who a branch may put on a file, and who may do it at all, is guarded in
// the action and checked by people-on-file.mjs, which drives the same rows
// from the profile. Nothing is repeated here.

check(branch.errors.length === 0, `no page errors or 500s ${branch.errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
