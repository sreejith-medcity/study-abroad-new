// The link to Medcity's own CRM: a key, the two ways of proving who you are,
// registering and updating a student, last edit wins without being silent, the
// lookup, the lead, idempotency, and the outbound queue with its retries.
// Wants the plain seed.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";

const OUT = "/tmp/smoke-crm-link";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });

async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
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
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
};

await fetch(`${BASE}/login`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const tag = String(Date.now()).slice(-6);

// --- A key, made by the super admin.
const su = await signIn("sreejith@miak.in", "10.200.1.1");
const sp = su.page;
let text = await go(sp, "/admin/integrations");
check(/The CRM link/.test(text), "screen: the sync screen exists");
check(/Nothing is being sent out/.test(text), "screen: it says plainly that nothing goes out until it is switched on");

text = await go(sp, "/admin/integrations?tab=keys");
check(/No keys yet/.test(text) || /Key id/.test(text), "keys: the tab is there");
await sp.getByRole("button", { name: "New key" }).click();
const dialog = sp.getByRole("dialog").first();
await dialog.locator('input[name="name"]').fill(`Vendor test ${tag}`);
await dialog.getByRole("button", { name: "Make the key" }).click();
const said = await waitIn(dialog, /Secret: mcs_/);
const keyId = (said.match(/Key id: (mck_[0-9a-f]+)/) || [])[1];
const secret = (said.match(/Secret: (mcs_[0-9a-f]+)/) || [])[1];
check(!!keyId && !!secret, `keys: the key id and the secret are shown once (${keyId})`);
check(/cannot be shown again/.test(said), "keys: and it says the secret will not be shown again");
check(sql(`select count(*) from integration_keys where key_id = '${keyId}'`) === "1", "keys: it is recorded");
check(sql(`select secret_hash like '$2%' from integration_keys where key_id = '${keyId}'`) === "t", "keys: the secret is kept hashed, not in the open");
check(sql(`select secret_box is not null from integration_keys where key_id = '${keyId}'`) === "t", "keys: with a sealed copy, because a signature cannot be checked without the secret");
await sp.screenshot({ path: `${OUT}/01-keys.png`, fullPage: true });

const auth = { [`x-medcity-key`]: keyId, authorization: `Bearer ${secret}`, "content-type": "application/json" };

// --- Who may call.
let r = await call("/api/crm/students", { method: "POST", body: "{}" });
check(r.status === 401 && /x-medcity-key/.test(r.json?.error ?? ""), "auth: no key at all is refused");
r = await call("/api/crm/students", { method: "POST", headers: { "x-medcity-key": keyId, "content-type": "application/json" }, body: "{}" });
check(r.status === 401 && /bearer/i.test(r.json?.error ?? ""), "auth: a key with no token is refused");
r = await call("/api/crm/students", { method: "POST", headers: { ...auth, authorization: "Bearer mcs_wrong" }, body: "{}" });
check(r.status === 401 && /does not match/.test(r.json?.error ?? ""), "auth: a wrong token is refused");
check(sql("select count(*) from integration_events where direction = 'IN' and status = 'FAILED'") !== "0", "auth: a refusal is recorded, so a vendor fighting the auth is visible");

// --- Registering somebody new.
const crmId = `CRM-${tag}`;
const body = (over = {}) =>
  JSON.stringify({
    crmId,
    updatedAt: "2026-10-02T09:15:00Z",
    branch: "KOT",
    firstName: "Meera",
    lastName: `FromCrm${tag}`,
    phone: `+91 9333${tag}`,
    email: `meera.${tag}@example.com`,
    dateOfBirth: "2004-03-11",
    ...over,
  });

r = await call("/api/crm/students", { method: "POST", headers: auth, body: JSON.stringify({ crmId, firstName: "No", lastName: "Timestamp", phone: "+91 9000000000", branch: "KOT" }) });
check(r.status === 400 && /updatedAt is required/.test(r.json?.error ?? ""), "register: without their updatedAt it is refused, because there is no way to tell which edit is later");
r = await call("/api/crm/students", { method: "POST", headers: auth, body: body({ branch: undefined }) });
check(r.status === 400 && /branch is required/.test(r.json?.error ?? ""), "register: and without a branch, because a student on the head office belongs to nobody");

r = await call("/api/crm/students", { method: "POST", headers: { ...auth, "idempotency-key": `first-${tag}` }, body: body() });
check(r.status === 201 && r.json?.created === true, `register: a new student is created (${r.status})`);
const studentId = r.json?.studentId;
check(/^MC-KOT-/.test(r.json?.medcityId ?? ""), `register: with a Medcity ID from that branch (${r.json?.medcityId})`);
check(sql(`select crm_id from students where id = '${studentId}'`) === crmId, "register: linked to their CRM id");
check(sql(`select source from students where id = '${studentId}'`) === "crm", "register: and marked as having come from the CRM");
check(sql(`select consent_text like '%Medcity%CRM%' from students where id = '${studentId}'`) === "t", "register: consent is recorded as the CRM's claim, not restated as the portal's");
check(!!r.json?.student?.journeyStage, "register: the answer carries the student's own summary back");

// The same call again hands back the first answer rather than a second student.
const again = await call("/api/crm/students", { method: "POST", headers: { ...auth, "idempotency-key": `first-${tag}` }, body: body({ firstName: "Changed" }) });
check(again.headers.get("x-medcity-replay") === "1", "idempotency: a repeat is answered from the first call");
check(again.json?.studentId === studentId, "idempotency: with the same student id");
check(sql(`select first_name from students where id = '${studentId}'`) === "Meera", "idempotency: and the repeat's different body changed nothing");
check(sql(`select count(*) from students where crm_id = '${crmId}'`) === "1", "idempotency: no second student was created");

// --- Last edit wins, in both directions.
r = await call("/api/crm/students", { method: "POST", headers: auth, body: body({ updatedAt: "2026-10-03T09:00:00Z", city: "Kochi" }) });
check(r.status === 200 && r.json?.created === false, "update: a newer message updates the student");
check(sql(`select city from students where id = '${studentId}'`) === "Kochi", "update: and the field is written");
check((r.json?.changed ?? []).includes("city"), "update: the answer says which fields were written");
check(sql(`select count(*) from audit_logs where action = 'crm.student.update' and entity_id = '${studentId}'`) !== "0", "update: with what it replaced kept in the audit log, so a bad overwrite can be undone");

// A counsellor corrects something, then a stale CRM message tries to undo it.
sql(`update students set city = 'Alappuzha', updated_at = now() where id = '${studentId}'`);
r = await call("/api/crm/students", { method: "POST", headers: auth, body: body({ updatedAt: "2026-09-01T09:00:00Z", city: "Kochi" }) });
check(r.status === 200, "stale: an older message is still accepted");
check(sql(`select city from students where id = '${studentId}'`) === "Alappuzha", "stale: but the correction stands, because the portal's copy is newer");
check(r.json?.staleMessage === true, "stale: the answer says the message was the older one");
check((r.json?.leftAlone ?? []).some((c) => c.field === "city" && c.ours === "Alappuzha" && c.yours === "Kochi"), "stale: and names the field with both values, so the CRM can show its own user");
check((await waitSql("select count(*) from integration_events where status = 'NEEDS_A_PERSON'", "1")) === "1", "stale: it is put in front of a person rather than lost");
text = await go(sp, "/admin/integrations?tab=attention");
check(/older than ours/.test(text), "stale: and says so on the screen in words");
check(/city/.test(text), "stale: naming the field");
await sp.screenshot({ path: `${OUT}/02-needs-a-person.png`, fullPage: true });

// A blank never clears what the portal holds.
r = await call("/api/crm/students", { method: "POST", headers: auth, body: body({ updatedAt: "2026-10-05T09:00:00Z", email: "" }) });
check(sql(`select email from students where id = '${studentId}'`) !== "", "blank: an empty value from the CRM does not empty the portal's field");

// A field nobody agreed on is named, not written.
r = await call("/api/crm/students", { method: "POST", headers: auth, body: body({ updatedAt: "2026-10-06T09:00:00Z", journeyStage: "VISA" }) });
check((r.json?.ignoredFields ?? []).includes("journeyStage"), "scope: a field outside the agreed list is named back rather than written");
check(sql(`select journey_stage from students where id = '${studentId}'`) !== "VISA", "scope: and the portal's own column is untouched");

// --- The lookup.
r = await call(`/api/crm/students?crmId=${crmId}`, { headers: auth });
check(r.status === 200 && r.json?.found === true, "lookup: by their own id");
check(r.json?.student?.medcityId?.startsWith("MC-KOT-"), "lookup: answers with the Medcity ID");
check(Array.isArray(r.json?.student?.outstandingDocuments), "lookup: and what is still wanted from them");
check(!("passportNumber" in (r.json?.student ?? {})), "lookup: but not their passport number");
r = await call(`/api/crm/students?phone=9333${tag}`, { headers: auth });
check(r.json?.found === true, "lookup: by the last ten digits of a number, however it was written");
r = await call("/api/crm/students?crmId=nobody", { headers: auth });
check(r.status === 404, "lookup: an unknown one is a plain 404");
r = await call("/api/crm/students", { headers: auth });
check(r.status === 400, "lookup: with nothing to look up by, it says so");

// --- A lead.
r = await call("/api/crm/enquiries", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ crmId: `LEAD-${tag}`, name: `Devika ${tag}`, phone: `+91 9444${tag}`, branch: "KOT", interestCountry: "Germany" }),
});
check(r.status === 201 && r.json?.created === true, "lead: a lead comes in as an enquiry");
const enquiryId = r.json?.enquiryId;
check(sql(`select crm_id from enquiries where id = '${enquiryId}'`) === `LEAD-${tag}`, "lead: linked to its CRM id");
r = await call("/api/crm/enquiries", { method: "POST", headers: auth, body: JSON.stringify({ crmId: `LEAD-${tag}`, name: "Overwritten", phone: "+91 9000000001" }) });
check(r.json?.created === false && r.json?.enquiryId === enquiryId, "lead: the same one twice changes nothing a counsellor may have written on it");
check(sql(`select name from enquiries where id = '${enquiryId}'`) === `Devika ${tag}`, "lead: and the name is not overwritten");

// --- Signing.
await go(sp, "/admin/integrations?tab=keys");
const keyRow = sp.locator("tr").filter({ hasText: `Vendor test ${tag}` }).first();
await keyRow.getByRole("button", { name: "Require signing" }).click();
check((await waitSql(`select signature_required from integration_keys where key_id = '${keyId}'`, "t")) === "t", "signing: it can be switched on for a key without making a new one");
r = await call("/api/crm/students", { method: "POST", headers: auth, body: body({ updatedAt: "2026-10-07T09:00:00Z" }) });
check(r.status === 401 && /signature/i.test(r.json?.error ?? ""), "signing: with it on, a bearer token alone is refused");

const signed = (method, path, payload) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", secret).update([method.toUpperCase(), path, ts, payload].join("\n")).digest("hex");
  return { "x-medcity-key": keyId, "x-medcity-timestamp": ts, "x-medcity-signature": sig, "content-type": "application/json" };
};
const payload = body({ updatedAt: "2026-10-08T09:00:00Z", city: "Kollam" });
r = await call("/api/crm/students", { method: "POST", headers: signed("POST", "/api/crm/students", payload), body: payload });
check(r.status === 200, `signing: a request signed the documented way is accepted (${r.status})`);
check(sql(`select city from students where id = '${studentId}'`) === "Kollam", "signing: and does its work");
r = await call("/api/crm/students", { method: "POST", headers: signed("POST", "/api/crm/students", payload), body: body({ updatedAt: "2026-10-09T09:00:00Z", city: "Tampered" }) });
check(r.status === 401, "signing: a body changed after signing is refused");
const old = String(Math.floor(Date.now() / 1000) - 3600);
const oldSig = createHmac("sha256", secret).update(["POST", "/api/crm/students", old, payload].join("\n")).digest("hex");
r = await call("/api/crm/students", { method: "POST", headers: { "x-medcity-key": keyId, "x-medcity-timestamp": old, "x-medcity-signature": oldSig, "content-type": "application/json" }, body: payload });
check(r.status === 401 && /seconds out/.test(r.json?.error ?? ""), "signing: an hour-old signature is refused, so one copied off the wire is no use");

// --- Sending out, with a listener standing in for the CRM.
const received = [];
let answerWith = 200;
const listener = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body: raw });
    res.writeHead(answerWith, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});
await new Promise((r2) => listener.listen(4555, "127.0.0.1", r2));

text = await go(sp, "/admin/integrations?tab=sending");
await sp.locator('input[name="url"]').fill("http://127.0.0.1:4555/hooks/medcity");
await sp.locator('input[name="secret"]').fill(`signing-secret-${tag}`);
for (const kind of ["student.stage", "application.status", "money.event", "document.decision"]) {
  await sp.locator(`input[name="kinds"][value="${kind}"]`).check();
}
await sp.locator('input[name="enabled"]').check();
await sp.getByRole("button", { name: "Save" }).first().click();
check((await waitSql("select crm_webhook_enabled from app_settings where id = 'app'", "t")) === "t", "sending: the target is saved and switched on");
check(sql("select crm_webhook_secret_box is not null from app_settings where id = 'app'") === "t", "sending: with the signing secret sealed, not in the open");

await sp.getByRole("button", { name: "Send a test event" }).click();
const testSaid = await waitIn(sp.locator("main"), /Sent, and they answered|Not sent/);
check(/Sent, and they answered 200/.test(testSaid), `sending: the test event reaches the listener (${testSaid.slice(0, 80)})`);
check(received.length > 0, "sending: and arrives");
const testBody = JSON.parse(received[received.length - 1].body);
check(testBody.test === true, "sending: marked as a test, so nothing on their side mistakes it for a student");
check(!!received[received.length - 1].headers["x-medcity-signature"], "sending: carrying a signature over the body rather than the secret itself");
const expectSig = createHmac("sha256", `signing-secret-${tag}`)
  .update(["POST", "/hooks/medcity", received[received.length - 1].headers["x-medcity-timestamp"], received[received.length - 1].body].join("\n"))
  .digest("hex");
check(received[received.length - 1].headers["x-medcity-signature"] === expectSig, "sending: and the signature is one they can verify the documented way");

// A real event: a student moved to the next stage.
const movable = sql("select id from students where journey_stage <> 'ARRIVED' order by created_at limit 1");
const stageNow = sql(`select journey_stage from students where id = '${movable}'`);
const before = received.length;
await go(sp, `/students/${movable}/documentation`);
const mover = sp.getByRole("button", { name: "Move the stage" }).first();
if ((await mover.count()) === 0) {
  bad("sending: the stage mover is not on that student's documentation tab, so the hook was not exercised");
} else {
  // The stage select starts where the student is, so it is moved on by one. A
  // gate in the way is overridden with a reason, which is the desk's own path.
  const options = await sp.locator(`select[name="stage"]`).first().locator("option").evaluateAll((os) => os.map((o) => o.value));
  const nextStage = options[Math.min(options.indexOf(stageNow) + 1, options.length - 1)];
  await sp.locator('select[name="stage"]').first().selectOption(nextStage);
  const why = sp.locator('input[name="reason"]').first();
  if ((await why.count()) > 0) await why.fill("Moved by the integration test");
  await mover.click();
  await sp.waitForTimeout(1500);
  check((await waitSql(`select count(*) from integration_events where direction = 'OUT' and kind = 'student.stage' and entity_id = '${movable}'`, "1")) === "1", "sending: moving a student queues an event");
  check(sql(`select status from integration_events where direction = 'OUT' and kind = 'student.stage' and entity_id = '${movable}'`) === "PENDING", "sending: queued rather than posted, so the counsellor does not wait on somebody else's server");
  await go(sp, "/admin/integrations?tab=sending");
  await sp.getByRole("button", { name: "Send what is waiting" }).click();
  check((await waitSql(`select status from integration_events where direction = 'OUT' and kind = 'student.stage' and entity_id = '${movable}'`, "SENT")) === "SENT", "sending: draining the queue sends it");
  check(received.length > before, "sending: and the listener has it");
}

// What happens when the CRM refuses, and when it breaks.
answerWith = 400;
await go(sp, "/admin/integrations?tab=sending");
await sp.getByRole("button", { name: "Send a test event" }).click();
await waitIn(sp.locator("main"), /Not sent/);
check(sql("select count(*) from integration_events where direction = 'OUT' and status = 'NEEDS_A_PERSON' and response_status = 400") !== "0", "retries: a refusal the CRM meant is not retried, it is put in front of a person");
answerWith = 503;
await sp.getByRole("button", { name: "Send a test event" }).click();
// Waited on in the database rather than on the screen: the refusal above has
// left its own message in the form, so a screen wait would match that instead.
const retrying = await waitSql("select count(*) from integration_events where direction = 'OUT' and status = 'PENDING' and response_status = 503", "1");
check(retrying !== "0", "retries: a 503 is left to be tried again");
check(sql("select count(*) from integration_events where direction = 'OUT' and status = 'PENDING' and response_status = 503 and next_attempt_at > now()") !== "0", "retries: after a wait, not at once");

text = await go(sp, "/admin/integrations?tab=attention");
const stuck = sp.locator("li").filter({ hasText: "refused it" }).first();
if ((await stuck.count()) > 0) {
  await stuck.getByRole("button", { name: "Try again" }).click();
  check((await waitSql("select count(*) from integration_events where direction = 'OUT' and status = 'NEEDS_A_PERSON' and response_status = 400", "0")) === "0", "attention: a row can be put back in the queue once whatever was wrong is fixed");
} else {
  bad("attention: the refused row is not on the queue screen");
}

listener.close();

// --- The page the vendor is sent to.
text = await go(sp, "/admin/integrations?tab=api");
check(/POST \/api\/crm\/students/.test(text), "vendor: the endpoints are written down");
check(/x-medcity-signature/.test(text), "vendor: with the header names");
check(/method, the path, the timestamp and the exact body/.test(text), "vendor: and the signing order, which is where signing integrations go wrong first");
check(/idempotency-key/.test(text), "vendor: and how to retry safely");
check(/never clears a value the portal holds/.test(text), "vendor: and that a blank does not delete");
await sp.screenshot({ path: `${OUT}/03-for-the-vendor.png`, fullPage: true });

// --- Who may see it.
const ops = await signIn("ops@medcityoverseas.test", "10.200.1.2");
text = await go(ops.page, "/admin/integrations");
check(/The CRM link/.test(text), "roles: an ops manager can read it");
check((await ops.page.getByRole("button", { name: "New key" }).count()) === 0, "roles: but cannot make a key");
const admin = await signIn("admin@medcityoverseas.test", "10.200.1.3");
await admin.page.goto(`${BASE}/admin/integrations`);
await admin.page.waitForTimeout(400);
check(!admin.page.url().includes("/admin/integrations") || /forbidden/i.test(await admin.page.locator("body").innerText()), "roles: an Overseas admin is kept off it");
const partner = await signIn("kottayam@medcity.test", "10.200.1.4");
await partner.page.goto(`${BASE}/admin/integrations`);
await partner.page.waitForTimeout(400);
check(!partner.page.url().includes("/admin/integrations") || /forbidden/i.test(await partner.page.locator("body").innerText()), "roles: and so is a branch");

// A revoked key stops working at once.
await go(sp, "/admin/integrations?tab=keys");
await sp.locator("tr").filter({ hasText: `Vendor test ${tag}` }).first().getByRole("button", { name: "Revoke" }).click();
check((await waitSql(`select active from integration_keys where key_id = '${keyId}'`, "f")) === "f", "keys: revoking one is recorded");
r = await call("/api/crm/students", { method: "POST", headers: signed("POST", "/api/crm/students", payload), body: payload });
check(r.status === 401 && /not in use/.test(r.json?.error ?? ""), "keys: and it stops working at once");

for (const [who, e] of [["super admin", su.errors], ["ops", ops.errors], ["admin", admin.errors], ["branch", partner.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
