// Clicking a notification lands on the thing it is about.
//
// Written after every click landed on "https://0.0.0.0:3000/..." and the
// browser refused to go there at all. The route marked the notice read and
// then redirected to an address it built out of the server's own request
// URL, which is the address the server is bound to rather than the one the
// person is reading the portal under. Behind a proxy those are never the
// same, and on a machine bound to 0.0.0.0 the second one is not an address
// a browser can go to.
//
// So this checks the two things that were wrong: that the address sent back
// is relative, and that following it from the portal's own address arrives
// somewhere real. It also presses the link the way a person does, because a
// redirect that is right in a header and wrong in a browser is still wrong.
// Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const email = "kottayam@medcity.test";
const userId = sql(`select id from users where email = '${email}'`);
// A notice of its own, so this does not depend on what the seed happens to
// have left unread.
const target = "/applications?group=PENDING_PARTNER";
const id = sql(`
  insert into notifications (id, user_id, title, body, href)
  values ('ntfy-link-test', '${userId}', 'A test notice', 'Written by the notification-links suite', '${target}')
  on conflict (id) do update set read_at = null, href = excluded.href
  returning id`);
check(id === "ntfy-link-test", "a notice to click on");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.201.4.1" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.locator("aside[data-nav]").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});

// --- The address it sends back.
//
// Asked for under a name the server is not bound to, which is what a proxy
// does on every request. What comes back must not name a host at all.
const res = await page.request.get(`${BASE}/notifications/${id}`, {
  headers: { host: "doc.medcityoverseas.com", "x-forwarded-proto": "https" },
  maxRedirects: 0,
});
const location = res.headers()["location"] ?? "";
check(res.status() >= 300 && res.status() < 400, `the click redirects (${res.status()})`);
check(location.startsWith("/"), `and sends back a relative address, not one with a host in it (${location})`);
check(!/0\.0\.0\.0|localhost|:3000/.test(location), `with nothing of the server's own address in it (${location})`);
check(location === target, `pointing at what the notice is about (${location})`);

// --- Following it, the way a person does.
sql(`update notifications set read_at = null where id = '${id}'`);
await page.goto(`${BASE}/notifications`);
await hydrated(page);
// Scoped to the screen: the bell in the header holds the same notice, and
// that list is shut until somebody opens it.
const link = page.locator(`main a[href="/notifications/${id}"]`).first();
check((await link.count()) > 0, "the notice is on the notifications screen");
await link.click();
// Waited for by where it should arrive. "Anywhere but here" is satisfied by
// the screen it is leaving, since /notifications is not /notifications/.
await page.waitForURL(/\/applications/, { timeout: 15000 }).catch(() => {});
const landed = page.url().replace(BASE, "");
check(landed.startsWith("/applications"), `clicking it arrives on the applications screen (${landed})`);
check(!/could not be found|isn.t open to your role/i.test(await page.locator("body").innerText()), "and the screen is the real one, not a refusal");
check(sql(`select read_at is not null from notifications where id = '${id}'`) === "t", "and the notice is marked read");

// --- A notice can only send somebody inside the portal.
//
// A path starting with two slashes is another site's address written without
// its scheme, and reads as a path to anything checking only the first one.
for (const [href, what] of [["//example.com/", "an address on another site"], ["https://example.com/", "a whole other address"], ["/\\\\example.com", "a backslash, which some browsers read as a slash"]]) {
  sql(`update notifications set href = '${href}', read_at = null where id = '${id}'`);
  const r = await page.request.get(`${BASE}/notifications/${id}`, { maxRedirects: 0 });
  const where = r.headers()["location"] ?? "";
  check(where === "/notifications", `${what} is refused, and it goes to the notifications screen instead (${where})`);
}

sql(`delete from notifications where id = '${id}'`);
check(errors.length === 0, `no page errors or 500s ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
