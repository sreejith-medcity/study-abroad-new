// The family side: the Medcity ID on the file and in the search box, the
// student's dashboard rebuilt around the nine stages, and a parent's own
// read-only sign-in. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-family";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip, password = "Password@123") {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
const body = async (page) => { await settle(page); return page.locator("body").innerText(); };
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  let last = "";
  while (Date.now() < until) {
    last = await page.locator("main").innerText().catch(() => "");
    if (re.test(last)) return last;
    await page.waitForTimeout(300);
  }
  return last;
}
// A one-time password must stay on the screen long enough to be read out, so it
// is an alert inside the form rather than a toast that slides away.
async function waitIn(scope, re, timeout = 15000) {
  const until = Date.now() + timeout;
  let last = "";
  while (Date.now() < until) {
    last = await scope.innerText().catch(() => "");
    if (re.test(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}

// A cold server answers the first request slowly enough to race a read, so the
// suite knocks once before it starts counting.
await fetch(`${BASE}/login`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

// --- Every seeded student carries a Medcity ID, and the shape is the shape.
const seeded = sql("select count(*) from students where medcity_id is null");
check(seeded === "0", `id: every student has one (${seeded} without)`);
const shaped = sql("select count(*) from students where medcity_id !~ '^MC-[A-Z0-9]{2,4}-[0-9]{2}-[0-9]{4,}$'");
check(shaped === "0", `id: every one is shaped MC-BRANCH-YY-NNNN (${shaped} malformed)`);
const codes = sql("select count(*) from organizations where id_code is null");
check(codes === "0", `id: every branch has its letters (${codes} without)`);
const perBranch = sql("select count(*) from (select org_id, date_part('year', created_at), count(*) c, count(distinct medcity_id) d from students group by 1,2) x where c <> d");
check(perBranch === "0", "id: no serial is used twice inside a branch and a year");

// --- The counsellor's screens: on the file, in the list, and in the search box.
const counsellor = await signIn("uk.docs@medcity.test", "10.180.1.1");
const cp = counsellor.page;
const student = sql("select id from students where medcity_id is not null order by created_at limit 1");
const theirId = sql(`select medcity_id from students where id = '${student}'`);
let text = await body(cp);
text = await go(cp, `/students/${student}/profile`);
check((await body(cp)).includes(theirId), `file: the ID is on the header (${theirId})`);
text = await go(cp, "/students");
check(text.includes(theirId), "list: the ID is under the name");
// Read back the way a family says it on the phone, punctuation and all.
const spoken = theirId.replace(/-/g, " ").toLowerCase();
text = await go(cp, `/students?q=${encodeURIComponent(spoken)}`);
const name = sql(`select first_name || ' ' || last_name from students where id = '${student}'`);
check(text.includes(name), `search: "${spoken}" finds them`);
const anotherId = sql(`select medcity_id from students where id <> '${student}' limit 1`);
check(!text.includes(anotherId), "search: and nobody else");
await cp.screenshot({ path: `${OUT}/01-students-with-ids.png`, fullPage: true });

// --- A new student is given a number at registration.
const counter = sql("select used from id_counters where scope = (select org_id from users where email = 'uk.docs@medcity.test') and year = date_part('year', now())");
await cp.goto(`${BASE}/students/new`);
const tag = String(Date.now()).slice(-5);
await cp.fill('input[name="firstName"]', "Nadia");
await cp.fill('input[name="lastName"]', `Minted${tag}`);
await cp.fill('input[name="phone"]', `+91 98${tag}0000`.slice(0, 16));
await cp.locator('input[name="consent"]').check().catch(() => {});
await cp.locator('button[type="submit"]').first().click();
await cp.waitForURL((u) => /\/students\/[^/]+/.test(String(u)) && !String(u).includes("/new"), { timeout: 20000 }).catch(() => {});
const mintedId = await waitSql(`select coalesce(medcity_id, '') from students where last_name = 'Minted${tag}'`, "", 1) === "" ? sql(`select coalesce(medcity_id,'') from students where last_name = 'Minted${tag}'`) : sql(`select coalesce(medcity_id,'') from students where last_name = 'Minted${tag}'`);
check(/^MC-[A-Z0-9]{2,4}-[0-9]{2}-[0-9]{4,}$/.test(mintedId), `register: the new student is given a number (${mintedId})`);
const after = sql("select used from id_counters where scope = (select org_id from users where email = 'uk.docs@medcity.test') and year = date_part('year', now())");
check(Number(after) === Number(counter) + 1, `register: the branch counter moved on by one (${counter} to ${after})`);

// --- The student's dashboard is the journey.
const portal = await signIn("fathima.rahman@example.com", "10.180.1.2");
const pp = portal.page;
await pp.goto(`${BASE}/portal`);
// The language switch is a server action, so the page is read once the words
// it was asked for are actually on it rather than straight after the click.
await pp.locator('button[value="en"]').click().catch(() => {});
text = await waitText(pp, /Step \d of 9/i);
const stage = sql("select journey_stage from students where email = 'fathima.rahman@example.com'");
check(/Step \d of 9/i.test(text), "portal: the dashboard says which step of nine");
check(/What|Your|The/.test(text) && /Done|Now/.test(text), "portal: the rail marks what is done and what is now");
check(/Dates to keep/i.test(text), "portal: the dates that matter have their own card");
const ownId = sql("select medcity_id from students where email = 'fathima.rahman@example.com'");
check(text.includes(ownId), `portal: their Medcity ID is on the screen (${ownId})`);
await pp.screenshot({ path: `${OUT}/02-portal-journey.png`, fullPage: true });
// The rail is in Malayalam when they ask for Malayalam.
await pp.locator('button[value="ml"]').click();
text = await waitText(pp, /[\u0d00-\u0d7f]/);
check(/[\u0d00-\u0d7f]/.test(text), "portal: the journey reads in Malayalam too");
await pp.locator('button[value="en"]').click();
await waitText(pp, /Step \d of 9/i);

// The student is told who can read their file.
await pp.goto(`${BASE}/portal/profile`);
text = await waitText(pp, /Who can see your file/i);
check(/Who can see your file/i.test(text), "portal: the student is shown who can read their file");
const seededParent = sql("select u.name from student_guardians g join users u on u.id = g.user_id where g.student_id = (select id from students where email = 'fathima.rahman@example.com') and g.revoked_at is null limit 1");
check(!seededParent || text.includes(seededParent), `portal: the seeded parent is named (${seededParent})`);

// --- Giving a parent their own sign-in, from the student's file.
const admin = await signIn("admin@medcityoverseas.test", "10.180.1.3");
const ap = admin.page;
const target = sql("select id from students where email is not null and id not in (select student_id from student_guardians) order by created_at limit 1");
text = await go(ap, `/students/${target}/profile`);
check(/Family access/.test(text), "file: family access has its own card");
check(/cannot\s+change anything/i.test(text), "file: the card says a parent changes nothing");
const parentEmail = `parent.${tag}@example.com`;
// The profile page carries other forms with the same field names, so every
// family action is scoped to the family card.
const family = ap.locator("#family");
await family.locator('input[name="name"]').fill(`Ismail ${tag}`);
await family.locator('input[name="email"]').fill(parentEmail);
await family.locator('select[name="relation"]').selectOption("Father");
await family.locator('input[name="seesMoney"]').check();
await family.getByRole("button", { name: "Give family access" }).click();
const said = await waitIn(family, /can sign in at the family view/);
check(/can sign in at the family view/.test(said), "family: the sign-in is confirmed on the screen");
const password = (said.match(/One-time password: ([A-Za-z0-9]{5}-[A-Za-z0-9]{5})/) || [])[1];
check(!!password, "family: the one-time password is there to be read out");
check(/Reads the journey/.test(said), "family: the confirmation says what the parent will see");
check((await waitSql(`select count(*) from student_guardians where student_id = '${target}' and revoked_at is null`, "1")) === "1", "family: the row is recorded against the student");
check(sql(`select role from users where email = '${parentEmail}'`) === "PARENT", "family: the account is a parent account and nothing else");
check(sql(`select must_change_password from users where email = '${parentEmail}'`) === "t", "family: they must change the password at sign in");
check(sql(`select sees_money from student_guardians where user_id = (select id from users where email = '${parentEmail}')`) === "t", "family: the fees switch was honoured");
await ap.screenshot({ path: `${OUT}/03-family-access.png`, fullPage: true });

// The same email twice is refused rather than quietly creating a second account.
await family.locator('input[name="name"]').fill("Someone Else");
await family.locator('input[name="email"]').fill(parentEmail);
await family.getByRole("button", { name: "Give family access" }).click();
check(/already used by another account/.test(await waitIn(family, /already used by another account/)), "family: a taken email is refused");

// --- What the parent sees.
sql(`update users set must_change_password = false, password_hash = (select password_hash from users where email = 'admin@medcityoverseas.test') where email = '${parentEmail}'`);
const parent = await signIn(parentEmail, "10.180.1.4");
const fp = parent.page;
await fp.waitForURL((u) => String(u).includes("/family"), { timeout: 20000 }).catch(() => {});
check(fp.url().includes("/family"), `family: signing in lands on the family view (${fp.url()})`);
text = await main(fp);
const targetName = sql(`select first_name || ' ' || last_name from students where id = '${target}'`);
check(text.includes(targetName), "family: it opens on the student they were added to");
check(/Step \d of 9/i.test(text), "family: the same nine stages, same rail");
check(/Fees and payments/i.test(text), "family: the fees are there, because they were switched on");
await fp.screenshot({ path: `${OUT}/04-family-view.png`, fullPage: true });

text = await go(fp, "/family/documents");
check(/Only the student can upload/i.test(text), "family: the documents page says who uploads");
check((await fp.locator('input[type="file"]').count()) === 0, "family: there is nothing to upload with");

// A parent may not reach the staff app, another student, or any file.
for (const path of ["/dashboard", "/students", `/students/${target}/profile`, "/my-day", "/admin/invoices", "/portal"]) {
  await fp.goto(BASE + path);
  await fp.waitForTimeout(400);
  check(!fp.url().includes(path) || /forbidden/i.test(await body(fp)), `family: ${path} is not a parent's to read (landed on ${fp.url().replace(BASE, "")})`);
}
const someDoc = sql(`select id from documents limit 1`);
if (someDoc) {
  const res = await fp.request.get(`${BASE}/api/documents/${someDoc}`);
  check(res.status() === 404, `family: the files themselves are shut to a parent (${res.status()})`);
}

// --- Taking it away ends the reading, not the record.
text = await go(ap, `/students/${target}/profile`);
await ap.locator("#family").getByRole("button", { name: "Hide the fees" }).first().click();
check((await waitSql(`select sees_money from student_guardians where user_id = (select id from users where email = '${parentEmail}')`, "f")) === "f", "family: the fees can be switched back off");
await ap.locator("#family").getByRole("button", { name: "Remove access" }).first().click();
check((await waitSql(`select count(*) from student_guardians where student_id = '${target}' and revoked_at is not null`, "1")) === "1", "family: removing access leaves the row with a date on it");
check(sql(`select active from users where email = '${parentEmail}'`) === "f", "family: the account is switched off");
await fp.goto(`${BASE}/family`);
await fp.waitForTimeout(600);
check(!/Step \d of 9/i.test(await body(fp)), "family: a removed parent reading at that moment is out on their next click");
text = await go(ap, `/students/${target}/profile`);
check(/Removed/.test(text), "file: the card says when access was removed");

// --- Nobody else's business.
const mgmt = await signIn("management@medcityoverseas.test", "10.180.1.5");
text = await go(mgmt.page, `/students/${target}/profile`);
check(/Family access/.test(text), "roles: management can read who has access");
check((await mgmt.page.locator("#family").getByRole("button", { name: "Give family access" }).count()) === 0, "roles: management is given nothing to press");

for (const [who, e] of [["counsellor", counsellor.errors], ["student", portal.errors], ["admin", admin.errors], ["parent", parent.errors], ["management", mgmt.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
