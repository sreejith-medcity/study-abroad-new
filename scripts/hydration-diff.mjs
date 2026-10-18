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
 * What the error actually is, found by patching React to describe it
 * (the recipe is at the bottom of this comment):
 *   - it is thrown from popHydrationState, as a parent finishes. The meaning
 *     is "there are server-rendered nodes left inside this element that the
 *     client never accounted for", not "this element is wrong"
 *   - the element it lands on is always the first container inside the page's
 *     own content: the inner div of PageHeader, or the inner div of the
 *     dashboard hero. The leftover node is that container's first child, the
 *     h1 or the eyebrow, so the client consumed none of its children
 *   - React reports it as an element difference, not a text one
 *
 * What has already been ruled out, so nobody repeats it:
 *   - the server's own HTML. Twenty-five fetches of /wallet gave one shape,
 *     byte for byte, and it is the right shape: main > div.mx-auto >
 *     div.mb-6 > div > h1 + p. The markup the browser is handed is correct
 *   - a development React. Swapping React's development client into a
 *     production build (not `next dev`: the same build, the same server, only
 *     the renderer changed) gave none in sixty-six loads, which also means
 *     the fuller message that build would print cannot be got this way
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
 * What it looks like. The client is fast enough to be hydrating while the
 * document is still arriving: slowing the client down in any way takes it to
 * nought, the processor throttled six times over, the slower development
 * renderer, and a quiet machine. Next wraps the page in a Suspense boundary
 * of its own (the `<div hidden><!--$--><!--\/$--></div>` at the top of every
 * body), and content that lands in that boundary is moved into place by a
 * script. A move that happens while React is walking the same parent is
 * exactly this error: nodes left over that the client never claimed. Nothing
 * in this application renders a Suspense boundary, so if that is it, it is
 * Next's streaming rather than a line here, and the thing to try is the
 * upgrade: 15.5.28 is a patch ahead of us on the backport line, and 16 is
 * current.
 *
 * How to make React say what it saw, which is the part worth keeping. Next
 * does not use the React in node_modules; it carries its own at
 * node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js.
 * Patching that one and rebuilding does work. In `throwOnHydrationMismatch`,
 * before the throw, print the fiber (walk `.return` for the path, `.child`
 * and `.sibling` for what the client rendered), `nextHydratableInstance` (the
 * first leftover server node) and `hydrationParentFiber.stateNode.childNodes`
 * (what is actually in the DOM). Keep the original file somewhere first, and
 * put it back afterwards: a patched React must never be committed or
 * deployed.
 *
 * Reproducing it at all is the hard part. It came out at about one load in
 * ten with four people signed in at once walking seven screens each, and then
 * would not come out again in four hundred loads of the same build on a
 * quieter machine. Budget for that before starting.
 *
 * Where to look next: the patched-React recipe above, held open long enough
 * to catch one on a page whose content streams in parts, with the boundary
 * script's timing logged beside it. Comparing HTML after the fact, which is
 * what this script does, cannot settle it: by the time it reads the DOM
 * React has repaired the mismatch, which is why every region reads "same".
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
