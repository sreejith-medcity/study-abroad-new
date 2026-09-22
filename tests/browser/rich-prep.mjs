// Rich text comments and the branch test preparation page: the format bar,
// what renders and what stays text, notification previews, prep courses and
// their rules, the owner's switch, and an enquiry from the page. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-rich-prep";
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


sql("delete from prep_courses; update organizations set prep_page_enabled = false");
const org = sql("select id from organizations where name = 'Medcity Kottayam'");
const slug = sql(`select public_slug from organizations where id = '${org}'`);

// --- Rich text comments.
const owner = await signIn("kottayam@medcity.test", "10.102.1.1");
const op = owner.page;
const sid = sql("select id from students where first_name = 'Arathi'");
const app = sql(`select id from applications where student_id = '${sid}' limit 1`);
await go(op, `/students/${sid}/applications?app=${app}`);
await op.waitForLoadState("networkidle");
const box = op.locator("#body-TEAM");
await op.locator("form").filter({ has: box }).getByRole("button", { name: "Bold" }).click();
check((await box.inputValue()) === "**bold**", "format bar: bold inserts its markers");
await box.fill("**Urgent**: please check *today*\n- passport\n- <b>not html</b>\n\nSee https://www.gov.uk/student-visa");
await op.locator("form").filter({ has: box }).getByRole("button", { name: "Post comment" }).click();
await toast(op, /Comment posted/);
await go(op, `/students/${sid}/applications?app=${app}`);
const thread = op.locator("main");
check(await thread.locator("strong", { hasText: "Urgent" }).count() >= 1 && await thread.locator("em", { hasText: "today" }).count() >= 1, "comment: bold and italic render");
check(await thread.locator("li").filter({ hasText: /^passport$/ }).count() >= 1 && await thread.locator("li").filter({ hasText: /^<b>not html<\/b>$/ }).count() >= 1 && await thread.locator("b", { hasText: "not html" }).count() === 0, "comment: list items render, markup stays text");
check(await thread.locator('a[href="https://www.gov.uk/student-visa"][rel*="noopener"]').count() >= 1, "comment: links open safely");
const note = sql(`select body from notifications n join users u on u.id = n.user_id where n.title like 'New team comment%' order by n.created_at desc limit 1`);
check(!note || !note.includes("**"), "comment: notification preview without markers");

// --- Prep courses.
const admin = await signIn("admin@medcityoverseas.test", "10.102.1.2");
const ap = admin.page;
await go(ap, "/admin/prep");
await ap.waitForLoadState("networkidle");
await ap.locator('[name="test"]').selectOption("IELTS");
await ap.locator('[name="title"]').fill("IELTS Academic, evening batch");
await ap.locator('[name="summary"]').fill("All four modules with weekly mock tests on the practice platform.");
await ap.locator('[name="mode"]').fill("Online");
await ap.locator('[name="durationWeeks"]').fill("60");
await ap.locator('[name="feeInr"]').fill("12,500");
await ap.getByRole("button", { name: "Add course" }).click();
check(await ap.getByText("Whole weeks, up to 52").waitFor({ timeout: 10000 }).then(() => true, () => false), "prep: weeks checked");
await ap.locator('[name="durationWeeks"]').fill("6");
await ap.getByRole("button", { name: "Add course" }).click();
await toast(ap, /Course added/);
const cid = sql("select id from prep_courses where title = 'IELTS Academic, evening batch'");
check(sql(`select fee_inr from prep_courses where id = '${cid}'`) === "12500", "prep: fee stored in rupees");

const anon = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.102.1.9" } });
const pub = await anon.newPage();
let res = await pub.goto(`${BASE}/prep/${slug}`);
check(res.status() === 404, "prep page: off until the owner switches it on");

await go(op, "/settings/students");
await op.waitForLoadState("networkidle");
await op.getByRole("button", { name: "Switch the prep page on" }).click();
await op.getByRole("button", { name: "Switch the prep page off" }).waitFor({ timeout: 10000 }).catch(() => {});
check(new RegExp(`/prep/${slug}`).test(await op.locator("main").innerText()), "settings: the prep link is shown");

await pub.goto(`${BASE}/prep/${slug}`);
let text = await pub.locator("main").innerText();
check(/IELTS Academic, evening batch/.test(text) && /₹12,500/.test(text) && /6 weeks/.test(text), "prep page: the course with fee and length");
const tag = String(Date.now()).slice(-6);
await pub.fill('input[name="name"]', `Prep Student ${tag}`);
await pub.fill('input[name="phone"]', `+91 9${tag}222`);
await pub.check('input[name="consent"]');
await pub.click('button[type="submit"]');
check(await pub.getByText("Please choose a course").waitFor({ timeout: 10000 }).then(() => true, () => false), "prep page: a course must be chosen");
await pub.locator('select[name="prepCourse"]').selectOption(cid);
await pub.click('button[type="submit"]');
await pub.waitForURL(/\/prep\/.*\/thanks$/, { timeout: 20000 }).catch(() => {});
check(/\/thanks$/.test(pub.url()) && /batches and dates/.test(await pub.locator("main").innerText()), "prep page: thank-you page");
const enq = sql(`select answers::text || '|' || source from enquiries where name = 'Prep Student ${tag}'`);
check(enq.includes("IELTS Academic, evening batch (IELTS)") && enq.endsWith("|WEBSITE"), "prep page: enquiry with its course");
check(sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'kottayam@medcity.test' and n.title = 'New test prep enquiry'`) !== "0", "prep page: the branch is told");

await go(op, "/settings/students");
await op.waitForLoadState("networkidle");
await op.getByRole("button", { name: "Switch the prep page off" }).click();
await op.getByRole("button", { name: "Switch the prep page on" }).waitFor({ timeout: 10000 }).catch(() => {});
res = await pub.goto(`${BASE}/prep/${slug}`);
check(res.status() === 404, "prep page: gone once switched off");

for (const [who, e] of [["owner", owner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
