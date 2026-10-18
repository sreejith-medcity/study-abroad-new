/**
 * Where did the two renders disagree?
 *
 * React reports a hydration mismatch in production as error #418 and nothing
 * else: no element, no page, no diff. This takes the HTML the server sent and
 * the DOM the browser ended up with, and prints the first place they part
 * company, per region, so the error names something.
 *
 *   npm run build && npm start &
 *   EMAIL=someone@medcity.test PATHS="/wallet|/dashboard" ROUNDS=10 \
 *     node scripts/hydration-diff.mjs
 *
 * What it will not show you: a difference that is only the browser's own
 * normalising. React rewrites every form action to a javascript: throw,
 * lowercases attribute names such as noValidate, and decodes entities, so
 * those are filtered out below. A region reported as "same" really is the
 * same, and if React still threw, the mismatch is somewhere this does not
 * look: a hoisted style or script, or a boundary that re-rendered.
 *
 * What has already been ruled out, so nobody repeats it:
 *   - the shell's client components, removed one at a time, make no difference
 *   - a cold server start makes no difference: eight cold starts, none threw
 *   - plain navigation barely reproduces it: about one load in thirty
 *   - it is not a slow client losing a race with streamed content. Throttling
 *     the processor six times over did not raise the rate; it fell to nought
 *     in thirty loads
 *   - it does not happen in development at all. A whole suite that fails on it
 *     in a production build passes against `next dev` with nothing logged,
 *     which also means the non-minified message cannot be got that way
 *   - the server does shuffle its own script tags between identical renders of
 *     /students/board and /documentation, two of the pages that complain. That
 *     is real and worth knowing, but it is not this: the one error seen in
 *     fourteen loads landed on a page with the ordinary ordering
 *
 * Where to look next. It needs a production build and a session that posts
 * forms, so the usable instrumentation is probably a patched copy of React's
 * error so the offending node can be printed, rather than more comparing of
 * HTML after the fact: by the time this script reads the DOM, React has
 * already repaired the mismatch, which is why every region reads as "same".
 *
 * It is worth the effort. On a full suite run it is the single largest cause
 * of failure: eight suites fail on nothing else, and three more fail on it as
 * well as something real.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PATHS = (process.env.PATHS ?? "/dashboard").split("|");
const EMAIL = process.env.EMAIL ?? "sreejith@miak.in";
const PASSWORD = process.env.PASSWORD ?? "Password@123";
const ROUNDS = Number(process.env.ROUNDS ?? 6);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.251.0.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();

let serverHtml = "";
page.on("response", async (r) => {
  if (r.request().resourceType() === "document" && r.url().startsWith(BASE)) {
    try { serverHtml = await r.text(); } catch { /* a redirect has no body */ }
  }
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 30000 });

/** Everything the browser changes on its own, taken back out. */
const normalise = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/action="javascript:throw[\s\S]*?"/g, 'action=""')
    .replace(/\snovalidate=""/g, " noValidate=\"\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

let found = 0;
for (const path of PATHS) {
  for (let round = 0; round < ROUNDS; round++) {
    errors.length = 0;
    serverHtml = "";
    await page.goto(BASE + path, { waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(1500);
    if (!errors.length) continue;
    found++;
    console.log(`\n#### ${path} round ${round}: ${errors[0]}`);
    for (const tag of ["header", "aside", "main"]) {
      const live = await page.evaluate((t) => document.querySelector(t)?.innerHTML ?? "(none)", tag);
      const sent = serverHtml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      const a = normalise(sent ? sent[1] : "(none)");
      const b = normalise(live);
      if (a === b) { console.log(`  ${tag}: same`); continue; }
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.log(`  ${tag}: DIFFERS at ${i} of ${a.length}/${b.length}`);
      console.log("   SERVER:", JSON.stringify(a.slice(Math.max(0, i - 140), i + 240)));
      console.log("   CLIENT:", JSON.stringify(b.slice(Math.max(0, i - 140), i + 240)));
    }
    break;
  }
}
console.log(found ? `\n${found} page(s) complained` : "\nno hydration error seen");
await browser.close();
