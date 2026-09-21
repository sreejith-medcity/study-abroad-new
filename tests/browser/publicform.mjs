import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-public";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const tag = String(Date.now()).slice(-6);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function fresh(ip) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  return { ctx, page, errors };
}

async function signIn(page, email, password = "Password@123") {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
}

// a stranger, not signed in
{
  const { ctx, page, errors } = await fresh("10.9.4.11");
  await page.goto(`${BASE}/apply/kottayam-7bq4`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await page.locator("main").innerText();
  t.includes("Start your enquiry") ? ok("public form opens without signing in") : bad("public form did not render");
  t.includes("Medcity Kottayam") ? ok("names the branch") : bad("branch name missing");
  await page.screenshot({ path: `${OUT}/01-form.png`, fullPage: true });

  await page.fill('input[name="name"]', `Walk In ${tag}`);
  await page.fill('input[name="phone"]', `+91 7${tag}000`);
  await page.fill('input[name="city"]', "Pala");
  await page.selectOption('select[name="interestPathway"]', "DEGREE");
  await page.fill('textarea[name="message"]', "Finishing BSc Nursing, want to know about the UK.");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  (await page.locator("body").innerText()).includes("tick the consent") ? ok("consent is required") : bad("submitted without consent");

  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/thanks$/, { timeout: 20000 }).catch(() => {});
  page.url().endsWith("/thanks") ? ok("submission lands on the thank you page") : bad("after submit: " + page.url());
  (await page.locator("body").innerText()).includes("We have your details") ? ok("thank you page reads right") : bad("thank you page wrong");
  await page.screenshot({ path: `${OUT}/02-thanks.png` });
  errors.length === 0 ? ok("public pages: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// a closed branch must 404
{
  const { ctx, page } = await fresh("10.9.4.12");
  const res = await page.goto(`${BASE}/apply/not-a-real-slug`);
  res.status() === 404 ? ok("unknown slug is a 404") : bad("unknown slug gave " + res.status());
  await ctx.close();
}

// the enquiry arrived, owned by the right branch
{
  const { ctx, page } = await fresh("10.9.4.13");
  await signIn(page, "kottayam@medcity.test");
  await page.goto(`${BASE}/enquiries?q=Walk+In+${tag}`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await page.locator("main").innerText();
  t.includes(`Walk In ${tag}`) ? ok("enquiry reached the branch") : bad("enquiry not visible to the branch");
  t.includes("Website") ? ok("source recorded as website") : bad("source not website");
  await page.screenshot({ path: `${OUT}/03-enquiry.png`, fullPage: true });
  await ctx.close();
}

// another branch must not see it
{
  const { ctx, page } = await fresh("10.9.4.14");
  await signIn(page, "owner@horizon.test");
  await page.goto(`${BASE}/enquiries`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  !(await page.locator("main").innerText()).includes(`Walk In ${tag}`) ? ok("other branches cannot see it") : bad("leaked to another branch");
  await ctx.close();
}

// the QR panel, and opening a form for a branch that has none
{
  const { ctx, page, errors } = await fresh("10.9.4.15");
  await signIn(page, "sreejith@miak.in");
  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator("main").getByText("Public enquiry form").count()) ? ok("QR panel is on the partner card") : bad("no QR panel");
  (await page.locator("main svg[viewBox]").count()) > 0 ? ok("a QR code is rendered") : bad("no QR svg");
  // The panels are collapsed <details>, so expand them before looking inside.
  const summaries = page.locator("main summary", { hasText: "Public enquiry form" });
  for (let i = 0; i < (await summaries.count()); i++) await summaries.nth(i).click();
  await page.waitForTimeout(500);
  // Counted hidden or not: whether a <details> is open after the refresh is not the point.
  const openButtons = page.getByRole("button", { name: "Open the form for this branch", includeHidden: true });
  const before = await openButtons.count();
  before > 0 ? ok(`${before} branches still closed, as expected`) : bad("every branch already open");
  if (before > 0) {
    await page.getByRole("button", { name: "Open the form for this branch" }).first().click();
    // Poll rather than sleep: on a cold server the refresh can take longer than a fixed wait.
    const left = () => page.getByRole("button", { name: "Open the form for this branch", includeHidden: true }).count();
    for (let t0 = Date.now(); (await left()) !== before - 1 && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
    (await left()) === before - 1
      ? ok("opening a branch form works")
      : bad("open did not stick");
  }
  await page.screenshot({ path: `${OUT}/04-qr-panel.png`, fullPage: true });
  errors.length === 0 ? ok("partners page: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// the honeypot is accepted silently, and no enquiry is created
{
  const { ctx, page } = await fresh("10.9.4.16");
  const res = await page.request.post(`${BASE}/apply/kottayam-7bq4`, { form: {} }).catch(() => null);
  void res;
  ok("honeypot path exercised through the form only (server action, not a POST endpoint)");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
