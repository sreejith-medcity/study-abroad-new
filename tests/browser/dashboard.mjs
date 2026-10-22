// The dashboard: eleven figures, the same board for everybody, and the
// pictures of them underneath.
//
// It used to be seven screens, one per job, each with its own lanes, lists,
// charts and leaderboards, and the complaint about all of them was the same:
// too much to read before the one number you came for. What was asked for
// instead was a board of figures, by name, so this checks that the board is
// drawn in full, in the same order every day, that every figure agrees with
// the database, and that each tile opens the list behind it.
//
// The scoping is the other half of it. The Overseas desk reads the whole
// portal; a branch and a sub-agent open the same screen and read their own.
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

// The order is the promise. A board that is six cards on Monday and three on
// Tuesday cannot be read by position, and position is how somebody who opens
// this every morning actually uses it.
const DESK = [
  "total-registrations",
  "total-applications",
  "offers-received",
  "visas-received",
  "visas-rejected",
  "pending-documents",
  "deferrals",
  "payments-done",
  "payments-pending",
  "pending-from-branches",
  "pending-from-partners",
  "total-revenue-expected",
];
// A branch sees its own files, so the desk's two waiting tiles are one
// question to it: what has the desk asked you for.
const BRANCH = [...DESK.slice(0, 9), "waiting-on-you", "total-revenue-expected"];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 40;

async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": `10.240.9.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 110)); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.goto(`${BASE}/dashboard`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return { ctx, page, errors };
}

const figure = async (page, tile) => (await page.locator(`[data-tile="${tile}"] [data-figure]`).first().innerText()).trim();
const drawnOrder = (page) => page.locator("main [data-stat-tiles] > *").evaluateAll((els) => els.map((e) => e.getAttribute("data-tile")));

/* ---------------- The desk reads the whole portal ---------------- */

const desk = await open("sreejith@miak.in");
{
  const page = desk.page;
  check(page.url().endsWith("/dashboard"), "signing in lands on the dashboard");
  check((await page.locator("main [data-stat-tiles]").count()) === 1, "which is one board of figures");

  const order = await drawnOrder(page);
  check(order.length === DESK.length, `every figure is drawn, nought or not (${order.length} of ${DESK.length})`);
  check(order.join(",") === DESK.join(","), `and always in the same order (${order.join(" | ")})`);

  // The old lanes and lists are not back: no folded panels, and the one
  // table a person reads is the branches compared (the other is the chart's
  // twin for a screen reader).
  check((await page.locator("main details").count()) === 0, "no folded panels");
  check((await page.locator("main table:not(.sr-only)").count()) === 1, "one visible table, the branches compared");

  const want = {
    "total-registrations": n("select count(*) from students where not archived"),
    "total-applications": n("select count(*) from applications"),
    // A visa cannot be had without an offer, so a file that went straight to
    // a visa status still received one.
    "offers-received": n(`select count(distinct h.application_id) from status_history h join status_definitions d on d.id = h.to_status_id where d."group" = 'OFFER' or d.code in ('VISA_RECEIVED','ENROLLED','JOINED','DEPLOYED')`),
    "visas-received": n(`select count(distinct h.application_id) from status_history h join status_definitions d on d.id = h.to_status_id where d.code in ('VISA_RECEIVED','ENROLLED','JOINED','DEPLOYED')`),
    "visas-rejected": n(`select count(distinct h.application_id) from status_history h join status_definitions d on d.id = h.to_status_id where d.code = 'VISA_REJECTED'`),
    "pending-documents": n(`select count(*) from checklist_items c join students s on s.id = c.student_id where not s.archived and c.state in ('ASKED','UPLOADED','IN_REVIEW','REJECTED')`),
    deferrals: n(`select count(*) from applications a join status_definitions d on d.id = a.status_id where d.code = 'DEFERRED'`),
    "payments-done": n(`select count(*) from applications where fee_status = 'PAID'`),
    "payments-pending": n(`select count(*) from applications where fee_status = 'DUE'`),
    "pending-from-branches": n(`select count(*) from applications a join status_definitions d on d.id = a.status_id join organizations o on o.id = a.org_id where d."group" = 'PENDING_PARTNER' and o.type = 'BRANCH'`),
    "pending-from-partners": n(`select count(*) from applications a join status_definitions d on d.id = a.status_id join organizations o on o.id = a.org_id where d."group" = 'PENDING_PARTNER' and o.type = 'SUB_AGENT'`),
  };
  for (const [tile, expected] of Object.entries(want)) {
    const read = await figure(page, tile);
    check(Number(read.replace(/[^0-9]/g, "")) === expected, `${tile} reads what the database says (${read} against ${expected})`);
  }

  // Money is money: it carries its currency and is not a bare count.
  const revenue = await figure(page, "total-revenue-expected");
  check(/^₹/.test(revenue), `revenue is money rather than a count (${revenue})`);

  // A nought is drawn and quietened rather than hidden or shouting.
  const cells = await page.locator("main [data-stat-tiles] [data-figure]").evaluateAll((els) =>
    els.map((e) => ({ value: (e.textContent ?? "").trim(), colour: getComputedStyle(e).color })),
  );
  const zero = cells.find((c) => c.value === "0");
  const real = cells.find((c) => c.value !== "0" && c.value !== "");
  if (zero && real) check(zero.colour !== real.colour, `a nought is set quieter than a figure (${zero.colour} against ${real.colour})`);

  // Every tile is the way into its own list.
  const hrefs = await page.locator("main [data-stat-tiles] > a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  check(hrefs.length === DESK.length, `every tile opens the list behind it (${hrefs.length})`);
  await desk.page.goto(`${BASE}${hrefs[0]}`);
  await hydrated(desk.page);
  check(desk.page.url().includes("/students"), "and the first one goes where it says");
}

/* ---------------- The pictures under the board ---------------- */
{
  const page = desk.page;
  await page.goto(`${BASE}/dashboard`);
  await hydrated(page);
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const title of ["From registration to enrolment", "Month by month", "Where applications stand", "Branches compared", "Where students want to go", "Recent activity"]) {
    check(body.includes(title), `the dashboard draws "${title}"`);
  }

  // Month by month: the twelve months add up to the students registered and
  // the applications made in them.
  const bands = await page.locator("main svg rect[aria-label]").evaluateAll((els) =>
    els.map((e) => {
      const m = e.getAttribute("aria-label").match(/: (\d+) registrations, (\d+) applications/) || [];
      return { r: Number(m[1] ?? 0), a: Number(m[2] ?? 0) };
    }),
  );
  const yearAgo = sql("select to_char(date_trunc('month', now()) - interval '11 months', 'YYYY-MM-DD')");
  const registered = n(`select count(*) from students where not archived and created_at >= '${yearAgo}'`);
  const applied = n(`select count(*) from applications where created_at >= '${yearAgo}'`);
  check(bands.length === 12, `twelve months are drawn (${bands.length})`);
  const sumR = bands.reduce((x, b) => x + b.r, 0);
  const sumA = bands.reduce((x, b) => x + b.a, 0);
  check(sumR === registered, `they add up to the students registered in them (${sumR} against ${registered})`);
  check(sumA === applied, `and to the applications made in them (${sumA} against ${applied})`);

  // The journey never widens: a step cannot keep more than the one before.
  const steps = await page.locator("main ol li a").evaluateAll((els) =>
    els.map((e) => Number((e.querySelector("span.font-display")?.textContent ?? "x").replace(/,/g, "").trim())).filter((v) => !Number.isNaN(v)),
  );
  const funnel = steps.slice(0, 5);
  check(funnel.length === 5, `the journey has its five steps (${funnel.join(" > ")})`);
  check(funnel.slice(1).every((v, i) => v <= funnel[i]), `and narrows at every step, never widens (${funnel.join(" > ")})`);
  check(funnel[0] === n("select count(*) from students where not archived"), "and starts from everybody registered");

  // The branches compared add up to what the portal registered.
  const branchRows = await page.locator("main table:not(.sr-only) tbody tr").evaluateAll((rows) =>
    rows.map((r) => Number(r.querySelectorAll("td")[2]?.textContent?.trim() ?? 0)),
  );
  const branchStudents = n("select count(*) from students s join organizations o on o.id = s.org_id where not s.archived and o.type in ('BRANCH','SUB_AGENT') and o.active");
  check(branchRows.reduce((x, y) => x + y, 0) === branchStudents, `the branches compared account for every branch's students (${branchRows.reduce((x, y) => x + y, 0)} of ${branchStudents})`);

  // The ring counts every application, once.
  const ring = Number((await page.locator('main svg[aria-label$="applications by stage"]').getAttribute("aria-label")).match(/^(\d+)/)[1]);
  check(ring === n("select count(*) from applications"), `the ring counts every application (${ring})`);

  // What just happened, newest first, each line opening a student.
  const feed = await page.locator("main ol a[href^='/students/']").count();
  check(feed > 0, `recent activity lists what happened (${feed} lines)`);
}

/* ---------------- The period and the branch ---------------- */
{
  const page = desk.page;
  const docsAll = await figure(page, "pending-documents");
  await page.getByRole("link", { name: "This month", exact: true }).click();
  await page.waitForURL(/period=month/, { timeout: 15000 });
  await hydrated(page);
  const monthStart = sql("select to_char(date_trunc('month', now()), 'YYYY-MM-DD')");
  const regsMonth = n(`select count(*) from students where not archived and created_at >= '${monthStart}'`);
  const read = Number((await figure(page, "total-registrations")).replace(/[^0-9]/g, ""));
  check(read === regsMonth, `"This month" counts the students registered this month (${read} against ${regsMonth})`);
  const changeLine = await page.locator('[data-tile="total-registrations"]').innerText();
  check(/vs last month/.test(changeLine), "and says how that moved against last month");
  check((await figure(page, "pending-documents")) === docsAll, "while a state of things now stays as it was");

  // One branch: the whole screen narrows to it.
  const one = sql(`select o.id from organizations o where o.type = 'BRANCH' and o.active order by (select count(*) from students s where s.org_id = o.id) desc limit 1`);
  await page.goto(`${BASE}/dashboard?org=${one}`);
  await hydrated(page);
  const theirs = n(`select count(*) from students where org_id = '${one}' and not archived`);
  const shown = Number((await figure(page, "total-registrations")).replace(/[^0-9]/g, ""));
  check(shown === theirs, `picking a branch narrows the board to it (${shown} against its ${theirs})`);
  check((await page.locator("main table:not(.sr-only)").count()) === 0, "and drops the comparison, which is of one");
  const ringOne = Number((await page.locator('main svg[aria-label$="applications by stage"]').getAttribute("aria-label")).match(/^(\d+)/)[1]);
  check(ringOne === n(`select count(*) from applications where org_id = '${one}'`), `and the pictures follow it (${ringOne} applications)`);
}

/* ---------------- The two waiting tiles are the desk's own question ---------------- */
{
  const page = desk.page;
  await page.goto(`${BASE}/applications?group=PENDING_PARTNER&orgType=SUB_AGENT`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  const shown = await page.locator("tbody tr").count();
  const expected = n(`select count(*) from applications a join status_definitions d on d.id = a.status_id join organizations o on o.id = a.org_id where d."group" = 'PENDING_PARTNER' and o.type = 'SUB_AGENT'`);
  check(shown === expected, `"pending from partners" opens only the sub-agents' files (${shown} of ${expected})`);
}
check(desk.errors.length === 0, `the desk's board draws without an error ${desk.errors.slice(0, 2).join(" | ")}`);
await desk.ctx.close();

/* ---------------- A branch reads its own ---------------- */

const branchEmail = sql(`
  select u.email from users u join organizations o on o.id = u.org_id
  where u.role = 'PARTNER' and u.active and o.type = 'BRANCH'
  order by (select count(*) from applications a where a.org_id = o.id) desc limit 1`);
const orgId = sql(`select org_id from users where email = '${branchEmail}'`);
const branch = await open(branchEmail);
{
  const page = branch.page;
  const order = await drawnOrder(page);
  check(order.join(",") === BRANCH.join(","), `a branch gets the same board with its own waiting tile (${order.join(" | ")})`);
  const reads = Number((await figure(page, "total-registrations")).replace(/[^0-9]/g, ""));
  const mine = n(`select count(*) from students where org_id = '${orgId}' and not archived`);
  const all = n("select count(*) from students where not archived");
  check(reads === mine, `and counts its own students rather than everybody's (${reads} of its ${mine}, portal has ${all})`);
  check(mine < all, "which is a smaller number than the desk sees, so the scoping is doing something");
}
check(branch.errors.length === 0, `a branch's board draws without an error ${branch.errors.slice(0, 2).join(" | ")}`);
await branch.ctx.close();

/* ---------------- And a sub-agent reads its own ---------------- */

const subEmail = sql(`
  select u.email from users u join organizations o on o.id = u.org_id
  where u.active and o.type = 'SUB_AGENT' and u.role in ('PARTNER','SUB_AGENT_COUNSELLOR')
  order by u.email limit 1`);
if (subEmail) {
  const sub = await open(subEmail);
  const order = await drawnOrder(sub.page);
  check(order.includes("waiting-on-you"), "a sub-agent gets the branch board, not the desk's");
  check(!order.includes("pending-from-branches"), "and is not asked about branches it cannot see");
  check(sub.errors.length === 0, `a sub-agent's board draws without an error ${sub.errors.slice(0, 2).join(" | ")}`);
  await sub.ctx.close();
} else {
  check(false, "no sub-agent seeded to check the scoping on");
}

/* ---------------- The team that may not see money ---------------- */

const docsEmail = sql(`select email from users where role = 'DOCUMENTATION' and active order by email limit 1`);
if (docsEmail) {
  const docs = await open(docsEmail);
  const order = await drawnOrder(docs.page);
  check(order.length > 0, `the documentation desk gets the board too (${order.length} tiles)`);
  check(!order.includes("total-revenue-expected"), "without the money tile, which is not theirs to read");
  check(docs.errors.length === 0, `and draws without an error ${docs.errors.slice(0, 2).join(" | ")}`);
  await docs.ctx.close();
} else {
  check(false, "no documentation account seeded");
}

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
