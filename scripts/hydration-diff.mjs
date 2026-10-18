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
 * What it is. The client renders the element with no children at all, while
 * the server rendered its content. Two caught in the act:
 *
 *   /wallet            the inner div of PageHeader
 *                      client children: none
 *                      in the DOM: the h1 "Wallet" and the subtitle
 *
 *   /settings/branch   the eyebrow div
 *                      client children: none
 *                      in the DOM: the text "Medcity Kochi · Branch head"
 *
 * Both times document.readyState was "interactive" when React threw: the
 * page was still arriving. So the title and the eyebrow, which are plain
 * strings passed down from a server component, reached the client empty,
 * and React rendered an empty element where the server had put the words.
 * The flight payload those strings travel in is pushed into the page as
 * inline scripts spread through the body, and React had started hydrating
 * before the ones carrying that part of the tree had run.
 *
 * That accounts for everything else seen here: it needs a fast client,
 * because a slow one loses the race the other way and has the whole payload
 * by the time it hydrates (the processor throttled six times over, the
 * development renderer, and a quiet machine all take it to nought); it is
 * always the first element inside the page's own content, which is the first
 * thing whose data comes from the later part of the stream; and the server's
 * HTML is right, because the server did its half properly.
 *
 * Which means it is Next's streaming hydration rather than a line in this
 * application, and there is nothing here to change. 15.5.28 was tried, a
 * full sweep of all 78 suites on it: no regression anywhere, and the warning
 * still there, which figures, since the React it carries is byte for byte
 * the one 15.5.27 carries.
 *
 * Next 16 was tried too, in a throwaway clone with its own database, and it
 * looks like the answer:
 *   - it builds with no change to a line of this application
 *   - twenty-seven suites run on it, among them all twelve that had shown
 *     the warning on 15.5.28, and the warning did not appear once
 *   - the probe below, eight rounds, did not turn it up either, where the
 *     same eight rounds on 15.5.27 turned it up twice
 *   - nothing failed an assertion
 *
 * What it does cost: two suites hang on page.waitForLoadState("networkidle"),
 * which never settles under 16. That idiom is used ninety-five times across
 * thirty-one suites and would have to go, which is no loss, since Playwright
 * has advised against it for years and every one of those waits is standing
 * in for something specific the suite could wait for instead. That is the
 * whole of the upgrade's cost as far as this has been taken; whether to pay
 * it is a decision about a major version, not about this warning.
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
 * Reproducing it: tests/browser/_hydstate.mjs, which is the billing suite
 * with the document's state recorded at the moment the warning fires. It
 * came out twice in eight runs. Comparing HTML after the fact, which is what
 * this script does, cannot settle anything: by the time it reads the DOM
 * React has repaired the mismatch, which is why every region reads "same".
 *
 * Until Next fixes it or we move to 16, the suites report it rather than
 * fail on it, which tests/browser/_errors.mjs explains and run-all counts.
 * STRICT_HYDRATION=1 puts the failures back.
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
