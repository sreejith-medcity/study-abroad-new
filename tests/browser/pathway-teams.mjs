// Pathway teams across branches: a team carries AUSBILDUNG, an Ausbildung
// student registered at Medcity Kochi goes on it, and a member of the team
// from Medcity Kottayam can open and list the student while a Kottayam
// counsellor outside the team cannot. The lead gives the file to a member.
//
//   BASE=http://localhost:3103 DB=sa_teams node tests/browser/pathway-teams.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = process.env.DB ?? execFileSync("bash", ["-lc", "grep -o 'localhost:5432/[a-z0-9_]*' .env | head -1 | cut -d/ -f2"]).toString().trim();
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q]).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--renderer-process-limit=2"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 60000 }).catch(() => {});
  return { ctx, page, errors };
}
// One browser window at a time: the check is run beside other servers.
const serverErrors = [];
const done = async (s) => { serverErrors.push(...s.errors); await s.ctx.close(); };
const go = async (page, path) => {
  const res = await page.goto(BASE + path, { timeout: 180000, waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  return { status: res?.status() ?? 0, text: await page.locator("body").innerText() };
};

const stamp = Date.now().toString().slice(-6);
const teamName = `Ausbildung ${stamp}`;

// 1. The admin makes the team, links it to Ausbildung and puts Kottayam people in it.
const adm = await signIn("admin@medcityoverseas.test", "10.210.1.1");
await go(adm.page, "/admin/teams");
await adm.page.fill('form:has(button:has-text("Add the team")) input[name="name"]', teamName);
await adm.page.click('button:has-text("Add the team")');
await adm.page.getByText(`${teamName} added.`).waitFor({ timeout: 180000 });
const teamId = sql(`select id from teams where name = '${teamName}'`);
check(!!teamId, "the team is created");
await go(adm.page, "/admin/teams");
const section = adm.page.locator(`#team-${teamId}`);
if (!(await section.locator('input[name="pathway"][value="AUSBILDUNG"]').isVisible())) await section.locator("summary, button").first().click();
await section.locator('input[name="pathway"][value="AUSBILDUNG"]').check();
await section.locator('form:has(input[name="pathway"]) button:has-text("Save")').click();
await adm.page.waitForTimeout(1500);
check(sql(`select string_agg(pathway::text, ',') from team_pathways where team_id = '${teamId}'`) === "AUSBILDUNG", "the team carries Ausbildung");

const userId = (email) => sql(`select id from users where email = '${email}'`);
for (const [email, lead] of [["senior@medcity.test", true], ["trainee@medcity.test", false]]) {
  await go(adm.page, "/admin/teams");
  const sec = adm.page.locator(`#team-${teamId}`);
  if (!(await sec.locator('select[name="userId"]').isVisible())) await sec.locator("summary, button").first().click();
  await sec.locator('select[name="userId"]').selectOption(userId(email));
  if (lead) await sec.locator('input[name="lead"]').check();
  await sec.locator('button:has-text("Add")').last().click();
  await adm.page.getByText("Added to the team.").waitFor({ timeout: 180000 });
}
check(sql(`select count(*) from team_members where team_id = '${teamId}'`) === "2", "a Kottayam lead and member are in it");
await done(adm);

// 2. Medcity Kochi registers an Ausbildung student.
const kochi = await signIn("kochi@medcity.test", "10.210.1.2");
await go(kochi.page, "/students/new");
await kochi.page.fill('input[name="firstName"]', "Teamtest");
await kochi.page.fill('input[name="lastName"]', `Kochi${stamp}`);
await kochi.page.fill('input[name="phone"]', `+91 98${stamp}11`);
await kochi.page.selectOption('select[name="aim"]', "AUSBILDUNG");
await kochi.page.check('input[name="consent"]');
await kochi.page.click('button:has-text("Create student")');
await kochi.page.waitForURL(/\/students\/[^/]+\/profile/, { timeout: 60000 });
const studentId = kochi.page.url().split("/students/")[1].split("/")[0];
const row = sql(`select s.team_id || '|' || o.name from students s join organizations o on o.id = s.org_id where s.id = '${studentId}'`);
check(row === `${teamId}|Medcity Kochi`, `the Kochi student went on the team and stayed at Kochi (${row})`);
check((await go(kochi.page, `/students/${studentId}/profile`)).text.includes(`${teamName} team`), "the header names the team");
await done(kochi);

// 3. The Kottayam team member opens and lists them; a Kottayam counsellor outside the team cannot.
const member = await signIn("trainee@medcity.test", "10.210.1.3");
let r = await go(member.page, `/students/${studentId}/profile`);
check(r.status === 200 && r.text.includes(`Kochi${stamp}`), "a team member at another branch opens the student");
check(r.text.includes("Medcity Kochi"), "and is told which branch runs the file");
const listed = (s) => s.page.locator(`main a[href="/students/${studentId}/profile"]`).count();
await go(member.page, `/students?q=Kochi${stamp}`);
check((await listed(member)) > 0, "the student is on the team member's list");
await go(member.page, `/students?team=${teamId}`);
check((await listed(member)) > 0, "and on it filtered to the team");
await done(member);

const outsider = await signIn("uk.docs@medcity.test", "10.210.1.4");
r = await go(outsider.page, `/students/${studentId}/profile`);
check(r.status === 404 || /not found/i.test(r.text), "a Kottayam counsellor outside the team cannot open them");
await go(outsider.page, `/students?q=Kochi${stamp}`);
check((await listed(outsider)) === 0, "nor see them in the list");
await done(outsider);

const head = await signIn("kottayam@medcity.test", "10.210.1.5");
r = await go(head.page, `/students/${studentId}/profile`);
check(r.status === 404 || /not found/i.test(r.text), "the Kottayam branch head, not in the team, cannot open them either");
await done(head);

// 4. The lead gives the file to the member.
const lead = await signIn("senior@medcity.test", "10.210.1.6");
await go(lead.page, `/students/${studentId}/profile`);
const give = lead.page.locator('form:has(button:has-text("Give it"))');
if (!(await give.isVisible())) await lead.page.locator("#team summary, #team button").first().click();
await give.locator('select[name="userId"]').selectOption(userId("trainee@medcity.test"));
await give.locator('button:has-text("Give it")').click();
await lead.page.getByText(/now has this file for the team/).waitFor({ timeout: 180000 });
check(sql(`select count(*) from student_people where student_id = '${studentId}' and part = 'Team' and user_id = '${userId("trainee@medcity.test")}'`) === "1", "the lead put the member on the file for the team");
check(sql(`select assigned_to_id is null from students where id = '${studentId}'`) === "t", "and the branch's counsellor field is untouched");
await done(lead);

// 5. Apply to existing students: the seeded Ausbildung files without a team.
const adm2 = await signIn("admin@medcityoverseas.test", "10.210.1.7");
await go(adm2.page, "/admin/teams");
const sec = adm2.page.locator(`#team-${teamId}`);
if (!(await sec.locator('button:has-text("Apply to existing students")').isVisible())) await sec.locator("summary, button").first().click();
await sec.locator('button:has-text("Apply to existing students")').click();
await adm2.page.getByText(/put on|No files to add/).first().waitFor({ timeout: 180000 });
const said = await adm2.page.locator("body").innerText();
check(/students? put on|No files to add/.test(said), `the apply button reports what it did: ${said.match(/\d+ students? put on[^.]*|No files to add[^.]*/)?.[0]}`);
check(sql(`select count(*) from audit_logs where action = 'team.apply_existing' and entity_id = '${teamId}'`) === "1", "and is audited");

await done(adm2);
check(serverErrors.length === 0, `no server errors (${serverErrors.join(", ")})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
