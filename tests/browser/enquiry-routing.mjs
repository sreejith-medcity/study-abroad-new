// Lead routing and hygiene: who a new enquiry goes to, a repeat enquiry
// joining the one already there (and a lost one coming back), duplicates
// across branches folded together, and lost reasons picked from a list and
// counted. Wants the plain seed.
import { chromium } from "playwright";
import { hydrated, knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-enquiry-routing";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const tag = String(Date.now()).slice(-6);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
const allErrors = [];
let ipN = 10;
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": `10.231.${tag.slice(-2) % 200}.${ipN++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; allErrors.push(`${e} @ ${page.url()}`); });
  page.on("response", (r) => { if (r.status() >= 500) allErrors.push(`${r.status()} ${r.url()}`); });
  return { ctx, page };
}
const sessions = new Map();
async function signIn(email) {
  if (sessions.has(email)) return sessions.get(email);
  const { page } = await fresh();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  sessions.set(email, page);
  return page;
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); await hydrated(page); return main(page); }
async function waitSql(q, want, tries = 30) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (want instanceof RegExp ? want.test(v) : v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  let last = "";
  while (Date.now() < until) {
    last = await page.locator("main").innerText().catch(() => "");
    if (re.test(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 12000 }).then(() => true, () => false);

const id = (q) => sql(q);
const kottayam = id("select id from organizations where name = 'Medcity Kottayam'");
const kochi = id("select id from organizations where name = 'Medcity Kochi'");
const horizon = id("select id from organizations where type = 'SUB_AGENT' limit 1");
const germany = id("select id from users where email = 'germany@medcity.test'");
const ukDocs = id("select id from users where email = 'uk.docs@medcity.test'");
const slug = id(`select public_slug from organizations where id = '${kottayam}'`);
// Who round robin picks from at Kottayam: its active counsellors, at whatever level.
const POOL = `select id from users where org_id = '${kottayam}' and active and role in ('COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR')`;
const openCounts = () =>
  Object.fromEntries(
    sql(`select u.id || ':' || (select count(*) from enquiries x where x.assigned_to_id = u.id and x.stage in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')) from users u where u.id in (${POOL})`)
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(":"))
      .map(([k, v]) => [k, Number(v)]),
  );
const keyOf = (phone) => phone.replace(/\D/g, "").slice(-10);
const countByPhone = (orgId, phone) => sql(`select count(*) from enquiries where org_id = '${orgId}' and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = '${keyOf(phone)}'`);

async function newEnquiry(page, fields) {
  await go(page, "/enquiries/new");
  if (fields.orgId) await page.selectOption('select[name="orgId"]', fields.orgId);
  await page.fill('input[name="name"]', fields.name);
  await page.fill('input[name="phone"]', fields.phone);
  if (fields.email) await page.fill('input[name="email"]', fields.email);
  if (fields.source) await page.selectOption('select[name="source"]', fields.source);
  if (fields.pathway) await page.selectOption('select[name="interestPathway"]', fields.pathway);
  if (fields.notes) await page.fill('textarea[name="notes"]', fields.notes);
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await page.waitForURL((u) => /\/enquiries\/(?!new\b)[^/?]+/.test(new URL(String(u)).pathname), { timeout: 20000 }).catch(() => {});
  await hydrated(page);
  return page.url();
}

// ======================= 1. Routing rules =======================

// A branch head sets their own branch's rules.
const head = await signIn("kottayam@medcity.test");
let text = await go(head, "/settings/enquiries");
check(/Who new enquiries go to/.test(text), "settings: a branch head has the routing screen");
check(/Enquiries/.test(await head.getByRole("navigation", { name: "Settings sections" }).innerText().catch(() => "")), "settings: under its own Enquiries tab");
check(/Not reachable/.test(text) && /Chose another agency/.test(text) && /Visa concerns/.test(text), "lost reasons: the list starts with the study-abroad reasons");
check(!(await head.getByRole("button", { name: "Add reason" }).count()), "lost reasons: a branch head reads the list but does not keep it");
check(/Round robin here picks from/.test(text), "settings: the branch head is told who round robin picks from");

await head.fill('input[name="name"]', `Web degree ${tag}`);
await head.fill('input[name="priority"]', "10");
await head.selectOption('select[name="source"]', "WEBSITE");
await head.selectOption('select[name="pathway"]', "DEGREE");
await head.locator('input[name="method"][value="PERSON"]').check();
await head.selectOption('select[name="assignToId"]', germany);
await head.getByRole("button", { name: "Add rule" }).click();
const webRule = await waitSql(`select coalesce(max(id), '') from enquiry_routing_rules where name = 'Web degree ${tag}'`, /.+/);
check(!!webRule, "rule: a named-person rule is saved");
check(sql(`select org_id || '|' || method || '|' || assign_to_id || '|' || source || '|' || pathway from enquiry_routing_rules where id = '${webRule}'`) === `${kottayam}|PERSON|${germany}|WEBSITE|DEGREE`, "rule: for the branch head's own branch, to the person picked, for that source and pathway");

await go(head, "/settings/enquiries");
await head.fill('input[name="name"]', `Everything else ${tag}`);
await head.fill('input[name="priority"]', "500");
await head.getByRole("button", { name: "Add rule" }).click();
const rrRule = await waitSql(`select coalesce(max(id), '') from enquiry_routing_rules where name = 'Everything else ${tag}'`, /.+/);
check(sql(`select method || '|' || org_id from enquiry_routing_rules where id = '${rrRule}'`) === `ROUND_ROBIN|${kottayam}`, "rule: a round robin rule for the branch");
check(sql(`select count(*) from audit_logs where action = 'routing.create' and entity_id in ('${webRule}', '${rrRule}')`) === "2", "rule: both are in the audit log");
text = await waitText(head, new RegExp(`Everything else ${tag}`));
check(text.indexOf(`Web degree ${tag}`) < text.indexOf(`Everything else ${tag}`), "rule: listed in the order they are tried");

// The head office sets a rule for another branch; the Kottayam head never sees it.
const admin = await signIn("admin@medcityoverseas.test");
await go(admin, "/settings/enquiries");
await admin.fill('input[name="name"]', `Kochi only ${tag}`);
await admin.selectOption('select[name="orgId"]', kochi);
await admin.getByRole("button", { name: "Add rule" }).click();
check(!!(await waitSql(`select coalesce(max(id), '') from enquiry_routing_rules where name = 'Kochi only ${tag}' and org_id = '${kochi}'`, /.+/)), "rule: the head office sets a rule for any branch");
text = await go(head, "/settings/enquiries");
check(!text.includes(`Kochi only ${tag}`), "rule: a branch head does not see another branch's rules");

// A counsellor has no say in it.
const counsellor = await signIn("uk.docs@medcity.test");
text = await go(counsellor, "/settings/enquiries");
check(/set by the head office and branch heads/.test(text) && !/Add a rule/.test(text), "settings: a counsellor is told who sets routing, and cannot");

// Manual entry with nobody named goes by the rules.
const webUrl = await newEnquiry(head, { name: `Routed Web ${tag}`, phone: `+91 95${tag}01`, source: "WEBSITE", pathway: "DEGREE" });
const webId = webUrl.split("/enquiries/")[1]?.split("?")[0];
check(sql(`select assigned_to_id from enquiries where id = '${webId}'`) === germany, "manual: a website degree enquiry goes to the person the rule names");
check(sql(`select count(*) from enquiry_notes where enquiry_id = '${webId}' and body like '%routing rule "Web degree ${tag}"%'`) === "1", "manual: its history says which rule gave it out");
check(sql(`select count(*) from audit_logs where action = 'enquiry.route' and entity_id = '${webId}'`) === "1", "manual: the routing is audited");
check(sql(`select count(*) from notifications where user_id = '${germany}' and href = '/enquiries/${webId}' and title = 'New enquiry assigned to you'`) === "1", "manual: the person it went to is told, as before");

for (const n of [1, 2]) {
  const before = openCounts();
  const url = await newEnquiry(head, { name: `Routed Walk ${n} ${tag}`, phone: `+91 95${tag}1${n}`, source: "WALK_IN" });
  const eid = url.split("/enquiries/")[1]?.split("?")[0];
  const to = sql(`select coalesce(assigned_to_id, '') from enquiries where id = '${eid}'`);
  const least = Math.min(...Object.values(before));
  check(to in before, `round robin ${n}: the walk-in goes to one of the branch's active counsellors`);
  check(before[to] === least, `round robin ${n}: the one holding the fewest open enquiries (${before[to]} against a least of ${least})`);
}
check(Number(sql(`select assigned_count from enquiry_routing_rules where id = '${rrRule}'`)) >= 2, "round robin: the rule counts what it has given out");

// Somebody named on the form keeps it: the rules only fill a gap.
await go(head, "/enquiries/new");
await head.fill('input[name="name"]', `Named Owner ${tag}`);
await head.fill('input[name="phone"]', `+91 95${tag}21`);
await head.selectOption('select[name="assignedToId"]', ukDocs);
await head.getByRole("button", { name: "Save enquiry" }).click();
check((await waitSql(`select coalesce(assigned_to_id, '') from enquiries where name = 'Named Owner ${tag}'`, ukDocs)) === ukDocs, "manual: an owner picked on the form is kept");

// The public form.
{
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/apply/${slug}`);
  await hydrated(page);
  await page.fill('input[name="name"]', `Form Routed ${tag}`);
  await page.fill('input[name="phone"]', `+91 94${tag}31`);
  await page.selectOption('select[name="interestPathway"]', "DEGREE");
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/thanks$/, { timeout: 20000 }).catch(() => {});
  check((await waitSql(`select coalesce(assigned_to_id, '') from enquiries where name = 'Form Routed ${tag}'`, germany)) === germany, "public form: a website degree enquiry is routed by the branch's rule");
  await ctx.close();
}

// The CRM.
const su = await signIn("sreejith@miak.in");
await go(su, "/admin/integrations?tab=keys");
await su.getByRole("button", { name: "New key" }).click();
const dialog = su.getByRole("dialog").first();
await dialog.locator('input[name="name"]').fill(`Routing test ${tag}`);
await dialog.getByRole("button", { name: "Make the key" }).click();
let said = "";
for (let i = 0; i < 40 && !/Secret: mcs_/.test(said); i++) { said = await dialog.innerText().catch(() => ""); await new Promise((r) => setTimeout(r, 300)); }
const keyId = (said.match(/Key id: (mck_[0-9a-f]+)/) || [])[1];
const secret = (said.match(/Secret: (mcs_[0-9a-f]+)/) || [])[1];
const auth = { "x-medcity-key": keyId, authorization: `Bearer ${secret}`, "content-type": "application/json" };
const call = async (body) => {
  const res = await fetch(`${BASE}/api/crm/enquiries`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
{
  const before = openCounts();
  const r = await call({ crmId: `ROUTE-${tag}`, name: `Crm Routed ${tag}`, phone: `+91 93${tag}41`, branch: "KOT" });
  check(r.status === 201 && r.json?.created === true, `crm: a lead comes in (${r.status})`);
  const to = sql(`select coalesce(assigned_to_id, '') from enquiries where id = '${r.json?.enquiryId}'`);
  check(to in before && before[to] === Math.min(...Object.values(before)), "crm: and is given out by the branch's round robin rule");
  const abhijith = sql("select id from enquiries where phone = '+91 98470 11002'");
  const again = await call({ crmId: `AGAIN-${tag}`, name: "Abhijith M", phone: "098470-11002", branch: "KOT" });
  check(again.json?.created === false && again.json?.enquiryId === abhijith, "crm: a lead for a number already open at the branch lands on that enquiry");
  check(countByPhone(kottayam, "+91 98470 11002") === "1", "crm: and no second enquiry is made");
  check(sql(`select count(*) from enquiry_notes where enquiry_id = '${abhijith}' and body like 'Enquired again%CRM%'`) === "1", "crm: the open enquiry gets a note saying they came again");
}

// A bulk upload: new rows naming nobody are routed.
{
  // Held by a counsellor still at the branch, so reopening keeps them on it and the new row alone is routed.
  sql(`insert into enquiries (id, org_id, created_by_id, assigned_to_id, name, phone, source, stage, lost_reason) values ('lostcsv${tag}', '${kottayam}', '${ukDocs}', '${ukDocs}', 'Lost Csv ${tag}', '+91 92${tag}51', 'PHONE', 'LOST', 'Did not pick up')`);
  const csv = ["name,phone,source,interest_pathway", `Csv Routed ${tag},+91 92${tag}52,WALK_IN,AUSBILDUNG`, `Lost Csv Again,092${tag}51,PHONE,`].join("\n");
  await go(head, "/imports?kind=enquiries");
  await head.locator("#file-enquiries").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await head.getByRole("button", { name: "Check the file" }).click();
  await head.getByTestId("import-result").first().waitFor({ timeout: 20000 }).catch(() => {});
  const preview = await head.getByTestId("import-result").innerText().catch(() => "");
  check(/1 new/.test(preview) && /Reopen \(was lost\)/.test(preview), `import: the preview shows one new and one lost enquiry to reopen (${preview.split("\n").slice(0, 2).join(" | ")})`);
  const before = openCounts();
  await head.getByRole("button", { name: /^Import \d/ }).click();
  await head.getByText(/^Imported from/).waitFor({ timeout: 30000 }).catch(() => {});
  const to = await waitSql(`select coalesce(max(assigned_to_id), '') from enquiries where name = 'Csv Routed ${tag}'`, /.+/);
  check(to in before && before[to] === Math.min(...Object.values(before)), "import: a row naming nobody goes by the round robin rule");
  check(sql(`select stage from enquiries where id = 'lostcsv${tag}'`) === "NEW", "import: a number the branch had lost is reopened as New (nobody had reached them)");
  check(countByPhone(kottayam, `+91 92${tag}51`) === "1", "import: and not entered a second time");
  check(sql(`select count(*) from enquiry_notes where enquiry_id = 'lostcsv${tag}' and body like 'Came back%bulk upload%Did not pick up%'`) === "1", "import: the note says it came back, from where, and what it had been lost for");
}

// A sub-agent's referral the desk passes to a branch goes by that branch's rules.
{
  const hq = sql("select id from organizations where type = 'HQ'");
  const by = sql("select id from users where email = 'owner@horizon.test'");
  sql(`insert into enquiries (id, org_id, created_by_id, submitted_by_org_id, name, phone, source, stage) values ('ref${tag}', '${hq}', '${by}', '${horizon}', 'Referral Routed ${tag}', '+91 91${tag}61', 'REFERRAL', 'NEW')`);
  const before = openCounts();
  await go(admin, "/admin/agents?tab=referrals");
  const row = admin.locator("tr").filter({ hasText: `Referral Routed ${tag}` }).first();
  await row.locator('select[name="orgId"]').selectOption(kottayam);
  await row.getByRole("button", { name: "Give it to them" }).click();
  check((await waitSql(`select org_id from enquiries where id = 'ref${tag}'`, kottayam)) === kottayam, "referral: the branch has it");
  const to = sql(`select coalesce(assigned_to_id, '') from enquiries where id = 'ref${tag}'`);
  check(to in before && before[to] === Math.min(...Object.values(before)), "referral: held by the counsellor the branch's rule picks, not left on the branch head");
  check(sql(`select count(*) from enquiry_notes where enquiry_id = 'ref${tag}' and body like '%routing rule "Everything else ${tag}"%'`) === "1", "referral: with the rule named on its history");
}

// ======================= 2. Repeat enquiries =======================

{
  const vishnu = sql("select id from enquiries where phone = '+91 98470 11006'");
  check(sql(`select stage from enquiries where id = '${vishnu}'`) === "LOST", "repeat: the seed has Vishnu lost");
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/apply/${slug}`);
  await hydrated(page);
  await page.fill('input[name="name"]', "Vishnu P");
  await page.fill('input[name="phone"]', "098470 11006");
  await page.fill('textarea[name="message"]', "Ready to try again for the UK.");
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/thanks$/, { timeout: 20000 }).catch(() => {});
  check(page.url().endsWith("/thanks"), "repeat: the person filling the form sees the same thank-you");
  await ctx.close();
  check(/^(NEW|CONTACTED)$/.test(await waitSql(`select stage from enquiries where id = '${vishnu}'`, /^(NEW|CONTACTED)$/)), "repeat: a lost enquiry's number on the form reopens it");
  check(countByPhone(kottayam, "+91 98470 11006") === "1", "repeat: rather than a second enquiry");
  check(sql(`select assigned_to_id from enquiries where id = '${vishnu}'`) === ukDocs, "repeat: the owner is kept, still being active");
  check(sql(`select count(*) from enquiry_notes where enquiry_id = '${vishnu}' and body like 'Came back%branch form%Website%Budget below what the UK route needs%Ready to try again%'`) === "1", "repeat: the note says it came back, through what, and what it was lost for");
  check(sql(`select lost_reason is null and lost_reason_id is null and next_follow_up_at is not null from enquiries where id = '${vishnu}'`) === "t", "repeat: the lost reason is cleared and a follow-up set");
  check(sql(`select count(*) from audit_logs where action = 'enquiry.reopen' and entity_id = '${vishnu}'`) === "1", "repeat: the reopening is audited");
  check(sql(`select count(*) from notifications where user_id = '${ukDocs}' and href = '/enquiries/${vishnu}' and title = 'A lost enquiry came back'`) === "1", "repeat: the owner is told");
  text = await go(counsellor, `/enquiries/${vishnu}`);
  check(/Came again\s*1 time/.test(text), "repeat: the enquiry says the person came again");
}

{
  const meera = sql("select id from enquiries where phone = '+91 98470 11005'");
  const url = await newEnquiry(counsellor, { name: "Meera S", phone: "+919847011005", source: "PHONE", notes: `Rang again ${tag}` });
  check(url.includes(`/enquiries/${meera}`) && url.includes("repeat=note"), "repeat: typing in a number already open opens that enquiry");
  text = await main(counsellor);
  check(/Already on the list/.test(text), "repeat: and says why");
  check(countByPhone(kottayam, "+91 98470 11005") === "1", "repeat: no second enquiry is made");
  check(text.includes(`Rang again ${tag}`), "repeat: what was typed is on its history");
}

// ======================= 3. Duplicates and merging =======================

const nandana = sql("select id from enquiries where phone = '+91 98470 11001'");
const dupUrl = await newEnquiry(admin, { orgId: kochi, name: `Nandana Kochi ${tag}`, phone: "+91 98470 11001", notes: `Walked into Kochi ${tag}` });
const dup = dupUrl.split("/enquiries/")[1]?.split("?")[0];
check(sql(`select org_id from enquiries where id = '${dup}'`) === kochi, "duplicate: the same number at another branch is a separate enquiry there");
text = await main(admin);
check(/Possible duplicates/.test(text) && text.includes("Nandana Prakash") && /Medcity Kottayam/.test(text), "duplicate: the head office sees the other branch's enquiry beside it");

const kochiHead = await signIn("kochi@medcity.test");
text = await go(kochiHead, `/enquiries/${dup}`);
check(/Possible duplicates/.test(text) && /1 more with another branch/.test(text), "duplicate: a branch is told there is one at another branch");
check(!text.includes("Nandana Prakash"), "duplicate: but not whose it is");

text = await go(head, `/enquiries/${nandana}`);
check(/1 more with another branch/.test(text) && !/Merge .* into this one/.test(text), "merge: a branch head cannot merge across branches");

text = await go(admin, `/enquiries/${nandana}`);
await admin.getByText(`Merge Nandana Kochi ${tag} into this one`).click();
await admin.getByRole("button", { name: "Merge into this enquiry" }).click();
check(/Tick the box/.test(await waitText(admin, /Tick the box/)), "merge: it asks for the tick first");
await admin.locator('input[name="confirm"]').check();
await admin.getByRole("button", { name: "Merge into this enquiry" }).click();
await admin.waitForURL(/merged=1/, { timeout: 20000 }).catch(() => {});
check((await waitSql(`select stage from enquiries where id = '${dup}'`, "MERGED")) === "MERGED", "merge: the duplicate is closed as merged, not deleted");
check(sql(`select merged_into_id || '|' || (merged_by_id is not null) from enquiries where id = '${dup}'`) === `${nandana}|true`, "merge: it points at the enquiry kept, with who merged it");
check(sql(`select count(*) from enquiry_notes where enquiry_id = '${nandana}' and body like 'Walked into Kochi ${tag}%'`) === "1", "merge: its history moved to the enquiry kept");
check(sql(`select count(*) from enquiry_notes where enquiry_id = '${dup}'`) === "1", "merge: leaving one line on the duplicate saying where it went");
check(sql(`select count(*) from audit_logs where action = 'enquiry.merge' and entity_id = '${nandana}' and meta->>'merged' = '${dup}'`) === "1", "merge: audited with what was folded in");
text = await waitText(admin, /Merged into this one/);
check(/Merged into this one/.test(text) && text.includes(`Nandana Kochi ${tag}`), "merge: the kept enquiry lists what was folded into it");
text = await go(admin, `/enquiries/${dup}`);
check(/Merged into another enquiry/.test(text) && !/Log a follow up/.test(text), "merge: the duplicate's page says where it went and offers no work on it");
await go(admin, `/enquiries?q=${encodeURIComponent(`Nandana Kochi ${tag}`)}`);
check((await admin.locator("main").getByRole("link", { name: `Nandana Kochi ${tag}` }).count()) === 0, "merge: the list no longer counts the person twice");
await go(admin, `/enquiries?stage=MERGED&q=${encodeURIComponent(`Nandana Kochi ${tag}`)}`);
check((await admin.locator("main").getByRole("link", { name: `Nandana Kochi ${tag}` }).count()) === 1, "merge: asking for merged ones finds it");

// The same email at the same branch, merged by the branch head.
{
  const meera = sql("select id from enquiries where phone = '+91 98470 11005'");
  const twinUrl = await newEnquiry(head, { name: `Meera Twin ${tag}`, phone: `+91 90${tag}71`, email: "meera.suresh@example.com", source: "SOCIAL" });
  const twin = twinUrl.split("/enquiries/")[1]?.split("?")[0];
  text = await go(counsellor, `/enquiries/${meera}`);
  check(text.includes(`Meera Twin ${tag}`) && /Same email/.test(text), "duplicate: the same email is a possible duplicate too");
  check(!(await counsellor.getByText(`Merge Meera Twin ${tag} into this one`).count()), "merge: a counsellor sees duplicates but cannot merge");
  await go(head, `/enquiries/${meera}`);
  await head.getByText(`Merge Meera Twin ${tag} into this one`).click();
  await head.locator('input[name="confirm"]').check();
  await head.getByRole("button", { name: "Merge into this enquiry" }).click();
  check((await waitSql(`select stage from enquiries where id = '${twin}'`, "MERGED")) === "MERGED", "merge: a branch head merges two of their own branch's enquiries");
}

// ======================= 4. Lost reasons =======================

text = await go(admin, "/settings/enquiries");
check((text.match(/Switch off/g) || []).length >= 7, "lost reasons: the head office keeps the list");
await admin.fill('input[name="label"]', `Family decided against it ${tag}`);
await admin.getByRole("button", { name: "Add reason" }).click();
check(!!(await waitSql(`select coalesce(max(id), '') from lost_reasons where label = 'Family decided against it ${tag}'`, /.+/)), "lost reasons: a reason is added");
await go(admin, "/settings/enquiries");
await admin.getByRole("button", { name: "Switch off Other" }).click();
check((await waitSql("select active::text from lost_reasons where label = 'Other'", "false")) === "false", "lost reasons: one is switched off rather than removed");
check(sql("select count(*) from audit_logs where action in ('lost_reason.create', 'lost_reason.off')") === "2", "lost reasons: both changes are audited");

const lostUrl = await newEnquiry(counsellor, { name: `Lost Test ${tag}`, phone: `+91 89${tag}81`, source: "WHATSAPP" });
const lostId = lostUrl.split("/enquiries/")[1]?.split("?")[0];
const followStages = await counsellor.locator('main select[name="stage"]').first().locator("option").allInnerTexts();
check(!followStages.includes("Lost"), "lost: the follow-up form no longer closes an enquiry as lost without a reason");
const offered = await counsellor.locator('select[name="lostReasonId"] option').allInnerTexts();
check(offered.includes("Budget") && offered.includes(`Family decided against it ${tag}`) && !offered.includes("Other"), "lost: the reasons offered are the list's, without the one switched off");
await counsellor.getByRole("button", { name: "Close as lost" }).click();
check(/Pick the reason/.test(await waitText(counsellor, /Pick the reason/)), "lost: a reason has to be picked");
check(sql(`select stage from enquiries where id = '${lostId}'`) === "NEW", "lost: and nothing closes without one");
await counsellor.selectOption('select[name="lostReasonId"]', { label: "Budget" });
await counsellor.fill('textarea[name="lostReason"]', "UK fees too high");
await counsellor.getByRole("button", { name: "Close as lost" }).click();
check(await toast(counsellor, /Closed as lost/), "lost: closed with the reason");
check((await waitSql(`select stage from enquiries where id = '${lostId}'`, "LOST")) === "LOST", "lost: the stage is Lost");
check(sql(`select r.label || '|' || e.lost_reason || '|' || (e.lost_at is not null) from enquiries e join lost_reasons r on r.id = e.lost_reason_id where e.id = '${lostId}'`) === "Budget|UK fees too high|true", "lost: the reason, the words beside it and when are recorded");
text = await go(counsellor, `/enquiries/${lostId}`);
check(/Budget: UK fees too high/.test(text), "lost: the page reads the reason and the words together");

// An enquiry lost before the list existed still reads.
const old = sql("select id from enquiries where phone = '+91 98470 11002'");
sql(`update enquiries set stage = 'LOST', lost_reason = 'Old words ${tag}', lost_reason_id = null, lost_at = null where id = '${old}'`);
text = await go(counsellor, `/enquiries/${old}`);
check(text.includes(`Old words ${tag}`), "lost: an old free-text reason is still readable");

// The report.
text = await go(admin, "/reports/lost-reasons");
check(/By reason/.test(text) && /By source/.test(text) && /By branch/.test(text), "report: counts by reason, source and branch");
check(/Budget/.test(text) && /Not recorded/.test(text) && text.includes(`Lost Test ${tag}`), "report: the reason picked, the old ones as not recorded, and the enquiries behind them");
check(/Medcity Kottayam/.test(text), "report: by branch for the head office");
const csvRes = await admin.request.get(`${BASE}/api/reports/lost-reasons`);
const csvText = await csvRes.text();
check(csvRes.status() === 200 && /text\/csv/.test(csvRes.headers()["content-type"] ?? ""), "report: downloads as a CSV");
check(/"By reason","Enquiries","Share"/.test(csvText) && csvText.includes(`Lost Test ${tag}`) && /"Budget"/.test(csvText), "report: the CSV has the counts and the enquiries");
check(sql("select count(*) from audit_logs where action = 'enquiry.lost_report_export'") === "1", "report: the download is audited");
check((await admin.request.get(`${BASE}/api/reports/lost-reasons`, { headers: {} })).status() === 200, "report: the head office can download it again");

text = await go(kochiHead, "/reports/lost-reasons");
check(!text.includes(`Lost Test ${tag}`) && !/Every branch/.test(text), "report: a branch head sees only their own branch");
text = await go(head, "/reports/lost-reasons");
check(text.includes(`Lost Test ${tag}`), "report: the Kottayam head sees Kottayam's");
text = await go(counsellor, "/reports/lost-reasons");
check(/for the head office, management and branch heads/.test(text) && !text.includes(`Lost Test ${tag}`), "report: a counsellor is not shown it");
check((await counsellor.request.get(`${BASE}/api/reports/lost-reasons`)).status() === 404, "report: nor its file");
const mgmt = await signIn("management@medcityoverseas.test");
text = await go(mgmt, "/reports/lost-reasons");
check(text.includes(`Lost Test ${tag}`), "report: management reads every branch");
check(/Lost reasons/.test(await mgmt.locator("nav").first().innerText().catch(() => "")), "report: and finds it in the menu");
await admin.screenshot({ path: `${OUT}/report.png`, fullPage: true });

const real = allErrors.filter((e) => !/favicon/.test(e));
check(real.length === 0, `no client or server errors${real.length ? `: ${real.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
