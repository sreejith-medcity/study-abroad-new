// The side menu: how it is grouped, what it carries, and putting it away.
//
// The menu used to be five groups of eleven, ten, eleven, four and one, read
// by scanning every time, and it said nothing about what was waiting behind
// any of it. These checks hold the three things that changed.
import { chromium } from "playwright";
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

const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});

/* ---------------- Grouped so a group can be read ---------------- */

for (const [email, who, ip] of [["sreejith@miak.in", "the Overseas team", "10.80.1.1"], ["kottayam@medcity.test", "a branch", "10.80.1.2"]]) {
  const { ctx, page } = await signIn(email, ip);
  await page.goto(`${BASE}/dashboard`);
  await settle(page);

  // Every group, folded or not, and how many entries it holds.
  const sizes = await page.locator("aside nav > div, aside nav > details").evaluateAll((els) =>
    els.map((e) => ({
      title: (e.querySelector("p, summary")?.textContent ?? "").trim(),
      items: e.querySelectorAll("a, span[title]").length,
      folded: e.tagName === "DETAILS",
    })),
  );
  const working = sizes.filter((g) => !g.folded);
  const longest = Math.max(...working.map((g) => g.items));
  check(longest <= 5, `${who}: no working group is longer than five, longest is ${longest} (${working.find((g) => g.items === longest)?.title})`);
  check(sizes.length >= 5, `${who}: the menu is in groups, ${sizes.length} of them`);
  check(sizes.some((g) => g.folded), `${who}: the screens set up once are folded away`);

  /* ---------------- What is waiting, on the menu ---------------- */

  // The portal's own number for the documentation queue, against the badge.
  if (email === "sreejith@miak.in") {
    const waiting = Number(sql("select count(*) from checklist_items where state in ('UPLOADED','IN_REVIEW')"));
    const badge = await page.locator('aside nav a[href="/documentation"] span.tabular').innerText().catch(() => "");
    if (waiting > 0) {
      check(badge === String(waiting), `${who}: the documentation queue carries its count, ${badge} against ${waiting}`);
    } else {
      check(badge === "", `${who}: nothing waiting means no badge at all, not a nought`);
    }
  }

  // A badge somebody cannot act on is not worth a millisecond: a branch has
  // no business with the documentation desk's queue, so it is not counted.
  if (email === "kottayam@medcity.test") {
    check((await page.locator('aside nav a[href="/documentation"]').count()) === 0, `${who}: is not shown the desk's queue at all`);
  }

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

  // It is still put away on the next screen.
  await page.goto(`${BASE}/students`);
  await settle(page);
  const stillNarrow = await page.locator("aside[data-nav]").evaluate((e) => e.getBoundingClientRect().width);
  check(Math.round(stillNarrow) === Math.round(narrow), `${who}: and stays away when you move about`);

  await page.getByRole("button", { name: /Show the menu/ }).click();
  await page.waitForTimeout(400);
  const back = await page.locator("aside[data-nav]").evaluate((e) => e.getBoundingClientRect().width);
  check(Math.round(back) === Math.round(wide), `${who}: and comes back`);

  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
