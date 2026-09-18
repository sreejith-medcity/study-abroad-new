import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-roles";
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
  // "/" bounces on to the role's home, so wait for the second hop too.
  await page.waitForURL((u) => new URL(String(u)).pathname !== "/", { timeout: 15000 }).catch(() => {});
  return { ctx, page, errors };
}

// super admin: the full role list, and adding someone with a role and a title
{
  const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.9.6.11");
  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("domcontentloaded");
  const summary = page.locator("main summary", { hasText: "Add user to Medcity International Overseas Corporation" }).first();
  await summary.click();
  await page.waitForTimeout(400);

  const roleSelect = page.locator('main select[aria-label="Role for the new account"]').first();
  const options = await roleSelect.locator("option").allInnerTexts();
  const wanted = ["Super admin", "Ops manager", "Overseas admin", "Documentation team", "Management"];
  wanted.every((w) => options.some((o) => o.includes(w)))
    ? ok("every HQ role is offered: " + options.map((o) => o.trim()).join(", "))
    : bad("missing roles, got: " + options.join(", "));

  // the blurb follows the choice
  await roleSelect.selectOption("DOCUMENTATION");
  await page.waitForTimeout(300);
  (await page.locator("main").innerText()).includes("without moving statuses")
    ? ok("the role description updates with the choice")
    : bad("no description for documentation");

  await page.locator('main input[name="name"]').first().fill(`Docs Person ${tag}`);
  await page.locator('main input[name="email"]').first().fill(`docs.person${tag}@medcityoverseas.test`);
  await page.locator('main input[aria-label="Job title for the new account"]').first().fill("Germany documentation");
  await page.getByRole("button", { name: "Add user" }).first().click();
  await page.locator("main").getByText(/One-time password|temporary password/i).first().waitFor({ timeout: 15000 })
    .then(() => ok("a documentation account is created with a one-time password"))
    .catch(() => bad("no password confirmation after adding"));

  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("domcontentloaded");
  const listed = await page.locator("main").innerText();
  listed.includes(`Docs Person ${tag}`) ? ok("the new account is listed") : bad("new account missing from the list");
  listed.includes("Germany documentation") ? ok("the job title shows beside the name") : bad("job title missing");
  listed.includes("Documentation team") ? ok("the role chip reads Documentation team") : bad("role chip missing");
  await page.screenshot({ path: `${OUT}/01-people.png`, fullPage: true });

  // titles can be edited in place
  const row = page.locator("main li").filter({ hasText: `docs.person${tag}@medcityoverseas.test` }).first();
  await row.locator('input[name="deskLabel"]').fill("Germany desk documentation");
  await row.getByRole("button", { name: "Save title" }).click();
  await page.locator("main").getByText(/is now "Germany desk documentation"/).first().waitFor({ timeout: 12000 })
    .then(() => ok("a title can be changed in place"))
    .catch(() => bad("title change not confirmed"));
  errors.length === 0 ? ok("people page: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ops manager: admin powers plus accounts, no audit log
{
  const { ctx, page, errors } = await signIn("ops@medcityoverseas.test", "10.9.6.12");
  page.url().endsWith("/dashboard") ? ok("ops manager lands on the desk") : bad("landed on " + page.url());
  const nav = page.locator('nav[aria-label="Main"]');
  (await nav.getByText("Commission", { exact: true }).count()) ? ok("ops manager sees commission") : bad("no commission in nav");
  (await nav.getByText("Audit log").count()) === 0 ? ok("ops manager has no audit log") : bad("ops manager sees the audit log");

  await page.goto(`${BASE}/admin/audit`);
  await page.waitForLoadState("domcontentloaded");
  page.url().includes("/forbidden") ? ok("audit log is refused") : bad("ops manager reached " + page.url());

  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("domcontentloaded");
  (await page.locator('main select[aria-label="Change role"]').count()) ? ok("ops manager can change roles") : bad("no role control for ops manager");
  const opts = await page.locator('main select[aria-label="Change role"]').first().locator("option").evaluateAll((els) => els.map((e) => ({ v: e.value, d: e.disabled })));
  opts.find((o) => o.v === "SUPER_ADMIN")?.d ? ok("but cannot hand out super admin") : bad("ops manager could create a super admin");

  await page.goto(`${BASE}/admin/commission`);
  await page.waitForLoadState("domcontentloaded");
  (await page.locator('main select[aria-label="Move to"]').count()) ? ok("ops manager can move commission") : bad("ops manager cannot move commission");
  errors.length === 0 ? ok("ops manager: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// documentation team: files yes, statuses and money no
{
  const { ctx, page, errors } = await signIn("documentation@medcityoverseas.test", "10.9.6.13");
  page.url().endsWith("/dashboard") ? ok("documentation lands on the dashboard") : bad("landed on " + page.url());
  const t = (await page.locator("main").innerText()).toLowerCase();
  t.includes("documentation desk") ? ok("dashboard reads as the documentation desk") : bad("wrong dashboard heading");
  !t.includes("paid to partners") ? ok("money lines are hidden") : bad("money is visible to documentation");
  await page.screenshot({ path: `${OUT}/02-documentation-dashboard.png`, fullPage: true });

  const nav = page.locator('nav[aria-label="Main"]');
  (await nav.getByText("Students", { exact: true }).count()) ? ok("students are in the nav") : bad("no students in nav");
  (await nav.getByText("Commission", { exact: true }).count()) === 0 ? ok("commission is not in the nav") : bad("commission in documentation nav");
  (await nav.getByText("Partners", { exact: true }).count()) === 0 ? ok("partners is not in the nav") : bad("partners in documentation nav");

  for (const [path, label] of [["/admin/commission", "commission"], ["/admin/partners", "partners"], ["/admin/audit", "the audit log"], ["/admin/programs", "programs"]]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("domcontentloaded");
    page.url().includes("/forbidden") ? ok(`${label} is refused`) : bad(`documentation reached ${path}`);
  }

  // the work queue is theirs to read, without the status control
  await page.goto(`${BASE}/admin/queue`);
  await page.waitForLoadState("domcontentloaded");
  page.url().includes("/admin/queue") ? ok("the work queue opens") : bad("queue refused: " + page.url());
  (await page.locator("main").getByText("Change status").count()) === 0 ? ok("no status control in the queue") : bad("documentation can change status from the queue");

  // a student file: documents yes, status no
  await page.goto(`${BASE}/students`);
  await page.waitForLoadState("domcontentloaded");
  const href = await page.locator('main a[href*="/students/"][href$="/profile"]').first().getAttribute("href");
  await page.goto(`${BASE}${href.replace("/profile", "/documents")}`);
  await page.waitForLoadState("domcontentloaded");
  (await page.locator('input[type="file"]').count()) > 0 ? ok("documents can be uploaded") : bad("no upload control on the document tab");
  await page.goto(`${BASE}${href.replace("/profile", "/applications")}`);
  await page.waitForLoadState("domcontentloaded");
  const appText = await page.locator("main").innerText();
  !appText.includes("Change status") ? ok("no status control on the application") : bad("documentation can change status");
  appText.includes("check and ask partner") || appText.includes("Open check") ? ok("the pre-submission check is offered") : bad("no check link");
  await page.screenshot({ path: `${OUT}/03-documentation-file.png`, fullPage: true });
  errors.length === 0 ? ok("documentation: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
