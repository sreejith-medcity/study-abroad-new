// Sub-agents: applying, being approved, the agreement, referring a lead, the
// desk passing it to a branch, what a referral earns, and the four conditions on
// a withdrawal. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-agents";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });

async function openTab(ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  return { ctx, page, errors };
}
async function signIn(email, ip) {
  const t = await openTab(ip);
  await t.page.goto(`${BASE}/login`);
  await t.page.fill('input[name="email"]', email);
  await t.page.fill('input[name="password"]', "Password@123");
  await t.page.click('button[type="submit"]');
  await t.page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return t;
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
const body = async (page) => { await settle(page); return page.locator("body").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
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
const waitText = (page, re, timeout = 15000) => waitIn(page.locator("main"), re, timeout);
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}
// A cold server answers the first request slowly enough to race a read.
await fetch(`${BASE}/login`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const tag = String(Date.now()).slice(-6);

// --- The public form. No sign in at all.
const anon = await openTab("10.190.1.1");
const ap0 = anon.page;
let text = await go(ap0, "/join");
check(/Work with Medcity Overseas/i.test(text), "join: the page is open to anybody with the link");
check(/paid per student who goes/i.test(text), "join: it says how somebody is paid before they apply");
check(/the agreement comes later/i.test(text), "join: and that applying commits them to nothing");
const beforeCount = sql("select count(*) from agent_applications");
await ap0.fill('input[name="contactName"]', `Anil Kumar ${tag}`);
await ap0.fill('input[name="firmName"]', `Kumar Guidance ${tag}`);
await ap0.fill('input[name="email"]', `anil.${tag}@example.com`);
await ap0.fill('input[name="phone"]', `+91 9000${tag}`);
await ap0.fill('input[name="city"]', "Alappuzha");
await ap0.locator('textarea[name="aboutThem"]').fill("Twelve nursing students a year ask me about Germany.");

// The company and its owner. A GSTIN that cannot be one is refused at the form.
await ap0.fill('input[name="companyLegalName"]', `Kumar Guidance LLP ${tag}`);
await ap0.fill('input[name="companyRegistrationNo"]', "AAB-1234");
await ap0.fill('input[name="gstin"]', "32ABCDE1234F1Z5");
await ap0.fill('input[name="companyPan"]', "ABCDE1234F");
await ap0.locator('textarea[name="companyAddress"]').fill("Second floor, Market Road, Alappuzha");
await ap0.fill('input[name="ownerName"]', "Anil Kumar");
await ap0.locator('select[name="ownerIdKind"]').selectOption("PAN");
await ap0.fill('input[name="ownerIdNumber"]', "zzzzz9999z");
await ap0.locator('input[name="consent"]').check();
await ap0.getByRole("button", { name: "Send my application" }).click();
check(/Thank you/i.test(await waitText(ap0, /Thank you/i)), "join: sending it is confirmed");
check((await waitSql("select count(*) from agent_applications", String(Number(beforeCount) + 1))) === String(Number(beforeCount) + 1), "join: the application is recorded");
const applicationId = sql(`select id from agent_applications where email = 'anil.${tag}@example.com'`);
check(sql(`select status from agent_applications where id = '${applicationId}'`) === "NEW", "join: it starts as new");
check(sql(`select consent_text is not null from agent_applications where id = '${applicationId}'`) === "t", "join: what they agreed to is kept with the row");
check(sql(`select gstin from agent_applications where id = '${applicationId}'`) === "32ABCDE1234F1Z5", "join: the company's GSTIN is kept");
check(sql(`select company_pan from agent_applications where id = '${applicationId}'`) === "ABCDE1234F", "join: and its PAN");
check(sql(`select owner_id_kind from agent_applications where id = '${applicationId}'`) === "PAN", "join: what the owner proved themselves with");
check(sql(`select owner_id_number from agent_applications where id = '${applicationId}'`) === "ZZZZZ9999Z", "join: tidied to upper case rather than refused");

// A GSTIN that cannot be a GSTIN never reaches the database.
{
  const before = sql("select count(*) from agent_applications");
  await go(ap0, "/join");
  await ap0.fill('input[name="contactName"]', `Bad Gst ${tag}`);
  await ap0.fill('input[name="email"]', `badgst.${tag}@example.com`);
  await ap0.fill('input[name="phone"]', `+91 9111${tag}`);
  await ap0.fill('input[name="gstin"]', "NOT-A-GSTIN");
  await ap0.locator('input[name="consent"]').check();
  await ap0.getByRole("button", { name: "Send my application" }).click();
  check(await waitText(ap0, /Fifteen characters/i), "join: a GSTIN that cannot be one is refused, with what one looks like");
  check(sql("select count(*) from agent_applications") === before, "join: and nothing was written");
}
await ap0.screenshot({ path: `${OUT}/01-join.png`, fullPage: true });

// The same number again is the same person, not a second partner.
await ap0.goto(`${BASE}/join`);
await ap0.fill('input[name="contactName"]', "Anil Again");
await ap0.fill('input[name="email"]', `anil.again.${tag}@example.com`);
await ap0.fill('input[name="phone"]', `+91 9000${tag}`);
await ap0.locator('input[name="consent"]').check();
await ap0.getByRole("button", { name: "Send my application" }).click();
check(/already have your application/i.test(await waitText(ap0, /already have your application|Thank you/i)), "join: the same number twice is the same application");
check(sql(`select count(*) from agent_applications where phone like '%${tag}'`) === "1", "join: and no second row is written");

// --- The desk reviews it.
const admin = await signIn("admin@medcityoverseas.test", "10.190.1.2");
const dp = admin.page;
text = await go(dp, "/admin/agents");
check(/Sub-agents/.test(text), "desk: the screen exists");
check(new RegExp(`Anil Kumar ${tag}`).test(text), "desk: the new application is in the queue");
check(/Twelve nursing students/.test(text), "desk: what they wrote about themselves is readable");
await dp.getByRole("button", { name: "I am looking at this" }).first().click();
check((await waitSql(`select status from agent_applications where id = '${applicationId}'`, "REVIEWING")) === "REVIEWING", "desk: picking one up is recorded, so two people do not both ring them");
await dp.screenshot({ path: `${OUT}/02-applications.png`, fullPage: true });

// Approving creates the organisation and its first login.
const orgsBefore = sql("select count(*) from organizations");
const row = dp.locator("tr").filter({ hasText: `Anil Kumar ${tag}` }).first();
await row.getByRole("button", { name: "Approve" }).click();
const dialog = dp.getByRole("dialog").first();
await dialog.locator('input[name="orgName"]').fill(`Kumar Guidance ${tag}`);
await dialog.locator('select[name="parentOrgId"]').selectOption({ index: 1 });
await dialog.getByRole("button", { name: "Create the sub-agent" }).click();
const said = await waitIn(dialog, /One-time password/);
check(/is set up/.test(said), "approve: the sub-agent is created and confirmed on screen");
check(/One-time password: [A-Za-z0-9]{5}-[A-Za-z0-9]{5}/.test(said), "approve: the one-time password is shown once, to read out");
check(/accept 2026\.1 of the agreement before any money can be withdrawn/.test(said), "approve: and they are told what will be asked of them");
check((await waitSql("select count(*) from organizations", String(Number(orgsBefore) + 1))) === String(Number(orgsBefore) + 1), "approve: one organisation, no more");
const agentOrg = sql(`select id from organizations where name = 'Kumar Guidance ${tag}'`);
check(sql(`select type from organizations where id = '${agentOrg}'`) === "SUB_AGENT", "approve: it is a sub-agent");
check(sql(`select parent_org_id is not null from organizations where id = '${agentOrg}'`) === "t", "approve: under the branch that was chosen");
check(sql(`select role from users where email = 'anil.${tag}@example.com'`) === "PARTNER", "approve: the owner's login is a partner account");
check(sql(`select must_change_password from users where email = 'anil.${tag}@example.com'`) === "t", "approve: they must change the password at sign in");
check(sql(`select org_id = '${agentOrg}' from agent_applications where id = '${applicationId}'`) === "t", "approve: the application remembers what it became");

// --- The sub-agent's own portal.
sql(`update users set must_change_password = false, password_hash = (select password_hash from users where email = 'admin@medcityoverseas.test') where email = 'anil.${tag}@example.com'`);
const agent = await signIn(`anil.${tag}@example.com`, "10.190.1.3");
const gp = agent.page;
await go(gp, "/dashboard");
const shell = await body(gp);
check(/My referrals/i.test(shell), "agent: their own referrals are in the nav");
check(/Agreement/.test(shell), "agent: and the Agreement");

// The agreement, before anything else.
text = await go(gp, "/agreement");
check(/Memorandum of Understanding/.test(text), "agreement: the published version is there to read");
check(/What is not paid for/.test(text), "agreement: the whole text, not a summary");
check(/Not accepted/.test(text), "agreement: and it says they have not accepted it");
await gp.locator('input[name="typedName"]').fill(`Anil Kumar ${tag}`);
await gp.locator('input[name="agree"]').check();
await gp.getByRole("button", { name: /Accept 2026\.1/ }).click();
check((await waitSql(`select count(*) from mou_acceptances where org_id = '${agentOrg}'`, "1")) === "1", "agreement: accepting it is recorded once");
check(sql(`select accepted_name from mou_acceptances where org_id = '${agentOrg}'`) === `Anil Kumar ${tag}`, "agreement: with the name they typed, not their account name");
check(sql(`select ip_address is not null from mou_acceptances where org_id = '${agentOrg}'`) === "t", "agreement: and where from");
text = await waitText(gp, /You have accepted this version/);
check(/not an electronic signature/.test(text), "agreement: the page says what this is and is not");
await gp.screenshot({ path: `${OUT}/03-agreement.png`, fullPage: true });

// --- Referring somebody.
text = await go(gp, "/referrals");
check(/Students you have sent to Medcity/.test(text), "referrals: the page explains itself");
check(/10% of what Medcity earns/.test(text), "referrals: the rate they are on is on the screen");
check(/once Medcity has actually been paid/.test(text), "referrals: and when it becomes money they can take");
await gp.locator('input[name="name"]').fill(`Meera Referred ${tag}`);
await gp.locator('input[name="phone"]').fill(`+91 9111${tag}`);
await gp.locator('input[name="city"]').fill("Alappuzha");
await gp.locator('input[name="interestCountry"]').fill("Germany");
await gp.locator('select[name="interestPathway"]').selectOption("AUSBILDUNG");
await gp.locator('textarea[name="notes"]').fill("Std. 12 science, no German yet.");
await gp.locator('input[name="consent"]').check();
await gp.getByRole("button", { name: "Send the referral" }).click();
await gp.waitForURL((u) => String(u).includes("sent=1"), { timeout: 20000 }).catch(() => {});
const enquiryId = await waitSql(`select coalesce(max(id), '') from enquiries where name = 'Meera Referred ${tag}'`, "", 1) || sql(`select id from enquiries where name = 'Meera Referred ${tag}'`);
check(!!enquiryId, "refer: the lead is recorded");
check(sql(`select submitted_by_org_id = '${agentOrg}' from enquiries where id = '${enquiryId}'`) === "t", "refer: the sub-agent is recorded as the referrer");
check(sql(`select o.type from enquiries e join organizations o on o.id = e.org_id where e.id = '${enquiryId}'`) === "HQ", "refer: and it lands with the head office, not a branch");
check(sql(`select source from enquiries where id = '${enquiryId}'`) === "REFERRAL", "refer: marked as a referral");
check(sql(`select count(*) from enquiry_notes where enquiry_id = '${enquiryId}' and body like '%agreed to being referred%'`) === "1", "refer: the permission they confirmed is written down");
text = await main(gp);
check(new RegExp(`Meera Referred ${tag}`).test(text), "refer: it is on their own list at once");
check(/With Medcity, not looked at yet/.test(text), "refer: with the stage in words a family would understand");

// The same number twice from the same sub-agent is the same lead.
await gp.locator('input[name="name"]').fill("Meera Again");
await gp.locator('input[name="phone"]').fill(`+91 9111${tag}`);
await gp.locator('input[name="consent"]').check();
await gp.getByRole("button", { name: "Send the referral" }).click();
check(/already referred that number/.test(await waitText(gp, /already referred that number/)), "refer: referring the same number twice is refused");

// A sub-agent sees their own referrals and nobody else's.
const someoneElse = sql(`select name from enquiries where coalesce(submitted_by_org_id, '') <> '${agentOrg}' limit 1`);
check(!(await main(gp)).includes(someoneElse), "refer: and never another organisation's leads");
await gp.screenshot({ path: `${OUT}/04-referrals.png`, fullPage: true });

// --- The desk passes it to a branch.
text = await go(dp, "/admin/agents?tab=referrals");
check(/Waiting for a branch/.test(text), "desk: referrals nobody is working have their own list");
check(new RegExp(`Meera Referred ${tag}`).test(text), "desk: the new one is in it");
const waitingRow = dp.locator("tr").filter({ hasText: `Meera Referred ${tag}` }).first();
const branchId = sql("select id from organizations where name = 'Medcity Kottayam'");
await waitingRow.locator('select[name="orgId"]').selectOption(branchId);
await waitingRow.getByRole("button", { name: "Give it to them" }).click();
check((await waitSql(`select org_id from enquiries where id = '${enquiryId}'`, branchId)) === branchId, "assign: the branch now owns the lead");
check(sql(`select submitted_by_org_id = '${agentOrg}' from enquiries where id = '${enquiryId}'`) === "t", "assign: and the referrer is unchanged, because the referrer is who gets paid");
check(sql(`select assigned_to_id is not null from enquiries where id = '${enquiryId}'`) === "t", "assign: somebody inside the branch owns it");
text = await go(gp, "/referrals");
check(/Medcity Kottayam/.test(text), "assign: the sub-agent can see who is holding it");

// --- The branch registers the referral as a student.
const branch = await signIn("kottayam@medcity.test", "10.190.1.4");
const bp = branch.page;
await bp.goto(`${BASE}/students/new?enquiryId=${enquiryId}`);
await settle(bp);
await bp.fill('input[name="firstName"]', "Meera");
await bp.fill('input[name="lastName"]', `Referred${tag}`);
await bp.fill('input[name="phone"]', `+91 9111${tag}`);
await bp.locator('input[name="consent"]').check().catch(() => {});
await bp.locator('button[type="submit"]').first().click();
await bp.waitForURL((u) => /\/students\/[^/]+\/profile/.test(String(u)), { timeout: 20000 }).catch(() => {});
const studentId = sql(`select coalesce(student_id, '') from enquiries where id = '${enquiryId}'`);
check(!!studentId, "register: the enquiry is converted against a student");
check(sql(`select referred_by_org_id = '${agentOrg}' from students where id = '${studentId}'`) === "t", "register: the student file remembers who referred them");
check((await waitSql(`select count(*) from referral_earnings where student_id = '${studentId}'`, "1")) === "1", "register: the earning is opened the same day");
check(sql(`select state from referral_earnings where student_id = '${studentId}'`) === "PENDING", "register: not yet earned, because Medcity has not been paid");
check(sql(`select amount_inr is null from referral_earnings where student_id = '${studentId}'`) === "t", "register: and carries no figure yet rather than a nought");
text = await go(gp, "/referrals");
check(/Registered as a student/.test(text), "register: the sub-agent sees it happened");
check(/Not yet earned/.test(text), "register: and that nothing is owed yet");

// --- Money in makes it payable.
// A seeded student with a commission is given the same referrer, so settling
// that commission exercises the hook rather than a special path.
// A commission has to be invoiced before it can be marked received, which is
// where the referral hook fires. The fixture is set up in the database; the move
// that matters is made through the screen.
const commissionId = sql("select c.id from commissions c where c.status not in ('SETTLED', 'WRITTEN_OFF') and c.partner_amount_inr is not null order by c.created_at limit 1");
if (commissionId) sql(`update commissions set status = 'INVOICED', invoiced_at = now() where id = '${commissionId}'`);
if (!commissionId) {
  bad("earning: the seed left no commission to settle");
} else {
  const earnerStudent = sql(`select a.student_id from commissions c join applications a on a.id = c.application_id where c.id = '${commissionId}'`);
  sql(`update students set referred_by_org_id = '${agentOrg}' where id = '${earnerStudent}'`);
  const gross = sql(`select grossSelect from (select case when currency = 'INR' then round(gross_amount) else null end as grossSelect from commissions where id = '${commissionId}') x`);
  const walletBefore = sql(`select count(*) from wallet_entries where org_id = '${agentOrg}' and kind = 'REFERRAL'`);
  text = await go(dp, "/admin/commission?tab=pipeline");
  // The pipeline moves one commission at a time from its own row.
  const commissionRow = dp.locator("tr").filter({ has: dp.locator(`input[value="${commissionId}"]`) }).first();
  const hasRow = (await commissionRow.count()) > 0;
  if (!hasRow) {
    bad("earning: the commission is not on the first page of the pipeline, so the hook could not be exercised through the screen");
  } else {
    await commissionRow.locator('select[name="status"]').selectOption("RECEIVED");
    await commissionRow.locator('button[type="submit"]').first().click();
    check((await waitSql(`select status from commissions where id = '${commissionId}'`, "RECEIVED")) === "RECEIVED", "earning: the commission is marked received");
    check(
      (await waitSql(`select state from referral_earnings where student_id = '${earnerStudent}'`, "PAYABLE")) === "PAYABLE",
      "earning: and the referral behind it becomes payable",
    );
    const amount = sql(`select coalesce(amount_inr::text, '') from referral_earnings where student_id = '${earnerStudent}'`);
    if (gross) check(amount === String(Math.round(Number(gross) * 0.1)), `earning: priced at the platform rate, 10% of ${gross} (${amount})`);
    else ok(`earning: the commission is not in rupees, so the figure comes from the exchange rate (${amount || "not recorded"})`);
    const walletAfter = await waitSql(`select count(*) from wallet_entries where org_id = '${agentOrg}' and kind = 'REFERRAL'`, String(Number(walletBefore) + 1));
    check(Number(walletAfter) > Number(walletBefore), `earning: the sub-agent's wallet is credited (${walletBefore} to ${walletAfter})`);
    check(sql(`select wallet_entry_id is not null from referral_earnings where student_id = '${earnerStudent}'`) === "t", "earning: the credit is tied to the earning, so it cannot happen twice");
    // Passing through SETTLED as well must not credit a second time.
    sql(`update commissions set status = 'RECEIVED' where id = '${commissionId}'`);
    const twice = sql(`select count(*) from wallet_entries where org_id = '${agentOrg}' and kind = 'REFERRAL'`);
    check(twice === walletAfter, "earning: and a second pass credits nothing again");
  }
}

// --- The conditions on a withdrawal.
const balance = sql(`select coalesce(sum(amount_inr), 0) from wallet_entries where org_id = '${agentOrg}'`);
text = await go(gp, "/wallet");
check(/The current agreement is accepted/.test(text), "withdraw: the agreement condition is listed and met");
check(/Bank details and PAN are on file/.test(text), "withdraw: so is the bank one");
check(/Medcity has been paid for the students behind it/.test(text), "withdraw: and the money-in rule is stated rather than assumed");
check(/Add a company with its account number/.test(text), "withdraw: with no bank details on file, it says where to add them");
check(/Not yet/.test(text), "withdraw: and the whole thing is held up");
await gp.screenshot({ path: `${OUT}/05-withdraw-blocked.png`, fullPage: true });

// Bank details, then a minimum above the balance, then under it.
sql(`insert into billing_companies (id, org_id, legal_name, address, state, pan, bank_account_name, bank_account_number, ifsc, is_default) values ('bc${tag}', '${agentOrg}', 'Kumar Guidance', 'Alappuzha', 'Kerala', 'AAACK1234K', 'Kumar Guidance', '123456789012', 'HDFC0001234', true)`);
sql(`update app_settings set min_withdrawal_inr = ${Number(balance) + 100000} where id = 'app'`);
text = await go(gp, "/wallet");
check(/At least/.test(text) && /to go/.test(text), "withdraw: a minimum above the balance says how far short they are");
sql("update app_settings set min_withdrawal_inr = 1000 where id = 'app'");
text = await go(gp, "/wallet");
check(!/Not yet/.test(text), `withdraw: with everything met, the form opens (balance ${balance})`);
const payoutsBefore = sql(`select count(*) from payout_requests where org_id = '${agentOrg}'`);
await gp.locator('input[name="amountInr"]').fill("1000");
await gp.getByRole("button", { name: "Request payout" }).click();
check((await waitSql(`select count(*) from payout_requests where org_id = '${agentOrg}'`, String(Number(payoutsBefore) + 1))) === String(Number(payoutsBefore) + 1), "withdraw: the request reaches the desk");
await gp.screenshot({ path: `${OUT}/06-withdraw-open.png`, fullPage: true });

// While one is waiting, the page says so instead of offering the form again.
text = await go(gp, "/wallet");
check(/requested/i.test(text) && /will confirm the transfer/.test(text), "withdraw: a request already with the desk is shown rather than a second form");
check((await gp.locator('input[name="amountInr"]').count()) === 0, "withdraw: and there is nothing to ask with");

// An unaccepted agreement shuts it again, which is the condition doing its job.
sql(`delete from payout_requests where org_id = '${agentOrg}'`);
sql(`delete from mou_acceptances where org_id = '${agentOrg}'`);
text = await go(gp, "/wallet");
check(/Read the agreement and accept it/.test(text), "withdraw: taking the acceptance away shuts it again");
check(/Not yet/.test(text), "withdraw: and the whole list is shown again rather than one refusal");

// --- Nobody else's business.
const branchText = await go(bp, "/referrals");
check(/Not a sub-agent/.test(branchText), "roles: a branch is told this page is not theirs");
check((await bp.locator('input[name="name"]').count()) === 0, "roles: and is given no referral form");
const mgmt = await signIn("management@medcityoverseas.test", "10.190.1.5");
await mgmt.page.goto(`${BASE}/admin/agents`);
await mgmt.page.waitForTimeout(500);
check(/forbidden/i.test(await body(mgmt.page)) || !mgmt.page.url().includes("/admin/agents"), "roles: management is kept off the sub-agent screens");
await gp.goto(`${BASE}/admin/agents`);
await gp.waitForTimeout(500);
check(!gp.url().includes("/admin/agents") || /forbidden/i.test(await body(gp)), "roles: and so is a sub-agent");

for (const [who, e] of [["anonymous", anon.errors], ["desk", admin.errors], ["sub-agent", agent.errors], ["branch", branch.errors], ["management", mgmt.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
