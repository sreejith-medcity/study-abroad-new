// Teams, the people on a file, and who a service request lands on.
//
// Medcity's work divides by pathway and destination before it divides by role,
// and the portal had no word for that. A file could also name only one person,
// so everybody else working on it was carried in somebody's head.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
// A folding part may already be open: click it only when it is not.
const open = async (where) => {
  const details = where.locator("details").first();
  if ((await details.count()) && !(await details.evaluate((d) => d.open))) await where.locator("summary").first().click();
  await where.page().waitForTimeout(250);
};

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
const studentId = sql("select id from students where not archived order by created_at limit 1");
const tag = Math.random().toString(36).slice(2, 6);
const name = `Ausbildung ${tag}`;
// A part nobody is on yet, because the same person cannot be added twice for
// the same part and this suite is run again and again.
const part = `Visa ${tag}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.239.2.7" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

// A team can be made, and somebody put in it.
await page.goto(`${BASE}/admin/teams`);
await page.waitForTimeout(500);
// Every team on the screen has a rename form with the same field names, so
// the new-team form is found by its own button rather than by field name.
const newTeam = page.locator("form").filter({ has: page.getByRole("button", { name: /add the team/i }) });
await newTeam.locator('input[name="name"]').fill(name);
await newTeam.locator('input[name="note"]').fill("Nursing and care pathways into Germany");
await newTeam.getByRole("button", { name: /add the team/i }).click();
await page.waitForTimeout(2000);
const teamId = sql(`select id from teams where name = '${name}'`);
check(Boolean(teamId), `the team is made (${name})`);

const fold = page.locator(`#team-${teamId}`);
check((await fold.count()) === 1, "it is on the screen");
await open(fold);
const member = fold.locator('select[name="userId"]');
const who = await member.locator("option").nth(1).getAttribute("value");
await member.selectOption(who);
await fold.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(2000);
check(sql(`select count(*) from team_members where team_id = '${teamId}'`) === "1", "somebody is in the team");

// A student's file can be put on that team, and carry other people.
await page.goto(`${BASE}/students/${studentId}/profile`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const panel = page.locator("#team");
check((await panel.count()) === 1, "the file has a team panel");
await open(panel);
await panel.locator('select[name="teamId"]').selectOption(teamId);
await panel.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(2000);
check(sql(`select coalesce(team_id, '') from students where id = '${studentId}'`) === teamId, "the file says which team carries it");

const before = Number(sql(`select count(*) from student_people where student_id = '${studentId}'`));
await page.reload();
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const panel2 = page.locator("#team");
await open(panel2);
const picker = panel2.locator('select[name="userId"]');
const person = await picker.locator("option").nth(1).getAttribute("value");
await picker.selectOption(person);
await panel2.locator('input[name="part"]').fill(part);
await panel2.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(2000);
const after = Number(sql(`select count(*) from student_people where student_id = '${studentId}'`));
check(after === before + 1, `somebody else is named on the file (${before} to ${after})`);
check(sql(`select part from student_people where student_id = '${studentId}' order by created_at desc limit 1`) === part, "with what they do on it");

// What the branch was told before the candidate registered is on the file,
// so the desk reads the conversation that led to it rather than a bare
// registration.
const fromEnquiry = sql("select student_id from enquiries where student_id is not null limit 1");
if (fromEnquiry) {
  await page.goto(`${BASE}/students/${fromEnquiry}/profile`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const asked = page.locator("#enquiry");
  check((await asked.count()) === 1, "the file carries the enquiry it came from");
  await open(asked);
  const said = (await asked.innerText()).replace(/\s+/g, " ");
  const note = sql(`select body from enquiry_notes where enquiry_id = (select id from enquiries where student_id = '${fromEnquiry}' limit 1) order by created_at desc limit 1`);
  check(!note || said.includes(note.slice(0, 30)), "with what was written on it");
} else {
  console.log("  --  no student registered from an enquiry here, skipped");
}

// A service request lands on the person named for that kind.
await page.goto(`${BASE}/admin/services`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const owners = page.locator("#owners");
check((await owners.count()) === 1, "the services screen says who handles what");
await open(owners);
const ticket = owners.locator('select[name="userId"]').first();
const owner = await ticket.locator("option").nth(1).getAttribute("value");
await ticket.selectOption(owner);
await owners.getByRole("button", { name: "Save" }).first().click();
await page.waitForTimeout(2000);
check(Number(sql("select count(*) from service_owners")) > 0, "the owner is kept");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
