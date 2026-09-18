import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-portal";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function fresh(ip) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
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

// the student
{
  const { ctx, page, errors } = await fresh("10.9.5.11");
  await signIn(page, "fathima.rahman@example.com");
  await page.waitForURL(/\/portal/, { timeout: 15000 }).catch(() => {});
  page.url().includes("/portal") ? ok("a student lands in the portal") : bad("student landed on " + page.url());

  // Malayalam, whichever way the account was left by an earlier run.
  await page.getByRole("button", { name: "മലയാളം" }).click();
  await page.waitForTimeout(1500);
  let t = await page.locator("main").innerText();
  t.includes("നമസ്കാരം") ? ok("renders in Malayalam") : bad("Malayalam greeting missing");
  await page.screenshot({ path: `${OUT}/01-home-ml.png`, fullPage: true });

  await page.getByRole("button", { name: "English" }).click();
  await page.waitForTimeout(1500);
  t = await page.locator("main").innerText();
  t.includes("Hello") ? ok("language switch works") : bad("did not switch to English");
  t.includes("Your applications") ? ok("applications listed") : bad("no applications section");
  await page.screenshot({ path: `${OUT}/02-home-en.png`, fullPage: true });

  // staff pages are not reachable
  await page.goto(`${BASE}/dashboard`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/portal") ? ok("staff dashboard redirects back to the portal") : bad("student reached " + page.url());
  await page.goto(`${BASE}/students`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/portal") ? ok("student list is out of reach") : bad("student reached " + page.url());

  // documents
  await page.goto(`${BASE}/portal/documents`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  t = await page.locator("main").innerText();
  t.includes("Your documents") ? ok("documents page renders") : bad("documents page missing");
  const uploads = await page.locator('input[type="file"]').count();
  // Nothing outstanding is a valid state once an earlier run has uploaded it.
  uploads > 0
    ? ok(`${uploads} documents can be uploaded`)
    : t.includes("Every document we asked for is with us")
      ? ok("nothing outstanding, and the page says so")
      : bad("no upload control and no all-clear message");
  await page.screenshot({ path: `${OUT}/03-documents.png`, fullPage: true });

  // upload one
  if (uploads > 0) {
    const tmp = "/tmp/smoke-portal/sample.pdf";
    fs.writeFileSync(tmp, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    await page.locator('input[type="file"]').first().setInputFiles(tmp);
    await page.getByRole("button", { name: "Upload" }).first().click();
    await page.waitForURL(/uploaded=/, { timeout: 15000 }).catch(() => {});
    await page.locator("main").getByText(/We have it|ഞങ്ങൾക്ക് ലഭിച്ചു/).first().waitFor({ timeout: 15000 })
      .then(() => ok("a student upload is accepted and confirmed"))
      .catch(() => bad("upload gave no confirmation"));
  }

  // messages
  await page.goto(`${BASE}/portal/messages`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  t = await page.locator("main").innerText();
  t.includes("Messages") ? ok("messages page renders") : bad("messages page missing");
  !t.includes("Dear team") ? ok("team-only notes stay hidden") : bad("a team note leaked into the student thread");
  await page.fill('textarea[name="body"]', "Sent from the portal smoke test.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(2500);
  (await page.locator("main").innerText()).includes("Sent from the portal smoke test")
    ? ok("a student message posts to the thread")
    : bad("message did not appear");
  await page.screenshot({ path: `${OUT}/04-messages.png`, fullPage: true });

  // profile
  await page.goto(`${BASE}/portal/profile`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  t = await page.locator("main").innerText();
  t.includes("Your details") ? ok("profile page renders") : bad("profile page missing");
  /[A-Z]•+\d\d/.test(t) ? ok("passport stays masked in the portal") : bad("passport not masked: " + (t.match(/Passport[\s\S]{0,40}/) ?? [""])[0]);
  await page.screenshot({ path: `${OUT}/05-profile.png`, fullPage: true });
  errors.length === 0 ? ok("portal: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// the counsellor sees the student's message and can invite another student
{
  const { ctx, page } = await fresh("10.9.5.12");
  await signIn(page, "uk.docs@medcity.test");
  await page.goto(`${BASE}/students`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const link = page.locator('main a[href*="/students/"][href$="/profile"]').first();
  if (await link.count()) {
    const href = await link.getAttribute("href");
    await page.goto(`${BASE}${href}`);
    await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const t = await page.locator("main").innerText();
    t.includes("Student portal") ? ok("the student file offers portal access") : bad("no portal card on the student file");
    // An earlier run may already have invited this student, which is a valid state.
    const invite = page.getByRole("button", { name: /Give portal access/i }).first();
    if (await invite.count()) {
      await invite.click();
      await page.locator('[role="status"]').getByText(/One-time password/i).first().waitFor({ timeout: 15000 })
        .then(() => ok("invite issues a one-time password"))
        .catch(() => bad("invite gave no password"));
    } else {
      t.includes("can sign in") || t.includes("Portal account")
        ? ok("this student already has portal access, and the file says so")
        : bad("no invite button and no sign of an existing portal account");
    }
    await page.screenshot({ path: `${OUT}/06-invite.png`, fullPage: true });
  } else {
    bad("could not open a student file");
  }
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
