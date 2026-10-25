import { chromium } from "playwright";
import { knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-portal";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
// The Ausbildung journey block reads the file it checks against straight from
// the database, the way the other suites do, so nothing is written down twice.
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
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
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
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
  // Fathima is a degree student: the Ausbildung journey is not hers to see.
  (await page.locator("[data-ausbildung-journey]").count()) === 0 ? ok("a degree student sees no Ausbildung journey card") : bad("the Ausbildung journey card showed for a degree student");
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
  // Visible ones only: a file already with us has a Replace form folded away
  // under it, which is not something still to upload.
  const uploads = await page.locator('input[type="file"]:visible').count();
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
    await page.locator('input[type="file"]:visible').first().setInputFiles(tmp);
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

// the Ausbildung student: the journey card on the portal home
{
  const akshara = sql("select id from students where first_name = 'Akshara' and last_name = 'Anilkumar'");
  if (!akshara) {
    bad("the seeded Ausbildung student Akshara Anilkumar is not in the database");
  } else {
    // Akshara has no portal account in the seed. Give her one with the shared
    // test password, or bring an account an earlier run or an invite left
    // behind back to it, so the sign-in below is the plain one.
    const email = "akshara.anilkumar@example.com";
    const hash = "(select password_hash from users where email = 'fathima.rahman@example.com')";
    if (sql(`select count(*) from users where role = 'STUDENT' and student_id = '${akshara}'`) === "0") {
      sql(`insert into users (id, name, email, phone, password_hash, role, org_id, student_id, locale)
           select substr(md5(random()::text), 1, 20), first_name || ' ' || last_name, '${email}', phone, ${hash}, 'STUDENT', org_id, id, 'en' from students where id = '${akshara}'`);
    }
    sql(`update users set password_hash = ${hash}, must_change_password = false, active = true, locale = 'en' where role = 'STUDENT' and student_id = '${akshara}'`);
    const login = sql(`select email from users where role = 'STUDENT' and student_id = '${akshara}' order by created_at limit 1`);

    // The round the portal follows is the one the staff tab follows: open, a
    // live one before a finished one, the latest moved first. It is put at
    // step 10 (employer interviews), where the seed has it, so the card's
    // words are known whatever another suite moved it to.
    const liveApp = sql(`select xa.id from applications xa join programs xp on xp.id = xa.program_id join status_definitions xs on xs.id = xa.status_id
      where xa.student_id = '${akshara}' and xp.pathway = 'AUSBILDUNG' and xs."group" <> 'CLOSED' order by (xs."group" = 'SUCCESS') asc, xa.status_changed_at desc limit 1`);
    sql(`update applications set status_id = (select id from status_definitions where pathway = 'AUSBILDUNG' and code = 'EMPLOYER_INTERVIEW'), status_changed_at = now() where id = '${liveApp}'`);
    // A mentor on the file, so the card has one to name: the first documentation officer.
    if (sql(`select count(*) from student_people where student_id = '${akshara}' and part = 'Documentation mentor'`) === "0") {
      sql(`insert into student_people (id, student_id, user_id, part) select substr(md5(random()::text), 1, 20), '${akshara}', id, 'Documentation mentor' from users where role = 'DOCUMENTATION' and active order by created_at limit 1`);
    }
    const mentor = sql(`select u.name from student_people sp join users u on u.id = sp.user_id where sp.student_id = '${akshara}' and sp.part = 'Documentation mentor' and u.active order by sp.created_at desc limit 1`);
    const counsellor = sql(`select u.name || '|' || coalesce(u.phone, '') from students s join users u on u.id = s.assigned_to_id where s.id = '${akshara}'`).split("|");

    const { ctx, page, errors } = await fresh("10.9.5.13");
    await signIn(page, login);
    await page.waitForURL(/\/portal/, { timeout: 15000 }).catch(() => {});
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const card = page.locator("[data-ausbildung-journey]");
    (await card.count()) === 1 ? ok("an Ausbildung student gets the journey card") : bad("no Ausbildung journey card on " + page.url());
    if (await card.count()) {
      const text = (await card.innerText()).replace(/\s+/g, " ");
      text.includes("Your Ausbildung journey") ? ok("the card is titled for the student") : bad("card title missing");

      // The current step and the next, in the student's words.
      const step = await card.getAttribute("data-current-step");
      const next = await card.getAttribute("data-next-step");
      step === "10" && next === "11" ? ok("the card is at step 10 with step 11 next") : bad(`card at step ${step}, next ${next}`);
      const now = (await card.locator("[data-journey-now]").innerText()).trim();
      /Interviews with employers are being arranged/.test(now) ? ok(`the current step reads in plain words (${now})`) : bad(`current step reads: ${now}`);
      const then = (await card.locator("[data-journey-next]").innerText()).trim();
      /training contract/i.test(then) ? ok(`what happens next is the next step's line (${then})`) : bad(`next step reads: ${then}`);
      !/Interview scheduling|Assigning a mentor/.test(text) ? ok("the staff titles stay with the staff") : bad("a staff step title reached the student");
      // The desks: placement lit, the ones behind it done, visa and travel ahead.
      (await card.locator('[data-journey-desk="PLACEMENT"][data-position="NOW"]').count()) === 1 ? ok("the placement desk is the one lit") : bad("placement desk not lit");
      (await card.locator('[data-journey-desk="COUNSELLING"][data-position="DONE"]').count()) === 1 ? ok("counselling is behind the file") : bad("counselling not marked done");
      (await card.locator('[data-journey-desk="VISA"][data-position="AHEAD"]').count()) === 1 ? ok("visa is still ahead") : bad("visa not marked ahead");
      (await card.locator("[data-journey-desk]").count()) === 6 ? ok("six desks on the track") : bad("desk count off");
      // Nothing internal: no turnaround, no desk emails.
      !/T\+\d|turnaround|@miak\.in|same day/i.test(text) ? ok("no turnaround days or desk emails reach the student") : bad("internal detail on the card: " + text.slice(0, 200));

      // Who to contact.
      const contacts = (await card.locator("[data-journey-contacts]").innerText()).replace(/\s+/g, " ");
      contacts.includes(counsellor[0]) ? ok(`the counsellor is named (${counsellor[0]})`) : bad(`counsellor missing from: ${contacts}`);
      !counsellor[1] || contacts.includes(counsellor[1]) ? ok("with their phone") : bad(`counsellor phone missing from: ${contacts}`);
      mentor && contacts.includes(mentor) ? ok(`the mentor is named (${mentor})`) : bad(`mentor ${mentor || "(none set)"} missing from: ${contacts}`);

      // The German chips follow the modules on file, with the next level marked.
      const states = {};
      for (const row of sql(`select level || '=' || state from german_modules where student_id = '${akshara}'`).split("\n").filter(Boolean)) {
        const [level, state] = row.split("=");
        states[level] = state;
      }
      let chipsRight = true;
      for (const level of ["A1", "A2", "B1", "B2"]) {
        const want = states[level] ?? "NOT_STARTED";
        const got = await card.locator(`[data-german-level="${level}"]`).getAttribute("data-state");
        if (got !== want) { chipsRight = false; bad(`German ${level} chip says ${got}, the file says ${want}`); }
      }
      if (chipsRight) ok("the four German chips match the modules on file");
      const nextLevel = ["A1", "A2", "B1", "B2"].find((l) => (states[l] ?? "NOT_STARTED") !== "COMPLETED") ?? "";
      (await card.locator("[data-german-levels]").getAttribute("data-next-level")) === nextLevel ? ok(`the next German level is ${nextLevel || "none: all done"}`) : bad("next German level is wrong");

      // The payments: next milestone and paid so far, from the same income lines the staff tab sums.
      const [owed, received] = sql(`select coalesce(sum(coalesce(invoiced_amount, expected_amount)), 0)::int || '|' || coalesce(sum(received_amount), 0)::int from income_lines
        where student_id = '${akshara}' and kind = 'SERVICE_FEE' and currency = 'INR' and state not in ('WRITTEN_OFF', 'NOT_APPLICABLE')`).split("|").map(Number);
      const percents = [[7, 50], [11, 80], [12, 100]];
      const wantNext = owed > 0 ? String(percents.find(([, p]) => received < Math.round((owed * p) / 100))?.[0] ?? "") : "11";
      const gotNext = await card.locator("[data-payments]").getAttribute("data-next-milestone");
      gotNext === wantNext ? ok(`the next milestone is step ${wantNext || "none: all paid"}`) : bad(`next milestone is ${gotNext}, expected ${wantNext}`);
      const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
      const paid = (await card.locator("[data-paid-so-far]").innerText()).replace(/\s+/g, " ");
      const wantPaid = owed > 0 ? (received > 0 ? inr(received) : "Not recorded") : "Not recorded";
      paid.includes(wantPaid) ? ok(`paid so far reads ${wantPaid}`) : bad(`paid so far reads ${paid}, expected ${wantPaid}`);
      if (owed > 0) paid.includes(inr(owed)) ? ok(`against the ${inr(owed)} raised`) : bad(`total missing from: ${paid}`);
      if (owed > 0 && wantNext) {
        const amount = inr(Math.round((owed * percents.find(([s]) => String(s) === wantNext)[1]) / 100));
        (await card.locator("[data-next-payment]").innerText()).includes(amount) ? ok(`the next payment's amount is ${amount}`) : bad("next payment amount missing");
      }
      !/₹0\b/.test(text) ? ok("no zero stands in for an unknown amount") : bad("a zero amount is shown");
      await page.screenshot({ path: `${OUT}/07-ausbildung-journey.png`, fullPage: true });
    }
    errors.length === 0 ? ok("ausbildung portal: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
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
      // The password stays on the page, so a counsellor can read it to the student.
      await page.locator("main").getByText(/One-time password/i).first().waitFor({ timeout: 15000 })
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
