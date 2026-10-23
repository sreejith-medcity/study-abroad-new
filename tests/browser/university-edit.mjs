// Editing a university: an admin changes its city, website and about text,
// the university page shows them, the change history lists the save, and
// Restore puts the old city back. A name another university in the same
// country already has, and a website that is not a full address, are refused.
// A counsellor neither sees the way in nor gets anywhere by sending the save
// an admin sent. Works on the plain seed or the full catalogue; the row is
// put back as it was at the end.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// A university that shares its country with another one, for the duplicate
// name, and whose programs name no campus: with campuses the page heading
// lists those instead of the city.
const row = sql(`
  select u.id || '|' || o.name
  from universities u
  join lateral (select o.name from universities o where o.country_id = u.country_id and o.id <> u.id order by o.name limit 1) o on true
  where not exists (select 1 from programs p where p.university_id = u.id and coalesce(p.campus, '') <> '')
  order by u.name, u.id
  limit 1`);
if (!row) {
  console.log("SKIPPED: no university that shares its country with another.");
  process.exit(0);
}
const sep = row.indexOf("|");
const id = row.slice(0, sep);
const otherName = row.slice(sep + 1);
const snapshot = sql(`select row_to_json(u) from universities u where id = ${lit(id)}`);
const original = JSON.parse(snapshot);
const started = sql("select now()::text");
const adminName = sql("select name from users where email = 'admin@medcityoverseas.test'");

const stamp = Date.now().toString(36);
const newCity = `Testville ${stamp}`;
const newWebsite = `https://www.example.edu/uni-edit-${stamp}`;
const newAbout = `First line of the profile ${stamp}.\nSecond line, kept on its own.`;

const col = (c) => sql(`select coalesce(${c}::text, '') from universities where id = ${lit(id)}`);
const edits = () => n(`select count(*) from catalogue_changes where entity = 'university' and entity_id = ${lit(id)} and source = 'edit' and created_at >= ${lit(started)}`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.249.3.${ip++}` } });
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
const save = (page) => page.getByRole("button", { name: "Save university" }).click();

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

try {
  /* ---------------- An admin finds the screen and saves three fields ---------------- */
  {
    const a = await open("admin@medcityoverseas.test");
    await go(a.page, `/universities/${id}`);
    const link = a.page.locator("[data-edit-university]");
    check((await link.count()) === 1, "an admin sees Edit university on the university page");
    await link.click();
    await a.page.waitForURL((u) => String(u).includes(`/admin/universities/${id}`), { timeout: 15000 }).catch(() => {});
    await a.page.locator("[data-university-edit]").waitFor({ timeout: 15000 }).catch(() => {});
    await hydrated(a.page);
    check(a.page.url().includes(`/admin/universities/${id}`) && (await a.page.locator("[data-university-edit]").count()) === 1, "and it opens the edit screen");
    check((await a.page.locator('input[name="name"]').inputValue()) === original.name, "the form starts from the stored name");

    await a.page.fill('input[name="city"]', newCity);
    await a.page.fill('input[name="website"]', newWebsite);
    await a.page.fill('textarea[name="about"]', newAbout);
    const request = a.page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"], { timeout: 10000 }).catch(() => null);
    await save(a.page);
    const req = await request;
    if (req) captured = { url: req.url(), headers: await req.allHeaders(), body: req.postDataBuffer() };
    await a.page.locator('[role="status"]').filter({ hasText: /Saved 3 changes/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
    check(col("city") === newCity, `the city is saved (${col("city")})`);
    check(col("website") === newWebsite, `the website is saved (${col("website")})`);
    check(col("about") === newAbout, "the about text is saved with its line break");
    check(col("name") === original.name, "fields left alone keep their value");
    check(
      n(`select count(*) from catalogue_changes c join users u on u.id = c.changed_by_id
         where c.entity = 'university' and c.entity_id = ${lit(id)} and c.source = 'edit' and c.created_at >= ${lit(started)}
           and u.email = 'admin@medcityoverseas.test' and c.field in ('city', 'website', 'about')`) === 3,
      "each changed field is recorded as an edit, with who made it",
    );
    check(n(`select count(distinct batch_id) from catalogue_changes where entity = 'university' and entity_id = ${lit(id)} and source = 'edit' and created_at >= ${lit(started)}`) === 1, "as one save");
    check(edits() === 3, `and nothing else is recorded as changed (${edits()} rows)`);

    /* ---------------- The university page shows it ---------------- */
    await go(a.page, `/universities/${id}`);
    // The heading block only: the history card further down names the new city too.
    const heading = await a.page.locator("h1", { hasText: original.name }).first().locator("xpath=..").innerText().catch(() => "");
    check(heading.includes(newCity), "the university page heading shows the new city");
    const about = a.page.locator("[data-university-about]");
    const aboutText = await about.innerText().catch(() => "");
    check(aboutText.includes(`First line of the profile ${stamp}.\nSecond line, kept on its own.`), "the about card shows the new text with its line break");
    check((await a.page.locator(`a[href="${newWebsite}"]`).count()) >= 1, "the website links to the new address");

    /* ---------------- The history lists the save ---------------- */
    const latest = a.page.locator("[data-change-history] [data-change-batch]").first();
    const text = await latest.innerText().catch(() => "");
    check(text.includes(adminName) && /Edited/.test(text), `the newest history entry names the admin and says it was an edit (${text.split("\n").slice(0, 2).join(" / ")})`);
    for (const f of ["city", "website", "about"]) check((await latest.locator(`[data-change-field="${f}"]`).count()) === 1, `the history lists the ${f} change`);
    const cityBefore = await latest.locator('[data-change-field="city"] [data-before]').innerText().catch(() => "");
    check(cityBefore === (original.city || "Not recorded"), `the history shows the old city (${cityBefore})`);

    /* ---------------- Restore puts the old city back ---------------- */
    await go(a.page, `/admin/universities/${id}`);
    const field = a.page.locator("[data-change-history] [data-change-batch]").first().locator('[data-change-field="city"]');
    await field.getByRole("button", { name: "Restore City", exact: true }).click();
    await a.page.locator('[role="status"]').filter({ hasText: /Restored 1 field/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
    check(col("city") === (original.city ?? ""), `restore puts the old city back (${col("city") || "Not recorded"})`);
    check(col("website") === newWebsite && col("about") === newAbout, "and leaves the other fields of that save alone");
    // Without reloading: the form must drop the city it was holding, or the
    // next save would quietly undo the restore.
    await a.page
      .waitForFunction((v) => document.querySelector('input[name="city"]')?.value === v, original.city ?? "", { timeout: 5000 })
      .catch(() => {});
    check((await a.page.locator('input[name="city"]').inputValue()) === (original.city ?? ""), "the edit form shows the restored city without a reload");
    await go(a.page, `/universities/${id}`);
    const top = await a.page.locator("[data-change-history] [data-change-batch]").first().innerText().catch(() => "");
    check(/Restored/.test(top) && /City/.test(top), "the university page history shows the restore at the top");

    /* ---------------- A name already used in the same country ---------------- */
    await go(a.page, `/admin/universities/${id}`);
    await a.page.fill('input[name="name"]', otherName);
    await save(a.page);
    const refusal = a.page.getByText(/already has that name/).first();
    await refusal.waitFor({ timeout: 10000 }).catch(() => {});
    check(await refusal.isVisible().catch(() => false), "a name another university in the country has is refused, saying so");
    check((await a.page.getByText(/Already used by another university in/).count()) === 1, "and the message sits under the name field");
    check(col("name") === original.name, "the name is unchanged");

    /* ---------------- A website that is not a full address ---------------- */
    await go(a.page, `/admin/universities/${id}`);
    await a.page.fill('input[name="website"]', "www.example.edu");
    await save(a.page);
    const bad = a.page.getByText("A full address, starting https://").first();
    await bad.waitFor({ timeout: 10000 }).catch(() => {});
    check(await bad.isVisible().catch(() => false), "a website without https:// is refused, saying what is wanted");
    check(col("website") === newWebsite, "the website is unchanged");
    check(edits() === 3, "and neither refusal recorded anything");

    check(a.errors.length === 0, `no errors for the admin ${a.errors.slice(0, 2).join(" | ")}`);
    await a.ctx.close();
  }

  /* ---------------- A counsellor neither sees it nor can call it ---------------- */
  {
    const c = await open("germany@medcity.test");
    await go(c.page, `/universities/${id}`);
    check((await c.page.locator("[data-edit-university]").count()) === 0, "a counsellor does not see Edit university");
    await c.page.goto(`${BASE}/admin/universities/${id}`);
    await c.page.waitForLoadState("domcontentloaded");
    check(!c.page.url().includes(`/admin/universities/${id}`) || (await c.page.locator("[data-university-edit]").count()) === 0, "a counsellor cannot open the edit screen");

    check(!!captured, "the admin's save was captured to replay");
    if (captured) {
      // The city is back at its old value now, so a save that wrongly went
      // through would show as the test city again.
      const before = edits();
      await replay(c.ctx, captured);
      check(col("city") === (original.city ?? "") && edits() === before, "a counsellor sending the same save changes nothing");

      // The same request from the admin does go through, so the check above is
      // a refusal and not a request that could never have worked.
      const a = await open("admin@medcityoverseas.test");
      await replay(a.ctx, captured);
      check(col("city") === newCity && edits() === before + 1, "while the admin sending it saves the city");
      await a.ctx.close();
    }
    await c.ctx.close();
  }
} finally {
  // Back as it was, and the suite's own history rows with it.
  sql(`update universities u set (name, city, website, about, facts, is_public, qs_rank, qs_year, the_rank, the_year, rank_sort)
       = (select r.name, r.city, r.website, r.about, r.facts, r.is_public, r.qs_rank, r.qs_year, r.the_rank, r.the_year, r.rank_sort
          from json_populate_record(null::universities, ${lit(snapshot)}) r)
       where u.id = ${lit(id)}`);
  sql(`delete from catalogue_changes where entity = 'university' and entity_id = ${lit(id)} and created_at >= ${lit(started)}`);
  await browser.close();
}
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
