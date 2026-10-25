// The publish rules on the Programs list: a course may only go live with at
// least one intake, and a post-study work answer (eligible or not eligible)
// needs its evidence. The edit screen and the draft review screens always
// applied them; this suite covers the other ways in. The per-row Set refuses
// to set such a course live and says why beside the row; the "All N
// matching" Publish takes only the ready courses, leaves the rest as drafts
// and says how many and why; Back to draft and archiving are unaffected; and
// a CSV row marked LIVE with a work rights answer and no evidence comes in as
// a draft, with the preview and the result saying so, while a LIVE row with
// no intake is still refused. Works on the plain seed or the full catalogue:
// the courses it works on are its own, at universities it adds and removes.
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
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const UNI = "u_publish_rules_t";
const UNI_NAME = "Publish Rules Test University";
// The import makes its own university by name, so it is found and removed by name.
const IMPORT_UNI = "Publish Rules Import Test College";
const importIds = `select p.id from programs p join universities u on u.id = p.university_id where u.name = '${IMPORT_UNI}'`;
const cleanup = () => {
  sql(`delete from catalogue_changes where entity = 'program' and (entity_id like 'p_pbr_%' or entity_id in (${importIds}))`);
  sql(`delete from programs where id like 'p_pbr_%' or id in (${importIds})`);
  sql(`delete from universities where id = '${UNI}' or name = '${IMPORT_UNI}'`);
};
cleanup();

const gb = sql("select id from countries where code = 'GB'");
if (!gb) {
  console.log("SKIPPED: the United Kingdom is not set up as a destination.");
  process.exit(0);
}
sql(`insert into universities (id, name, country_id) values ('${UNI}', '${UNI_NAME}', '${gb}')`);
const course = (id, name, level, status, intakes, extra = {}) => {
  const cols = { id, name, university_id: UNI, level, status, intake_months: intakes, ...extra };
  const lit = (v) => (v === null ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  sql(`insert into programs (${Object.keys(cols).join(", ")}) values (${Object.values(cols).map(lit).join(", ")})`);
};
// Two drafts that cannot go live, for different reasons, and three that can:
// one for the row's Set, one for the bulk Publish, and one to archive.
course("p_pbr_nointake", "Rules No Intake MSc", "PG", "DRAFT", "{}");
course("p_pbr_noevidence", "Rules No Evidence MA", "PG", "DRAFT", "{1}", { work_rights: "ELIGIBLE" });
course("p_pbr_row_ready", "Rules Row Ready BSc", "UG", "DRAFT", "{9}");
course("p_pbr_bulk_ready", "Rules Bulk Ready MSc", "PG", "DRAFT", "{9,1}", { work_rights: "INELIGIBLE", work_rights_note: "Under two years, so no PGWP (IRCC)" });
course("p_pbr_archive", "Rules Archive Me BA", "UG", "DRAFT", "{}");

const status = (id) => sql(`select status from programs where id = '${id}'`);
const changes = (id, source) => n(`select count(*) from catalogue_changes where entity = 'program' and entity_id = '${id}' and field = 'status' and source = '${source}'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 20;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.249.7.${ip++}` } });
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
const listOf = (statusFilter) => `/admin/programs?q=${encodeURIComponent(UNI_NAME)}&status=${statusFilter}`;

/** Picks a status on one row of the list and presses its Set. */
async function setRow(page, id, to) {
  const row = page.locator(`[data-program-row="${id}"]`);
  await row.locator('select[name="status"]').selectOption(to);
  await row.getByRole("button", { name: "Set", exact: true }).click();
  return row;
}

const bulkResult = (page) => page.locator("[data-bulk-result]");
// Presses a bulk button and waits for its own answer: each answer carries a
// fresh data-answer stamp, so the one from the press before is never read.
async function pressBulk(page, button) {
  const old = (await bulkResult(page).count()) ? await bulkResult(page).getAttribute("data-answer") : null;
  await page.getByRole("button", { name: button, exact: true }).click();
  await page
    .waitForFunction((was) => {
      const el = document.querySelector("[data-bulk-result]");
      return !!el && el.getAttribute("data-answer") !== was;
    }, old, { timeout: 30000 })
    .catch(() => {});
  const el = bulkResult(page);
  return {
    text: (await el.innerText().catch(() => "")).replace(/\s+/g, " "),
    done: Number(await el.getAttribute("data-done").catch(() => -1)),
    leftDrafts: Number(await el.getAttribute("data-left-drafts").catch(() => -1)),
  };
}

const a = await open("admin@medcityoverseas.test");

/* ---------------- The row's Set refuses a course that is not ready ---------------- */
{
  await go(a.page, listOf("DRAFT"));
  check((await a.page.locator("[data-program-row]").count()) === 5, "the list filtered to the test university's drafts shows all five");

  let row = await setRow(a.page, "p_pbr_nointake", "LIVE");
  const refused = row.locator("[data-status-refused]");
  await refused.waitFor({ timeout: 15000 }).catch(() => {});
  const said = (await refused.innerText().catch(() => "")).replace(/\s+/g, " ");
  check((await refused.getAttribute("data-status-refused").catch(() => "")) === "intakes", `setting a course with no intake live is refused (${said})`);
  check(/Not set live: it has no intakes\./.test(said), "and the row says why");
  check((await refused.locator('a[href="/admin/programs/p_pbr_nointake"]').count()) === 1, "with a link to the course to add what is missing");
  check(status("p_pbr_nointake") === "DRAFT" && changes("p_pbr_nointake", "edit") === 0, "the course stays a draft and nothing is written to its history");
  await until(async () => (await row.locator('select[name="status"]').inputValue()) === "DRAFT", 5000);
  check((await row.locator('select[name="status"]').inputValue()) === "DRAFT", "the row's status box goes back to the status the course still has");

  row = await setRow(a.page, "p_pbr_noevidence", "LIVE");
  await row.locator("[data-status-refused]").waitFor({ timeout: 15000 }).catch(() => {});
  check(
    (await row.locator("[data-status-refused]").getAttribute("data-status-refused").catch(() => "")) === "evidence" &&
      /post-study work answer has no evidence behind it/.test(await row.locator("[data-status-refused]").innerText().catch(() => "")),
    "a work rights answer with no evidence is refused with its own reason",
  );
  check(status("p_pbr_noevidence") === "DRAFT", "and that course stays a draft too");

  // A ready course goes live from its row as before.
  await setRow(a.page, "p_pbr_row_ready", "LIVE");
  await until(() => status("p_pbr_row_ready") === "LIVE");
  check(status("p_pbr_row_ready") === "LIVE", "a course that meets the rules is set live from its row");
  check(
    n(`select count(*) from catalogue_changes where entity_id = 'p_pbr_row_ready' and field = 'status' and source = 'edit' and before = '"DRAFT"'::jsonb and after = '"LIVE"'::jsonb`) === 1,
    "and the change is in its history",
  );

  // Archiving has no rules: it takes a course out of sight.
  await go(a.page, listOf("DRAFT"));
  await setRow(a.page, "p_pbr_archive", "ARCHIVED");
  await until(() => status("p_pbr_archive") === "ARCHIVED");
  check(status("p_pbr_archive") === "ARCHIVED", "a course with no intake can still be archived from its row");
  check((await a.page.locator("[data-status-refused]").count()) === 0, "with nothing refused on the list");
}

/* ---------------- The bulk Publish leaves drafts that are not ready ---------------- */
{
  await go(a.page, listOf("DRAFT"));
  const head = await a.page.locator("main").innerText();
  check(/All 3 matching/.test(head), "the bulk control offers the three drafts left");
  let said = await pressBulk(a.page, "Publish");
  await until(() => status("p_pbr_bulk_ready") === "LIVE");
  check(status("p_pbr_bulk_ready") === "LIVE", "publishing every match sets the ready draft live");
  check(status("p_pbr_nointake") === "DRAFT" && status("p_pbr_noevidence") === "DRAFT", "the draft with no intake and the one with no evidence stay drafts");
  check(said.done === 1 && said.leftDrafts === 2, `the answer counts 1 published and 2 left (${said.done}, ${said.leftDrafts})`);
  check(
    said.text.includes("Published 1. 2 left as drafts: 1 has no intakes, 1 has a post-study work answer with no evidence behind it. Open each one to add what is missing."),
    `and says why each was left (${said.text})`,
  );
  check(changes("p_pbr_bulk_ready", "bulk") === 1 && changes("p_pbr_nointake", "bulk") === 0 && changes("p_pbr_noevidence", "bulk") === 0, "only the published course has a bulk change in its history");
  await until(async () => /2 matches/.test(await a.page.locator("main").innerText()), 10000);
  check(/2 matches/.test(await a.page.locator("main").innerText()), "the list refreshes to the two drafts left");
  check((await bulkResult(a.page).count()) === 1, "and the answer stays on screen after the refresh");

  // Pressing again publishes nothing and says so, rather than saying nothing.
  said = await pressBulk(a.page, "Publish");
  check(said.done === 0 && /^Nothing published\. 2 left as drafts/.test(said.text), `a second press publishes nothing and says why (${said.text})`);
  check(status("p_pbr_nointake") === "DRAFT" && status("p_pbr_noevidence") === "DRAFT", "and both drafts are still drafts");

  // Back to draft has no rules either, and still answers once the filter is empty.
  await go(a.page, listOf("LIVE"));
  said = await pressBulk(a.page, "Back to draft");
  await until(() => status("p_pbr_row_ready") === "DRAFT" && status("p_pbr_bulk_ready") === "DRAFT");
  check(status("p_pbr_row_ready") === "DRAFT" && status("p_pbr_bulk_ready") === "DRAFT", "back to draft moves both live courses back");
  check(said.done === 2 && /Moved 2 back to draft\./.test(said.text), `and the answer says so (${said.text})`);
}

/* ---------------- A CSV row marked LIVE that is not ready ---------------- */
{
  await go(a.page, "/admin/programs");
  const csv = [
    "program,university,country_code,level,intakes,work_rights,work_rights_note,status",
    `Rules Import No Evidence MSc,${IMPORT_UNI},GB,PG,Sep,ELIGIBLE,,LIVE`,
    `Rules Import Complete MSc,${IMPORT_UNI},GB,PG,Sep|Jan,ELIGIBLE,Graduate Route on gov.uk,LIVE`,
    `Rules Import No Intake MSc,${IMPORT_UNI},GB,PG,,UNKNOWN,,LIVE`,
  ].join("\n");
  await a.page.getByText("Or paste CSV (template)").click();
  await a.page.fill("#csv-text", csv);
  await a.page.getByRole("button", { name: "Preview import" }).click();
  const held = a.page.locator("[data-import-held-back]");
  await held.waitFor({ timeout: 15000 }).catch(() => {});
  const preview = (await a.page.locator("main").innerText()).replace(/\s+/g, " ");
  check((await held.getAttribute("data-import-held-back").catch(() => "")) === "1", "the preview counts one row that will come in as a draft");
  check(/Line 2: Rules Import No Evidence MSc is marked LIVE but is imported as a draft, an existing live course going back to draft \(work rights with no evidence\)/.test(preview), "and names it with the reason");
  check(/1 will come in as a draft/.test(preview), "with a chip beside the ready count");
  check(/Line 4: at least one intake month is required/.test(preview), "a LIVE row with no intake is still refused, as before");

  await a.page.getByRole("button", { name: "Import 2 rows" }).click();
  await a.page.getByText(/Imported:/).waitFor({ timeout: 20000 }).catch(() => {});
  const result = (await a.page.locator("main").innerText()).replace(/\s+/g, " ");
  check(
    result.includes("Imported: 2 new, 0 updated, 1 rows skipped. 1 row marked LIVE came in as a draft because it has a post-study work answer with no evidence behind it."),
    `the import result says which way the row came in and why (${(result.match(/Imported:[^\n]{0,220}/) || [""])[0]})`,
  );
  const imported = (name) => sql(`select p.status from programs p join universities u on u.id = p.university_id where u.name = '${IMPORT_UNI}' and p.name = '${name}'`);
  check(imported("Rules Import No Evidence MSc") === "DRAFT", "the row with no evidence is a draft");
  check(imported("Rules Import Complete MSc") === "LIVE", "the complete row is live");
  check(imported("Rules Import No Intake MSc") === "", "the row with no intake was not imported");
}

check(a.errors.length === 0, `no errors for the admin ${a.errors.slice(0, 2).join(" | ")}`);
await a.ctx.close();

cleanup();
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
