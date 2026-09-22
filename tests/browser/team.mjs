// Branch team management: the owner adds counsellors within the tier's seats
// (one-time password, forced change), switches one off (students move to the
// owner, sign-in ends at once) and back on, resets a password, and nobody
// else can reach it. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-team";
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


sql("delete from users where email like 'new.counsellor%@medcity.test'; update users set active = true where email = 'uk.docs@medcity.test'; update organizations set counsellor_seats = 8 where name = 'Medcity Kottayam'");
const org = sql("select id from organizations where name = 'Medcity Kottayam'");
const ukDocs = sql("select id from users where email = 'uk.docs@medcity.test'");
const before = Number(sql(`select count(*) from students where assigned_to_id = '${ukDocs}'`));

// A counsellor signed in, to see them lose access.
const counsellor = await signIn("uk.docs@medcity.test", "10.105.1.3");
const owner = await signIn("kottayam@medcity.test", "10.105.1.1");
const op = owner.page;
let text = await go(op, "/settings/team");
check(/3 of 8 seats in use/.test(text) && /Owner/.test(text), "team: seats and people listed");

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
await op.waitForLoadState("networkidle");
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

// Seats: full means no add and no switching back on.
sql(`update organizations set counsellor_seats = (select count(*) from users where org_id = '${org}' and active and role in ('PARTNER','COUNSELLOR')) where id = '${org}'`);
text = await go(op, "/settings/team");
check(/Every seat is in use/.test(text) && (await op.getByRole("button", { name: "Add counsellor" }).count()) === 0 && /No seat free/.test(text), "seats: full means no add and no switch back on");
sql(`update organizations set counsellor_seats = 8 where id = '${org}'`);
await go(op, "/settings/team");
await op.getByTestId("member-uk.docs@medcity.test").getByRole("button", { name: /^Switch on/ }).click();
await op.waitForTimeout(1500);
check(sql(`select active from users where id = '${ukDocs}'`) === "t", "switch on: back when a seat is free");

// Reset a password.
await go(op, "/settings/team");
const row = op.getByTestId(`member-${email}`);
await row.getByText("Desk and password").click();
await row.getByRole("button", { name: "New password for New Counsellor" }).click();
check(await op.getByText(new RegExp(`One-time password for ${email.replace(".", "\\.")}: \\S+\\. They are signed out`)).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "reset: a one-time password, shown once");

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
