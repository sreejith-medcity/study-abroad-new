// Student fees: a fee plan kept by finance, applied to a student as a
// schedule with shares split to the rupee, invoices with GST where the branch
// has a GSTIN and a bill of supply where it has none, a draft held back for a
// missing GST rate, receipts at the counter with their limits, an invoice
// raised by the stage move, the printable invoice and receipt with the amount
// in words, a Razorpay payment link paid through the signed webhook (once),
// the student's own view, the ageing report and its audited CSV, the day book,
// refunds with segregation of duties, cancelling and writing off, and who
// sees what. Then the starter plans from Medcity's fee sheets, an Ausbildung
// plan invoiced by the application's status reaching a step of the guide, and
// an NCLEX-RN plan invoiced by a placement step being completed. Wants the plain seed and the server started with
// RAZORPAY_API_BASE pointing at the stand-in below (port 4010, or RZP_PORT).
import { chromium } from "playwright";
import { hydrated, knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createHmac } from "node:crypto";

const OUT = "/tmp/smoke-student-fees";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const RZP_PORT = Number(process.env.RZP_PORT ?? 4010);
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
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
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(`${page.url()}: ${String(e).slice(0, 120)}`); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const body = (page) => page.locator("body").innerText();
async function go(page, p) {
  await page.goto(BASE + p);
  await hydrated(page).catch(() => {});
  return body(page);
}
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
const waitText = (page, re) => page.getByText(re).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
const waitSql = async (q, want, ms = 10000) => {
  const end = Date.now() + ms;
  let got = sql(q);
  while (got !== want && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    got = sql(q);
  }
  return got;
};
const audited = (action, after) => Number(sql(`select count(*) from audit_logs where action = '${action}' and created_at >= '${after}'`)) > 0;

// A stand-in for Razorpay's Payment Links API.
const seen = [];
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/v1/payment_links") {
      const n = seen.filter((s) => s.url === "/v1/payment_links").length;
      res.end(JSON.stringify({ id: `plink_test${n}`, short_url: `https://rzp.io/i/test${n}`, status: "created" }));
    } else {
      res.end(JSON.stringify({ status: "cancelled" }));
    }
  });
});
await new Promise((r) => mock.listen(RZP_PORT, r));

// --- The fixture: clean fee tables, the student at the start of the journey.
const started = sql("select now()::text");
const fathima = sql("select id from students where first_name = 'Fathima'");
const arathi = sql("select id from students where first_name = 'Arathi'");
const aleesha = sql("select id from students where first_name = 'Aleesha'");
const kot = sql("select id_code from organizations where name = 'Medcity Kottayam'");
const fyNow = sql("select to_char(case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4 then (now() at time zone 'Asia/Kolkata') else (now() at time zone 'Asia/Kolkata') - interval '1 year' end, 'YY') || '-' || to_char(case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4 then (now() at time zone 'Asia/Kolkata') + interval '1 year' else (now() at time zone 'Asia/Kolkata') end, 'YY')");
sql(`delete from fee_payment_links; delete from fee_refunds; delete from fee_receipts; delete from fee_instalments; delete from fee_invoice_lines; delete from fee_invoices; delete from fee_plans where starter_key is null;
  delete from id_counters where scope like 'fees:%'; delete from payment_settings;
  update organizations set gstin = null, state = null;
  update students set journey_stage = 'PROFILE', state = 'Kerala' where id = '${fathima}';
  delete from checklist_items where student_id = '${fathima}'`);

// --- Finance keeps the plans and the GSTINs.
const finance = await signIn("finance@medcityoverseas.test", "10.120.1.1");
const fp = finance.page;
let text = await go(fp, "/fees/plans");
check(/Fee plans/.test(text) && /Add a fee plan/.test(text), "plans: finance has the plan editor");
check(/Medcity Kottayam/.test(text) && /Not recorded/.test(text), "plans: no GSTIN means Not recorded, nothing invented");

// The starter plans, as Medcity's fee sheets write them.
const fsjCard = await fp.locator('[data-plan="FSJ and BFD, Germany"]').innerText();
check(/From Medcity.s fee sheet/.test(fsjCard), "starters: FSJ and BFD is there, marked as from the fee sheet");
check(
  /Registration\s+₹10,000\s+at FSJ \/ BFD step 2, registration and agreement/.test(fsjCard) &&
    /Application\s+₹2,00,000\s+at FSJ \/ BFD step 6, payment status check and application start/.test(fsjCard) &&
    /After Receiving Offer Letter\s+₹2,00,000\s+at FSJ \/ BFD step 10, employer confirmation and contract/.test(fsjCard) &&
    /Before Visa Submission\s+₹90,000\s+at FSJ \/ BFD step 12, visa document preparation/.test(fsjCard),
  "starters: FSJ and BFD's four instalments, each at the FSJ / BFD step it names",
);
check(/₹5,00,000 in all/.test(fsjCard) && /GST 18%/.test(fsjCard) && /The fee sheet says: Registration: ₹10,000 \+ 18% GST/.test(fsjCard), "starters: the sheet's total, its rate and its own words");
const ausCard = await fp.locator('[data-plan="Ausbildung Program (General), for B1 Full/B2 Part"]').innerText();
check(/at Ausbildung step 11, training contract/.test(ausCard) && /₹90,000/.test(ausCard), "starters: the Ausbildung sheet waits for the guide's steps");
const nclexCard = fp.locator('[data-plan="NCLEX-RN Registration and Coaching, service charge (Medcity students)"]');
check(/when "Second service charge payment" is completed/.test(await nclexCard.innerText()), "starters: the NCLEX-RN sheet waits for the placement steps");
check(/Not recorded/.test(await nclexCard.locator("tr").filter({ hasText: "Third (visa screen)" }).innerText()), "starters: a sheet line with + GST and no rate reads Not recorded");
check(Number(sql("select count(*) from fee_plans where starter_key is not null")) === 7, "starters: seven plans from the sheets, nothing invented beside them");
check((await fp.locator('[aria-label="Student fees"] a[href="/admin/payments"]').count()) === 1, "finance: Online payments opens from the fee screens");

// The Kottayam GSTIN, with its state read from the code.
const kRow = fp.locator('[data-org="Medcity Kottayam"]');
await kRow.locator("summary").click();
await kRow.locator('input[name="gstin"]').fill("32abcde1234f1z5");
await kRow.getByRole("button", { name: "Save tax details" }).click();
check(await toast(fp, /GSTIN 32ABCDE1234F1Z5, Kerala/), "gst: the GSTIN is saved upper-cased and the state read from it");
check(sql("select gstin || '|' || state from organizations where name = 'Medcity Kottayam'") === "32ABCDE1234F1Z5|Kerala", "gst: stored on the organisation");

// A plan in shares that do not add up is refused, then fixed.
const editor = fp.locator("form").filter({ has: fp.getByRole("button", { name: "Add plan" }) });
await editor.locator('input[name="name"]').fill("UK Masters in three");
await editor.locator('input[name="gstPercent"]').fill("18");
await editor.getByLabel("Instalment 1 name").fill("Registration");
await editor.getByLabel("Instalment 1 value").fill("30");
await editor.getByRole("button", { name: "Add instalment" }).click();
await editor.getByLabel("Instalment 2 name").fill("On offer");
await editor.getByLabel("Instalment 2 value").fill("30");
await editor.getByLabel("Instalment 2 due").selectOption("JOURNEY");
await editor.getByLabel("Instalment 2 stage").selectOption("OFFER");
await editor.getByRole("button", { name: "Add instalment" }).click();
await editor.getByLabel("Instalment 3 name").fill("On visa");
await editor.getByLabel("Instalment 3 value").fill("30");
await editor.getByLabel("Instalment 3 due").selectOption("JOURNEY");
await editor.getByLabel("Instalment 3 stage").selectOption("VISA");
await editor.getByRole("button", { name: "Add plan" }).click();
check(await waitText(fp, /add up to 90%, not 100%/), "plans: shares must make a hundred");
await editor.getByLabel("Instalment 3 value").fill("40");
await editor.getByRole("button", { name: "Add plan" }).click();
check(await toast(fp, /Plan added/), "plans: a share plan is saved");
text = await go(fp, "/fees/plans");
check(/UK Masters in three/.test(text) && /on offer/.test(text) && /on visa/.test(text) && /GST 18%/.test(text), "plans: listed with its stages and rate");
const planId = sql("select id from fee_plans where name = 'UK Masters in three'");
check(audited("fee_plan.create", started) && audited("org.tax_details", started), "audit: plan and tax details are logged");

// A branch head reads the plans and cannot change them.
const owner = await signIn("kottayam@medcity.test", "10.120.1.2");
const op = owner.page;
text = await go(op, "/fees/plans");
check(/UK Masters in three/.test(text) && !/Add a fee plan/.test(text) && (await op.locator('[data-org] summary').count()) === 0, "plans: a branch head reads them and edits nothing");

// --- The branch head applies the plan to Fathima.
text = await go(op, `/students/${fathima}/fees`);
check(/Fee schedule/.test(text) && /32ABCDE1234F1Z5/.test(text), "student: the fees tab says the branch issues tax invoices");
check(/Fees/.test(await op.locator('[aria-label="Student file steps"]').innerText()), "student: Fees is a tab on the file");
const apply = op.locator("form").filter({ has: op.getByRole("button", { name: "Apply plan" }) });
await apply.locator('select[name="planId"]').selectOption(planId);
await apply.getByRole("button", { name: "Apply plan" }).click();
check(await waitText(op, /needs the package fee/), "schedule: a share plan without the fee is refused, nothing worked out");
await apply.locator('input[name="fee"]').fill("100001");
await apply.getByRole("button", { name: "Apply plan" }).click();
check(await toast(op, /applied: 3 instalments, 1 invoiced now, 2 when the file reaches the stage/), "schedule: applied, the dated one invoiced and two waiting for their stages");
check(sql(`select string_agg(amount::text, ',' order by seq) from fee_instalments where student_id = '${fathima}'`) === "30000,30000,40001", "schedule: shares split to the rupee, the last taking the remainder");
const inv1 = `INV/${kot}/${fyNow}/0001`;
check(
  sql(`select number || '|' || kind || '|' || taxable || '|' || cgst || '|' || sgst || '|' || coalesce(igst::text, '-') || '|' || total || '|' || state from fee_invoices where student_id = '${fathima}'`) ===
    `${inv1}|TAX_INVOICE|30000|2700|2700|-|35400|ISSUED`,
  `invoice: ${inv1}, CGST and SGST at 9% each inside Kerala`,
);
const inv1Id = sql(`select id from fee_invoices where number = '${inv1}'`);

// --- Receipts at the counter.
text = await go(op, `/students/${fathima}/fees`);
let block = op.locator(`[data-invoice="${inv1}"]`);
check(/Issued/.test(await block.innerText()) && /35,400/.test(await block.innerText()), "invoice: shown issued with its total");
async function receive(page, number, fill) {
  const b = page.locator(`[data-invoice="${number}"]`);
  await b.locator("summary").filter({ hasText: "Record receipt" }).click();
  const f = b.locator("form").filter({ has: page.getByRole("button", { name: "Record receipt" }) });
  for (const [k, v] of Object.entries(fill)) {
    if (k === "method") await f.locator('select[name="method"]').selectOption(v);
    else await f.locator(`input[name="${k}"]`).fill(v);
  }
  await f.getByRole("button", { name: "Record receipt" }).click();
}
await receive(op, inv1, { amount: "40000" });
check(await waitText(op, /Only ₹35,400 is due/), "receipt: never more than the balance");
await op.locator(`[data-invoice="${inv1}"] form`).filter({ has: op.getByRole("button", { name: "Record receipt" }) }).locator('input[name="amount"]').fill("10000");
await op.locator(`[data-invoice="${inv1}"] form`).filter({ has: op.getByRole("button", { name: "Record receipt" }) }).getByRole("button", { name: "Record receipt" }).click();
const rct1 = `RCT/${kot}/${fyNow}/0001`;
check(await toast(op, new RegExp(`Receipt ${rct1.replace(/\//g, "\\/")} for ₹10,000`)), `receipt: ${rct1} for cash`);
check(sql(`select state || '|' || received from fee_invoices where id = '${inv1Id}'`) === "PART_PAID|10000", "receipt: the invoice is part paid");
await go(op, `/students/${fathima}/fees`);
await receive(op, inv1, { amount: "25400", method: "UPI" });
check(await waitText(op, /The UPI, card or bank reference/), "receipt: UPI needs its reference");
await op.locator(`[data-invoice="${inv1}"] form`).filter({ has: op.getByRole("button", { name: "Record receipt" }) }).locator('input[name="reference"]').fill("UPI-998877");
await op.locator(`[data-invoice="${inv1}"] form`).filter({ has: op.getByRole("button", { name: "Record receipt" }) }).getByRole("button", { name: "Record receipt" }).click();
check(await toast(op, /for ₹25,400/), "receipt: the balance by UPI");
check(sql(`select state || '|' || received from fee_invoices where id = '${inv1Id}'`) === "PAID|35400", "receipt: the invoice is paid");
check(audited("fee_receipt.record", started), "audit: receipts are logged");

// --- Printing: the invoice and the receipt, amounts in words.
const rct1Id = sql(`select id from fee_receipts where number = '${rct1}'`);
text = await go(op, `/print/fees/invoice/${inv1Id}`);
check(/Tax invoice/i.test(text) && /GSTIN 32ABCDE1234F1Z5/.test(text) && /CGST at 9%/.test(text) && /SGST at 9%/.test(text) && /₹35,400/.test(text), "print: a tax invoice with the split and Indian grouping");
check(/Rupees Thirty Five Thousand Four Hundred Only/.test(text), "print: the total in words");
text = await go(op, `/print/fees/receipt/${rct1Id}`);
check(/Fee receipt/i.test(text) && /Rupees Ten Thousand Only/.test(text) && new RegExp(rct1).test(text), "print: the receipt with its number and the amount in words");

// --- The stage move invoices the instalment tied to it.
const admin = await signIn("admin@medcityoverseas.test", "10.120.1.3");
const ap = admin.page;
await go(ap, `/students/${fathima}/documentation`);
await ap.locator('select[name="stage"]').first().selectOption("OFFER");
await ap.getByRole("button", { name: "Move the stage" }).click();
// The documentation list may hold the stage; an admin lets it through with a reason.
if (await ap.getByText(/Give a reason for letting this through/).first().waitFor({ timeout: 4000 }).then(() => true, () => false)) {
  await ap.locator('input[name="reason"]').first().fill("Fees test: the offer is in hand");
  await ap.getByRole("button", { name: "Move the stage" }).click();
}
check(await toast(ap, /1 fee invoice raised for this stage/), "stage: moving to offer raises the offer instalment");
const inv2 = `INV/${kot}/${fyNow}/0002`;
check(sql(`select f.number || '|' || f.total || '|' || (f.due_on - (now() at time zone 'Asia/Kolkata')::date) from fee_invoices f join fee_invoice_lines l on l.invoice_id = f.id where f.student_id = '${fathima}' and l.description like 'On offer%'`) === `${inv2}|35400|7`, "stage: issued with a week to pay");
check(sql(`select state from fee_instalments where student_id = '${fathima}' and label = 'On visa'`) === "SCHEDULED", "stage: the visa instalment still waits");

// --- A draft held back for a GST rate, then issued.
text = await go(op, `/students/${fathima}/fees`);
await op.locator("summary").filter({ hasText: "Raise an invoice by hand" }).click();
const byHand = op.locator("form").filter({ has: op.getByRole("button", { name: "Raise invoice" }) });
await byHand.locator('input[name="description1"]').fill("Courier of documents");
await byHand.locator('input[name="amount1"]').fill("1000");
await byHand.getByRole("button", { name: "Raise invoice" }).click();
check(await toast(op, /Saved as a draft\. Medcity Kottayam has GSTIN 32ABCDE1234F1Z5/), "draft: no GST rate, so it stays a draft rather than guessing");
text = await go(op, `/students/${fathima}/fees`);
const draft = op.locator('[data-invoice="draft"]');
check(/Rate not recorded/.test(await draft.innerText()), "draft: reads Rate not recorded");
await draft.locator("summary").filter({ hasText: "GST rate" }).click();
await draft.locator('input[name="gstPercent"]').fill("18");
await draft.getByRole("button", { name: "Set rate" }).click();
check(await toast(op, /GST rate set to 18%/), "draft: the rate is recorded");
await go(op, `/students/${fathima}/fees`);
await op.locator('[data-invoice="draft"]').getByRole("button", { name: "Issue" }).click();
const inv3 = `INV/${kot}/${fyNow}/0003`;
check(await toast(op, new RegExp(`${inv3.replace(/\//g, "\\/")} issued for ₹1,180`)), "draft: issued with the next number and 18% on top");

// --- A branch with no GSTIN issues a bill of supply.
const kochi = await signIn("kochi@medcity.test", "10.120.1.4");
const kp = kochi.page;
text = await go(kp, `/students/${aleesha}/fees`);
check(/no GSTIN recorded/.test(text), "bill of supply: the tab says there is no GSTIN");
await kp.locator("summary").filter({ hasText: "Raise an invoice by hand" }).click();
const kHand = kp.locator("form").filter({ has: kp.getByRole("button", { name: "Raise invoice" }) });
await kHand.locator('input[name="description1"]').fill("Application handling fee");
await kHand.locator('input[name="amount1"]').fill("12500");
await kHand.locator('input[name="gstPercent"]').fill("18");
await kHand.getByRole("button", { name: "Raise invoice" }).click();
const koc = sql("select id_code from organizations where name = 'Medcity Kochi'");
const kInv = `INV/${koc}/${fyNow}/0001`;
check(await toast(kp, new RegExp(`${kInv.replace(/\//g, "\\/")} issued for ₹12,500`)), "bill of supply: numbered in Kochi's own series, no tax added");
check(sql(`select kind || '|' || coalesce(cgst::text, '-') || '|' || coalesce(igst::text, '-') || '|' || total from fee_invoices where number = '${kInv}'`) === "BILL_OF_SUPPLY|-|-|12500", "bill of supply: no tax figures at all");
const kInvId = sql(`select id from fee_invoices where number = '${kInv}'`);
text = await go(kp, `/print/fees/invoice/${kInvId}`);
check(/Bill of supply/i.test(text) && /No GST is charged/.test(text) && /Rupees Twelve Thousand Five Hundred Only/.test(text), "bill of supply: printed as such, in words");
text = await go(kp, `/print/fees/invoice/${inv1Id}`);
check(!/Tax invoice/i.test(text), "scope: Kochi cannot print Kottayam's invoice");

// --- A payment link: off while Razorpay is off, then on.
text = await go(op, `/students/${fathima}/fees`);
check((await op.locator(`[data-invoice="${inv2}"]`).getByRole("button", { name: "Payment link" }).count()) === 0, "link: no payment link while online payments are off");
const sa = await signIn("sreejith@miak.in", "10.120.1.5");
await go(sa.page, "/settings/platform");
const pform = sa.page.locator("#payments form");
await pform.locator('[name="razorpayKeyId"]').fill("rzp_test_AbCdEf123456");
await pform.locator('[name="keySecret"]').fill("test_secret_value");
await pform.locator('[name="webhookSecret"]').fill("hook_secret_value");
await pform.locator('[name="enabled"]').check();
await pform.getByRole("button", { name: "Save payment settings" }).click();
await toast(sa.page, /Online payments are on/);
await go(op, `/students/${fathima}/fees`);
await op.locator(`[data-invoice="${inv2}"]`).getByRole("button", { name: "Payment link" }).click();
check(await waitText(op, /Payment link ready: https:\/\/rzp\.io\/i\/test1/), "link: made at Razorpay and shown to the branch");
const linkCall = seen.find((s) => s.url === "/v1/payment_links");
check(linkCall?.body.amount === 3540000 && linkCall?.body.currency === "INR" && linkCall?.auth === `Basic ${Buffer.from("rzp_test_AbCdEf123456:test_secret_value").toString("base64")}`, "link: the balance in paise, signed with the keys");

// The student sees it and pays.
const student = await signIn("fathima.rahman@example.com", "10.120.1.6");
const sp = student.page;
text = await go(sp, "/portal/fees");
check(new RegExp(inv1).test(text) && new RegExp(inv2).test(text) && new RegExp(inv3).test(text), "portal: the student sees their invoices");
check(/Pay online ₹35,400/.test(text), "portal: with the payment link");
check(new RegExp(rct1).test(text) && /Receipt to print/.test(text), "portal: and their receipts");
check(/On visa/.test(text), "portal: and what is coming up on the plan");
const hook = (event, payId) => JSON.stringify({ event, payload: { payment_link: { entity: { id: "plink_test1", amount_paid: 3540000 } }, payment: { entity: { id: payId, amount: 3540000, order_id: "order_x" } } } });
const post = (raw, sig) => sp.request.post(`${BASE}/api/razorpay/webhook`, { data: raw, headers: { "content-type": "application/json", "x-razorpay-signature": sig } });
let res = await post(hook("payment_link.paid", "pay_fee0001"), "0".repeat(64));
check(res.status() === 401, "webhook: an unsigned payment is refused");
const good = hook("payment_link.paid", "pay_fee0001");
const sig = createHmac("sha256", "hook_secret_value").update(good).digest("hex");
res = await post(good, sig);
check(res.status() === 200, "webhook: a signed payment is accepted");
const inv2Id = sql(`select id from fee_invoices where number = '${inv2}'`);
check((await waitSql(`select state || '|' || received from fee_invoices where id = '${inv2Id}'`, "PAID|35400")) === "PAID|35400", "webhook: the invoice is marked paid");
await post(good, sig);
check(sql(`select count(*) from fee_receipts where razorpay_payment_id = 'pay_fee0001'`) === "1" && sql(`select received from fee_invoices where id = '${inv2Id}'`) === "35400", "webhook: a replay records nothing twice");
check(sql(`select method || '|' || coalesce(recorded_by_id, 'razorpay') from fee_receipts where razorpay_payment_id = 'pay_fee0001'`) === "RAZORPAY|razorpay", "webhook: the receipt is Razorpay's");
text = await go(sp, "/portal/fees");
check(!/Pay online/.test(text), "portal: no pay button once it is paid");
const rzpReceipt = sql("select id from fee_receipts where razorpay_payment_id = 'pay_fee0001'");
text = await go(sp, `/print/fees/receipt/${rzpReceipt}`);
check(/Rupees Thirty Five Thousand Four Hundred Only/.test(text), "portal: the student prints their receipt");
// Someone else's document is not there.
await go(op, `/students/${arathi}/fees`);
await op.locator("summary").filter({ hasText: "Raise an invoice by hand" }).click();
const aHand = op.locator("form").filter({ has: op.getByRole("button", { name: "Raise invoice" }) });
await aHand.locator('input[name="description1"]').fill("Visa guidance fee");
await aHand.locator('input[name="amount1"]').fill("5000");
await aHand.locator('input[name="gstPercent"]').fill("18");
await aHand.getByRole("button", { name: "Raise invoice" }).click();
await toast(op, /issued/);
const arathiInv = sql(`select id from fee_invoices where student_id = '${arathi}'`);
text = await go(sp, `/print/fees/invoice/${arathiInv}`);
check(!/Visa guidance fee/.test(text), "portal: another student's invoice is not there");

// --- Scope: a counsellor sees their own students' fees and no one else's.
const counsellor = await signIn("uk.docs@medcity.test", "10.120.1.7");
text = await go(counsellor.page, "/fees?state=ALL");
check(new RegExp(inv1).test(text) && !/Arathi/.test(text) && !new RegExp(kInv).test(text), "scope: a counsellor's list is their own students");
text = await go(op, "/fees?state=ALL");
check(new RegExp(inv1).test(text) && /Arathi/.test(text) && !new RegExp(kInv).test(text), "scope: a branch head's list is their branch");
text = await go(fp, "/fees?state=ALL");
check(new RegExp(inv1).test(text) && new RegExp(kInv).test(text), "scope: finance sees every branch");
const docs = await signIn("documentation@medcityoverseas.test", "10.120.1.8");
await docs.page.goto(`${BASE}/fees`);
await docs.page.waitForURL(/forbidden/, { timeout: 10000 }).catch(() => {});
check(/forbidden/.test(docs.page.url()), "scope: the documentation desk is kept away from fees");

// --- Ageing: one invoice forty-five days late in Kochi.
sql(`update fee_invoices set due_on = (now() at time zone 'Asia/Kolkata')::date - 45 where id = '${kInvId}'`);
text = await go(fp, "/fees/ageing");
const kochiRow = await fp.locator('[data-branch="Medcity Kochi"]').innerText();
check(/₹12,500/.test(kochiRow) && kochiRow.split("\t").filter((c) => /₹12,500/.test(c)).length === 2, "ageing: Kochi's balance sits in one bucket and the total");
const headers = await fp.locator("table").first().locator("th").allInnerTexts();
const cells = (await fp.locator('[data-branch="Medcity Kochi"] td').allInnerTexts()).map((c) => c.trim());
check(cells[headers.findIndex((h) => /31 to 60/i.test(h))] === "₹12,500", "ageing: in the 31 to 60 day bucket");
check(/Longest overdue/.test(text) && (await fp.locator(`[data-overdue="${kInv}"]`).count()) === 1 && /45/.test(await fp.locator(`[data-overdue="${kInv}"]`).innerText()), "ageing: the longest overdue list names it, 45 days late");
const csvRes = await fp.request.get(`${BASE}/api/fees/ageing`);
const csv = await csvRes.text();
check(csvRes.status() === 200 && csv.includes(kInv) && csv.includes("31 to 60 days") && /text\/csv/.test(csvRes.headers()["content-type"] ?? ""), "ageing: the CSV lists the invoice and its bucket");
check(audited("fee_ageing.export", started), "ageing: the download is audited");
text = await go(op, "/fees/ageing");
check(!/Medcity Kochi/.test(text), "ageing: a branch head sees their branch only");

// --- Day book.
text = await go(fp, "/fees/day-book");
const dayRow = (await fp.locator('[data-daybook="Medcity Kottayam"] td').allInnerTexts()).map((c) => c.trim());
const dayHead = (await fp.locator("table").first().locator("th").allInnerTexts()).map((h) => h.trim().toLowerCase());
check(dayRow[dayHead.indexOf("cash")] === "₹10,000" && dayRow[dayHead.indexOf("upi")] === "₹25,400" && dayRow[dayHead.indexOf("razorpay link")] === "₹35,400", "day book: Kottayam's receipts by method");
const dayCsv = await (await fp.request.get(`${BASE}/api/fees/day-book`)).text();
check(dayCsv.includes(rct1) && dayCsv.includes("UPI-998877") && audited("fee_day_book.export", started), "day book: the CSV, audited");

// --- Refunds, with segregation of duties.
await go(op, `/students/${fathima}/fees`);
await op.locator(`[data-invoice="${inv1}"] summary`).filter({ hasText: "Request refund" }).click();
const rq = op.locator(`[data-invoice="${inv1}"] form`).filter({ has: op.getByRole("button", { name: "Request refund" }) });
await rq.locator('input[name="amount"]').fill("40000");
await rq.locator('textarea[name="reason"]').fill("Student deferred to the next intake");
await rq.getByRole("button", { name: "Request refund" }).click();
check(await waitText(op, /Up to ₹35,400 can be refunded/), "refund: never more than was received");
await rq.locator('input[name="amount"]').fill("5000");
await rq.getByRole("button", { name: "Request refund" }).click();
const rfd1 = `RFD/${kot}/${fyNow}/0001`;
check(await toast(op, new RegExp(`Refund ${rfd1.replace(/\//g, "\\/")} requested`)), "refund: requested with its number");
text = await go(op, "/fees/refunds");
check(new RegExp(rfd1).test(text) && (await op.getByRole("button", { name: "Approve" }).count()) === 0, "refund: the branch head cannot approve it");

// Finance asks for one of its own, and cannot approve that one.
await go(fp, `/students/${fathima}/fees`);
await fp.locator(`[data-invoice="${inv2}"] summary`).filter({ hasText: "Request refund" }).click();
const fq = fp.locator(`[data-invoice="${inv2}"] form`).filter({ has: fp.getByRole("button", { name: "Request refund" }) });
await fq.locator('input[name="amount"]').fill("2000");
await fq.locator('textarea[name="reason"]').fill("Charged twice for the courier");
await fq.getByRole("button", { name: "Request refund" }).click();
const rfd2 = `RFD/${kot}/${fyNow}/0002`;
check(await toast(fp, /requested/), "refund: finance requests one too");
text = await go(fp, "/fees/refunds");
const ownRow = fp.locator(`[data-refund="${rfd2}"]`);
check(/somebody else decides it/.test(await ownRow.innerText()) && (await ownRow.getByRole("button", { name: "Approve" }).count()) === 0, "refund: no approve button on your own request");
// Forcing it through the form of the other refund's row, pointed at your own, is refused by the server.
const otherRow = fp.locator(`[data-refund="${rfd1}"]`);
const rfd2Id = sql(`select id from fee_refunds where number = '${rfd2}'`);
await otherRow.locator('input[name="refundId"]').evaluate((el, v) => (el.value = v), rfd2Id);
await otherRow.getByRole("button", { name: "Approve" }).click();
check(await waitText(fp, /You asked for this refund, so somebody else decides it/), "refund: the server refuses an approval of your own request");
check(sql(`select state from fee_refunds where id = '${rfd2Id}'`) === "REQUESTED", "refund: still waiting");

// Finance approves the branch head's; the admin decides finance's.
await go(fp, "/fees/refunds");
await fp.locator(`[data-refund="${rfd1}"]`).getByRole("button", { name: "Approve" }).click();
check(await toast(fp, /approved/), "refund: finance approves the branch head's request");
await go(ap, "/fees/refunds");
await ap.locator(`[data-refund="${rfd2}"]`).getByRole("button", { name: "Reject" }).click();
check(await waitText(ap, /Say why it is rejected/), "refund: a rejection needs a reason");
await ap.locator(`[data-refund="${rfd2}"] input[name="note"]`).fill("Courier was used twice");
await ap.locator(`[data-refund="${rfd2}"]`).getByRole("button", { name: "Reject" }).click();
check(await toast(ap, /rejected/), "refund: the head office rejects finance's request");

// Paid out with a reference, and the invoice reads it.
text = await go(fp, "/fees/refunds");
const payRow = fp.locator(`[data-refund="${rfd1}"]`);
await payRow.locator("summary").filter({ hasText: "Record payout" }).click();
await payRow.getByRole("button", { name: "Record payout" }).click();
check(await waitText(fp, /The bank, UPI or cash voucher reference/), "refund: a payout needs its reference");
await payRow.locator('input[name="reference"]').fill("NEFT-REF-5521");
await payRow.getByRole("button", { name: "Record payout" }).click();
check(await toast(fp, /paid out/), "refund: paid out");
check(sql(`select state || '|' || payout_reference from fee_refunds where number = '${rfd1}'`) === "PAID|NEFT-REF-5521", "refund: the reference is on it");
check(sql(`select received || '|' || refunded || '|' || state from fee_invoices where id = '${inv1Id}'`) === "35400|5000|PAID", "refund: the invoice is corrected, nothing falls due again");
text = await go(op, `/students/${fathima}/fees`);
check(/Net fee after refunds ₹30,400/.test(await op.locator(`[data-invoice="${inv1}"]`).innerText()), "refund: the student's tab shows the net fee");
text = await go(fp, `/print/fees/invoice/${inv1Id}`);
check(/Refunded/.test(text) && /₹5,000/.test(text), "refund: the printed invoice shows it");
for (const a of ["fee_refund.request", "fee_refund.approve", "fee_refund.reject", "fee_refund.pay", "fee_invoice.issue", "fee_plan.apply", "fee_link.create", "fee_receipt.razorpay"]) check(audited(a, started), `audit: ${a}`);

// --- Cancelling and writing off belong to finance.
text = await go(op, `/students/${arathi}/fees`);
const arathiNo = sql(`select number from fee_invoices where id = '${arathiInv}'`);
check((await op.locator(`[data-invoice="${arathiNo}"] summary`).filter({ hasText: "Cancel invoice" }).count()) === 0, "cancel: a branch head cannot cancel an issued invoice");
await go(fp, `/students/${arathi}/fees`);
const ab = fp.locator(`[data-invoice="${arathiNo}"]`);
await ab.locator("summary").filter({ hasText: "Cancel invoice" }).click();
await ab.locator('input[name="reason"]').first().fill("Raised against the wrong student");
await ab.getByRole("button", { name: "Cancel it" }).click();
check(await toast(fp, /cancelled/), "cancel: finance cancels it with a reason");
check(sql(`select state || '|' || closed_reason from fee_invoices where id = '${arathiInv}'`) === "CANCELLED|Raised against the wrong student", "cancel: recorded with the reason");
await go(fp, `/students/${aleesha}/fees`);
const wb = fp.locator(`[data-invoice="${kInv}"]`);
await wb.locator("summary").filter({ hasText: "Write off" }).click();
await wb.locator('input[name="reason"]').last().fill("Student unreachable for six months");
await wb.getByRole("button", { name: "Write off the balance" }).click();
check(await toast(fp, /written off/), "write off: finance writes off the late one");
text = await go(fp, "/fees/ageing");
check(!/Medcity Kochi/.test(text), "write off: it leaves the ageing report");
check(audited("fee_invoice.cancel", started) && audited("fee_invoice.write_off", started), "audit: cancel and write-off are logged");

// --- Finance works the fees tab of a file it otherwise only reads.
text = await go(fp, `/students/${fathima}/fees`);
check(!/You are reading this file, not working on it/.test(text) && (await fp.locator("fieldset[disabled]").count()) === 0, "finance: the fees tab is open to finance");
text = await go(fp, `/students/${fathima}/profile`);
check(/You are reading this file, not working on it/.test(text), "finance: the rest of the file stays read-only");

// --- An Ausbildung plan, invoiced as the application reaches the guide's steps.
const akshara = sql("select id from students where first_name = 'Akshara'");
const ausbApp = sql(`select a.id from applications a join programs p on p.id = a.program_id join status_definitions sd on sd.id = a.status_id where a.student_id = '${akshara}' and p.pathway = 'AUSBILDUNG' and sd.code = 'EMPLOYER_INTERVIEW' limit 1`);
// The seed also has her joined at another employer (step 18). The plan reads the
// furthest step any Ausbildung application is at, so that one is withdrawn here,
// leaving the file at the employer interview, step 10.
sql(`update applications set status_id = (select id from status_definitions where pathway = 'AUSBILDUNG' and code = 'WITHDRAWN') where student_id = '${akshara}' and id <> '${ausbApp}' and program_id in (select id from programs where pathway = 'AUSBILDUNG')`);
const ausPlan = sql("select id from fee_plans where starter_key = 'ausbildung-general-b1-full-b2-part'");
await go(op, `/students/${akshara}/fees`);
const ausApply = op.locator("form").filter({ has: op.getByRole("button", { name: "Apply plan" }) });
await ausApply.locator('select[name="planId"]').selectOption(ausPlan);
await ausApply.getByRole("button", { name: "Apply plan" }).click();
// At the employer interview, step 10, the file is past the application's step 9.
check(await toast(op, /applied: 4 instalments, 2 invoiced now, 2 when the file reaches the stage or step/), "ausbildung: registration and the application (step 9, already passed) are invoiced at once");
const ausStates = () => sql(`select string_agg(state::text, ',' order by seq) from fee_instalments where student_id = '${akshara}'`);
check(ausStates() === "INVOICED,INVOICED,SCHEDULED,SCHEDULED", "ausbildung: the offer and visa instalments wait for their steps");
check(sql(`select count(*) from fee_invoices where student_id = '${akshara}' and state = 'ISSUED' and gst_percent = 18`) === "2", "ausbildung: both issued at the sheet's 18%");
text = await go(op, `/students/${akshara}/fees`);
check(/at Ausbildung step 11, training contract/.test(await op.locator('[data-instalment="After offer letter"]').innerText()), "ausbildung: the schedule says which step brings the next one due");
await go(ap, `/students/${akshara}/applications?app=${ausbApp}`);
await ap.locator(`#status-${ausbApp}`).selectOption({ label: "Training contract signed" });
await ap.getByRole("button", { name: "Update status" }).click();
check((await waitSql(`select state from fee_instalments where student_id = '${akshara}' and seq = 3`, "INVOICED")) === "INVOICED", "ausbildung: the training contract (step 11) invoices the offer letter instalment");
check(sql(`select state from fee_instalments where student_id = '${akshara}' and seq = 4`) === "SCHEDULED", "ausbildung: the visa instalment still waits for step 12");
check(
  sql(`select f.state || '|' || f.total || '|' || (f.due_on - (now() at time zone 'Asia/Kolkata')::date) from fee_invoices f join fee_instalments i on i.invoice_id = f.id where i.student_id = '${akshara}' and i.seq = 3`) === "ISSUED|236000|7",
  "ausbildung: issued for ₹2,00,000 and 18% GST, a week to pay",
);

// --- An NCLEX-RN plan, invoiced as the placement steps are completed.
const simi = sql("select id from students where preferred_pathway = 'NURSING' order by created_at limit 1");
const nclexPlan = sql("select id from fee_plans where starter_key = 'nclex-rn-service-medcity'");
await go(op, `/students/${simi}/fees`);
const nApply = op.locator("form").filter({ has: op.getByRole("button", { name: "Apply plan" }) });
await nApply.locator('select[name="planId"]').selectOption(nclexPlan);
await nApply.getByRole("button", { name: "Apply plan" }).click();
check(await toast(op, /applied: 3 instalments, 1 invoiced now, 2 when the file reaches the stage or step/), "nclex: the initial payment is invoiced, the second and third wait");
await go(op, `/students/${simi}/ausbildung`);
const secondStep = op.locator('[data-nclex-step="SECOND_SERVICE_CHARGE"]');
await secondStep.locator('select[name="completed"]').selectOption("1");
await secondStep.getByRole("button", { name: "Save" }).click();
check((await waitSql(`select state from fee_instalments where student_id = '${simi}' and seq = 2`, "INVOICED")) === "INVOICED", "nclex: completing the second service charge step invoices it");
check(sql(`select f.state || '|' || f.total from fee_invoices f join fee_instalments i on i.invoice_id = f.id where i.student_id = '${simi}' and i.seq = 2`) === "ISSUED|29500", "nclex: ₹25,000 and 18% GST");
text = await go(op, `/students/${simi}/fees`);
const third = op.locator('[data-instalment="Service, Third (visa screen), Medcity students"]');
check(/Not recorded/.test(await third.innerText()), "nclex: the third payment's GST reads Not recorded on the schedule");
await third.getByRole("button", { name: "Invoice now" }).click();
check(await toast(op, /Raised as a draft: Medcity Kottayam has GSTIN 32ABCDE1234F1Z5 on record and this invoice has no GST rate/), "nclex: with a GSTIN and no rate it waits as a draft, never a guessed tax");
check(sql(`select f.state || '|' || coalesce(f.gst_percent::text, 'none') || '|' || coalesce(f.total::text, 'none') from fee_invoices f join fee_instalments i on i.invoice_id = f.id where i.student_id = '${simi}' and i.seq = 3`) === "DRAFT|none|none", "nclex: the draft has no rate and no total");

await sp.screenshot({ path: `${OUT}/portal.png`, fullPage: true });
mock.close();
for (const [who, e] of [["finance", finance.errors], ["owner", owner.errors], ["admin", admin.errors], ["kochi", kochi.errors], ["student", student.errors], ["counsellor", counsellor.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
sql("delete from payment_settings");
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
