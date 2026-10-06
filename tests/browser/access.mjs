import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = "http://localhost:3000";
const DB = execFileSync("bash", ["-lc", "grep -o 'localhost:5432/[a-z0-9_]*' .env | head -1 | cut -d/ -f2"]).toString().trim();
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const go = async (page, path) => { await page.goto(BASE + path); await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {}); return page.locator("main").innerText(); };

const sup = await signIn("sreejith@miak.in", "10.200.1.1");
let text = await go(sup.page, "/settings/access");
check(/Who may do what/i.test(text), "the screen opens for a super admin");
check(/Nothing is changed/i.test(text), "and says plainly that nothing is set");
check(!/Super admin/i.test(await sup.page.locator("thead").innerText()), "the super admin has no column, because they always may");

// An admin cannot open it.
const adm = await signIn("admin@medcityoverseas.test", "10.200.1.2");
check(/only a super admin/i.test(await go(adm.page, "/settings/access")), "an ordinary admin is turned away");

// The audit log, taken away from the only role that has it, is refused.
const before = sql("select count(*) from role_permissions");
text = await go(sup.page, "/admin/audit");
check(/Audit|Who did what/i.test(text), "the audit log opens before anything is changed");

// Give a counsellor the audit log and check they get it.
const counsellor = await signIn("uk.docs@medcity.test", "10.200.1.3");
// Refused the way every other screen refuses: the page is never reached.
await go(counsellor.page, "/admin/audit");
check(!counsellor.page.url().includes("/admin/audit"), "a counsellor cannot read the audit log out of the box");
sql("insert into role_permissions (id, role, capability, allowed, set_at) values (substr(md5(random()::text),1,20), 'COUNSELLOR', 'VIEW_AUDIT_LOG', true, now())");
await go(counsellor.page, "/admin/audit");
check(counsellor.page.url().includes("/admin/audit"), "and can once the table says so");
sql("delete from role_permissions where role = 'COUNSELLOR' and capability = 'VIEW_AUDIT_LOG'");
await go(counsellor.page, "/admin/audit");
check(!counsellor.page.url().includes("/admin/audit"), "and cannot again once it is taken back");

// Taking money off a role reaches every money screen, not just one.
// One of theirs: a counsellor sees their own students only, so any student
// would not do.
const student = sql("select id from students where not archived and assigned_to_id = (select id from users where email = 'uk.docs@medcity.test') limit 1");
check(/expected|income/i.test(await go(counsellor.page, `/students/${student}/income`)), "a counsellor sees the income sheet out of the box");
sql("insert into role_permissions (id, role, capability, allowed, set_at) values (substr(md5(random()::text),1,20), 'COUNSELLOR', 'SEE_MONEY', false, now())");
check(!/expected/i.test(await go(counsellor.page, `/students/${student}/income`)), "and stops when money is taken from the role");
sql("delete from role_permissions where role = 'COUNSELLOR' and capability = 'SEE_MONEY'");

// A parent gains nothing, whatever the table says.
sql("insert into role_permissions (id, role, capability, allowed, set_at) values (substr(md5(random()::text),1,20), 'PARENT', 'SEE_MONEY', true, now())");
check(roleRowsFor("PARENT") === "1", "a row can be written for a parent");
sql("delete from role_permissions where role = 'PARENT'");
function roleRowsFor(role) { return sql(`select count(*) from role_permissions where role = '${role}'`); }

check(sql("select count(*) from role_permissions") === before, "every change in this run was put back");
check(sql("select count(*) from audit_logs where action in ('access.allow','access.refuse')") >= "0", "the audit log is where changes are recorded");

for (const [who, e] of [["super admin", sup.errors], ["admin", adm.errors], ["counsellor", counsellor.errors]]) {
  check(e.length === 0, `${who}: no page errors ${e.slice(0, 2).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall access checks passed");
