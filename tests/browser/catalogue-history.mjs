// Catalogue change history: an admin edits a program, the history card shows
// the value from before the edit, and Restore puts it back. A counsellor
// neither sees the history nor gets anywhere by sending the restore request
// an admin sent. A restore of an old save leaves a field that has been saved
// again since, and says so, and Restore refuses while the edit form holds
// typing nobody has saved. Works on the plain seed or the full catalogue.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// A live program the edit screen will save as it stands: it has an intake,
// and a work rights verdict only where it has evidence for it.
const row = sql(`
  select p.id || '|' || p.university_id || '|' || coalesce(p.application_fee::text, '')
  from programs p
  where p.status = 'LIVE' and cardinality(p.intake_months) > 0
    and (p.work_rights = 'UNKNOWN' or coalesce(p.work_rights_note, '') <> '')
    and p.level::text <> 'TOP_UP'
    and (p.program_url is null or p.program_url ~ '^https?://')
  order by p.created_at, p.id
  limit 1`);
if (!row) {
  console.log("SKIPPED: no live program with an intake to edit.");
  process.exit(0);
}
const [id, uniId, oldFeeText] = row.split("|");
const oldFee = oldFeeText === "" ? null : Number(oldFeeText);
const newFee = (oldFee ?? 100) + 37;
const fee = () => sql(`select coalesce(application_fee::text, '') from programs where id = '${id}'`);
const restores = () => n(`select count(*) from catalogue_changes where entity = 'program' and entity_id = '${id}' and source = 'restore'`);
const adminName = sql("select name from users where email = 'admin@medcityoverseas.test'");
const digits = (s) => String(s).replace(/[^0-9]/g, "");
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.248.7.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 120)); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const go = async (page, path) => {
  await page.goto(`${BASE}${path}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
};

// Replays a captured server action request from another signed-in context.
// The cookies are that context's own, so it is the same call made by someone else.
async function replay(ctx, captured) {
  const headers = { ...captured.headers };
  for (const h of Object.keys(headers)) if (h.startsWith(":")) delete headers[h];
  for (const h of ["cookie", "host", "content-length", "connection", "origin", "referer", "x-forwarded-for"]) delete headers[h];
  headers.origin = BASE;
  const res = await ctx.request.post(captured.url, { headers, data: captured.body, maxRedirects: 0, failOnStatusCode: false });
  return res.status();
}

let captured = null;

/* ---------------- An admin edits a field, and the history keeps the old value ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, `/admin/programs/${id}`);
  check((await a.page.locator("[data-change-history]").count()) === 1, "the admin program page has a change history card");

  await a.page.fill('input[name="applicationFee"]', String(newFee));
  await a.page.getByRole("button", { name: "Save program" }).click();
  await a.page.locator('[role="status"]').filter({ hasText: /Saved/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(fee() === String(newFee), `the edit saves the new fee (${fee()} against ${newFee})`);
  check(
    n(`select count(*) from catalogue_changes c join users u on u.id = c.changed_by_id
       where c.entity = 'program' and c.entity_id = '${id}' and c.field = 'applicationFee' and c.source = 'edit'
         and u.email = 'admin@medcityoverseas.test' and c.after = '${newFee}'::jsonb`) === 1,
    "the edit is recorded field by field, with who made it",
  );

  await go(a.page, `/admin/programs/${id}`);
  const card = a.page.locator("[data-change-history]");
  const latest = card.locator("[data-change-batch]").first();
  const text = await latest.innerText().catch(() => "");
  check(text.includes(adminName) && /Edited/.test(text), `the newest entry names the admin and says it was an edit (${text.split("\n").slice(0, 2).join(" / ")})`);
  const field = latest.locator('[data-change-field="applicationFee"]');
  check((await field.count()) === 1 && /Application fee/.test(await field.innerText()), "the field is named in plain words");
  const before = await field.locator("[data-before]").innerText().catch(() => "");
  const after = await field.locator("[data-after]").innerText().catch(() => "");
  check(oldFee == null ? before === "Not recorded" : oldFee === 0 ? before === "No application fee" : digits(before) === String(oldFee), `before shows the old fee as the page shows fees (${before})`);
  check(digits(after) === String(newFee), `after shows the new fee (${after})`);

  /* ---------------- Restore puts it back ---------------- */
  const request = a.page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"], { timeout: 10000 }).catch(() => null);
  await field.getByRole("button", { name: "Restore Application fee" }).click();
  const req = await request;
  if (req) captured = { url: req.url(), headers: await req.allHeaders(), body: req.postDataBuffer() };
  await a.page.locator('[role="status"]').filter({ hasText: /Restored 1 field/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(fee() === (oldFee == null ? "" : String(oldFee)), `restore puts the old fee back (${fee() || "Not recorded"})`);
  check(restores() === 1, "and the restore is recorded as a change of its own");
  // Without reloading: the form on screen must drop the fee it was holding,
  // or the next save would quietly undo the restore.
  const shownFee = oldFee == null ? "" : String(oldFee);
  await a.page
    .waitForFunction((v) => document.querySelector('input[name="applicationFee"]')?.value === v, shownFee, { timeout: 5000 })
    .catch(() => {});
  check((await a.page.locator('input[name="applicationFee"]').inputValue()) === shownFee, "the edit form on screen shows the restored fee without a reload");

  await go(a.page, `/admin/programs/${id}`);
  const top = await a.page.locator("[data-change-history] [data-change-batch]").first().innerText().catch(() => "");
  check(/Restored/.test(top) && /Application fee/.test(top), "the history shows the restore at the top");

  /* ---------------- A restore never throws away a newer value ---------------- */
  const f1 = (oldFee ?? 100) + 51;
  const f2 = f1 + 13;
  for (const v of [f1, f2]) {
    await a.page.fill('input[name="applicationFee"]', String(v));
    await a.page.getByRole("button", { name: "Save program" }).click();
    await until(() => fee() === String(v));
  }
  check(fee() === String(f2), `two saves in a row land (${fee()} against ${f2})`);
  const editOf = (after) =>
    sql(`select id from catalogue_changes where entity = 'program' and entity_id = '${id}' and field = 'applicationFee' and source = 'edit' and after = '${after}'::jsonb order by created_at desc limit 1`);
  const older = editOf(f1);
  const newer = editOf(f2);
  check(!!older && !!newer, "both saves are in the history");
  await go(a.page, `/admin/programs/${id}`);
  const restoreOf = (changeId) => a.page.locator(`[data-change-history] form:has(input[name="changeId"][value="${changeId}"])`);
  const restoresBefore = restores();

  // Unsaved typing in the edit form: Restore says so and does nothing, rather
  // than starting the form afresh and losing what was typed.
  await a.page.fill('input[name="applicationFee"]', "999");
  await restoreOf(newer).getByRole("button").click();
  const guard = restoreOf(newer).locator('[role="alert"]');
  await guard.waitFor({ timeout: 5000 }).catch(() => {});
  check(/Save or undo your changes first/.test(await guard.innerText().catch(() => "")), "Restore refuses while the edit form holds unsaved changes");
  await a.page.waitForTimeout(500);
  check(fee() === String(f2) && restores() === restoresBefore, "and changes nothing in the database");
  check((await a.page.locator('input[name="applicationFee"]').inputValue()) === "999", "and what was typed is still in the form");
  // Typing the old value back is undoing the change, so Restore works again.
  await a.page.fill('input[name="applicationFee"]', String(f2));

  // The older save set the fee to f1, but the newer one has moved it on to
  // f2 since. Putting the older save's value back would throw f2 away.
  await restoreOf(older).getByRole("button").click();
  const refusal = restoreOf(older).locator('[role="alert"]');
  await refusal.waitFor({ timeout: 10000 }).catch(() => {});
  const said = await refusal.innerText().catch(() => "");
  check(/Application fee was changed again since/.test(said) && /left as it is/.test(said) && digits(said).includes(String(f2)), `restoring the older save says the fee was changed since, and to what (${said})`);
  check(fee() === String(f2) && restores() === restoresBefore, `and leaves the newer fee in place (${fee()})`);

  // The newer save still holds, so its own Restore goes through.
  await restoreOf(newer).getByRole("button").click();
  await until(() => fee() === String(f1));
  check(fee() === String(f1) && restores() === restoresBefore + 1, `restoring the newer save puts its old fee back (${fee()})`);

  /* ---------------- The university page has one too, for admins ---------------- */
  sql(`insert into catalogue_changes (id, entity, entity_id, field, before, after, source, batch_id)
       values ('cch_test_uni', 'university', '${uniId}', 'website', 'null'::jsonb, '"https://example.org"'::jsonb, 'registry', 'cch_test_batch')
       on conflict (id) do nothing`);
  await go(a.page, `/universities/${uniId}`);
  const uniCard = await a.page.locator("[data-change-history]").innerText().catch(() => "");
  check(/Register sync/.test(uniCard) && /Website/.test(uniCard), "the university page shows its history to an admin, with the sync named");
  check(a.errors.length === 0, `no errors for the admin ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

/* ---------------- A counsellor neither sees it nor can call it ---------------- */
{
  const c = await open("germany@medcity.test");
  await c.page.goto(`${BASE}/admin/programs/${id}`);
  await c.page.waitForLoadState("domcontentloaded");
  check(!c.page.url().includes(`/admin/programs/${id}`) || (await c.page.locator("[data-change-history]").count()) === 0, "a counsellor cannot open the admin program page or its history");
  await go(c.page, `/universities/${uniId}`);
  check((await c.page.locator("[data-change-history]").count()) === 0, "a counsellor does not see the university's history");

  check(!!captured, "the admin's restore request was captured to replay");
  if (captured) {
    // Put the fee back to what the captured change set it to: a restore that
    // wrongly went through would show, and the admin's replay is one that may
    // go through (a field changed again since would be left alone).
    sql(`update programs set application_fee = ${newFee} where id = '${id}'`);
    const before = restores();
    await replay(c.ctx, captured);
    check(fee() === String(newFee) && restores() === before, "a counsellor sending the same restore changes nothing");

    // The same request from the admin does go through, so the check above is
    // a refusal and not a request that could never have worked.
    const a = await open("admin@medcityoverseas.test");
    await replay(a.ctx, captured);
    check(fee() === (oldFee == null ? "" : String(oldFee)) && restores() === before + 1, "while the admin sending it restores the fee");
    await a.ctx.close();
  }
  await c.ctx.close();
}

sql(`delete from catalogue_changes where id = 'cch_test_uni'`);
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
