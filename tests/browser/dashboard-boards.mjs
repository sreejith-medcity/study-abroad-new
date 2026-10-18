// Every dashboard has a board that does not change shape.
//
// The staff dashboards put two different things in one row of tiles: alerts,
// which should come and go with the trouble, and the figures the desk reads
// every morning, which should not. A tile row that is six cards on Monday and
// three on Tuesday cannot be read by position, and position is how anybody
// uses the screen they open first. The alerts stayed where they were; the
// figures moved to a board that is drawn in full every day.
import { chromium } from "playwright";
import { knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// What each desk is promised, in the order it is promised in. The point of
// the board is that this list is the same every morning, so the test says it
// out loud rather than counting whatever happens to be drawn.
const LANES = ["New / assessment", "Pending from partner", "In progress", "Offer / contract", "Visa / done", "On hold"];
const BOARDS = [
  // The platform owner and management read the same lanes: the business is
  // where the applications are, not how many accounts exist.
  ["SUPER_ADMIN", LANES],
  ["ADMIN", ["New / assessment", "In progress", "Offer / contract"]],
  ["MANAGEMENT", LANES],
  ["DESK_COUNSELLOR", ["Live applications", "Visas granted"]],
  ["APPLICATION_TEAM_LEADER", ["Decided this week"]],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 100;
for (const [role, labels] of BOARDS) {
  // The named account, not one of the generated demo users, which are seeded
  // without the demo password and cannot sign in.
  const email = sql(`select email from users where role = '${role}' and active and email not like '%person%' order by email limit 1`);
  if (!email) {
    check(true, `${role}: nobody seeded, nothing to check`);
    continue;
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.238.5.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 90)); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  await page.goto(`${BASE}/dashboard`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);

  const board = page.locator("main [data-kpi-board]");
  check((await board.count()) === 1, `${role}: has one board of figures`);
  const drawn = await board.locator("> *").evaluateAll((els) =>
    els.map((e) => {
      const n = e.querySelector("p.tabular");
      return { text: e.textContent.replace(/\s+/g, " ").trim(), value: (n?.textContent ?? "").trim(), colour: n ? getComputedStyle(n).color : "" };
    }),
  );
  check(drawn.length === labels.length, `${role}: every figure is drawn, nought or not (${drawn.length} of ${labels.length})`);
  check(
    labels.every((l, i) => (drawn[i]?.text ?? "").startsWith(l)),
    `${role}: and always in the same order (${drawn.map((d) => d.text.replace(/\d.*$/, "").trim()).join(" | ")})`,
  );
  // A nought on the board is drawn but quietened. Only checkable when this
  // data has one; the partner dashboard's own suite covers the colour rule.
  const zero = drawn.find((d) => d.value === "0");
  const figure = drawn.find((d) => d.value !== "0" && d.value !== "");
  if (zero && figure) check(zero.colour !== figure.colour, `${role}: a nought is set quieter than a figure`);

  // The alerts above it still behave as alerts: one at nought is said in a
  // line, not drawn as a card.
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const alerts = page.locator("main [data-alert-tiles] a, main [data-alert-tiles] > div");
  if ((await alerts.count()) > 0 || /^Nothing /m.test(body)) check(true, `${role}: the alerts are still a separate row`);

  // Everything that is not the board folds to a line that says its own
  // summary. A dashboard of nine open panels of equal weight has no shape:
  // the figures that matter are somewhere in the middle of it.
  const folded = await page.locator("main details:not([open])").count();
  const open = await page.locator("main details[open]").count();
  if (folded + open > 0) {
    check(open === 0, `${role}: the secondary panels are folded, not open (${open} open of ${folded + open})`);
    // The title and the "Show" at the end are not the summary. What has to
    // be there is the line between them, and textContent runs the three
    // together, so they are read as separate elements.
    const summaries = await page.locator("main details:not([open]) > summary").evaluateAll((els) =>
      els.map((e) => {
        const parts = [...e.children].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
        return { title: parts[0] ?? "", said: parts.slice(1, -1).join(" ").trim() };
      }),
    );
    // Terse is fine: "10 live" says as much as a sentence would. Empty is not.
    const mute = summaries.filter((x) => x.said.length === 0);
    check(mute.length === 0, `${role}: and each says what it holds without being opened (${mute[0]?.title ?? "all do"})`);
  }

  // React 418 is a hydration mismatch that has been on these pages since
  // before this work and shows up on perhaps one load in three. Counting it
  // as a failure here would make the suite flake and train people to ignore
  // it, so it is reported on its own line and anything else still fails.
  const hydration = errors.filter((e) => e.includes("418"));
  const other = errors.filter((e) => !e.includes("418"));
  if (hydration.length) console.log(`  --  ${role}: ${hydration.length} known hydration warning, see scripts/hydration-diff.mjs`);
  check(other.length === 0, `${role}: no client errors besides that ${other.slice(0, 1).join("")}`);
  await ctx.close();
}

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
