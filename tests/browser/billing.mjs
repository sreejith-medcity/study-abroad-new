// Billing companies and the owner's commission switch: adding companies
// with PAN, GSTIN and IFSC rules, the limit of four, editing without
// re-entering the account number, the default, a payout paid to a chosen
// company and what the team sees, removal rules, hiding commission from
// counsellors everywhere, and the commission structure page. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-billing";
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

sql("delete from payout_requests where billing_company_id is not null; delete from billing_companies; update organizations set counsellors_see_commission = true");

// --- Kochi's owner adds companies.
const owner = await signIn("kochi@medcity.test", "10.99.1.1");
const op = owner.page;
await go(op, "/settings/branch");
await op.waitForLoadState("networkidle");
const form = op.locator("#billing form").last();
const fill = async (v) => { for (const [name, value] of Object.entries(v)) await form.locator(`[name="${name}"]`).fill(value); };
await fill({ legalName: "Kochi Education Services LLP", state: "Kerala", address: "2nd Floor, MG Road, Kochi 682016", pan: "ABCDE12F", gstin: "32ABCDE9999F1Z5", bankAccountName: "Kochi Education Services LLP", bankAccountNumber: "123", ifsc: "SBIN1234567" });
await form.getByRole("button", { name: "Add company" }).click();
await form.getByText(/A PAN is five letters/).waitFor({ timeout: 10000 }).catch(() => {});
let text = await form.innerText();
check(/A PAN is five letters/.test(text) && /9 to 18 digits/.test(text) && /An IFSC is 11 characters/.test(text), "billing: PAN, account and IFSC rules");
await fill({ pan: "ABCDE1234F", bankAccountNumber: "001234567890", ifsc: "SBIN0001234" });
await form.getByRole("button", { name: "Add company" }).click();
await form.getByText(/different PAN/).waitFor({ timeout: 10000 }).catch(() => {});
check(/This GSTIN belongs to a different PAN/.test(await form.innerText()), "billing: GSTIN must carry the PAN");
await fill({ gstin: "32abcde1234f1z5", lutNumber: "AD320326000123X" });
await form.getByRole("button", { name: "Add company" }).click();
await form.getByText(/Enter the date the LUT runs to/).waitFor({ timeout: 10000 }).catch(() => {});
check(/Enter the date the LUT runs to/.test(await form.innerText()), "billing: an LUT needs its end date");
await form.locator('[name="lutValidUntil"]').fill("2027-03-31");
await form.getByRole("button", { name: "Add company" }).click();
await toast(op, /Company added/);
text = await go(op, "/settings/branch");
check(/Kochi Education Services LLP/.test(text) && /Default/.test(text) && /GST 32ABCDE1234F1Z5/.test(text) && /•••• 7890/.test(text) && !/001234567890/.test(text), "billing: listed as default, GSTIN upper-cased, account masked");
check(/LUT to/.test(text), "billing: LUT shown with its date");

// Three more reach the limit.
const org = sql("select id from organizations where name = 'Medcity Kochi'");
for (const n of [2, 3, 4]) sql(`insert into billing_companies (id, org_id, legal_name, address, state, pan, bank_account_name, bank_account_number, ifsc) values ('bc-test-${n}', '${org}', 'Second Company ${n}', 'Kochi', 'Kerala', 'ABCDE123${n}F', 'Second Company ${n}', '99988877${n}', 'HDFC0000123')`);
text = await go(op, "/settings/branch");
check(!/Add a billing company/.test(text) && !(await op.getByRole("button", { name: "Add company" }).count()), "billing: no way to add a fifth");

// Edit without re-entering the account number.
const first = sql("select id from billing_companies where legal_name = 'Kochi Education Services LLP'");
await go(op, `/settings/branch?edit=${first}#billing`);
await op.waitForLoadState("networkidle");
const edit = op.locator("#billing li").filter({ hasText: "Kochi Education Services LLP" }).locator("form").filter({ has: op.getByRole("button", { name: "Save company" }) });
await edit.locator('[name="legalName"]').fill("Kochi Education Services Private Limited");
await edit.getByRole("button", { name: "Save company" }).click();
await toast(op, /Company updated/);
check(sql(`select legal_name || '|' || bank_account_number from billing_companies where id = '${first}'`) === "Kochi Education Services Private Limited|001234567890", "billing: edit keeps the account number on file");

// Default moves.
await go(op, "/settings/branch");
await op.waitForLoadState("networkidle");
await op.locator("#billing li").filter({ hasText: "Second Company 2" }).getByRole("button", { name: "Make default" }).click();
await op.waitForTimeout(1500);
check(sql("select legal_name from billing_companies where is_default") === "Second Company 2", "billing: one default at a time");

// Payout to a chosen company.
await go(op, "/wallet");
await op.waitForLoadState("networkidle");
const payTo = op.getByLabel("Pay to");
check((await payTo.inputValue()) === "bc-test-2", "wallet: the default company is picked");
await payTo.selectOption(first);
await op.getByLabel("Amount (rupees)").fill("1000");
await op.getByRole("button", { name: "Request payout" }).click();
await toast(op, /Requested/);
check(sql("select billing_company_id from payout_requests where status = 'REQUESTED'") === first, "wallet: payout names the company");

// Used on a payout, it cannot be removed; an unused one can.
await go(op, "/settings/branch");
await op.waitForLoadState("networkidle");
await op.getByRole("button", { name: "Remove Kochi Education Services Private Limited" }).click();
await op.getByText(/stays for the record/).first().waitFor({ timeout: 10000 }).catch(() => {});
check(/stays for the record/.test(await main(op)), "billing: a company on a payout stays");
await op.getByRole("button", { name: "Remove Second Company 4" }).click();
await toast(op, /Second Company 4 removed/);
check(sql("select count(*) from billing_companies") === "3", "billing: an unused company is removed");

// The team sees where to pay.
const admin = await signIn("admin@medcityoverseas.test", "10.99.1.2");
text = await go(admin.page, "/admin/commission?tab=payouts");
check(/Kochi Education Services Private Limited/.test(text) && /GSTIN 32ABCDE1234F1Z5/.test(text) && /001234567890/.test(text) && /SBIN0001234/.test(text), "admin: payout shows the company, GSTIN and bank details");

// Other branches and counsellors cannot touch billing.
const kochiRow = sql(`select count(*) from billing_companies where org_id <> '${org}'`);
check(kochiRow === "0", "billing: nothing leaked to other branches");
const counsellor = await signIn("uk.docs@medcity.test", "10.99.1.3");
const cp = counsellor.page;
const r = await cp.goto(`${BASE}/settings/branch`);
check(r.status() >= 300 || !/Billing companies/.test(await main(cp)), "billing: counsellors cannot open branch billing");

// --- Owner hides commission from counsellors (Kottayam).
const kOwner = await signIn("kottayam@medcity.test", "10.99.1.4");
await go(kOwner.page, "/settings/branch");
await kOwner.page.waitForLoadState("networkidle");
await kOwner.page.getByRole("button", { name: "Hide commission from counsellors" }).click();
await kOwner.page.getByRole("button", { name: "Show commission to counsellors" }).waitFor({ timeout: 10000 }).catch(() => {});
check(sql("select counsellors_see_commission from organizations where name = 'Medcity Kottayam'") === "f", "switch: saved");
text = await go(cp, "/search?country=GB");
check(!/Your share|Commission:|Commission on offer|Highest commission/.test(text), "switch: search shows no commission to the counsellor");
const nav = await cp.locator("nav").first().innerText();
check(!/Wallet/.test(nav) && !/\bCommission\b/.test(nav), "switch: Money section gone from the counsellor's menu");
await cp.goto(`${BASE}/wallet`);
await cp.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {});
check(/\/dashboard/.test(cp.url()), "switch: the wallet sends the counsellor away");
await cp.goto(`${BASE}/commission/structure`);
await cp.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {});
check(/\/dashboard/.test(cp.url()), "switch: so does the commission structure");
text = await go(kOwner.page, "/search?country=GB");
check(/Your share|Commission:/.test(text), "switch: the owner still sees commission");
await go(kOwner.page, "/settings/branch");
await kOwner.page.waitForLoadState("networkidle");
await kOwner.page.getByRole("button", { name: "Show commission to counsellors" }).click();
await kOwner.page.getByRole("button", { name: "Hide commission from counsellors" }).waitFor({ timeout: 10000 }).catch(() => {});
text = await go(cp, "/search?country=GB");
check(/Your share|Commission:/.test(text), "switch: back on, the counsellor sees it again");

// --- Commission structure.
text = await go(kOwner.page, "/commission/structure");
check(/Commission structure/.test(text) && /United Kingdom/.test(text) && /7\.5% of first-year tuition/.test(text), "structure: the UK rule as the branch's own rate (50% of 15%)");
await go(kOwner.page, "/commission/structure?country=DE");
text = await kOwner.page.locator("table").innerText();
check(/Germany/.test(text) && !/United Kingdom/.test(text), "structure: filters by destination");
await kOwner.page.screenshot({ path: `${OUT}/structure.png`, fullPage: true });

for (const [who, e] of [["owner", owner.errors], ["counsellor", counsellor.errors], ["kottayam", kOwner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
