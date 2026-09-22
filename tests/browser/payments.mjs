// Online payments: the owner's Razorpay keys and their rules, a partner paying
// a due application fee (order created at a stand-in for Razorpay's API), the
// signed webhook marking it paid once, the lists, and the switch. Wants the
// plain seed and the server started with RAZORPAY_API_BASE=http://localhost:4010.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createHmac } from "node:crypto";

const OUT = "/tmp/smoke-payments";
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


// A stand-in for Razorpay's Orders API. The app must run with RAZORPAY_API_BASE=http://localhost:4010.
const seen = [];
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `order_test${String(seen.length).padStart(6, "0")}`, status: "created" }));
  });
});
await new Promise((r) => mock.listen(4010, r));

const sid = sql("select id from students where first_name = 'Arathi'");
const app = sql(`select a.id from applications a where a.student_id = '${sid}' limit 1`);
const prog = sql(`select program_id from applications where id = '${app}'`);
const cur = sql(`select c.currency from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where p.id = '${prog}'`);
sql(`delete from payments; delete from payment_settings; update programs set application_fee = 50 where id = '${prog}'; update applications set fee_status = 'DUE' where id = '${app}'; delete from notifications where title like '%paid online'`);

// --- The platform owner sets the keys.
const owner = await signIn("sreejith@miak.in", "10.103.1.1");
const sp = owner.page;
await go(sp, "/settings/platform");
await sp.waitForLoadState("networkidle");
const form = sp.locator("#payments form");
await form.locator('[name="razorpayKeyId"]').fill("pk_live_123");
await form.locator('[name="keySecret"]').fill("test_secret_value");
await form.locator('[name="webhookSecret"]').fill("hook_secret_value");
await form.locator('[name="enabled"]').check();
await form.getByRole("button", { name: "Save payment settings" }).click();
check(await form.getByText(/starts rzp_test_ or rzp_live_/).waitFor({ timeout: 10000 }).then(() => true, () => false), "settings: key id format checked");
await form.locator('[name="razorpayKeyId"]').fill("rzp_test_AbCdEf123456");
await form.getByRole("button", { name: "Save payment settings" }).click();
await toast(sp, /Online payments are on/);
const stored = sql("select razorpay_key_id || '|' || razorpay_key_secret_enc from payment_settings");
check(stored.startsWith("rzp_test_AbCdEf123456|v1.") && !stored.includes("test_secret_value"), "settings: secret sealed, never stored plain");
await go(sp, "/settings/platform");
check(!(await sp.content()).includes("test_secret_value"), "settings: the secret never comes back to the page");

// --- A partner pays a due fee.
const partner = await signIn("kottayam@medcity.test", "10.103.1.2");
const pp = partner.page;
await go(pp, `/students/${sid}/applications?app=${app}`);
await pp.waitForLoadState("networkidle");
const payBtn = pp.getByRole("button", { name: `Pay ${cur} 50 online` });
check(await payBtn.count() === 1, "application: pay button on a due fee");
await payBtn.click();
await pp.locator('[role="status"]').first().waitFor({ timeout: 15000 }).catch(() => {});
check(seen.length === 1 && seen[0].url === "/v1/orders" && seen[0].body.amount === 5000 && seen[0].body.currency === cur, `order: fee sent in ${cur} minor units`);
check(seen[0]?.auth === `Basic ${Buffer.from("rzp_test_AbCdEf123456:test_secret_value").toString("base64")}`, "order: signed with the key id and secret");
const orderId = sql(`select razorpay_order_id || '|' || status from payments where application_id = '${app}'`);
check(orderId === "order_test000001|CREATED", "order: recorded as not yet paid");

// --- Razorpay's webhook.
const hook = (event, extra = {}) => JSON.stringify({ event, payload: { payment: { entity: { id: "pay_test000001", order_id: "order_test000001", ...extra } } } });
const post = (body, sig) => pp.request.post(`${BASE}/api/razorpay/webhook`, { data: body, headers: { "content-type": "application/json", "x-razorpay-signature": sig } });
let res = await post(hook("payment.captured"), "0".repeat(64));
check(res.status() === 401, "webhook: a bad signature is refused");
check(sql(`select fee_status from applications where id = '${app}'`) === "DUE", "webhook: nothing changes on a bad signature");
const good = hook("payment.captured");
const sig = createHmac("sha256", "hook_secret_value").update(good).digest("hex");
res = await post(good, sig);
check(res.status() === 200, "webhook: a signed capture is accepted");
check(sql(`select status || '|' || razorpay_payment_id from payments where application_id = '${app}'`) === "PAID|pay_test000001", "webhook: payment marked paid");
check(sql(`select fee_status from applications where id = '${app}'`) === "PAID", "webhook: the fee is marked paid");
await post(good, sig);
check(sql("select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'kottayam@medcity.test' and n.title like '%paid online'") === "1", "webhook: a replay does not tell anyone twice");

let text = await go(pp, "/wallet");
check(/Paid online/.test(text) && new RegExp(`${cur} 50\\.00`).test(text), "wallet: the payment is listed");
const admin = await signIn("admin@medcityoverseas.test", "10.103.1.3");
text = await go(admin.page, "/admin/payments");
check(/Medcity Kottayam/.test(text) && /Paid/.test(text) && /pay_test000001/.test(text), "admin: online payments list");
text = await go(pp, `/students/${sid}/applications?app=${app}`);
check(!/online$/m.test(text) && /Paid/.test(text), "application: paid, no pay button");

// --- Switched off, the button goes.
sql(`update applications set fee_status = 'DUE' where id = '${app}'; update payment_settings set enabled = false`);
await go(pp, `/students/${sid}/applications?app=${app}`);
check(await pp.getByRole("button", { name: /online$/ }).count() === 0, "switch: no pay button when payments are off");

mock.close();
for (const [who, e] of [["owner", owner.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
