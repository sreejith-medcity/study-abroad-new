// Three things shipped together: the appearance options, the filter bar and
// the dashboard kit.
//
// Each check is written so that it fails if the thing it names is not there.
// The skin checks read the computed background of a card, because a skin that
// is saved but not painted is the failure worth catching: the setting page
// would look right either way.
import { chromium } from "playwright";
import { hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
// Whatever the run started on, so a failed run does not leave somebody on a
// surface they did not pick.
const before = sql(`select skin from users where email = '${email}'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.235.6.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

const settle = () => hydrated(page).catch(() => {});
// Outside the repository, like every other suite: nothing under tests/ is
// git-ignored, and a screenshot is not source.
const shots = "/tmp/smoke-appearance";
fs.mkdirSync(shots, { recursive: true });

/* ---------------- Appearance ---------------- */

await page.goto(`${BASE}/settings`);
await settle();
// Named rather than counted: the menu's put-away toggle carries
// aria-pressed too, and so does the reading-size picker that sits under
// this one, and counting them all made this suite fail for reasons that
// had nothing to do with appearance.
const surfaces = page.locator('[data-testid="skin-swatch"]');
check((await surfaces.count()) === 3, `Settings offers three surfaces, found ${await surfaces.count()}`);

const skinOf = () => page.evaluate(() => document.documentElement.getAttribute("data-skin"));
// The card background, as the browser actually paints it.
const cardBg = () =>
  page.evaluate(() => {
    const el = document.querySelector(".shadow-card");
    return el ? getComputedStyle(el).backgroundColor : null;
  });

for (const [i, want] of [[1, "glass"], [2, "night"], [0, "soft"]]) {
  await page.goto(`${BASE}/settings`);
  await settle();
  await page.locator('[data-testid="skin-swatch"]').nth(i).click();
  await page.waitForFunction((w) => document.documentElement.getAttribute("data-skin") === w, want, { timeout: 10000 }).catch(() => {});
  check((await skinOf()) === want, `Picking ${want} paints the page in it`);
  check(sql(`select skin from users where email = '${email}'`) === want, `Picking ${want} is remembered`);

  await page.goto(`${BASE}/dashboard`);
  await settle();
  const bg = await cardBg();
  if (want === "glass") {
    // Translucent and light, whatever the exact value is tuned to: the
    // point is that the field behind the card arrives through it.
    const alpha = Number((bg ?? "").match(/rgba\(255, 255, 255, ([\d.]+)\)/)?.[1] ?? 1);
    check(alpha > 0 && alpha < 0.75, `A card is translucent under glass, not ${bg}`);
  }
  if (want === "night") check(bg === "rgb(25, 18, 32)", `A card is dark under night, not ${bg}`);
  if (want === "soft") check(bg === "rgb(255, 255, 255)", `A card is white under soft, not ${bg}`);
  await page.screenshot({ path: `${shots}/dashboard-${want}.png`, fullPage: false });
}

/* ---------------- The filter bar ---------------- */

await page.goto(`${BASE}/students`);
await settle();
check(await page.getByText(/More filters \(\d\)/).count() === 1, "The students list folds its less used filters");
check(await page.locator("text=filters on").count() === 0, "Nothing says filters are on before any are");

// Pick the first real pathway and watch the list reload on the change alone,
// with no Apply button pressed.
await page.selectOption('select[aria-label="Pathway"]', "AUSBILDUNG");
await page.waitForURL(/pathway=AUSBILDUNG/, { timeout: 10000 });
check(true, "Choosing a filter applies it without an Apply button");
const chip = page.getByRole("button", { name: /Remove the pathway filter/i });
check((await chip.count()) === 1, "The filter that is on shows as a chip");
check((await page.locator("text=/1 filter on/").count()) === 1, "The bar says how many filters are on");
await page.screenshot({ path: `${shots}/students-filtered.png` });

await chip.click();
await page.waitForURL((u) => !String(u).includes("pathway="), { timeout: 10000 });
check(true, "Taking the chip off takes the filter off");

// Clear all leaves where-you-are alone.
await page.goto(`${BASE}/students?view=archived&pathway=DEGREE`);
await settle();
await page.getByRole("button", { name: /^Clear/ }).click();
await page.waitForURL((u) => !String(u).includes("pathway="), { timeout: 10000 });
check(page.url().includes("view=archived"), "Clearing the filters stays in the archive you were looking at");

// The queue keeps its mode when the filters are cleared.
await page.goto(`${BASE}/documentation?mine=1&stage=OFFER`);
await settle();
if (await page.getByRole("button", { name: /^Clear/ }).count()) {
  await page.getByRole("button", { name: /^Clear/ }).click();
  await page.waitForURL((u) => !String(u).includes("stage="), { timeout: 10000 });
  check(page.url().includes("mine=1"), "Clearing the queue's filters keeps you on your own files");
}

/* ---------------- The dashboard kit ---------------- */

await page.goto(`${BASE}/dashboard`);
await settle();
// The dashboard is a board of figures and nothing else. Every tile is drawn
// every day, nought or not, so it can be read by position; what a nought
// does instead of disappearing is go quiet.
const tiles = page.locator("main [data-stat-tiles] > *");
check((await tiles.count()) >= 10, `The board carries its figures (${await tiles.count()})`);
const sizes = await page.locator("main [data-stat-tiles] [data-figure]").evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize));
check(sizes.every((s) => parseFloat(s) >= 22), `Figures are set large, got ${[...new Set(sizes)].join(", ")}`);
const shades = await page.locator("main [data-stat-tiles] [data-figure]").evaluateAll((els) =>
  els.map((e) => ({ nought: (e.textContent ?? "").trim() === "0", colour: getComputedStyle(e).color })),
);
const quiet = new Set(shades.filter((x) => x.nought).map((x) => x.colour));
const loud = new Set(shades.filter((x) => !x.nought).map((x) => x.colour));
check([...quiet].every((c) => !loud.has(c)), `A nought is set quieter than a figure (${[...quiet].join(", ") || "none on this data"})`);
await page.screenshot({ path: `${shots}/dashboard-kit.png` });

/* ---------------- Reading size ---------------- */

// The same shape as the surface above it: four samples, picking one saves,
// and what it moves is the document's own font size, which every size in
// the portal is a multiple of.
const wasSize = sql(`select text_size from users where email = '${email}'`);
await page.goto(`${BASE}/settings`);
await settle();
const sizeCards = page.locator('[data-testid="size-swatch"]');
check((await sizeCards.count()) === 4, `Settings offers four reading sizes, found ${await sizeCards.count()}`);
const rootPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
const normalPx = await rootPx();
check(normalPx === 16, `The everyday size is sixteen pixels, got ${normalPx}`);

await page.getByLabel("Large", { exact: true }).click();
await page.waitForFunction(() => document.documentElement.dataset.text === "large", null, { timeout: 10000 }).catch(() => {});
check(sql(`select text_size from users where email = '${email}'`) === "large", "Picking a size is remembered");
const largePx = await rootPx();
check(largePx > normalPx, `Large is larger, ${normalPx} to ${largePx}`);

// It follows the person rather than the page they were on.
await page.goto(`${BASE}/students`);
await settle();
check((await rootPx()) === largePx, "and it holds on the next screen");
// The widest list in the portal still fits its card at the everyday size,
// and scrolls rather than spilling when it does not.
const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(spill === 0, `The page does not spill sideways at the larger size, over by ${spill}`);

await page.goto(`${BASE}/settings`);
await settle();
await page.getByLabel("Compact", { exact: true }).click();
await page.waitForFunction(() => document.documentElement.dataset.text === "compact", null, { timeout: 10000 }).catch(() => {});
check((await rootPx()) < normalPx, "Compact is smaller again");
sql(`update users set text_size = '${wasSize}' where email = '${email}'`);

sql(`update users set skin = '${before}' where email = '${email}'`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
