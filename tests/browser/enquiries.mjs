import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-enq";
// Unique per run: the portal refuses a duplicate number or email, by design.
const tag = String(Date.now()).slice(-5);
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function signIn(email, password = "Password@123", ip = "10.9.1.5") {
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

// counsellor: full life of an enquiry
{
  const { ctx, page, errors } = await signIn("uk.docs@medcity.test", "Password@123", "10.9.1.11");
  await page.goto(`${BASE}/enquiries`);
  await page.waitForLoadState("domcontentloaded");
  const list = (await page.locator("main").innerText()).toLowerCase();
  list.includes("nandana prakash") ? ok("seeded enquiries listed") : bad("seed enquiries missing");
  list.includes("overdue") ? ok("overdue tile present") : bad("no overdue tile");
  await page.screenshot({ path: `${OUT}/01-list.png`, fullPage: true });

  // capture a new one
  await page.goto(`${BASE}/enquiries/new`);
  await page.fill('input[name="name"]', `Test Walkin${tag}`);
  await page.fill('input[name="phone"]', `+91 9${tag}0000`);
  await page.fill('input[name="email"]', `test.walkin${tag}@example.com`);
  await page.fill('input[name="city"]', "Kottayam");
  await page.selectOption('select[name="source"]', "WALK_IN");
  await page.selectOption('select[name="interestPathway"]', "DEGREE");
  await page.fill('textarea[name="notes"]', "Asked about September intake in the UK.");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/enquiries\/[^/]+$/, { timeout: 20000 }).catch(() => {});
  /\/enquiries\/[a-z0-9]+$/i.test(page.url()) ? ok("enquiry created and opened") : bad("after create landed on " + page.url());
  await page.getByRole("heading", { name: `Test Walkin${tag}` }).first().waitFor({ timeout: 15000 }).catch(() => {});
  const detail = await page.locator("main").innerText();
  detail.includes(`Test Walkin${tag}`) ? ok("detail shows the name") : bad("detail missing name");
  detail.includes("Asked about September intake") ? ok("first note logged") : bad("note missing");
  await page.screenshot({ path: `${OUT}/02-detail.png`, fullPage: true });

  // log a follow up
  await page.fill('textarea[name="body"]', "Called back, sending the UK fee structure on WhatsApp.");
  await page.selectOption('main select[name="stage"]', "QUALIFIED");
  await page.locator('main button[type="submit"]').first().click();
  await page.locator("main").getByText(/Logged\. Stage is now/i).first().waitFor({ timeout: 10000 })
    .then(() => ok("follow up logged"))
    .catch(() => bad("follow up not confirmed"));
  const after = await page.locator("main").innerText();
  after.toLowerCase().includes("qualified") ? ok("stage moved to qualified") : bad("stage did not move");

  // convert to a student
  const enquiryUrl = page.url();
  await page.getByRole("link", { name: /Register as student/i }).click();
  await page.waitForURL(/\/students\/new/, { timeout: 20000 }).catch(() => {});
  const first = await page.inputValue('input[name="firstName"]').catch(() => "");
  first === `Test` || first === `Test` ? ok("student form prefilled from the enquiry") : bad(`prefill gave "${first}"`);
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/students\/[^/]+\/profile/, { timeout: 25000 }).catch(() => {});
  /\/students\/.+\/profile/.test(page.url()) ? ok("student created from the enquiry") : bad("after convert: " + page.url());

  await page.goto(enquiryUrl);
  await page.waitForLoadState("domcontentloaded");
  const converted = (await page.locator("main").innerText()).toLowerCase();
  converted.includes("converted") ? ok("enquiry closed as converted") : bad("enquiry not marked converted");
  converted.includes("became a student") ? ok("detail links to the student") : bad("no student link");
  await page.screenshot({ path: `${OUT}/03-converted.png`, fullPage: true });
  errors.length === 0 ? ok("counsellor: no client errors") : bad("counsellor errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// admin sees every branch's enquiries
{
  const { ctx, page, errors } = await signIn("admin@medcityoverseas.test", "Password@123", "10.9.1.12");
  await page.goto(`${BASE}/enquiries`);
  await page.waitForLoadState("domcontentloaded");
  const t = await page.locator("main").innerText();
  t.includes("Fahad Rahman") && t.includes("Sneha Rajan") ? ok("admin sees every branch") : bad("admin view is missing branches");
  (await page.locator('select[name="org"]').count()) ? ok("admin has the partner filter") : bad("no partner filter for admin");
  await page.screenshot({ path: `${OUT}/04-admin-list.png`, fullPage: true });
  errors.length === 0 ? ok("admin: no client errors") : bad("admin errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// a partner from another branch must not see this one
{
  const { ctx, page } = await signIn("owner@horizon.test", "Password@123", "10.9.1.13");
  await page.goto(`${BASE}/enquiries`);
  await page.waitForLoadState("domcontentloaded");
  const t = await page.locator("main").innerText();
  t.includes("Fahad Rahman") ? ok("sub-agent sees its own enquiry") : bad("sub-agent cannot see its own enquiry");
  !t.includes("Nandana Prakash") ? ok("sub-agent cannot see Kottayam's enquiries") : bad("org isolation broken");
  await ctx.close();
}

// management has no enquiries page
{
  const { ctx, page } = await signIn("management@medcityoverseas.test", "Password@123", "10.9.1.14");
  await page.goto(`${BASE}/enquiries`);
  await page.waitForLoadState("domcontentloaded");
  page.url().includes("/forbidden") ? ok("management is kept out of enquiries") : bad("management reached " + page.url());
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
