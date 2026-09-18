// The catalogue at real size: paging, an honest count, a bulk publish that acts
// on every match rather than the visible page, and the work rights column.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-catalogue";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function signIn(email, ip, password = "Password@123") {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const countOf = (text) => Number((text.match(/([\d,]+) match/) || [])[1]?.replace(/,/g, "") ?? -1);
// Paging is a client-side transition, so there is no load event to wait on.
// Waiting for the range line to actually change is both simpler and truer to
// what a person sees.
const rangeLine = async () => ((await page.locator("main").innerText()).match(/Showing[^\n]*/) || [""])[0];
async function waitForRange(previous, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const now = await rangeLine();
    if (now && now !== previous) return now;
    await page.waitForTimeout(250);
  }
  return null;
}

const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.60.1.11");

// ---- The count is the whole match, not the page ----
await page.goto(`${BASE}/admin/programs`);
await settle(page);
let t = await page.locator("main").innerText();
const total = countOf(t);
total > 300
  ? ok(`the header counts every match (${total}), not a capped page`)
  : bad(`expected more than 300 matches, header said ${total}`);
const firstPageRows = await page.locator("main tbody tr").count();
firstPageRows > 0 && firstPageRows < total
  ? ok(`the page shows ${firstPageRows} of them`)
  : bad(`page showed ${firstPageRows} rows against a total of ${total}`);
/Showing 1 to/.test(t) ? ok("it says which slice is on screen") : bad("no range shown");
await page.screenshot({ path: `${OUT}/01-page-1.png`, fullPage: true });

// ---- Paging reaches rows the first page cannot ----
// Compared on the whole row: a programme name like "Master of Information
// Technology" is shared by several universities, so the name alone proves nothing.
const rowText = async () => (await page.locator("main tbody tr").first().innerText()).replace(/\s+/g, " ").trim();
const firstRowOnPage1 = await rowText();
const rangeOnPage1 = await rangeLine();
await page.getByRole("link", { name: "Next" }).click();
const rangeOnPage2 = await waitForRange(rangeOnPage1);
firstRowOnPage1 !== (await rowText()) ? ok("Next moves to different rows") : bad("Next showed the same rows");
/Showing 51 to/.test(rangeOnPage2 ?? "") ? ok("the range advances") : bad(`the range did not advance, saw ${rangeOnPage2}`);
await page.getByRole("link", { name: "Previous" }).click();
await waitForRange(rangeOnPage2);
await settle(page);
await page.waitForTimeout(1200);
const backAgain = await rowText();
backAgain === firstRowOnPage1
  ? ok("Previous comes back")
  : bad(`Previous landed elsewhere: "${backAgain.slice(0, 60)}" vs "${firstRowOnPage1.slice(0, 60)}"`);

// ---- Deep pages still render ----
const lastPage = Math.ceil(total / 50);
await page.goto(`${BASE}/admin/programs?page=${lastPage}`);
await settle(page);
(await page.locator("main tbody tr").count()) > 0
  ? ok(`the last page (${lastPage}) has rows on it`)
  : bad(`page ${lastPage} came back empty`);

// ---- Filtering resets to page one rather than stranding the user ----
await page.goto(`${BASE}/admin/programs?page=${lastPage}`);
await settle(page);
await page.locator('select[name="country"]').selectOption("DE");
await page.getByRole("button", { name: "Filter" }).click();
await page.waitForURL(/country=DE/, { timeout: 15000, waitUntil: "commit" }).catch(() => {});
await settle(page);
await page.waitForTimeout(1500);
t = await page.locator("main").innerText();
const german = countOf(t);
german > 0 && (await page.locator("main tbody tr").count()) > 0
  ? ok(`filtering from a deep page lands on results (${german} German)`)
  : bad("filtering from a deep page came back empty");

// ---- Bulk publish acts on every match, not the visible page ----
await page.goto(`${BASE}/admin/programs?country=DE&status=DRAFT`);
await settle(page);
t = await page.locator("main").innerText();
const drafts = countOf(t);
if (drafts <= 50) {
  bad(`test needs more than one page of German drafts, found ${drafts}`);
} else {
  /All \d+ matching/.test(t) ? ok("the bulk control says it acts on every match") : bad("the bulk label still talks about the page");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForTimeout(8000);
  await page.goto(`${BASE}/admin/programs?country=DE&status=DRAFT`);
  await settle(page);
  const left = countOf(await page.locator("main").innerText());
  left === 0 || left === -1
    ? ok(`publishing cleared all ${drafts} German drafts in one go`)
    : bad(`${left} German drafts survived a bulk publish of ${drafts}`);
}
await page.screenshot({ path: `${OUT}/02-after-publish.png`, fullPage: true });

// ---- Work rights ----
await page.goto(`${BASE}/admin/programs?q=Georgian`);
await settle(page);
t = await page.locator("main").innerText();
/No work rights/i.test(t) ? ok("an ineligible programme is marked on the admin list") : bad("no work rights warning on the admin list");

// Search only ever shows live rows, so the rest of the catalogue has to be
// published before the search assertions mean anything. This doubles as the
// full-size run of the bulk control: every remaining draft, in one action.
await page.goto(`${BASE}/admin/programs?status=DRAFT`);
await settle(page);
const remaining = countOf(await page.locator("main").innerText());
if (remaining > 0) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForTimeout(12000);
  await page.goto(`${BASE}/admin/programs?status=DRAFT`);
  await settle(page);
  const stillDraft = countOf(await page.locator("main").innerText());
  stillDraft <= 0
    ? ok(`one action published all ${remaining} remaining drafts`)
    : bad(`${stillDraft} of ${remaining} drafts survived`);
}

await page.goto(`${BASE}/search?workRights=1`);
await settle(page);
// Counted from the rows themselves: the quick-filter chip is also labelled
// "Post-study work", so matching the page text would pass with no results at all.
const rowsShown = await page.locator("main tbody tr").count();
rowsShown > 0 ? ok(`the post-study work filter returns ${rowsShown} programmes`) : bad("the work rights filter returned nothing");
const badges = await page.locator("main tbody tr", { hasText: /Post-study work/i }).count();
badges === rowsShown && rowsShown > 0
  ? ok("every result under that filter carries the badge, never an unknown")
  : bad(`${rowsShown - badges} of ${rowsShown} results are not confirmed`);

// And the unfiltered catalogue is far larger, so the filter is really filtering.
await page.goto(`${BASE}/search`);
await settle(page);
const allRows = await page.locator("main tbody tr").count();
const total2 = Number(((await page.locator("body").innerText()).match(/([\d,]+) live program/) || [])[1]?.replace(/,/g, "") ?? -1);
total2 > rowsShown ? ok(`unfiltered search holds ${total2} live programmes`) : bad(`unfiltered search showed ${total2}`);
allRows > 0 ? ok("search renders rows at full catalogue size") : bad("search rendered no rows");
await page.screenshot({ path: `${OUT}/03-work-rights.png`, fullPage: true });

// A partner sees the same warning, since they are the ones advising the student.
await ctx.close();
{
  const { ctx: pctx, page: ppage } = await signIn("kottayam@medcity.test", "10.60.1.21");
  await ppage.goto(`${BASE}/search?q=Georgian`);
  await settle(ppage);
  const warned = await ppage.locator("main tbody tr", { hasText: /No post-study work/i }).count();
  warned > 0 ? ok(`a partner sees the warning on ${warned} rows too`) : bad("the partner view hides the warning");
  await pctx.close();
}

errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors");
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall catalogue checks passed");
process.exit(fails.length ? 1 : 0);
