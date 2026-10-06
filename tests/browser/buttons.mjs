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

const WHO = [
  ["admin@medcityoverseas.test", "admin", docsStudent],
  ["ops@medcityoverseas.test", "ops manager", docsStudent],
  ["documentation@medcityoverseas.test", "documentation", docsStudent],
  ["teamlead@medcityoverseas.test", "application team leader", docsStudent],
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
  for (const screen of screens) {
    await page.goto(BASE + screen, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
    if (page.url().includes("/forbidden")) continue;
    const labels = [...new Set(await page.locator('form button[type="submit"]').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean)))];
    for (const text of labels) {
      if (DESTRUCTIVE.test(text)) { skipped += 1; continue; }
      await page.goto(BASE + screen, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
      const button = page.locator('form button[type="submit"]', { hasText: text }).first();
      if (!(await button.count())) continue;
      await button.click({ timeout: 5000 }).catch(() => {});
      pressed += 1;
      await page.waitForTimeout(900);
      if (page.url().includes("/forbidden")) refused.push(`"${text}" on ${screen}`);
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
