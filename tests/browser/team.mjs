// Branch team management: the owner adds counsellors (a branch without a
// limit, a sub-agent within its tier's seats)
// (one-time password, forced change), switches one off (students move to the
// owner, sign-in ends at once) and back on, resets a password, and nobody
// else can reach it. Wants the plain seed.
import { chromium } from "playwright";
import { hydrated, knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-team";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
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
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
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


sql("delete from users where email like 'new.counsellor%@medcity.test'; update users set active = true where email = 'uk.docs@medcity.test'; update organizations set counsellor_seats = 8 where name = 'Medcity Kottayam'");
const org = sql("select id from organizations where name = 'Medcity Kottayam'");
const ukDocs = sql("select id from users where email = 'uk.docs@medcity.test'");
const before = Number(sql(`select count(*) from students where assigned_to_id = '${ukDocs}'`));

// A counsellor signed in, to see them lose access.
const counsellor = await signIn("uk.docs@medcity.test", "10.105.1.3");
const owner = await signIn("kottayam@medcity.test", "10.105.1.1");
const op = owner.page;
let text = await go(op, "/settings/team");
// The seat count moves with the seed, which now has one of each counsellor
// role at this branch, so the shape is asserted rather than a frozen number.
check(/\d+ (person|people) active/.test(text) && /Owner/.test(text) && !/seats in use/.test(text), "team: people listed, and a branch is not told about seats");

// Add a counsellor.
const email = `new.counsellor${Date.now() % 100000}@medcity.test`;
await op.locator('[name="name"]').fill("New Counsellor");
await op.locator('[name="email"]').fill("uk.docs@medcity.test");
await op.getByRole("button", { name: "Add counsellor" }).click();
check(await op.getByText("Someone already signs in with this email").waitFor({ timeout: 10000 }).then(() => true, () => false), "add: an email already in use is refused");
await op.locator('[name="email"]').fill(email);
await op.locator("#tm-desk").fill("Ireland desk");
await op.getByRole("button", { name: "Add counsellor" }).click();
const note = await op.locator('[role="status"], [role="alert"], .text-good-700, main').filter({ hasText: /One-time password for/ }).first().innerText({ timeout: 10000 }).catch(() => "");
const pw = (note.match(/One-time password for \S+: (\S+)\./) || [])[1];
check(!!pw && sql(`select role || '|' || org_id || '|' || must_change_password from users where email = '${email}'`) === `COUNSELLOR|${org}|true`, "add: counsellor in this branch, must change the password");
const fresh = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.105.1.4" } });
const fp = await fresh.newPage();
await fp.goto(`${BASE}/login`);
await fp.fill('input[name="email"]', email);
await fp.fill('input[name="password"]', pw ?? "x");
await fp.click('button[type="submit"]');
await fp.waitForURL(/change-password/, { timeout: 15000 }).catch(() => {});
check(/change-password/.test(fp.url()), "add: the new counsellor is sent to choose a password");

// Switch a counsellor off: students move to the owner, sign-in ends.
await go(op, "/settings/team");
await hydrated(op);
await op.getByRole("button", { name: "Switch off Uk" }).or(op.getByRole("button", { name: /^Switch off / }).first()).first().click().catch(() => {});
await op.waitForTimeout(1500);
const off = sql(`select active from users where id = '${ukDocs}'`);
if (off !== "f") {
  // The first "Switch off" may have been another counsellor; target uk.docs by its row.
  await op.getByTestId("member-uk.docs@medcity.test").getByRole("button", { name: /^Switch off/ }).click();
  await op.waitForTimeout(1500);
}
check(sql(`select active from users where id = '${ukDocs}'`) === "f", "switch off: saved");
check(Number(sql(`select count(*) from students where assigned_to_id = '${ukDocs}'`)) === 0 && before > 0, `switch off: ${before} students moved to the owner`);
const r = await counsellor.page.goto(`${BASE}/dashboard`);
await counsellor.page.waitForLoadState("domcontentloaded");
check(/\/login/.test(counsellor.page.url()) || r.status() >= 400, "switch off: the counsellor is signed out at once");

// A branch is Medcity's own and has no seat limit: "unable to add more than
// 3 members" was a sub-agent's tier cap applied to a branch. Squeeze its old
// seat number below its headcount and it must still take more people.
sql(`update organizations set counsellor_seats = 1 where id = '${org}'`);
text = await go(op, "/settings/team");
check((await op.getByRole("button", { name: "Add counsellor" }).count()) === 1 && !/Every seat is in use/.test(text), "branch: still takes more people whatever the old seat number says");
const many = Number(sql(`select count(*) from users where org_id = '${org}' and active and role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR')`));
for (let i = 0; i < 2; i++) {
  await op.locator('[name="name"]').fill(`Extra Counsellor ${i}`);
  await op.locator('[name="email"]').fill(`new.counsellor.extra${i}.${Date.now() % 100000}@medcity.test`);
  await op.getByRole("button", { name: "Add counsellor" }).click();
  await toast(op, /One-time password/);
  await go(op, "/settings/team");
}
const after = Number(sql(`select count(*) from users where org_id = '${org}' and active and role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR')`));
check(after === many + 2, `branch: a fourth member and beyond are added (${many} to ${after})`);

// A sub-agent keeps its tier's seats: full means no add.
{
  const sub = await signIn("owner@horizon.test", "10.105.1.9");
  const subOrg = sql("select org_id from users where email = 'owner@horizon.test'");
  sql(`update organizations set counsellor_seats = (select count(*) from users where org_id = '${subOrg}' and active and role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR')) where id = '${subOrg}'`);
  const t = await go(sub.page, "/settings/team");
  check(/Every seat is in use/.test(t) && (await sub.page.getByRole("button", { name: "Add counsellor" }).count()) === 0, "sub-agent: full means no add");
  sql(`update organizations set counsellor_seats = 3 where id = '${subOrg}'`);
  await sub.ctx.close();
}
sql(`update organizations set counsellor_seats = 8 where id = '${org}'`);
await go(op, "/settings/team");
await op.getByTestId("member-uk.docs@medcity.test").getByRole("button", { name: /^Switch on/ }).click();
await op.waitForTimeout(1500);
check(sql(`select active from users where id = '${ukDocs}'`) === "t", "switch on: back on");

// Reset a password.
await go(op, "/settings/team");
const row = op.getByTestId(`member-${email}`);
await row.getByText("Details and password").click();
await row.getByRole("button", { name: "New password for New Counsellor" }).click();
check(await op.getByText(new RegExp(`One-time password for ${email.replace(".", "\\.")}: \\S+\\. They are signed out`)).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "reset: a one-time password, shown once");

// The branch head corrects a counsellor's name, email and department.
// Written after the owner found nobody could fix a misspelt name without
// making a new account.
const newId = sql(`select id from users where email = '${email}'`);
const renamed = `renamed.counsellor${Date.now() % 100000}@medcity.test`;
await go(op, "/settings/team");
await hydrated(op);
const member = op.getByTestId(`member-${email}`);
await member.getByText("Details and password").click();
await member.locator(`#email-${newId}`).fill("UK.DOCS@medcity.test");
await member.getByRole("button", { name: "Save details" }).click();
check(await member.getByText("Someone already signs in with that email.").waitFor({ timeout: 10000 }).then(() => true, () => false), "edit: an email already in use is refused, whatever its case");
await member.locator(`#name-${newId}`).fill("Renamed Counsellor");
await member.locator(`#email-${newId}`).fill(renamed);
await member.locator(`#dept-${newId}`).selectOption("Ausbildung");
await member.getByRole("button", { name: "Save details" }).click();
check(await toast(op, /now signs in with/), "edit: the save says they now sign in with the new address");
check(sql(`select name || '|' || email || '|' || coalesce(department, '') from users where id = '${newId}'`) === `Renamed Counsellor|${renamed}|Ausbildung`, "edit: name, email and department saved on the same account");
check(sql(`select count(*) from audit_logs where action = 'team.edit' and entity_id = '${newId}'`) === "1", "edit: audited");
check(sql(`select count(*) from notifications where user_id = '${newId}' and title = 'Your sign-in email changed'`) === "1", "edit: the counsellor is told their sign-in email changed");
const oldTry = await signIn(email, "10.105.1.7");
check(/\/login/.test(oldTry.page.url()), "edit: the old email no longer signs in");
await oldTry.ctx.close();

// The department shows on the row and the list filters by it.
let shown = await go(op, "/settings/team");
check((await op.getByTestId(`member-${renamed}`).innerText()).includes("Ausbildung"), "department: shown on the row");
await op.locator("#department-filter").selectOption("Ausbildung");
await op.locator("[data-department-filter]").getByRole("button", { name: "Show" }).click();
await op.waitForURL(/department=Ausbildung/, { timeout: 10000 }).catch(() => {});
await hydrated(op);
check((await op.getByTestId(`member-${renamed}`).count()) === 1 && (await op.getByTestId("member-uk.docs@medcity.test").count()) === 0, "department: the filter keeps the people in it and drops the rest");

// A branch head cannot move anybody, and cannot edit somebody at another branch.
shown = await go(op, "/settings/team");
check(!/Move to another branch/.test(shown), "access: the branch head is not offered a move");
const partnersPage = await op.goto(`${BASE}/admin/partners`);
await hydrated(op);
check(/\/forbidden/.test(op.url()) || partnersPage.status() >= 400 || !/Partners and people/.test(await main(op)), "access: the branch head cannot open the head office's people screen");
const elsewhere = sql("select id from users where email = 'staff@horizon.test'");
const elsewhereName = sql(`select name from users where id = '${elsewhere}'`);
await go(op, "/settings/team");
await hydrated(op);
const mine = op.getByTestId(`member-${renamed}`);
await mine.getByText("Details and password").click();
// The form is pointed at somebody else's counsellor, which a browser of the
// screen cannot do but a request can.
const editForm = mine.locator("form").filter({ has: op.getByRole("button", { name: "Save details" }) });
await editForm.locator('input[name="userId"]').evaluate((el, id) => { el.value = id; }, elsewhere);
await mine.locator(`#name-${newId}`).fill("Should Not Change");
await mine.getByRole("button", { name: "Save details" }).click();
check(await mine.getByText("That person is not a counsellor in your branch.").waitFor({ timeout: 10000 }).then(() => true, () => false), "access: editing another branch's person is refused");
check(sql(`select name from users where id = '${elsewhere}'`) === elsewhereName, "access: and nothing changed on them");

// Counsellors cannot manage the team; other branches cannot see it.
const c2 = await signIn("germany@medcity.test", "10.105.1.5");
const res = await c2.page.goto(`${BASE}/settings/team`);
check(res.status() >= 300 || !/Your team/.test(await c2.page.locator("main").innerText()), "access: counsellors cannot open Team");
const kochi = await signIn("kochi@medcity.test", "10.105.1.6");
text = await go(kochi.page, "/settings/team");
check(!/New Counsellor/.test(text) && !/uk\.docs/.test(text), "access: another branch sees only its own team");

for (const [who, e] of [["owner", owner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
