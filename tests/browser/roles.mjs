import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const DB = execFileSync("bash", ["-lc", "grep -o 'localhost:5432/[a-z0-9_]*' .env | head -1 | cut -d/ -f2"]).toString().trim();
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();

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
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
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
  // A one-time password stays on the page rather than riding a toast that fades,
  // because somebody has to read it out or copy it before it is gone for good.
  const credential = page.locator("main").getByText(/Temporary password for .*@/i).first();
  await credential.waitFor({ timeout: 15000 })
    .then(() => ok("a documentation account is created with a one-time password"))
    .catch(() => bad("no password confirmation after adding"));
  await page.waitForTimeout(6000);
  (await credential.isVisible())
    ? ok("the password is still on screen six seconds later")
    : bad("the one-time password disappeared before it could be used");
  (await page.getByRole("button", { name: "Copy" }).first().count())
    ? ok("the password can be copied")
    : bad("no copy button beside the password");

  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  // The page streams, so wait for the row rather than reading the text once.
  await page.locator("main").getByText(`Docs Person ${tag}`).first().waitFor({ timeout: 15000 })
    .then(() => ok("the new account is listed"))
    .catch(() => bad("new account missing from the list"));
  const listed = await page.locator("main").innerText();
  listed.includes("Germany documentation") ? ok("the job title shows beside the name") : bad("job title missing");
  listed.includes("Documentation team") ? ok("the role chip reads Documentation team") : bad("role chip missing");
  await page.screenshot({ path: `${OUT}/01-people.png`, fullPage: true });

  // titles can be edited in place
  const row = page.locator("main li").filter({ hasText: `docs.person${tag}@medcityoverseas.test` }).first();
  await row.locator('input[name="deskLabel"]').fill("Germany desk documentation");
  await row.getByRole("button", { name: "Save title" }).click();
  // Assert the change itself rather than the toast, which fades after a few seconds.
  await page.locator("main").getByText("Germany desk documentation").first().waitFor({ timeout: 12000 })
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
  await page.waitForURL((u) => String(u).includes("/forbidden"), { timeout: 10000 }).catch(() => {});
  page.url().includes("/forbidden") ? ok("audit log is refused") : bad("ops manager reached " + page.url());

  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator('main select[aria-label="Change role"]').count()) ? ok("ops manager can change roles") : bad("no role control for ops manager");
  const opts = await page.locator('main select[aria-label="Change role"]').first().locator("option").evaluateAll((els) => els.map((e) => ({ v: e.value, d: e.disabled })));
  opts.find((o) => o.v === "SUPER_ADMIN")?.d ? ok("but cannot hand out super admin") : bad("ops manager could create a super admin");

  await page.goto(`${BASE}/admin/commission`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
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
    await page.waitForURL((u) => String(u).includes("/forbidden"), { timeout: 10000 }).catch(() => {});
    page.url().includes("/forbidden") ? ok(`${label} is refused`) : bad(`documentation reached ${path}`);
  }

  // the work queue is theirs to read, without the status control
  await page.goto(`${BASE}/admin/queue`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/admin/queue") ? ok("the work queue opens") : bad("queue refused: " + page.url());
  (await page.locator("main").getByText("Change status").count()) === 0 ? ok("no status control in the queue") : bad("documentation can change status from the queue");

  // a student file: documents yes, status no.
  // The documentation team works the files given to them, so give them one the
  // way the queue would: by making them the officer on it.
  // This suite is about which controls a role is offered, not about which files
  // it is given, so give it all of them and let the scoping suites test scoping.
  sql(`update applications set officer_id = (select id from users where email = 'documentation@medcityoverseas.test')`);
  await page.goto(`${BASE}/students`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  // The documentation team sees the files given to them, so give them one the
  // way the queue would: by being the officer on it.
  const href = await page.locator('main a[href*="/students/"][href$="/profile"]').first().getAttribute("href").catch(() => null);
  await page.goto(`${BASE}${href.replace("/profile", "/documents")}`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator('input[type="file"]').count()) > 0 ? ok("documents can be uploaded") : bad("no upload control on the document tab");
  // Open a student who actually has an application, so the detail panel renders.
  await page.goto(`${BASE}/applications`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const appLink = await page.locator('main a[href*="/applications?app="]').first().getAttribute("href");
  await page.goto(`${BASE}${appLink}`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const appText = await page.locator("main").innerText();
  !appText.includes("Change status") ? ok("no status control on the application") : bad("documentation can change status");
  appText.includes("check and ask partner") || appText.includes("Open check") ? ok("the pre-submission check is offered") : bad("no check link");
  await page.screenshot({ path: `${OUT}/03-documentation-file.png`, fullPage: true });
  errors.length === 0 ? ok("documentation: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// --- The documentation desk registers students. The button was there and the
// screen behind it refused them, which is the worst of both.
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.210.2.1" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "documentation@medcityoverseas.test");
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.goto(`${BASE}/students/new`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/students/new") ? ok("documentation: the register screen opens for them") : bad(`documentation: turned away from registering (${page.url()})`);
  const regText = await page.locator("main").innerText();
  /branch/i.test(regText) ? ok("documentation: and they are asked which branch the student belongs to") : bad("documentation: no branch picker for a desk user");

  // Management reads and changes nothing, so it keeps neither the button nor the screen.
  await page.goto(`${BASE}/students`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator("main").innerText()).includes("Register student") ? ok("documentation: the button is on the students screen too") : bad("documentation: no register button");
  errors.length === 0 ? ok("documentation: no client errors registering") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// --- The application team leader: the desk, and what runs it.
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.210.2.2" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "teamlead@medcityoverseas.test");
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.goto(`${BASE}/dashboard`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const lead = await page.locator("main").innerText();
  /The documentation desk/i.test(lead) ? ok("team leader: their dashboard is the desk, not the applications board") : bad(`team leader: wrong dashboard (${lead.slice(0, 80).replace(/\n/g, " ")})`);
  /Who is carrying what/i.test(lead) ? ok("team leader: it says who is carrying what") : bad("team leader: no standing table");
  !/Commission|Invoices raised/i.test(lead) ? ok("team leader: running the desk is not running the money") : bad("team leader: money on the desk dashboard");
  await page.screenshot({ path: `${OUT}/05-team-leader.png`, fullPage: true });

  await page.goto(`${BASE}/documentation`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/documentation") ? ok("team leader: they work the queue like anybody else") : bad("team leader: turned away from the queue");

  // What the desk chases is theirs to set; the money is not.
  await page.goto(`${BASE}/admin/documents`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/admin/documents") ? ok("team leader: they set what the desk chases") : bad(`team leader: refused the requirements screen (${page.url()})`);
  await page.goto(`${BASE}/admin/invoices`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  !page.url().includes("/admin/invoices") ? ok("team leader: and are kept out of the invoices") : bad("team leader: reached the invoice screens");

  // An officer does not get the lead's screens.
  const off = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.210.2.3" } });
  const op = await off.newPage();
  await op.goto(`${BASE}/login`);
  await op.fill('input[name="email"]', "documentation@medcityoverseas.test");
  await op.fill('input[name="password"]', "Password@123");
  await op.click('button[type="submit"]');
  await op.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await op.goto(`${BASE}/admin/documents`);
  await op.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  !op.url().includes("/admin/documents") ? ok("officer: an officer does not set what the desk chases") : bad("officer: reached the requirements screen");
  await op.goto(`${BASE}/dashboard`);
  await op.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  !/Who is carrying what/i.test(await op.locator("main").innerText()) ? ok("officer: and does not see who is carrying what") : bad("officer: given the desk standing");
  await off.close();

  errors.length === 0 ? ok("team leader: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// --- A dashboard per role, each with that role's own work at the top.
{
  const seen = [
    ["senior@medcity.test", "senior counsellor", /every student/i, /Wallet balance|Counsellor seats/],
    ["trainee@medcity.test", "trainee", /in training/i, null],
    ["desk.counsellor@medcityoverseas.test", "desk counsellor", /Overseas desk/i, /Counsellor seats|Benefits level/],
    ["staff@horizon.test", "sub-agent counsellor", /referred/i, null],
    ["uk.docs@medcity.test", "counsellor", /Your desk/i, /Your team/],
  ];
  let ip = 60;
  for (const [email, label, wants, refuses] of seen) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.212.1.${ip++}` } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "Password@123");
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
    await page.goto(`${BASE}/dashboard`);
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const text = await page.locator("main").innerText();
    wants.test(text) ? ok(`${label}: gets their own dashboard`) : bad(`${label}: wrong dashboard (${text.slice(0, 70).replace(/\n/g, " ")})`);
    if (refuses) (!refuses.test(text) ? ok(`${label}: and not what belongs to somebody else`) : bad(`${label}: shown ${refuses}`));
    errors.length === 0 ? ok(`${label}: no client errors`) : bad(`${label}: ${errors.slice(0, 2).join(" | ")}`);
    await ctx.close();
  }
}

// A trainee builds files somebody else sends, which is the one thing their
// dashboard has that nobody else's does.
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.212.2.1" } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "trainee@medcity.test");
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.goto(`${BASE}/dashboard`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await page.locator("main").innerText();
  /Built and waiting to be sent/i.test(t) ? ok("trainee: what they built and cannot send is on their own screen") : bad("trainee: no waiting-to-be-sent card");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
