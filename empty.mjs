import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run","--disable-background-networking"] });
const ctx = await b.newContext({ viewport: {width:1400,height:1000}, extraHTTPHeaders: { "x-forwarded-for": "10.95.1.1" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
p.on("response", (r) => { if (r.status() >= 500) errs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await p.goto(`${BASE}/login`);
await p.fill('input[name="email"]', "sreejith@miak.in");
await p.fill('input[name="password"]', "Password@123");
await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
for (const path of ["/dashboard","/students","/applications","/admin/queue","/admin/partners","/admin/insights","/admin/commission","/admin/audit","/admin/programs","/enquiries","/search","/learning","/settings","/settings/platform","/notifications"]) {
  await p.goto(BASE + path);
  await p.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(()=>{});
  await p.waitForTimeout(500);
  const t = (await p.locator("main").innerText().catch(() => "")).replace(/\s+/g," ").slice(0, 60);
  console.log(String(path).padEnd(20), "|", t);
}
console.log(errs.length ? "ERRORS: " + errs.join(" | ") : "no errors on any screen");
await b.close();
