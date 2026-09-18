import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-money";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function signIn(email, ip, password = "Password@123") {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}

// admin: rules, pipeline, settle one commission
{
  const { ctx, page, errors } = await signIn("admin@medcityoverseas.test", "10.9.2.11");
  await page.goto(`${BASE}/admin/commission?tab=rules`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  let t = await page.locator("main").innerText();
  t.includes("UK universities") ? ok("seeded rules listed") : bad("no seeded rules");
  await page.screenshot({ path: `${OUT}/01-rules.png`, fullPage: true });

  await page.goto(`${BASE}/admin/commission`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  t = await page.locator("main").innerText();
  t.includes("Expected") ? ok("pipeline tiles render") : bad("pipeline tiles missing");
  const rowCount = await page.locator("main tbody tr").count();
  rowCount > 0 ? ok(`pipeline shows ${rowCount} commissions`) : bad("pipeline is empty");
  await page.screenshot({ path: `${OUT}/02-pipeline.png`, fullPage: true });

  // move the first EXPECTED one to invoiced
  const row = page.locator("main tbody tr").filter({ hasText: "Expected" }).first();
  if (await row.count()) {
    await row.locator('select[name="status"]').selectOption("INVOICED");
    await row.locator('input[name="invoiceRef"]').fill("MIO/TEST/1");
    await row.getByRole("button", { name: "Apply" }).click();
    // Assert the move itself: the toast fades, the invoice reference stays.
    await page.locator("main tbody tr").filter({ hasText: "MIO/TEST/1" }).first().waitFor({ timeout: 12000 })
      .then(() => ok("commission moved to invoiced"))
      .catch(() => bad("commission did not move"));
  } else {
    bad("no expected commission to move");
  }

  // backfill button
  await page.getByRole("button", { name: /Find missing commissions/i }).click();
  await page.locator('[role="status"]').getByText(/commission|Nothing to add/i).first().waitFor({ timeout: 10000 })
    .then(() => ok("backfill runs"))
    .catch(() => bad("backfill gave no answer"));
  errors.length === 0 ? ok("admin: no client errors") : bad("admin errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// partner: statement, wallet, payout request
{
  const { ctx, page, errors } = await signIn("kochi@medcity.test", "10.9.2.12");
  await page.goto(`${BASE}/commission`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  let t = await page.locator("main").innerText();
  t.includes("Paid to you") ? ok("partner statement renders") : bad("statement missing");
  await page.screenshot({ path: `${OUT}/03-partner-commission.png`, fullPage: true });

  await page.goto(`${BASE}/wallet`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  t = await page.locator("main").innerText();
  t.includes("Available balance") ? ok("wallet renders") : bad("wallet missing");
  const hasLedger = (await page.locator("main tbody tr").count()) > 0;
  hasLedger ? ok("wallet ledger has entries") : bad("wallet ledger empty");
  await page.screenshot({ path: `${OUT}/04-wallet.png`, fullPage: true });

  const amount = page.locator('input[name="amountInr"]');
  if (await amount.count()) {
    await amount.fill("5000");
    await page.locator('textarea[name="note"]').fill("Smoke test request");
    await page.getByRole("button", { name: /Request payout/i }).click();
    await page.locator('[role="status"]').getByText(/Requested|payout/i).first().waitFor({ timeout: 12000 })
      .then(() => ok("payout requested"))
      .catch(() => bad("payout request gave no answer"));
  } else {
    bad("no payout form for the owner");
  }
  errors.length === 0 ? ok("partner: no client errors") : bad("partner errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// admin pays it
{
  const { ctx, page } = await signIn("admin@medcityoverseas.test", "10.9.2.13");
  await page.goto(`${BASE}/admin/commission?tab=payouts`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const row = page.locator("main tbody tr").filter({ hasText: "Requested" }).first();
  // The page streams, so wait for the row rather than counting once.
  await row.waitFor({ timeout: 12000 }).catch(() => {});
  (await row.count()) ? ok("request reached the Overseas team") : bad("no pending request visible");
  if (await row.count()) {
    await row.locator('select[name="decision"]').selectOption("PAID");
    await row.locator('input[name="reference"]').fill("UTR-TEST-1");
    await row.getByRole("button", { name: "Apply" }).click();
    await page.locator("main tbody tr").filter({ hasText: "UTR-TEST-1" }).first().waitFor({ timeout: 12000 })
      .then(() => ok("payout marked paid"))
      .catch(() => bad("payout decision did not stick"));
  }
  await page.screenshot({ path: `${OUT}/05-payouts.png`, fullPage: true });
  await ctx.close();
}

// the partner sees the debit
{
  const { ctx, page } = await signIn("kochi@medcity.test", "10.9.2.14");
  await page.goto(`${BASE}/wallet`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await page.locator("main").innerText();
  t.includes("Payout") ? ok("payout shows in the ledger") : bad("no payout entry in the ledger");
  await ctx.close();
}

// a counsellor cannot request a payout, management cannot act
{
  const { ctx, page } = await signIn("uk.docs@medcity.test", "10.9.2.15");
  await page.goto(`${BASE}/wallet`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator('input[name="amountInr"]').count()) === 0 ? ok("counsellor cannot request a payout") : bad("counsellor sees the payout form");
  await ctx.close();
}
{
  const { ctx, page } = await signIn("management@medcityoverseas.test", "10.9.2.16");
  await page.goto(`${BASE}/admin/commission`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/admin/commission") ? ok("management can read the commission console") : bad("management got " + page.url());
  (await page.locator('main select[aria-label="Move to"]').count()) === 0 ? ok("management has no move controls") : bad("management can move commissions");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
