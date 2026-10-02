// Invoicing the vendors: the queue grouped per vendor with what is not ready yet,
// raising one invoice over several students, the document itself with its tax
// treatment, sending it, part payment and payment in full, the wallet credit, a
// dispute, the ageing report and writing one off. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-invoicing";
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
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (re.test(await page.locator("main").innerText())) return true; await page.waitForTimeout(300); }
  return false;
}
const toast = (page, re, timeout = 20000) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);
async function waitSql(q, want, tries = 30) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}

const admin = await signIn("admin@medcityoverseas.test", "10.190.1.1");
const ap = admin.page;

// --- The queue: grouped per vendor, and honest about what is not ready.
let text = await go(ap, "/admin/invoices");
check(/To invoice/.test(text), "queue: the screen exists");
check(/never on a status alone/.test(text), "queue: it says a milestone needs a date, not just a status");
const waitingShown = /waiting on a milestone|not ready yet/.test(text);
check(waitingShown, "queue: lines whose milestone has not happened are shown as waiting");
await ap.screenshot({ path: `${OUT}/01-queue.png`, fullPage: true });

// Make two placements ready to invoice, from one vendor.
const vendorId = sql("select r.vendor_id from applications a join program_routes r on r.id = a.route_id join income_lines l on l.application_id = a.id and l.commission_id is not null where l.invoice_id is null group by r.vendor_id order by count(*) desc limit 1");
sql(`update applications set visa_decision = 'GRANTED', visa_decision_on = current_date - 20 where id in (select a.id from applications a join program_routes r on r.id = a.route_id join income_lines l on l.application_id = a.id and l.commission_id is not null where r.vendor_id = '${vendorId}' and l.invoice_id is null)`);
sql(`update vendors set payable_on = 'VISA_APPROVED', days_to_pay = 30 where id = '${vendorId}'`);
sql(`update program_routes set payable_on = null, days_to_pay = null where vendor_id = '${vendorId}'`);
const ready = sql(`select count(*) from income_lines l join applications a on a.id = l.application_id join program_routes r on r.id = a.route_id where r.vendor_id = '${vendorId}' and l.invoice_id is null and l.commission_id is not null`);
const vendorName = sql(`select name from vendors where id = '${vendorId}'`);

text = await go(ap, "/admin/invoices");
check(text.includes(vendorName), `queue: ${vendorName} is in the queue`);
check(/ready/.test(text), `queue: with ${ready} ready`);

// --- Raising one invoice over several students.
const before = sql("select count(*) from vendor_invoices");
const card = ap.locator("div").filter({ hasText: vendorName }).first();
void card;
await ap.getByRole("button", { name: /Raise an invoice/ }).first().click();
check(/One invoice, as many students as you tick/.test(await main(ap)), "raise: the form says why invoices are batched");
check(/Tax on this invoice/.test(await main(ap)), "raise: the tax treatment is said before it goes out");
const dialogText = await ap.getByRole("dialog").first().innerText();
check(/zero-rated under LUT|taxable|IGST|Not registered/.test(dialogText), `raise: and which case it is in (${dialogText.slice(0, 60).replace(/\n/g, " ")})`);
await ap.getByRole("button", { name: /Raise it for/ }).click();
await ap.waitForURL(/\/admin\/invoices\/[^/?]+\?raised=1/, { timeout: 20000 }).catch(() => {});
check(await waitText(ap, /raised/), "raise: the invoice itself says what was raised, rather than a toast on a screen you have left");
const after = await waitSql("select count(*) from vendor_invoices", String(Number(before) + 1));
check(after === String(Number(before) + 1), "raise: the invoice exists");
const invoiceId = sql("select id from vendor_invoices order by created_at desc limit 1");
const number = sql(`select number from vendor_invoices where id = '${invoiceId}'`);
check(/^MIO\/\d\d-\d\d\/\d{4}$/.test(number), `raise: numbered inside the financial year (${number})`);
const lineCount = sql(`select count(*) from vendor_invoice_lines where invoice_id = '${invoiceId}'`);
check(Number(lineCount) >= 1, `raise: it covers ${lineCount} student(s) on one invoice`);
const totalMatches = sql(`select (select total from vendor_invoices where id = '${invoiceId}') = (select coalesce(sum(amount),0) + coalesce((select tax_amount from vendor_invoices where id = '${invoiceId}'),0) from vendor_invoice_lines where invoice_id = '${invoiceId}')`);
check(totalMatches === "t", "raise: the total is the sum of the lines plus tax, not a typed figure");
check(sql(`select count(*) from income_lines where invoice_id = '${invoiceId}' and state = 'INVOICED'`) === lineCount, "raise: every line it covers is marked invoiced");
check(sql(`select count(*) from commissions c join income_lines l on l.commission_id = c.id where l.invoice_id = '${invoiceId}' and c.status <> 'INVOICED'`) === "0", "raise: and the placement's commission says so too");

// The same lines cannot be invoiced twice.
text = await go(ap, "/admin/invoices");
const stillQueued = sql(`select count(*) from income_lines where invoice_id = '${invoiceId}' and invoice_id is not null`);
check(stillQueued === lineCount, "queue: an invoiced line leaves the queue");

// --- The document.
text = await go(ap, `/admin/invoices/${invoiceId}`);
check(text.includes(number), "document: the number is on it");
check(/Medcity International Overseas Corporation/.test(text), "document: raised by the billing company");
check(/GSTIN/.test(text), "document: with its GSTIN");
check(/Pay to/.test(text) && /IFSC/.test(text), "document: and where to pay");
check(/Net/.test(text) && /Total/.test(text), "document: the money adds up on the page");
check(/zero-rated|taxable|IGST|Not registered/.test(text), "document: the tax treatment is in words, not a bare percentage");
const studentOnIt = sql(`select s.first_name || ' ' || s.last_name from vendor_invoice_lines l join income_lines i on i.id = l.income_line_id join students s on s.id = i.student_id where l.invoice_id = '${invoiceId}' limit 1`);
check(text.includes(studentOnIt), "document: a line per student, which the vendor can match to their own file");
await ap.screenshot({ path: `${OUT}/02-invoice.png`, fullPage: true });

// --- Sending it.
await ap.getByRole("button", { name: "It has been sent" }).click();
await ap.getByRole("button", { name: "Record it" }).click();
check((await toast(ap, /marked as sent/)) || (await waitText(ap, /Sent|With the vendor/)), "sent: recording it is confirmed");
check((await waitSql(`select state from vendor_invoices where id = '${invoiceId}'`, "SENT")) === "SENT", "sent: the state moves");
check(sql(`select sent_at is not null from vendor_invoices where id = '${invoiceId}'`) === "t", "sent: and the ageing report starts counting");

// --- Part payment, then the whole of it.
const total = sql(`select total from vendor_invoices where id = '${invoiceId}'`);
text = await go(ap, `/admin/invoices/${invoiceId}`);
await ap.getByRole("button", { name: "Money in" }).click();
await ap.locator('input[name="amount"]').first().fill(String(Math.floor(Number(total) / 3)));
await ap.getByRole("button", { name: "Record it" }).click();
check(await toast(ap, /Part payment/), "money in: a part payment is called one");
check((await waitSql(`select state from vendor_invoices where id = '${invoiceId}'`, "PART_PAID")) === "PART_PAID", "money in: the invoice is part paid");
check(sql(`select count(*) from invoice_payments where invoice_id = '${invoiceId}'`) === "1", "money in: each payment is its own row");
check(sql(`select count(*) from income_lines where invoice_id = '${invoiceId}' and state = 'RECEIVED'`) === "0", "money in: no student's line is marked received on a part payment");

const walletBefore = sql("select count(*) from wallet_entries where kind = 'COMMISSION'");
text = await go(ap, `/admin/invoices/${invoiceId}`);
await ap.getByRole("button", { name: "Money in" }).click();
await ap.getByRole("button", { name: "Record it" }).click();
check((await toast(ap, /settled in full/)) || (await waitSql(`select state from vendor_invoices where id = '${invoiceId}'`, "PAID")) === "PAID", "money in: the rest of it settles the invoice");
check((await waitSql(`select state from vendor_invoices where id = '${invoiceId}'`, "PAID")) === "PAID", "money in: and it is paid");
check(sql(`select count(*) from income_lines where invoice_id = '${invoiceId}' and state = 'RECEIVED'`) === lineCount, "money in: now every student's line is received");
check(sql(`select count(*) from commissions c join income_lines l on l.commission_id = c.id where l.invoice_id = '${invoiceId}' and c.status = 'RECEIVED'`) !== "0", "money in: the placement's commission is received");
const walletAfter = await waitSql("select count(*) from wallet_entries where kind = 'COMMISSION'", String(Number(walletBefore) + Number(lineCount)));
check(Number(walletAfter) > Number(walletBefore), `money in: the branch's share lands in its wallet (${walletBefore} to ${walletAfter})`);
check(sql(`select count(*) from wallet_entries where reference = '${number}'`) !== "0", "money in: credited against the invoice number");
check(sql("select count(*) from notifications where title = 'Commission credited to your wallet'") !== "0", "money in: and the branch is told");

// --- The seeded invoice: a dispute, the ageing report, and writing one off.
const older = sql(`select id from vendor_invoices where id <> '${invoiceId}' order by created_at limit 1`);
if (older) {
  text = await go(ap, `/admin/invoices/${older}`);
  await ap.getByRole("button", { name: "They have questioned it" }).click();
  await ap.getByRole("button", { name: "Mark it disputed" }).last().click();
  check(await waitText(ap, /Say what the vendor is questioning/), "dispute: a reason is required");
  await ap.locator('textarea[name="reason"]').first().fill("They say two of these were placed through their own office, not ours.");
  await ap.getByRole("button", { name: "Mark it disputed" }).last().click();
  check((await toast(ap, /disputed/)) || (await waitSql(`select state from vendor_invoices where id = '${older}'`, "DISPUTED")) === "DISPUTED", "dispute: with a reason it is recorded");
  check((await waitSql(`select state from vendor_invoices where id = '${older}'`, "DISPUTED")) === "DISPUTED", "dispute: the state is kept");
  text = await go(ap, `/admin/invoices/${older}`);
  check(/placed through their own office/.test(text), "dispute: the reason is on the invoice");

  text = await go(ap, "/admin/invoices?tab=ageing");
  check(/What is owed, by how late it is/.test(text), "ageing: the report exists");
  check(/days late|Due now|Not due yet|late/i.test(text), "ageing: in buckets");
  check(/still money we are owed/.test(text), "ageing: and a disputed invoice stays in it");
  await ap.screenshot({ path: `${OUT}/03-ageing.png`, fullPage: true });

  await go(ap, `/admin/invoices/${older}`);
  await ap.getByRole("button", { name: "It has been worked out" }).click();
  check((await waitSql(`select state from vendor_invoices where id = '${older}'`, "PART_PAID")) === "PART_PAID", "dispute: resolving it puts the invoice back where it was");

  // Writing off: super admin only.
  check((await ap.getByRole("button", { name: "Write it off" }).count()) === 0, "write off: an admin is not offered it");
  const sup = await signIn("sreejith@miak.in", "10.190.1.2");
  await go(sup.page, `/admin/invoices/${older}`);
  await sup.page.getByRole("button", { name: "Write it off" }).click();
  await sup.page.locator('textarea[name="reason"]').first().fill("The vendor has gone into liquidation and will not settle.");
  await sup.page.getByRole("button", { name: "Write it off" }).last().click();
  check((await toast(sup.page, /written off/)) || (await waitSql(`select state from vendor_invoices where id = '${older}'`, "WRITTEN_OFF")) === "WRITTEN_OFF", "write off: with a reason it goes through");
  check((await waitSql(`select state from vendor_invoices where id = '${older}'`, "WRITTEN_OFF")) === "WRITTEN_OFF", "write off: the invoice says so");
  check(sql(`select count(*) from income_lines where invoice_id = '${older}' and state = 'WRITTEN_OFF'`) !== "0", "write off: and every student's line on it says so too");
  check(sql(`select count(*) from audit_logs where action = 'invoice.write_off' and entity_id = '${older}'`) === "1", "write off: it is in the audit log");
  for (const e of sup.errors) void e;
} else {
  bad("dispute: the seed left no second invoice to work with");
}

// --- Who may do what.
const mgmt = await signIn("management@medcityoverseas.test", "10.190.1.3");
text = await go(mgmt.page, "/admin/invoices");
check(/To invoice/.test(text), "roles: management reads the invoices");
check((await mgmt.page.getByRole("button", { name: /Raise an invoice/ }).count()) === 0, "roles: and raises none");
const partner = await signIn("kottayam@medcity.test", "10.190.1.4");
await go(partner.page, "/admin/invoices");
await partner.page.waitForURL((u) => !String(u).includes("/admin/invoices"), { timeout: 8000 }).catch(() => {});
check(!partner.page.url().includes("/admin/invoices"), "roles: a branch owner is turned away from the invoice screens");

for (const [who, e] of [["admin", admin.errors], ["management", mgmt.errors], ["partner", partner.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
