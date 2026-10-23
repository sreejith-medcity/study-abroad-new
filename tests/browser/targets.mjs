// Monthly targets: the desk sets a branch's, a branch head their own
// people's, and the dashboards show each against what has happened this
// month, counted the same way the dashboards count everything else.
// Wants the plain seed.
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

const month = sql("select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')");
const monthStart = sql(`select ('${month}-01 00:00:00+05:30')::timestamptz::text`);
const kottayam = sql("select org_id from users where email = 'kottayam@medcity.test'");
const germany = sql("select id from users where email = 'germany@medcity.test'");
const kochiHead = sql("select id from users where email = 'kochi@medcity.test'");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 40;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.247.5.${ip++}` } });
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
const save = async (page) => {
  await page.getByRole("button", { name: "Save targets" }).first().click();
  await page.getByText("Targets saved.").first().waitFor({ timeout: 10000 }).catch(() => {});
};
const target = (subject, metric) => sql(`select coalesce((select value::text from targets where subject = '${subject}' and month = '${month}' and metric = '${metric}'), '')`);

/* ---------------- The desk sets a branch's ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, "/targets");
  await a.page.locator(`input[name="t:org:${kottayam}:REGISTRATIONS"]`).fill("20");
  await a.page.locator(`input[name="t:org:${kottayam}:VISAS"]`).fill("4");
  await save(a.page);
  check(target(`org:${kottayam}`, "REGISTRATIONS") === "20" && target(`org:${kottayam}`, "VISAS") === "4", "the desk sets a branch's targets");
  check(target(`org:${kottayam}`, "APPLICATIONS") === "", "and an empty box is no target");

  await a.page.locator(`input[name="t:org:${kottayam}:VISAS"]`).fill("five");
  await a.page.getByRole("button", { name: "Save targets" }).first().click();
  await a.page.getByText("A whole number").first().waitFor({ timeout: 10000 }).catch(() => {});
  check(target(`org:${kottayam}`, "VISAS") === "4", "a target that is not a number is refused and nothing changes");
  await go(a.page, "/targets");
  await a.page.locator(`input[name="t:org:${kottayam}:VISAS"]`).fill("");
  await save(a.page);
  check(target(`org:${kottayam}`, "VISAS") === "", "clearing a box clears the target");
  check(a.errors.length === 0, `no errors for the desk ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

/* ---------------- Leadership sees the branches against their targets ---------------- */
{
  const l = await open("sreejith@miak.in");
  await go(l.page, "/dashboard");
  const row = l.page.locator(`[data-target-row="${kottayam}"]`);
  check((await row.count()) === 1, "leadership's dashboard shows the branch with a target");
  const regs = n(`select count(*) from students where org_id = '${kottayam}' and not archived and created_at >= '${monthStart}'`);
  const shown = Number((await row.locator('[data-target="REGISTRATIONS"] [data-figure]').innerText()).replace(/[^0-9]/g, ""));
  check(shown === regs, `against this month's registrations, counted as the dashboard counts them (${shown} against ${regs})`);
  check((await row.locator('[data-target="APPLICATIONS"]').innerText()).includes("No target"), "a metric with no target says so");
  await l.ctx.close();
}

/* ---------------- A branch head sets their people's ---------------- */
{
  const b = await open("kottayam@medcity.test");
  await go(b.page, "/targets");
  check((await b.page.locator(`input[name^="t:org:"]`).count()) === 0, "a branch head is not offered branch targets");
  await b.page.locator(`input[name="t:user:${germany}:REGISTRATIONS"]`).fill("6");
  await save(b.page);
  check(target(`user:${germany}`, "REGISTRATIONS") === "6", "a branch head sets a counsellor's target");
  await go(b.page, "/dashboard");
  check((await b.page.locator("[data-targets]").count()) === 1, "the branch's dashboard shows its targets");
  check((await b.page.locator(`[data-target-row="${germany}"]`).count()) === 1, "with each person who has one");
  check(b.errors.length === 0, `no errors for the branch head ${b.errors.slice(0, 2).join(" | ")}`);
  await b.ctx.close();
}

/* ---------------- The counsellor sees their own ---------------- */
{
  const c = await open("germany@medcity.test");
  await go(c.page, "/dashboard");
  const shown = Number((await c.page.locator('[data-targets] [data-target="REGISTRATIONS"] [data-figure]').innerText()).replace(/[^0-9]/g, ""));
  const mine = n(`select count(*) from students where assigned_to_id = '${germany}' and not archived and created_at >= '${monthStart}'`);
  check(shown === mine, `a counsellor's dashboard shows their own target, against their own students (${shown} against ${mine})`);
  check((await c.page.locator('[data-targets] a[href="/targets"]').count()) === 0, "and cannot change it");
  await c.page.goto(`${BASE}/targets`);
  await c.page.waitForLoadState("domcontentloaded");
  check(!c.page.url().includes("/targets"), "a counsellor cannot open the targets page");
  await c.ctx.close();
}

/* ---------------- A counsellor with no target is not shown an empty card ---------------- */
{
  const t = await open("trainee@medcity.test");
  await go(t.page, "/dashboard");
  check((await t.page.locator("[data-targets]").count()) === 0, "no target, no card");
  await t.ctx.close();
}

/* ---------------- Copying last month ---------------- */
{
  const last = sql(`select to_char((('${month}-01')::date - interval '1 month'), 'YYYY-MM')`);
  sql(`insert into targets (id, subject, org_id, month, metric, value) values ('tg_last', 'org:${kottayam}', '${kottayam}', '${last}', 'APPLICATIONS', 12)`);
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, "/targets");
  await a.page.getByRole("button", { name: "Copy last month's" }).first().click();
  await a.page.getByText(/Copied 1 target/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(target(`org:${kottayam}`, "APPLICATIONS") === "12", "last month's targets can be copied into this one");
  check(target(`org:${kottayam}`, "REGISTRATIONS") === "20", "without touching what is already set");
  await a.ctx.close();
}

/* ---------------- Only the desk and a branch head ---------------- */
{
  // A branch head cannot reach another branch's people, even by posting the form by hand.
  sql(`delete from targets where subject = 'user:${kochiHead}'`);
  const b = await open("kottayam@medcity.test");
  await go(b.page, "/targets");
  await b.page.evaluate((id) => {
    const input = document.createElement("input");
    input.name = `t:user:${id}:VISAS`;
    input.value = "9";
    document.querySelector("form")?.appendChild(input);
  }, kochiHead);
  await b.page.getByRole("button", { name: "Save targets" }).first().click();
  await b.page.getByText(/only set targets for your own branch/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(target(`user:${kochiHead}`, "VISAS") === "", "a branch head cannot set another branch's people's targets");
  await b.ctx.close();
}

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
