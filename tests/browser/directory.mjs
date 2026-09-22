// Contacts, quick links and promotional schemes: the team's contact list
// with its rules and levels, links, schemes with dates and destinations, who
// is told, the partner pages and dashboard cards, and the owner's commission
// switch. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-directory";
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


const iso = (d) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
sql("delete from notifications where title like 'New scheme:%'; delete from promotions; delete from team_contacts where name like 'Test %'; delete from quick_links where label like 'Test %'; update organizations set counsellors_see_commission = true");

// --- Admin: a contact, a link and a scheme.
const admin = await signIn("admin@medcityoverseas.test", "10.100.1.1");
const ap = admin.page;
await go(ap, "/admin/contacts");
await ap.waitForLoadState("networkidle");
const newC = ap.locator("form").filter({ has: ap.getByRole("button", { name: "Add contact" }) });
await newC.locator('[name="area"]').fill("Visa");
await newC.locator('[name="name"]').fill("Test Visa Officer");
await newC.getByRole("button", { name: "Add contact" }).click();
check(await newC.getByText("Give a phone number or an email").waitFor({ timeout: 10000 }).then(() => true, () => false), "contacts: needs a phone or an email");
await newC.locator('[name="phone"]').fill("+91 90000 00009");
await newC.locator('[name="whatsapp"]').check();
await newC.getByRole("button", { name: "Add contact" }).click();
await toast(ap, /Contact added/);
const cid = sql("select id from team_contacts where name = 'Test Visa Officer'");
check(!!cid, "contacts: added");
await go(ap, `/admin/contacts?edit=${cid}`);
await ap.waitForLoadState("networkidle");
const editC = ap.locator("li").filter({ hasText: "Test Visa Officer" }).locator("form").filter({ has: ap.getByRole("button", { name: "Save contact" }) });
await editC.locator('[name="title"]').fill("Visa desk");
await editC.getByRole("button", { name: "Save contact" }).click();
await toast(ap, /Contact updated/);
check(sql(`select title from team_contacts where id = '${cid}'`) === "Visa desk", "contacts: edited");

const ql = ap.locator("form").filter({ has: ap.getByRole("button", { name: "Add link" }) });
await ql.locator('[name="label"]').fill("Test Canada study permit");
await ql.locator('[name="url"]').fill("http://www.canada.ca/study");
await ql.getByRole("button", { name: "Add link" }).click();
check(await ql.getByText("A full https:// address").waitFor({ timeout: 10000 }).then(() => true, () => false), "links: only https");
await ql.locator('[name="url"]').fill("https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html");
await ql.getByRole("button", { name: "Add link" }).click();
await toast(ap, /Link added/);

// Kottayam hides commission from counsellors before the scheme goes out.
sql("update organizations set counsellors_see_commission = false where name = 'Medcity Kottayam'");
await go(ap, "/admin/promotions");
await ap.waitForLoadState("networkidle");
await ap.locator('[name="title"]').fill("UK January push");
await ap.locator('[name="summary"]').fill("₹10,000 extra per UK January visa");
await ap.locator('[name="terms"]').fill("Applies to visas granted for the January 2027 intake at UK universities with a commission rule. Paid with the regular commission.");
await ap.locator('[name="startsOn"]').fill(iso(-1));
await ap.locator('[name="endsOn"]').fill(iso(-3));
await ap.getByRole("button", { name: "Publish scheme" }).click();
check(await ap.getByText("It cannot end before it starts").waitFor({ timeout: 10000 }).then(() => true, () => false), "schemes: end before start refused");
await ap.locator('[name="endsOn"]').fill(iso(9));
await ap.locator("label").filter({ hasText: /^\s*United Kingdom$/ }).locator("input").check();
await ap.getByRole("button", { name: "Publish scheme" }).click();
await toast(ap, /Published/);
check(sql("select countries[1] from promotions where title = 'UK January push'") === "GB", "schemes: published with its destination");
const told = (email) => sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = '${email}' and n.title = 'New scheme: UK January push'`);
check(told("kottayam@medcity.test") === "1" && told("kochi@medcity.test") === "1", "schemes: owners are told");
check(told("uk.docs@medcity.test") === "0", "schemes: a counsellor kept away from commission is not told");
sql(`insert into promotions (id, title, summary, terms, starts_on, ends_on) values ('test-old', 'Spring bonus', 'Old scheme', 'Old terms for the spring intake', '${iso(-60)}', '${iso(-30)}')`);

// --- Partner.
const partner = await signIn("kottayam@medcity.test", "10.100.1.2");
const pp = partner.page;
let text = await go(pp, "/contacts");
check(/UK admissions/.test(text) && /Visa/.test(text) && /Test Visa Officer/.test(text) && /First call/.test(text) && /WhatsApp/.test(text), "contacts page: grouped, with level and WhatsApp");
check(/Test Canada study permit/.test(text) && /UK Student visa/.test(text), "contacts page: quick links");
sql(`update team_contacts set active = false where id = '${cid}'`);
text = await go(pp, "/contacts");
check(!/Test Visa Officer/.test(text), "contacts page: a hidden contact is gone");
text = await go(pp, "/promotions");
check(/UK January push/.test(text) && /₹10,000 extra per UK January visa/.test(text) && /10 days left/.test(text) && /Paid with the regular commission/.test(text), "schemes page: running scheme with days left and terms");
check(/Ended in the last year/.test(text) && /Spring bonus/.test(text), "schemes page: past schemes");
text = await go(pp, "/dashboard");
check(/Schemes running/.test(text) && /UK January push/.test(text) && /Quick links/.test(text), "dashboard: schemes and quick links");

const counsellor = await signIn("uk.docs@medcity.test", "10.100.1.3");
await counsellor.page.goto(`${BASE}/promotions`);
await counsellor.page.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {});
check(/\/dashboard/.test(counsellor.page.url()), "schemes page: follows the owner's commission switch");
text = await go(counsellor.page, "/contacts");
check(/UK admissions/.test(text), "contacts page: open to counsellors");
sql("update organizations set counsellors_see_commission = true");

// Withdrawn schemes disappear.
await go(ap, "/admin/promotions");
await ap.waitForLoadState("networkidle");
await ap.locator("li").filter({ hasText: "UK January push" }).getByRole("button", { name: "Withdraw" }).click();
await ap.locator("li").filter({ hasText: "UK January push" }).getByRole("button", { name: "Republish" }).waitFor({ timeout: 10000 }).catch(() => {});
text = await go(pp, "/promotions");
check(!/UK January push/.test(text), "schemes: withdrawn is gone");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors], ["counsellor", counsellor.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
