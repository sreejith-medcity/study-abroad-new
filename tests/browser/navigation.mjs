// The side menu: how it is grouped, what it carries, and putting it away.
//
// The menu used to be five groups of eleven, ten, eleven, four and one, read
// by scanning every time, and it said nothing about what was waiting behind
// any of it. These checks hold the three things that changed.
import { chromium } from "playwright";
import { hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });

async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  if (page.url().includes("/login")) check(false, `sign-in for ${email} did not go through`);
  return { ctx, page };
}

const settle = (page) => hydrated(page).catch(() => {});

/* ---------------- Grouped so a group can be read ---------------- */

for (const [email, who, ip] of [["sreejith@miak.in", "the Overseas team", "10.80.1.1"], ["kottayam@medcity.test", "a branch", "10.80.1.2"]]) {
  const { ctx, page } = await signIn(email, ip);
  await page.goto(`${BASE}/dashboard`);
  await settle(page);

  // Every group and how many entries it holds.
  const sizes = await page.locator("aside nav > details").evaluateAll((els) =>
    els.map((e) => ({
      title: (e.querySelector("summary span")?.textContent ?? "").trim(),
      items: e.querySelectorAll("a, span[title]").length,
    })),
  );
  check(sizes.length >= 5, `${who}: the menu is in groups, ${sizes.length} of them`);
  // One group is allowed to be long: the screens that are set up once and
  // read twice a year, which is shut unless you are in it. Everything a
  // person works in has to be readable without scanning.
  const long = sizes.filter((g) => g.items > 5);
  check(
    long.length <= 1,
    `${who}: at most one long group, and it is the set-up one (${long.map((g) => `${g.title} ${g.items}`).join(", ") || "none are long"})`,
  );
  check(sizes.every((g) => g.items > 0), `${who}: no group is empty`);

  /* ---------------- What is waiting, on the menu ---------------- */

  // The portal's own number for the documentation queue, against the badge.
  if (email === "sreejith@miak.in") {
    const waiting = Number(sql("select count(distinct student_id) from checklist_items where state in ('UPLOADED','IN_REVIEW')"));
    // Its group is shut on arrival, so open it the way somebody would.
    await page.locator("aside nav details summary").filter({ hasText: "APPLICATIONS" }).click();
    await page.waitForTimeout(300);
    const badge = (await page.locator('aside nav a[href="/documentation"] span.tabular').textContent().catch(() => "")) ?? "";
    if (waiting > 0) {
      check(badge.trim() === String(waiting), `${who}: the documentation queue carries its count, "${badge.trim()}" against ${waiting}`);
    } else {
      check(badge === "", `${who}: nothing waiting means no badge at all, not a nought`);
    }
    await page.locator("aside nav details summary").filter({ hasText: "APPLICATIONS" }).click();
    await page.waitForTimeout(300);
  }

  // A badge somebody cannot act on is not worth a millisecond: a branch has
  // no business with the documentation desk's queue, so it is not counted.
  if (email === "kottayam@medcity.test") {
    check((await page.locator('aside nav a[href="/documentation"]').count()) === 0, `${who}: is not shown the desk's queue at all`);
  }

  /* ---------------- Stacked, and remembered ---------------- */

  const shape = () =>
    page.locator("aside nav details").evaluateAll((ds) =>
      ds.map((d) => ({
        title: (d.querySelector("summary span")?.textContent ?? "").trim(),
        open: d.open,
        badge: (d.querySelector("summary span.tabular")?.textContent ?? "").trim(),
      })),
    );

  const onDashboard = await shape();
  check(onDashboard.length >= 5, `${who}: every group folds, ${onDashboard.length} of them`);
  const openNow = onDashboard.filter((g) => g.open);
  check(openNow.length === 1, `${who}: one group open on arrival, the one you are in (${openNow.map((g) => g.title).join(", ")})`);
  check(openNow[0]?.title.toUpperCase() === "TODAY", `${who}: and it is Today, because the dashboard is in it`);

  // The whole point of a shut group: it still says what is behind it.
  const shutWithWork = onDashboard.find((g) => !g.open && g.badge);
  check(!!shutWithWork, `${who}: a shut group still says how much is waiting inside (${shutWithWork?.title} ${shutWithWork?.badge})`);

  // A menu that fits. Before this, every entry was on screen at once.
  const visible = await page.locator("aside nav a:visible").count();
  const all = await page.locator("aside nav a").count();
  check(visible < all / 2, `${who}: only the group you are in is showing, ${visible} of ${all}`);

  // Open another, go somewhere else, and find it as you left it.
  //
  // Deliberately not the group holding where we are about to go: that one
  // opens itself whether anything was remembered or not, so using it proves
  // nothing. Money is nowhere near the students list.
  const other = onDashboard.find((g) => !g.open && g.title.toUpperCase() === "MONEY");
  check(!!other, `${who}: there is a Money group to leave open`);
  await page.locator("aside nav details summary").filter({ hasText: other.title }).click();
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/students`);
  await settle(page);
  const after = await shape();
  const stillOpen = after.find((g) => g.title === other.title)?.open;
  check(stillOpen === true, `${who}: ${other.title} was left open, so it is still open on the next screen`);
  const here = after.find((g) => g.open && g.title.toUpperCase() === "STUDENTS");
  check(!!here, `${who}: and the group holding the page you are now on opened itself`);

  await page.goto(`${BASE}/dashboard`);
  await settle(page);

  /* ---------------- Putting it away ---------------- */

  const wide = await page.locator("aside[data-nav]").evaluate((e) => e.getBoundingClientRect().width);
  await page.getByRole("button", { name: /Put the menu away/ }).click();
  await page.waitForTimeout(400);
  const narrow = await page.locator("aside[data-nav]").evaluate((e) => e.getBoundingClientRect().width);
  check(narrow < wide / 2, `${who}: the menu puts away, ${Math.round(wide)} to ${Math.round(narrow)}`);
  check((await page.locator('aside nav a[aria-current="page"]').count()) === 1, `${who}: and still says where you are`);
  // The words are gone, so every icon has to say what it is some other way.
  const unlabelled = await page.locator("aside nav a").evaluateAll((as) => as.filter((a) => !a.getAttribute("title")).length);
  check(unlabelled === 0, `${who}: every icon on the rail names itself, ${unlabelled} do not`);

  // It is still put away on the next screen. The column is read from the
  // browser's own memory after the page is interactive and then slides to
  // width, so the measurement waits for it to stop moving rather than
  // catching it mid-slide.
  await page.goto(`${BASE}/students`);
  await settle(page);
  const widthNow = () => page.locator("aside[data-nav]").evaluate((e) => e.getBoundingClientRect().width);
  let stillNarrow = await widthNow();
  for (let t0 = Date.now(); Math.round(stillNarrow) !== Math.round(narrow) && Date.now() - t0 < 5000; ) {
    await page.waitForTimeout(100);
    stillNarrow = await widthNow();
  }
  check(Math.round(stillNarrow) === Math.round(narrow), `${who}: and stays away when you move about (${Math.round(stillNarrow)})`);

  /* ---------------- Peeking at it ---------------- */

  // Nineteen icons and no words, and the only way back to the words was to
  // find the arrow at the bottom and click it twice. Moving the pointer onto
  // the column opens it over the page instead.
  const mainLeft = await page.locator("main").evaluate((e) => e.getBoundingClientRect().left);
  const toggleShut = await page.locator("aside[data-nav] button").first().boundingBox();
  await page.mouse.move(32, 400);
  await page.waitForTimeout(500);
  const peeking = await page.locator("aside[data-nav]").evaluate((e) => ({
    column: e.getBoundingClientRect().width,
    panel: e.firstElementChild.getBoundingClientRect().width,
  }));
  check(peeking.panel > narrow * 2, `${who}: the pointer on the column opens the menu, ${Math.round(narrow)} to ${Math.round(peeking.panel)}`);
  check((await page.locator("aside[data-nav]").innerText()).includes("Students"), `${who}: and the words are back`);
  // The column itself must not move, or the page jumps every time a cursor
  // crosses the left edge on the way to something else.
  check(Math.round(peeking.column) === Math.round(narrow), `${who}: over the page rather than pushing it`);
  check(
    Math.round(await page.locator("main").evaluate((e) => e.getBoundingClientRect().left)) === Math.round(mainLeft),
    `${who}: so nothing underneath shifts`,
  );
  // The toggle must not move as the menu opens: it used to sit after the
  // list, and opening the menu put the folded groups back and slid it down
  // the screen, away from the pointer on its way to it.
  const toggleOpen = await page.locator("aside[data-nav] button").first().boundingBox();
  check(Math.abs(toggleOpen.y - toggleShut.y) < 2, `${who}: and the way to close it again has not moved`);
  await page.mouse.move(900, 500);
  await page.waitForTimeout(500);
  const shut = await page.locator("aside[data-nav]").evaluate((e) => e.firstElementChild.getBoundingClientRect().width);
  check(Math.round(shut) === Math.round(narrow), `${who}: and it puts itself away again`);

  await page.getByRole("button", { name: /Keep the menu open/ }).click();
  await page.waitForTimeout(400);
  const back = await page.locator("aside[data-nav]").evaluate((e) => e.getBoundingClientRect().width);
  check(Math.round(back) === Math.round(wide), `${who}: and comes back (${Math.round(back)} against ${Math.round(wide)})`);

  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
