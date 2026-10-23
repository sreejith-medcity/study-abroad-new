// Draft review: the desk checks draft courses one university at a time
// instead of publishing everything a filter matches. The list counts each
// university's drafts and how many have a fee, an IELTS figure and intakes;
// a university's screen publishes the ticked drafts, archives them, or
// publishes all of them, and a draft that breaks a publish rule (no intake, a
// work rights answer with no evidence) stays a draft and the answer says why.
// Every status change lands in the catalogue history and the audit log. A
// counsellor neither opens the screens nor gets anywhere by sending the
// request an admin sent. Works on the plain seed or the full catalogue: the
// courses it works on are its own, at a university it adds and removes.
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

const UNI = "u_draft_review_t";
const UNI_NAME = "Draft Review Test University";
const cleanup = () => {
  sql(`delete from catalogue_changes where entity = 'program' and entity_id like 'p_drv_%'`);
  sql(`delete from programs where id like 'p_drv_%'`);
  sql(`delete from audit_logs where entity_id = '${UNI}'`);
  sql(`delete from universities where id = '${UNI}'`);
};
cleanup();

const gb = sql("select id from countries where code = 'GB'");
if (!gb) {
  console.log("SKIPPED: the United Kingdom is not set up as a destination.");
  process.exit(0);
}
sql(`insert into universities (id, name, country_id) values ('${UNI}', '${UNI_NAME}', '${gb}')`);
// One live course, and drafts that between them have and lack each figure the
// list counts. c has no intake and d claims work rights with no evidence, so
// neither can go live; g comes from no import, so a MIOC filter leaves it out.
const course = (id, name, level, status, source, intakes, extra = {}) => {
  const cols = { id, name, university_id: UNI, level, status, source, intake_months: intakes, ...extra };
  const lit = (v) => (v === null ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  sql(`insert into programs (${Object.keys(cols).join(", ")}) values (${Object.values(cols).map(lit).join(", ")})`);
};
course("p_drv_live", "Test Live Course", "PG", "LIVE", null, "{9}");
course("p_drv_a", "A Draft Accounting MSc", "PG", "DRAFT", "MIOC", "{9,1}", { tuition_per_year: 15000, min_ielts: 6.5, entry_requirements: "Second class bachelor's in a related subject\nIELTS 6.5 with no band below 6\nInterview may be required" });
course("p_drv_b", "B Draft Biology BSc", "UG", "DRAFT", "MIOC", "{9}", { min_ielts: 6 });
course("p_drv_c", "C Draft Chemistry MSc", "PG", "DRAFT", "MIOC", "{}", { tuition_per_year: 14000 });
course("p_drv_d", "D Draft Design MA", "PG", "DRAFT", "MIOC", "{1}", { work_rights: "ELIGIBLE" });
course("p_drv_e", "E Draft Economics MSc", "PG", "DRAFT", "MIOC", "{5}");
course("p_drv_f", "F Draft French BA", "UG", "DRAFT", "MIOC", "{9}", { tuition_per_year: 13000 });
course("p_drv_g", "G Draft Geography BSc", "UG", "DRAFT", null, "{2}");

const status = (id) => sql(`select status from programs where id = '${id}'`);
const adminId = sql("select id from users where email = 'admin@medcityoverseas.test'");
const reviewRows = (ids) => n(`select count(*) from catalogue_changes where entity = 'program' and field = 'status' and source = 'review' and entity_id in (${ids.map((x) => `'${x}'`).join(", ")})`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 20;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.248.9.${ip++}` } });
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

/** The figures one university's row on the list shows, read from its data attributes. */
async function listRow(page, query) {
  await go(page, `/admin/programs/review?${query}`);
  const row = page.locator(`[data-review-university="${UNI}"]`);
  if ((await row.count()) !== 1) return null;
  const out = {};
  for (const col of ["drafts", "fee", "ielts", "intakes", "live"]) out[col] = Number(await row.locator(`[data-col="${col}"]`).getAttribute("data-count"));
  return out;
}

const result = (page) => page.locator("[data-review-result]");
// Presses a button and waits for its own answer: each answer carries a fresh
// data-answer stamp, so the one from the press before is never read by mistake.
async function press(page, button, expect) {
  const old = (await result(page).count()) ? await result(page).getAttribute("data-answer") : null;
  await page.getByRole("button", { name: button }).click();
  await page
    .waitForFunction((was) => {
      const el = document.querySelector("[data-review-result]");
      return !!el && el.getAttribute("data-answer") !== was;
    }, old, { timeout: 15000 })
    .catch(() => {});
  await until(expect);
  return (await result(page).innerText().catch(() => "")).replace(/\s+/g, " ");
}
const tick = (page, id) => page.locator(`input[name="id"][value="${id}"]`).check();

let captured = null;
const q = `q=${encodeURIComponent(UNI_NAME)}`;

/* ---------------- The list counts drafts and what they carry ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, "/admin/programs");
  const link = a.page.locator("[data-review-link]");
  const allDrafts = n("select count(*) from programs where status = 'DRAFT'");
  check((await link.count()) === 1 && Number(await link.getAttribute("data-count")) === allDrafts, `the Programs screen links to the review with every draft counted (${allDrafts})`);
  check((await link.getAttribute("href")) === "/admin/programs/review", "and the link goes to the review list");

  const any = await listRow(a.page, q);
  check(!!any && any.drafts === 7 && any.fee === 3 && any.ielts === 2 && any.intakes === 6 && any.live === 1, `the university's row counts 7 drafts, 3 with a yearly fee, 2 with IELTS, 6 with intakes and 1 live (${JSON.stringify(any)})`);
  const mioc = await listRow(a.page, `${q}&source=MIOC`);
  check(!!mioc && mioc.drafts === 6 && mioc.intakes === 5 && mioc.live === 1, `narrowed to the MIOC app it counts that source's 6 drafts, and the live course still (${JSON.stringify(mioc)})`);
  const cricos = await listRow(a.page, `${q}&source=CRICOS`);
  check(cricos === null, "narrowed to CRICOS the university is not listed, having no CRICOS drafts");

  // The default order: the university with most drafts is at the top.
  await go(a.page, "/admin/programs/review");
  const top = sql(`select u.id from programs p join universities u on u.id = p.university_id where p.status = 'DRAFT' group by u.id, u.name order by count(*) desc, u.name, u.id limit 1`);
  check((await a.page.locator("[data-review-university]").first().getAttribute("data-review-university")) === top, "the list starts with the university that has most drafts");

  /* ---------------- Opening a university shows its drafts ---------------- */
  await go(a.page, `/admin/programs/review?${q}`);
  await a.page.locator(`[data-review-university="${UNI}"] a`).first().click();
  await a.page.waitForURL((u) => String(u).includes(`/admin/programs/review/${UNI}`), { timeout: 10000 }).catch(() => {});
  await hydrated(a.page);
  check(a.page.url().includes(`/admin/programs/review/${UNI}?`) && a.page.url().includes("q="), "clicking a university opens its drafts, keeping the list's filters");
  check((await a.page.locator("[data-draft-row]").count()) === 7, "all seven drafts are listed");

  // From here without a search, so "Next university" has the whole list to go to.
  await go(a.page, `/admin/programs/review/${UNI}`);
  const row = (id) => a.page.locator(`[data-draft-row="${id}"]`);
  check((await row("p_drv_a").locator('a[href="/admin/programs/p_drv_a"]').count()) === 1, "each course name links to its edit screen");
  check((await row("p_drv_c").getAttribute("data-problems")) === "intakes" && /No intakes/.test(await row("p_drv_c").innerText()), "a draft with no intake is marked as not ready");
  check((await row("p_drv_d").getAttribute("data-problems")) === "evidence", "a work rights answer with no evidence is marked as not ready");
  check((await row("p_drv_a").getAttribute("data-problems")) === "" && /Ready/.test(await row("p_drv_a").innerText()), "a complete draft is marked ready");
  const aText = await row("p_drv_a").innerText();
  check(/15,000/.test(aText) && /IELTS 6\.5/.test(aText) && /Second class bachelor's/.test(aText) && !/Interview may be required/.test(aText), "the row shows the fee, the IELTS figure and the first lines of the entry notes");
  check(/Not recorded/.test(await row("p_drv_b").innerText()), "a fee nobody recorded reads Not recorded");

  /* ---------------- Publish selected, with a draft that has no intake ---------------- */
  for (const id of ["p_drv_a", "p_drv_b", "p_drv_c"]) await tick(a.page, id);
  let said = await press(a.page, /^Publish selected/, () => status("p_drv_a") === "LIVE" && status("p_drv_b") === "LIVE");
  check(status("p_drv_a") === "LIVE" && status("p_drv_b") === "LIVE", "publish selected sets the ticked complete drafts live");
  check(status("p_drv_c") === "DRAFT", "the ticked draft with no intake stays a draft");
  check(/Published 2\./.test(said) && /1 left as a draft because it has no intakes/.test(said), `and the answer says how many and why (${said})`);
  await until(async () => (await row("p_drv_a").count()) === 0, 5000);
  check((await row("p_drv_a").count()) === 0 && (await row("p_drv_c").count()) === 1, "published courses leave the table, the refused one stays");
  const next = sql(`select u.id from programs p join universities u on u.id = p.university_id where p.status = 'DRAFT' and u.id <> '${UNI}' group by u.id, u.name order by count(*) desc, u.name, u.id limit 1`);
  const nextLink = result(a.page).locator("[data-next-university]");
  if (next) {
    check((await nextLink.getAttribute("href").catch(() => "")) === `/admin/programs/review/${next}`, `the answer offers the next university on the list (${await nextLink.innerText().catch(() => "none")})`);
  } else {
    check(/No other university on your list has drafts/.test(said), "the answer says there is no other university to go to");
  }

  check(!(await row("p_drv_c").locator('input[name="id"]').isChecked()), "the answer clears the ticks, so the refused draft is not carried into the next press");

  /* ---------------- Archive selected ---------------- */
  await tick(a.page, "p_drv_e");
  const request = a.page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"], { timeout: 10000 }).catch(() => null);
  said = await press(a.page, /^Archive selected/, () => status("p_drv_e") === "ARCHIVED");
  const req = await request;
  if (req) captured = { url: req.url(), headers: await req.allHeaders(), body: req.postDataBuffer() };
  check(status("p_drv_e") === "ARCHIVED" && /Archived 1\./.test(said), `archive selected archives the ticked draft (${said})`);
  check(status("p_drv_c") === "DRAFT", "and leaves the draft refused before alone");

  /* ---------------- Publish all at this university ---------------- */
  const all = a.page.locator("[data-publish-all]");
  check(/Publish all 4 drafts at this university/.test(await all.innerText().catch(() => "")), `the publish all button names the drafts left (${await all.innerText().catch(() => "")})`);
  said = await press(a.page, /^Publish all/, () => status("p_drv_f") === "LIVE" && status("p_drv_g") === "LIVE");
  check(status("p_drv_f") === "LIVE" && status("p_drv_g") === "LIVE", "publish all sets every ready draft live, whatever its source");
  check(status("p_drv_c") === "DRAFT" && status("p_drv_d") === "DRAFT", "the draft with no intake and the one with no evidence stay drafts");
  check(/Published 2\./.test(said) && /2 left as drafts/.test(said) && /1 has no intakes/.test(said) && /post-study work answer with no evidence/.test(said), `and the answer gives each reason (${said})`);
  await until(async () => (await a.page.locator("[data-draft-row]").count()) === 2, 5000);
  check((await a.page.locator("[data-draft-row]").count()) === 2, "only the two that are not ready are left on the screen");

  /* ---------------- History and audit ---------------- */
  const moved = ["p_drv_a", "p_drv_b", "p_drv_e", "p_drv_f", "p_drv_g"];
  check(reviewRows(moved) === 5, `every status change is in the catalogue history (${reviewRows(moved)} of 5)`);
  check(
    n(`select count(*) from catalogue_changes where entity = 'program' and entity_id = 'p_drv_a' and field = 'status' and source = 'review'
       and before = '"DRAFT"'::jsonb and after = '"LIVE"'::jsonb and changed_by_id = '${adminId}'`) === 1,
    "with the old status, the new one, and the admin who did it",
  );
  check(n(`select count(*) from catalogue_changes where entity_id = 'p_drv_e' and source = 'review' and after = '"ARCHIVED"'::jsonb`) === 1, "an archive is recorded too");
  check(reviewRows(["p_drv_c", "p_drv_d", "p_drv_live"]) === 0, "nothing is recorded for courses that did not change");
  check(n(`select count(distinct batch_id) from catalogue_changes where source = 'review' and entity_id in (${moved.map((x) => `'${x}'`).join(", ")})`) === 3, "each press is one batch in the history");
  check(
    n(`select count(*) from audit_logs where entity_id = '${UNI}' and action in ('programs.review_publish', 'programs.review_archive') and actor_id = '${adminId}'`) === 3,
    "each press is in the audit log against the university",
  );
  await go(a.page, "/admin/programs/p_drv_a");
  check(/Draft review/.test(await a.page.locator("[data-change-history]").innerText().catch(() => "")), "the course's own history names the draft review");

  const after = await listRow(a.page, q);
  check(!!after && after.drafts === 2 && after.live === 5, `the list now counts 2 drafts and 5 live (${JSON.stringify(after)})`);
  check(a.errors.length === 0, `no errors for the admin ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

/* ---------------- A counsellor neither opens it nor can call it ---------------- */
{
  const c = await open("germany@medcity.test");
  await c.page.goto(`${BASE}/admin/programs/review`);
  await c.page.waitForLoadState("domcontentloaded");
  check(!c.page.url().includes("/admin/programs/review") || (await c.page.locator("[data-review-list]").count()) === 0, "a counsellor cannot open the review list");
  await c.page.goto(`${BASE}/admin/programs/review/${UNI}`);
  await c.page.waitForLoadState("domcontentloaded");
  check(!c.page.url().includes(`/admin/programs/review/${UNI}`) || (await c.page.locator("[data-review-drafts]").count()) === 0, "or a university's drafts");

  check(!!captured, "the admin's archive request was captured to replay");
  if (captured) {
    sql(`update programs set status = 'DRAFT' where id = 'p_drv_e'`);
    const before = reviewRows(["p_drv_e"]);
    await replay(c.ctx, captured);
    check(status("p_drv_e") === "DRAFT" && reviewRows(["p_drv_e"]) === before, "a counsellor sending the same archive changes nothing");

    // The same request from the admin does go through, so the check above is
    // a refusal and not a request that could never have worked.
    const a = await open("admin@medcityoverseas.test");
    await replay(a.ctx, captured);
    check(status("p_drv_e") === "ARCHIVED" && reviewRows(["p_drv_e"]) === before + 1, "while the admin sending it archives the course");
    await a.ctx.close();
  }
  await c.ctx.close();
}

cleanup();
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
