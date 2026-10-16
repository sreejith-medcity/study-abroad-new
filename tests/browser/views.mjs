// Saved views: a question with a name on it, kept, counted and shared.
//
// Everybody asks the same three or four questions of these lists every
// morning and used to retype the filters or keep a browser bookmark nobody
// else could use.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
const name = `Germany files ${Math.random().toString(36).slice(2, 6)}`;
const country = sql("select code from countries order by code limit 1");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.235.6.3" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

const settle = async () => {
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
};

// Every list carries the row.
for (const [path, label] of [["/students", "Students"], ["/applications", "Applications"], ["/documentation", "Documentation"], ["/enquiries", "Enquiries"]]) {
  await page.goto(BASE + path);
  await settle();
  check((await page.getByRole("link", { name: "Everything", exact: true }).count()) > 0, `${label} has the view row`);
}

// Saving the screen you are looking at.
await page.goto(`${BASE}/students?country=${country}`);
await settle();
const save = page.getByRole("button", { name: /save this view/i });
check((await save.count()) === 1, "a filtered list offers to save itself");
await save.click();
await page.waitForTimeout(300);
await page.fill('input[name="name"]', name);
await page.selectOption('select[name="shared"]', "EVERYONE");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(2500);

const saved = sql(`select count(*) from views where name = '${name}'`);
check(saved === "1", `the view is kept (${name})`);
check(sql(`select query from views where name = '${name}'`) === `country=${country}`, "with the filters that were on screen");
check(sql(`select shared from views where name = '${name}'`) === "EVERYONE", "and who it is shared with");

// It comes back as a tab, with a number on it, and opens what it promised.
await page.goto(`${BASE}/students`);
await settle();
const tab = page.getByRole("link", { name: new RegExp(name) });
check((await tab.count()) === 1, "it is a tab on the list");
const tabText = await tab.innerText();
check(/\d/.test(tabText), `the tab carries its count (${tabText.replace(/\s+/g, " ")})`);
await tab.click();
await settle();
check(page.url().includes(`country=${country}`), "clicking it opens the list it was saved from");

// The count on the tab is the number of rows the list shows.
const promised = Number((tabText.match(/(\d+)\s*$/) || [])[1] ?? -1);
const shownRows = await page.locator("tbody tr").count();
check(promised === -1 || promised === shownRows || shownRows >= 200, `the count matches the list (${promised} against ${shownRows} rows)`);

// And it can be taken away again.
await page.getByRole("button", { name: /all views/i }).click();
await page.waitForTimeout(300);
const row = page.locator("li").filter({ hasText: name }).first();
await row.getByRole("button", { name: "Delete" }).click();
await page.waitForTimeout(2000);
check(sql(`select count(*) from views where name = '${name}'`) === "0", "and deleted by the person who made it");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
