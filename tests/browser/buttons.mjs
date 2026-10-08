// Every control on a screen a role can reach belongs to that role.
//
// The sibling of nav.mjs. That one presses links; this one presses the things
// on the page: the submit button of every form, and the plain buttons that post
// straight away. A control that lands on the forbidden screen is the same bug
// as a link that does, and it is worse, because somebody has already typed
// their work into it.
//
// Validation errors are the point of a form and are ignored. Wants the plain
// seed, and a throwaway database: this presses things.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

// One role per line, with the screens that role actually works on.
const mine = (email) => sql(`select coalesce((select s.id from students s where s.assigned_to_id = (select id from users where email = '${email}') limit 1), '')`);
const docsStudent = sql("select coalesce((select a.student_id from applications a where a.handed_over_at is not null limit 1), '')");
const branchStudent = mine("uk.docs@medcity.test");
const deskStudent = mine("desk.counsellor@medcityoverseas.test") || docsStudent;
const traineeStudent = mine("trainee@medcity.test") || branchStudent;

// A profile locks once an application has gone out, and a locked form hides its
// own submit button. Left alone, this suite would walk straight past the very
// control that was reported, so the two students it works on are unlocked.
for (const id of [docsStudent, branchStudent, deskStudent, traineeStudent]) if (id) sql(`update students set profile_locked = false where id = '${id}'`);

/** The two roles that are in here all day get the modals opened as well. */
const DEEP = ["counsellor", "documentation"];

const WHO = [
  ["admin@medcityoverseas.test", "admin", docsStudent],
  ["ops@medcityoverseas.test", "ops manager", docsStudent],
  ["documentation@medcityoverseas.test", "documentation", docsStudent],
  ["teamlead@medcityoverseas.test", "application team leader", docsStudent],
  ["finance@medcityoverseas.test", "finance", docsStudent],
  ["management@medcityoverseas.test", "management", docsStudent],
  ["desk.counsellor@medcityoverseas.test", "desk counsellor", deskStudent],
  ["kottayam@medcity.test", "branch head", branchStudent],
  ["uk.docs@medcity.test", "counsellor", branchStudent],
  ["senior@medcity.test", "senior counsellor", branchStudent],
  ["trainee@medcity.test", "trainee counsellor", traineeStudent],
];

/** The student's own tabs, plus every screen that role is given in its sidebar. */
const STUDENT_TABS = (id) => [
  `/students/${id}/profile`,
  `/students/${id}`,
  `/students/${id}/documentation`,
  `/students/${id}/applications`,
  `/students/${id}/services`,
  `/students/${id}/shortlist`,
];

/**
 * Buttons that destroy something are described, not pressed.
 *
 * The point here is who a control belongs to, which the server decides before
 * it does the work. Pressing Delete on every screen to learn that would leave
 * nothing for the next role to walk.
 */
const DESTRUCTIVE = /delete|remove|archive|write.?off|revoke|deactivate|pause|clear|reset|cancel|withdraw|sign out|forget/i;

/**
 * A refusal the server writes into the form rather than a redirect.
 *
 * The forbidden screen is the loud failure; this is the quiet one, and it is
 * the same bug: a control offered to somebody whose role the action then turns
 * down. Validation errors ("choose a program", "enter a reason") are the point
 * of a form and are not this.
 */
const REFUSED = /your role|not open to|only an admin|only a|is not allowed|cannot be done by|does not start|does not have|no permission|not permitted|forbidden/i;

/** Modals hide their controls until opened, so the openers get pressed too. */
const OPENS_MODAL = /^(?!.*(close|cancel)).{3,60}$/i;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 10;
for (const [email, label, studentId] of WHO) {
  if (!studentId) { bad(`${label}: the seed left no student to work on`); continue; }
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": `10.253.1.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  if (page.url().includes("/login")) { bad(`${label}: cannot sign in`); await ctx.close(); continue; }

  await page.locator("aside a").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  const own = [...new Set(await page.locator("aside a").evaluateAll((els) => els.map((e) => e.getAttribute("href")).filter((h) => h && h.startsWith("/"))))];
  const screens = [...new Set([...STUDENT_TABS(studentId), ...own])];

  const refused = [];
  let pressed = 0;
  let skipped = 0;

  const settle = async () => {
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
  };
  const alerts = async () =>
    page
      .locator('[role="alert"], [role="status"]')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean))
      .catch(() => []);

  /**
   * Did pressing that land on the forbidden screen, or draw a refusal?
   *
   * Only what the press itself put on the screen counts. A page can carry a
   * standing notice of its own - a read-only file says so at the top - and
   * reading that as the answer to a button nobody could even press is how a
   * sweep cries wolf.
   */
  const verdict = async (what, screen, before) => {
    await page.waitForTimeout(900);
    if (page.url().includes("/forbidden")) { refused.push(`${what} on ${screen} (forbidden screen)`); return; }
    const fresh = (await alerts()).filter((t) => !before.includes(t));
    const no = fresh.find((t) => REFUSED.test(t));
    if (no) refused.push(`${what} on ${screen} ("${no.slice(0, 90)}")`);
  };

  for (const screen of screens) {
    await page.goto(BASE + screen, { waitUntil: "domcontentloaded" }).catch(() => {});
    await settle();
    if (page.url().includes("/forbidden")) continue;

    const labels = [...new Set(await page.locator('form button[type="submit"]').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean)))];
    for (const text of labels) {
      if (DESTRUCTIVE.test(text)) { skipped += 1; continue; }
      await page.goto(BASE + screen, { waitUntil: "domcontentloaded" }).catch(() => {});
      await settle();
      const button = page.locator('form button[type="submit"]', { hasText: text }).first();
      if (!(await button.count())) continue;
      const before = await alerts();
      await button.click({ timeout: 5000 }).catch(() => {});
      pressed += 1;
      await verdict(`"${text}"`, screen, before);
    }

    // Then the controls behind a modal, which the sweep above cannot see: open
    // it, press its submit, and judge that the same way.
    if (!DEEP.includes(label)) continue;
    const openers = [...new Set(await page.locator('main button[type="button"]').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean)))];
    for (const text of openers) {
      if (DESTRUCTIVE.test(text) || !OPENS_MODAL.test(text)) { skipped += 1; continue; }
      await page.goto(BASE + screen, { waitUntil: "domcontentloaded" }).catch(() => {});
      await settle();
      const opener = page.locator('main button[type="button"]', { hasText: text }).first();
      if (!(await opener.count())) continue;
      await opener.click({ timeout: 5000 }).catch(() => {});
      const dialog = page.locator('[role="dialog"]').first();
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const submit = dialog.locator('form button[type="submit"]').first();
      if (!(await submit.count())) { await page.keyboard.press("Escape"); continue; }
      const inner = (await submit.textContent().catch(() => ""))?.trim() || text;
      if (DESTRUCTIVE.test(inner)) { skipped += 1; await page.keyboard.press("Escape"); continue; }
      const before = await alerts();
      await submit.click({ timeout: 5000 }).catch(() => {});
      pressed += 1;
      await verdict(`"${inner}" (in "${text}")`, screen, before);
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  refused.length === 0
    ? ok(`${label}: all ${pressed} controls across ${screens.length} screens belong to them (${skipped} destructive ones described, not pressed)`)
    : bad(`${label}: refused by ${refused.join("; ")}`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
