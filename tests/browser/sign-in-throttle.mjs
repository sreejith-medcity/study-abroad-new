// Signing in, over and over.
//
// The limit on the sign-in page is there to stop somebody guessing a password.
// It used to count every attempt, right or wrong, so a branch that shares one
// account between its counsellors was locked out of the portal for ten minutes
// on the ninth sign-in of the morning, and so was anybody on a connection bad
// enough to make them sign in again a few times.
//
// What this checks: the right password, many times over, always works; the
// wrong password, eight times, blocks the account; and one right password
// before that clears the count.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// The last counsellor by email rather than the first, because the first is
// the one most of the other suites sign in as, and this one deliberately
// leaves the account blocked at the end.
const email = sql("select email from users where role = 'COUNSELLOR' and active and not must_change_password order by email desc limit 1");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });

/** One sign-in from its own fresh browser, so nothing is carried over. */
async function attempt(password, ip) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 15000 }).catch(() => {});
  const inside = !page.url().includes("/login");
  const said = inside ? "" : await page.locator("main").innerText().catch(() => "");
  await ctx.close();
  return { inside, said };
}

// Each part uses its own caller address, because the limit counts callers too
// and this is about the per-account one.
const RIGHT = "Password@123";

// Twelve good sign-ins in a row. Under the old rule the ninth was refused.
let refused = 0;
for (let i = 0; i < 12; i++) {
  const r = await attempt(RIGHT, "10.90.0.1");
  if (!r.inside) refused++;
}
check(refused === 0, `twelve correct sign-ins all go through, ${refused} were refused`);

// Seven wrong, then a right one, then seven wrong again: the right one in the
// middle clears the count, so the account is never blocked.
for (let i = 0; i < 7; i++) await attempt("Wrong@12345", "10.90.0.2");
const afterSeven = await attempt(RIGHT, "10.90.0.2");
check(afterSeven.inside, "seven wrong tries do not block the account");
for (let i = 0; i < 7; i++) await attempt("Wrong@12345", "10.90.0.3");
const cleared = await attempt(RIGHT, "10.90.0.3");
check(cleared.inside, "a correct sign-in clears the run of wrong ones");

// And the limit still bites: enough wrong tries in a row and the account is held.
let blocked = false;
for (let i = 0; i < 10 && !blocked; i++) {
  const r = await attempt("Wrong@12345", "10.90.0.4");
  // The exact words the login page uses, not a loose match: the page
  // copy itself contains "try again" and the loop used to stop on the
  // first wrong password and then test nothing.
  if (!r.inside && /Too many attempts/.test(r.said)) blocked = true;
}
check(blocked, "enough wrong passwords in a row still blocks the account");
// Blocked means blocked, even with the right password.
const nowRight = await attempt(RIGHT, "10.90.0.5");
check(!nowRight.inside && /Too many attempts/.test(nowRight.said), "and the right password is refused while it is blocked");

await browser.close();
// Said out loud, because it is left that way on purpose and the next suite to
// use this account would otherwise fail for no reason anybody could see.
console.log(`\n${email} is now blocked for ten minutes. The block is held in the server's memory, so restarting it clears the block.`);
console.log(fails.length ? `${fails.length} failed` : "all passed");
process.exit(fails.length ? 1 : 0);
