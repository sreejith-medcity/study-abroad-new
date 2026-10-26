// The dashboards: one per job, drawn three ways, each counted against the
// database.
//
// Leadership and finance read an executive summary, the processing desk a
// command centre of tiles, and the documentation desk, a branch and a
// counsellor a pipeline board of their own work. This checks that each role
// gets its own, that the figures on each agree with the database, that every
// tile opens the list behind it, and that the scoping holds: the desk reads
// the whole portal, a branch its own, and a counsellor only their own
// students, which are the ones assigned to them and the ones they registered
// that nobody has yet been given, exactly as their students list shows them.
// The super admin and the ops manager can look at any of the others, as that
// desk sees it; nobody else can.
// Wants the plain seed; adds students of its own and takes them away again.
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
// question to it: what has the desk asked you for. It also reads who has not
// been given to anybody yet, and its own wallet.
const BRANCH = [...DESK.slice(0, 9), "waiting-on-you", "not-given-to-anyone", "total-revenue-expected", "wallet"];

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
const tileHref = (page, tile) => page.locator(`a[data-tile="${tile}"]`).first().getAttribute("href");
// The address a tile opens, and how many rows the list there says it holds.
const listTotal = async (page, href) => {
  await page.goto(`${BASE}${href}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  const foot = page.locator("[data-list-foot]");
  if ((await foot.count()) === 0) return await page.locator("main tbody tr").count();
  return Number(((await foot.innerText()).replace(/\s+/g, " ").match(/of ([\d,]+)/) || [])[1]?.replace(/,/g, "") ?? NaN);
};
// One person's own students, written out exactly as the portal's rule reads:
// inside their branch, and registered by them, assigned to them, or worked by
// them in a recorded way (the officer on an application, a document claimed
// or decided, or put on the file by name).
// `who` is an SQL expression for the person: a quoted id, or a column.
const ownOf = (who) => `s.org_id = (select org_id from users where id = ${who}) and not s.archived and (
  s.created_by_id = ${who} or s.assigned_to_id = ${who}
  or exists (select 1 from applications a where a.student_id = s.id and a.officer_id = ${who})
  or exists (select 1 from checklist_items c where c.student_id = s.id and (c.claimed_by_id = ${who} or c.decided_by_id = ${who}))
  or exists (select 1 from student_people p where p.student_id = s.id and p.user_id = ${who}))`;
const ownWhere = (id) => ownOf(`'${id}'`);
const own = (id) => n(`select count(*) from students s where ${ownWhere(id)}`);
const drawnOrder = (page) => page.locator("main [data-stat-tiles] > *").evaluateAll((els) => els.map((e) => e.getAttribute("data-tile")));

/* ---------------- The processing desk reads the whole portal ---------------- */

const desk = await open("admin@medcityoverseas.test");
{
  const page = desk.page;
  check(page.url().endsWith("/dashboard"), "signing in lands on the dashboard");
  check((await page.locator("main [data-stat-tiles]").count()) === 1, "which is one board of figures");

  const order = await drawnOrder(page);
  check(order.length === DESK.length, `every figure is drawn, nought or not (${order.length} of ${DESK.length})`);
  check(order.join(",") === DESK.join(","), `and always in the same order (${order.join(" | ")})`);

  // No folded panels, and two tables a person reads: who is carrying what,
  // and the branches compared.
  check((await page.locator("main details").count()) === 0, "no folded panels");
  check((await page.locator("main table:not(.sr-only)").count()) === 2, "two visible tables, the officers and the branches compared");
  check((await page.locator("main [data-exec-hero]").count()) === 0, "and it is the command centre, not the summary");

  const want = {
    "total-registrations": n("select count(*) from students where not archived"),
    "total-applications": n("select count(*) from applications"),
    // A visa cannot be had without an offer, so a file that went straight to
    // a visa status still received one.
    "offers-received": n(`select count(distinct h.application_id) from status_history h join status_definitions d on d.id = h.to_status_id where d."group" = 'OFFER' or d.code in ('VISA_RECEIVED','PRE_DEPARTURE','ENROLLED','JOINED','HAPPY_CALL','DEPLOYED')`),
    "visas-received": n(`select count(distinct h.application_id) from status_history h join status_definitions d on d.id = h.to_status_id where d.code in ('VISA_RECEIVED','PRE_DEPARTURE','ENROLLED','JOINED','HAPPY_CALL','DEPLOYED')`),
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
  for (const title of ["From registration to enrolment", "Deadlines this week", "Month by month", "Where applications stand", "Who is carrying what", "Branches compared", "Recent activity"]) {
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

  // The deadlines are this week's open ones.
  const weekDue = n(`select count(*) from application_deadlines where done_at is null and due_on between date_trunc('week', (now() at time zone 'Asia/Kolkata')::date)::date and (date_trunc('week', (now() at time zone 'Asia/Kolkata')::date) + interval '6 days')::date`);
  const weekShown = await page.locator("[data-week] > ul > li a").count();
  check(weekShown === Math.min(6, weekDue), `the week's deadlines are the open ones due this week (${weekShown} of ${weekDue})`);

  // Who is carrying what accounts for every open file, once.
  const loadRows = await page.locator("main table:not(.sr-only)").first().locator("tbody tr").evaluateAll((rows) => rows.map((r) => Number(r.querySelectorAll("td")[1]?.textContent?.trim() ?? 0)));
  const openFiles = n(`select count(*) from applications a join status_definitions d on d.id = a.status_id where d."group" in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')`);
  check(loadRows.reduce((x, y) => x + y, 0) === openFiles, `the officers carry every open file between them (${loadRows.reduce((x, y) => x + y, 0)} of ${openFiles})`);
  // And each officer's line opens exactly the files it counts.
  const officerLinks = await page.locator("main table:not(.sr-only)").first().locator("tbody tr").evaluateAll((rows) =>
    rows.map((r) => ({ href: r.querySelector("a")?.getAttribute("href"), open: Number(r.querySelectorAll("td")[1]?.textContent?.trim() ?? 0) })),
  );
  for (const o of officerLinks.slice(0, 3)) {
    await page.goto(`${BASE}${o.href}`);
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await hydrated(page);
    const shown = await page.locator("tbody tr").count();
    check(shown === o.open, `an officer's line opens their open files (${o.href}: ${shown} of ${o.open})`);
  }
  await page.goto(`${BASE}/dashboard`);
  await hydrated(page);

  // The branches compared add up to what the portal registered.
  const branchRows = await page.locator("main table:not(.sr-only)").nth(1).locator("tbody tr").evaluateAll((rows) =>
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
  check(!(await page.locator("main").innerText()).includes("Branches compared"), "and drops the comparison, which is of one");
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
  check(order.join(",") === BRANCH.join(","), `a branch gets its pipeline, with its own waiting tile and wallet (${order.join(" | ")})`);
  // The board holds every live application of the branch, column by column.
  const counts = await page.locator("[data-column] [data-count]").evaluateAll((els) => els.map((e) => Number(e.textContent.trim())));
  const live = n(`select count(*) from applications a join status_definitions d on d.id = a.status_id where a.org_id = '${orgId}' and d."group" in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER','SUCCESS')`);
  check(counts.length === 5 && counts.reduce((x, y) => x + y, 0) === live, `the board holds every live application of the branch (${counts.join("+")} against ${live})`);
  const loose = Number((await figure(page, "not-given-to-anyone")).replace(/[^0-9]/g, ""));
  check(loose === n(`select count(*) from students where org_id = '${orgId}' and not archived and assigned_to_id is null`), `"not given to anyone" counts the branch's unassigned students (${loose})`);
  check((await page.locator("[data-view-as]").count()) === 0, "and a branch head cannot look at anybody else's dashboard");
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

/* ---------------- The documentation desk reads documents ---------------- */

const docsEmail = sql(`select email from users where role = 'DOCUMENTATION' and active order by email limit 1`);
if (docsEmail) {
  const docs = await open(docsEmail);
  const page = docs.page;
  const order = await drawnOrder(page);
  check(order[0] === "waiting-for-a-check", `the documentation desk opens on what is waiting for a check (${order.join(" | ")})`);
  check(!order.includes("total-revenue-expected") && !(await page.locator("main").innerText()).includes("₹"), "and no money anywhere, which is not theirs to read");
  const waiting = Number((await figure(page, "waiting-for-a-check")).replace(/[^0-9]/g, ""));
  check(waiting === n(`select count(*) from checklist_items c join students s on s.id = c.student_id where not s.archived and c.state in ('UPLOADED','IN_REVIEW') and c.claimed_by_id is null`), `"waiting for a check" is the unclaimed pool (${waiting})`);
  const asked = Number((await figure(page, "asked-not-in")).replace(/[^0-9]/g, ""));
  check(asked === n(`select count(*) from checklist_items c join students s on s.id = c.student_id where not s.archived and c.state = 'ASKED'`), `"asked, not in" reads the database (${asked})`);
  const cols = await page.locator("[data-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")));
  check(cols.join(",") === "ASKED,UPLOADED,IN_REVIEW,REJECTED,ACCEPTED", `documents move across five columns (${cols.join(" > ")})`);
  check(docs.errors.length === 0, `and it draws without an error ${docs.errors.slice(0, 2).join(" | ")}`);
  await docs.ctx.close();
} else {
  check(false, "no documentation account seeded");
}

/* ---------------- Leadership reads a summary ---------------- */

const lead = await open("sreejith@miak.in");
{
  const page = lead.page;
  check((await page.locator("main [data-exec-hero]").count()) === 1, "leadership opens on the executive summary");
  const hero = async (slug) => Number((await page.locator(`[data-hero="${slug}"] [data-figure]`).innerText()).replace(/[^0-9]/g, ""));
  check((await hero("total-registrations")) === n("select count(*) from students where not archived"), "its registrations read the database");
  check((await hero("total-applications")) === n("select count(*) from applications"), "and its applications");
  check((await page.locator("main [data-gauge]").count()) === 1, "with the revenue gauge, for somebody who may see money");
  const docsNeed = Number((await page.locator('[data-attention="pending-documents"] [data-figure]').innerText()).trim());
  check(docsNeed === n(`select count(*) from checklist_items c join students s on s.id = c.student_id where not s.archived and c.state in ('ASKED','UPLOADED','IN_REVIEW','REJECTED')`), `needs attention counts the documents still out (${docsNeed})`);
  for (const title of ["How students flow through", "Needs attention", "Registrations, last twelve months", "Branches compared", "Latest"]) {
    check((await page.locator("main").innerText()).includes(title), `the summary draws "${title}"`);
  }
  check((await page.locator("[data-view-as] select").first().count()) === 1, "and the super admin can view as another desk");

  // Printed, the summary keeps its figures and drops the controls.
  await page.emulateMedia({ media: "print" });
  check(!(await page.locator("[data-view-as]").isVisible()), "printed, the view-as picker drops out");
  check(await page.locator("[data-exec-hero]").isVisible(), "and the band of figures stays");
  await page.emulateMedia({ media: "screen" });

  // Every placement figure is the length of the tracker list it opens.
  for (const slug of ["ausbildung-students", "interview-coming", "german-not-finished", "service-charge-pending", "nursing-students"]) {
    await page.goto(`${BASE}/dashboard`);
    await hydrated(page);
    const tile = page.locator(`[data-placement="${slug}"]`);
    const shown = Number((await tile.locator("[data-figure]").innerText()).replace(/[^0-9]/g, ""));
    await page.goto(`${BASE}${await tile.getAttribute("href")}`);
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await hydrated(page);
    const rows = await page.locator("[data-tracker-row]").count();
    check(shown === rows, `placements: "${slug}" is the list it opens (${shown} against ${rows})`);
  }
  await page.goto(`${BASE}/dashboard`);
  await hydrated(page);

  // Viewing as a branch narrows to it and reads what the branch reads.
  const one = sql(`select o.id from organizations o where o.type = 'BRANCH' and o.active order by (select count(*) from students s where s.org_id = o.id) desc limit 1`);
  await page.goto(`${BASE}/dashboard?as=branch&org=${one}`);
  await hydrated(page);
  check((await page.locator("[data-viewing-as]").count()) === 1, "viewing as a branch says so");
  const regs = Number((await figure(page, "total-registrations")).replace(/[^0-9]/g, ""));
  check(regs === n(`select count(*) from students where org_id = '${one}' and not archived`), `and reads that branch's students (${regs})`);

  // Viewing as one counsellor reads only that person's own students, and
  // the list a figure opens is that person's, not the viewer's whole portal.
  const who = sql(`select u.id from users u where u.role = 'COUNSELLOR' and u.active order by (select count(*) from students s where s.assigned_to_id = u.id) desc limit 1`);
  await page.goto(`${BASE}/dashboard?as=counsellor&who=${who}`);
  await hydrated(page);
  const theirs = Number((await figure(page, "my-students")).replace(/[^0-9]/g, ""));
  check(theirs === own(who), `viewing as a counsellor reads their own students only (${theirs})`);
  const whoseHref = await tileHref(page, "my-students");
  check(whoseHref.includes(`of=${who}`), `and "My students" opens that person's list (${whoseHref})`);
  check((await listTotal(page, whoseHref)) === theirs, "which holds the same number");
  // The placement figures on that board are that person's own files too, and
  // open the tracker on the same students rather than on the files assigned
  // to them alone.
  if ((await page.locator("[data-placements]").count()) === 1) {
    const tile = page.locator('[data-placement="ausbildung-students"]');
    const shown = Number((await tile.locator("[data-figure]").innerText()).replace(/[^0-9]/g, ""));
    const href = await tile.getAttribute("href");
    check(href.includes(`of=${who}`) && !href.includes("who="), `placements on a viewed-as board carry "of", not the counsellor picker (${href})`);
    await page.goto(`${BASE}${href}`);
    await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await hydrated(page);
    check((await page.locator("[data-tracker-row]").count()) === shown, `and the tracker holds the same number (${shown})`);
    check((await page.locator(`[data-own-files="${who}"]`).count()) === 1, "and says whose own files it is showing");
  }

  await page.goto(`${BASE}/dashboard?as=finance`);
  await hydrated(page);
  check((await page.locator('[data-hero="earned-not-invoiced"]').count()) === 1, "and viewing as finance draws the money");
}
check(lead.errors.length === 0, `the summary draws without an error ${lead.errors.slice(0, 2).join(" | ")}`);
await lead.ctx.close();

/* ---------------- Management reads the summary, and only its own ---------------- */

const mgmt = await open("management@medcityoverseas.test");
{
  const page = mgmt.page;
  await page.goto(`${BASE}/dashboard?as=desk`);
  await hydrated(page);
  check((await page.locator("main [data-exec-hero]").count()) === 1, "management reads the summary, and asking for another desk's changes nothing");
  check((await page.locator("[data-view-as]").count()) === 0, "with no view-as picker, which is the super admin's and the ops manager's");
  const queue = await page.locator('main a[href^="/admin/queue"], main a[href^="/documentation"]').count();
  check(queue === 0, `and no link into a work queue management cannot open (${queue})`);
}
check(mgmt.errors.length === 0, `management's summary draws without an error ${mgmt.errors.slice(0, 2).join(" | ")}`);
await mgmt.ctx.close();

/* ---------------- Finance reads money and nothing else ---------------- */

const fin = await open("finance@medcityoverseas.test");
{
  const page = fin.page;
  const slugs = await page.locator("[data-hero]").evaluateAll((els) => els.map((e) => e.getAttribute("data-hero")));
  check(slugs.join(",") === "earned-not-invoiced,ready-to-invoice,outstanding,received", `finance opens on the money (${slugs.join(" | ")})`);
  const text = await page.locator("main").innerText();
  check(!/registrations|applications by stage/i.test(text), "and nothing about students, which is the finance role's own rule");
  const latest = await page.locator('main a[href^="/admin/invoices/"]').count();
  check(latest === Math.min(6, n("select count(*) from invoice_payments")), `the latest money in lists the payments recorded (${latest})`);
  const late = Number((await page.locator('[data-attention="late-invoices"] [data-figure]').innerText()).trim());
  const lateDb = n(`select count(*) from vendor_invoices v where v.state not in ('PAID','WRITTEN_OFF','DRAFT') and v.due_on < current_date - 0 and v.total - v.received_amount - coalesce((select sum(amount) from credit_notes c where c.invoice_id = v.id), 0) > 0`);
  check(late === lateDb, `invoices past due read the database (${late} against ${lateDb})`);
}
check(fin.errors.length === 0, `finance's dashboard draws without an error ${fin.errors.slice(0, 2).join(" | ")}`);
await fin.ctx.close();

/* ---------------- A counsellor reads only their own students ---------------- */
// Sreekutty's board said "My students 10" while her list held thirteen: the
// ten given to her, two she had registered herself that nobody had been given
// to, and one a colleague registered that nobody had been given to. The board
// and the list now agree on twelve: her own are the ones given to her and the
// ones she registered; the colleague's walk-in is the branch head's to hand out.

const cEmail = sql(`select u.email from users u where u.role = 'COUNSELLOR' and u.active order by (select count(*) from students s where s.assigned_to_id = u.id) desc, u.email limit 1`);
const cId = sql(`select id from users where email = '${cEmail}'`);
const cOrg = sql(`select org_id from users where id = '${cId}'`);
const colleague = sql(`select id from users where org_id = '${cOrg}' and role = 'COUNSELLOR' and active and id <> '${cId}' order by email limit 1`);
sql("delete from students where id in ('dc_own', 'dc_theirs')");
sql(`insert into students (id, org_id, created_by_id, assigned_to_id, portal_token, first_name, last_name, phone)
     values ('dc_own', '${cOrg}', '${cId}', null, 'dc_t_own', 'Boardcheck', 'Walkin', '9100000811'),
            ('dc_theirs', '${cOrg}', '${colleague}', null, 'dc_t_theirs', 'Boardcheck', 'Colleague', '9100000812')`);
const coun = await open(cEmail);
{
  const page = coun.page;
  const mine = Number((await figure(page, "my-students")).replace(/[^0-9]/g, ""));
  const assigned = n(`select count(*) from students where assigned_to_id = '${cId}' and not archived`);
  const branchAll = n(`select count(*) from students where org_id = '${cOrg}' and not archived`);
  check(mine === own(cId), `a counsellor's board counts their own students: given to them, or registered by them (${mine})`);
  check(mine === assigned + 1, `which is the ones given to them plus the one they registered that nobody has been given (${assigned} + 1)`);
  check(mine < branchAll, "and fewer than the branch has, so a colleague's walk-in is not counted");
  const myHref = await tileHref(page, "my-students");
  check(myHref === "/students", `"My students" opens the plain students list, which is already exactly their own (${myHref})`);

  const loose = Number((await figure(page, "not-given-to-anyone")).replace(/[^0-9]/g, ""));
  const looseLabel = (await page.locator('[data-tile="not-given-to-anyone"]').innerText()).replace(/\s+/g, " ");
  check(/Registered by you, not yet given to a counsellor/.test(looseLabel), `the unassigned tile is about their own, not the branch's (${looseLabel})`);
  check(loose === n(`select count(*) from students s where ${ownWhere(cId)} and s.assigned_to_id is null`), `and counts the ones they registered that nobody has been given (${loose})`);
  check(loose >= 1 && loose < n(`select count(*) from students where org_id = '${cOrg}' and not archived and assigned_to_id is null`), "which is fewer than the branch's unassigned, the colleague's walk-in left out");
  const looseHref = await tileHref(page, "not-given-to-anyone");

  const counts = await page.locator("[data-column] [data-count]").evaluateAll((els) => els.map((e) => Number(e.textContent.trim())));
  const live = n(`select count(*) from applications a join status_definitions d on d.id = a.status_id join students s on s.id = a.student_id where ${ownWhere(cId)} and d."group" in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER','SUCCESS')`);
  check(counts.reduce((x, y) => x + y, 0) === live, `and the board holds only their own students' applications (${counts.join("+")} against ${live})`);
  const apps = Number((await figure(page, "total-applications")).replace(/[^0-9]/g, ""));
  check(apps === n(`select count(*) from applications a join students s on s.id = a.student_id where ${ownWhere(cId)}`), `"Applications" counts the applications of their own students (${apps})`);
  check((await tileHref(page, "total-applications")) === "/applications", "and opens the plain applications list, which is their own files");
  check((await page.locator("main").innerText()).includes("Follow-ups"), "with their follow-ups beside it");

  // The lists the tiles open hold the same numbers as the tiles.
  check((await listTotal(page, myHref)) === mine, `the students list opened from "My students" holds the same number (${mine})`);
  const listed = (await page.locator("main tbody tr").allInnerTexts()).join(" | ");
  check(listed.includes("Boardcheck Walkin") && !listed.includes("Boardcheck Colleague"), "with the student they registered and not the colleague's");
  check((await listTotal(page, looseHref)) === loose, `and the list opened from the unassigned tile holds that tile's number (${loose})`);

  await page.goto(`${BASE}/dashboard?as=leadership`);
  await hydrated(page);
  check((await page.locator("main [data-exec-hero]").count()) === 0, "and asking for leadership's dashboard changes nothing");
}
sql("delete from students where id in ('dc_own', 'dc_theirs')");
/* ---------------- A counsellor with nobody yet is told why the board is empty ---------------- */
{
  const empty = sql(`select u.email from users u where u.role in ('COUNSELLOR','SUB_AGENT_COUNSELLOR','TRAINEE_COUNSELLOR') and u.active and not exists (select 1 from students s where ${ownOf("u.id")}) order by u.email limit 1`);
  if (empty) {
    const nobody = await open(empty);
    check((await nobody.page.locator("[data-first-day]").count()) === 1, `a counsellor with no students is told how the board fills (${empty})`);
    check((await nobody.page.locator("[data-placements]").count()) === 0, "and is not shown a card of placement noughts");
    await nobody.ctx.close();
  }
}
check(coun.errors.length === 0, `a counsellor's board draws without an error ${coun.errors.slice(0, 2).join(" | ")}`);
await coun.ctx.close();

/* ---------------- The day's figures ---------------- */
// Today's five figures and the month so far, from the day end reports: a
// counsellor who answered today sees what they gave, one who has not sees the
// portal's count of all five (connected calls and leads included), a branch head sees
// the branch added up and each person's month, and leadership a strip per
// branch with a report this month.
{
  const today = sql("select (now() at time zone 'Asia/Kolkata')::date::text");
  const yesterday = sql(`select ('${today}'::date - 1)::text`);
  const month = today.slice(0, 7);
  const germany = sql("select id from users where email = 'germany@medcity.test'");
  const uk = sql("select id from users where email = 'uk.docs@medcity.test'");
  const kottayam = sql("select org_id from users where email = 'kottayam@medcity.test'");
  const report = (id, who, day, figures) =>
    sql(`insert into daily_journals (id, user_id, day, state, decided_at, entries, figures)
         values ('${id}', '${who}', '${day}', 'VERIFIED', now(), '[]'::jsonb, '${JSON.stringify(figures)}'::jsonb)
         on conflict (user_id, day) do update set state = 'VERIFIED', decided_at = now(), figures = excluded.figures`);
  // The Germany counsellor answered today, and yesterday too when yesterday is
  // in the same month; the UK counsellor has not answered at all.
  report("df_today", germany, today, { leadsReceived: 4, callsMade: 9, connectedCalls: 3, followUpsDone: 2, registrationsDone: 1 });
  const twoDays = yesterday.slice(0, 7) === month;
  if (twoDays) report("df_yesterday", germany, yesterday, { leadsReceived: 3, callsMade: 6, connectedCalls: 2, followUpsDone: 1, registrationsDone: 0 });
  sql(`delete from daily_journals where user_id = '${uk}' and day = '${today}'`);
  // A reached call, a no-answer call and an enquiry given to the UK counsellor
  // today, so the live tiles have something to count. "Two hours ago" is kept
  // inside today in India for a run just after midnight.
  const earlier = (interval) => `greatest(now() - interval '${interval}', '${today} 00:01:00+05:30'::timestamptz)`;
  const ukOrg = sql(`select org_id from users where id = '${uk}'`);
  sql(`insert into students (id, org_id, created_by_id, assigned_to_id, portal_token, first_name, last_name, phone, created_at)
       values ('df_s1', '${ukOrg}', '${uk}', '${uk}', 'df_t1', 'Figures', 'Student', '9100000771', ${earlier("2 hours")}) on conflict (id) do nothing`);
  sql(`insert into contact_log (id, org_id, student_id, channel, outcome, by_id, created_at)
       values ('df_c1', '${ukOrg}', 'df_s1', 'CALL', 'REACHED', '${uk}', ${earlier("90 minutes")}),
              ('df_c2', '${ukOrg}', 'df_s1', 'CALL', 'NO_ANSWER', '${uk}', ${earlier("80 minutes")}) on conflict (id) do nothing`);
  sql(`insert into enquiries (id, org_id, created_by_id, assigned_to_id, name, phone, created_at)
       values ('df_e1', '${ukOrg}', '${uk}', '${uk}', 'Figures Enquiry', '9100000772', ${earlier("3 hours")}) on conflict (id) do nothing`);
  const CONNECTED = "('REACHED','WILL_SEND','WANTS_TIME','NEEDS_COUNSELLING','NOT_INTERESTED')";
  const monthCalls = twoDays ? "15" : "9";
  const monthLeads = twoDays ? "7" : "4";
  const days = twoDays ? "2" : "1";
  const inToday = (col) => `${col} >= '${today} 00:00:00+05:30'::timestamptz and ${col} < '${today} 00:00:00+05:30'::timestamptz + interval '1 day'`;
  const todayText = async (page, key) => (await page.locator(`[data-day-figures] [data-figure-tile="${key}"] [data-today]`).innerText()).trim();
  const monthText = async (page, key) => (await page.locator(`[data-day-figures] [data-figure-tile="${key}"] [data-month]`).innerText()).trim();

  // A counsellor with an answered report sees what they gave.
  const g = await open("germany@medcity.test");
  check((await g.page.locator("[data-day-figures]").count()) === 1, "a counsellor's board has the day's figures");
  check((await g.page.locator("[data-day-figures] [data-figure-tile]").count()) === 5, "five of them");
  check((await g.page.locator("[data-day-figures]").getAttribute("data-today-source")) === "answered", "read from today's answered report");
  check((await todayText(g.page, "leadsReceived")) === "4" && (await todayText(g.page, "callsMade")) === "9", "with the leads and calls given on it, not the portal's count");
  check((await todayText(g.page, "connectedCalls")) === "3" && (await todayText(g.page, "followUpsDone")) === "2" && (await todayText(g.page, "registrationsDone")) === "1", "and the other three as given");
  check((await monthText(g.page, "callsMade")) === monthCalls && (await monthText(g.page, "leadsReceived")) === monthLeads, `with the month so far under each (${monthCalls} calls over ${days} ${days === "1" ? "day" : "days"})`);
  check(!(await g.page.locator("[data-day-figures]").innerText()).includes("Not given yet"), "and nothing still to come");
  check(g.errors.length === 0, `the figures draw without an error ${g.errors.slice(0, 2).join(" | ")}`);
  await g.ctx.close();

  // A counsellor who has not answered sees the portal's count of all five,
  // connected calls from the calls logged as reached and leads from the
  // enquiries given to them today.
  const u = await open("uk.docs@medcity.test");
  const ukCalls = n(`select count(*) from contact_log where by_id = '${uk}' and channel = 'CALL' and ${inToday("created_at")}`);
  const ukConnected = n(`select count(*) from contact_log where by_id = '${uk}' and channel = 'CALL' and outcome in ${CONNECTED} and ${inToday("created_at")}`);
  const ukLeads = n(`select count(*) from enquiries where assigned_to_id = '${uk}' and ${inToday("created_at")}`);
  const ukFollowUps = n(`select count(*) from tasks where done_by_id = '${uk}' and ${inToday("done_at")}`);
  const ukRegs = n(`select count(*) from students where created_by_id = '${uk}' and ${inToday("created_at")}`);
  check((await u.page.locator("[data-day-figures]").getAttribute("data-today-source")) === "live", "without a report, today is counted live");
  check((await todayText(u.page, "callsMade")) === String(ukCalls), `calls made is the calls logged in the portal today (${ukCalls})`);
  check((await todayText(u.page, "followUpsDone")) === String(ukFollowUps) && (await todayText(u.page, "registrationsDone")) === String(ukRegs), `follow-ups done and registrations done likewise (${ukFollowUps}, ${ukRegs})`);
  check(ukConnected >= 1 && ukConnected < ukCalls && ukLeads >= 1, `the reached call and the enquiry are there to count, and the no-answer call is not connected (${ukConnected} of ${ukCalls}, ${ukLeads} leads)`);
  check((await todayText(u.page, "connectedCalls")) === String(ukConnected), `connected calls is a live count of the calls logged as reached (${ukConnected})`);
  check((await todayText(u.page, "leadsReceived")) === String(ukLeads), `leads received is a live count of the enquiries given to them today (${ukLeads})`);
  check(!(await u.page.locator("[data-day-figures]").innerText()).includes("Not given yet"), "so nothing on the live board is still to come");
  check((await monthText(u.page, "callsMade")) === "Not recorded", "and a month with no answered report is not recorded, not 0");
  check(u.errors.length === 0, `the live figures draw without an error ${u.errors.slice(0, 2).join(" | ")}`);
  await u.ctx.close();

  // The branch head sees the branch added up, and each person's month.
  const b = await open("kottayam@medcity.test");
  const card = b.page.locator('[data-day-figures="branch"]');
  check((await card.count()) === 1, "a branch head's board has the branch's figures");
  const givers = n(`select count(*) from users u join organizations o on o.id = u.org_id where u.org_id = '${kottayam}' and u.active and o.type = 'BRANCH' and u.role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR','DESK_COUNSELLOR')`);
  check((await card.getAttribute("data-answered-today")) === "1" && (await card.getAttribute("data-of-today")) === String(givers), `one of the branch's ${givers} has answered today`);
  const othersCalls = n(`select count(*) from contact_log c join users u on u.id = c.by_id where u.org_id = '${kottayam}' and u.active and u.id <> '${germany}' and u.role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR','DESK_COUNSELLOR') and c.channel = 'CALL' and ${inToday("c.created_at")}`);
  check((await todayText(b.page, "callsMade")) === String(9 + othersCalls), `today's calls add the report given to the portal's count for the rest (9 + ${othersCalls})`);
  const othersLeads = n(`select count(*) from enquiries e join users u on u.id = e.assigned_to_id where u.org_id = '${kottayam}' and u.active and u.id <> '${germany}' and u.role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR','DESK_COUNSELLOR') and ${inToday("e.created_at")}`);
  const othersConnected = n(`select count(*) from contact_log c join users u on u.id = c.by_id where u.org_id = '${kottayam}' and u.active and u.id <> '${germany}' and u.role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR','DESK_COUNSELLOR') and c.channel = 'CALL' and c.outcome in ${CONNECTED} and ${inToday("c.created_at")}`);
  check((await todayText(b.page, "leadsReceived")) === String(4 + othersLeads), `today's leads add the report given to the enquiries given to the rest (4 + ${othersLeads})`);
  check((await todayText(b.page, "connectedCalls")) === String(3 + othersConnected), `and connected calls add the report given to the calls the rest logged as reached (3 + ${othersConnected})`);
  check((await card.locator("[data-day-figures-people]").count()) === 1, "with a table of each person's month");
  check((await card.locator("[data-day-figures-row]").count()) === givers, `one row per person who gives figures (${givers})`);
  const gRow = card.locator(`[data-day-figures-row="${germany}"]`);
  check((await gRow.locator('[data-col="callsMade"]').innerText()).trim() === monthCalls && (await gRow.locator('[data-col="leadsReceived"]').innerText()).trim() === monthLeads, `holding the month's sums for the counsellor who answered (${monthCalls} calls, ${monthLeads} leads)`);
  check((await gRow.locator('[data-col="days"]').innerText()).trim() === days, `and the days answered (${days})`);
  const uRow = card.locator(`[data-day-figures-row="${uk}"]`);
  check((await uRow.locator('[data-col="none"]').innerText()).includes("Not recorded") && (await uRow.locator('[data-col="days"]').innerText()).trim() === "0", "a counsellor with no answered report reads Not recorded across, with 0 days");
  check((await card.locator(`a[href="/journal/report?month=${month}"]`).count()) >= 1, "and the card opens the month's reports");
  check(b.errors.length === 0, `the branch's figures draw without an error ${b.errors.slice(0, 2).join(" | ")}`);
  await b.ctx.close();

  // Leadership reads a strip per branch, only where a report has been answered this month.
  const l = await open("sreejith@miak.in");
  const strip = l.page.locator('[data-day-figures="branches"]');
  check((await strip.count()) === 1, "leadership's summary has the branches' figures for the month");
  const row = strip.locator(`[data-day-figures-branch="${kottayam}"]`);
  check((await row.count()) === 1, "with the branch that answered");
  check((await row.locator('[data-col="callsMade"]').innerText()).trim() === monthCalls && (await row.locator('[data-col="registrationsDone"]').innerText()).trim() === "1", `holding the month's sums (${monthCalls} calls, 1 registration)`);
  const withReports = n(`select count(distinct u.org_id) from daily_journals d join users u on u.id = d.user_id where d.day >= '${month}-01' and d.figures is not null and u.active`);
  check((await strip.locator("[data-day-figures-branch]").count()) === withReports, `and only the branches with a report this month (${withReports})`);
  check((await strip.locator(`a[href="/journal/report?month=${month}"]`).count()) >= 1, "each opening the reports");
  check(l.errors.length === 0, `the strip draws without an error ${l.errors.slice(0, 2).join(" | ")}`);
  await l.ctx.close();
}

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
