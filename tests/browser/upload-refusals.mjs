// What happens when the answer to an upload is not the app's.
//
// In production something sits in front of the app, and a file is the one
// thing big enough for it to refuse on its own. A counsellor hit exactly that
// and got "This screen stopped working / An unexpected response was received
// from the server", because a server action cannot read an answer it did not
// write. The upload is posted to a route now, so every one of these has to
// come back as a sentence under the form with the screen still alive.
//
// The suite stands up its own front end on 3101 to do the refusing.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";

const APP = "http://localhost:3000";
const FRONT = "http://localhost:3101";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// The stand-in front end. "limit" refuses a body over 2 MB the way nginx and
// LiteSpeed do, with an HTML page. "down" answers every upload with a 502.
let mode = "limit";
const front = http.createServer((req, res) => {
  const len = Number(req.headers["content-length"] || 0);
  const upload = (req.url || "").startsWith("/api/uploads/");
  if (upload && mode === "down") {
    req.resume();
    res.writeHead(502, { "content-type": "text/html" });
    res.end("<html><body><h1>502 Bad Gateway</h1></body></html>");
    return;
  }
  if (mode === "limit" && len > 2 * 1024 * 1024) {
    req.resume();
    res.writeHead(413, { "content-type": "text/html" });
    res.end("<html><body><h1>413 Request Entity Too Large</h1></body></html>");
    return;
  }
  const up = http.request({ host: "127.0.0.1", port: 3000, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502, { "content-type": "text/html" }); res.end("<html><body>502</body></html>"); });
  req.pipe(up);
});
await new Promise((done) => front.listen(3101, done));

const email = sql("select email from users where role = 'DOCUMENTATION' and active limit 1") || sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
const studentId = sql("select id from students where not archived limit 1");
const pdf = (mbSize) => {
  const buf = Buffer.alloc(Math.round(mbSize * 1024 * 1024), 0x20);
  buf.write("%PDF-1.4\n", 0);
  return buf;
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.254.7.2" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(FRONT) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${FRONT}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

async function upload(name, buffer) {
  await page.goto(`${FRONT}/students/${studentId}/documents`);
  const form = page.locator("form", { has: page.locator('input[type="file"][name="file"]') }).first();
  const picker = form.locator('select[name="typeCode"]');
  if (await picker.count()) await picker.selectOption({ index: 1 });
  await form.locator('input[type="file"][name="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer });
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(3500);
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

// 1. The front end refuses an oversize body.
const before = Number(sql(`select count(*) from documents where student_id = '${studentId}'`));
let said = await upload("refused.pdf", pdf(3));
check(!/screen stopped working/i.test(said), "a refusal from in front of the app does not kill the screen");
check(/refused the file because it is too large/.test(said), "it says the server refused it for being too large");
check(/3\.0 MB/.test(said), "and says how big the file was");
check(Number(sql(`select count(*) from documents where student_id = '${studentId}'`)) === before, "nothing was saved");

// 2. The app is not answering at all.
mode = "down";
said = await upload("gateway.pdf", pdf(0.2));
check(!/screen stopped working/i.test(said), "a bad gateway does not kill the screen either");
check(/not taking uploads just then/.test(said), "it says the server was not taking uploads");
check(Number(sql(`select count(*) from documents where student_id = '${studentId}'`)) === before, "still nothing saved");

// 3. And with nothing in the way, the file goes up.
mode = "limit";
said = await upload("fine.pdf", pdf(0.2));
check(!/screen stopped working/i.test(said), "a good upload does not kill the screen");
check(Number(sql(`select count(*) from documents where student_id = '${studentId}'`)) === before + 1, "the file is on the student's file");
check(/fine\.pdf|uploaded/i.test(said), "and the screen shows it");

// 4. And the same for a student on a phone, which is where a photographed
// passport meets a size limit most often.
mode = "limit";
const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.254.7.3" } });
await sctx.route("**/*", (r) => (r.request().url().startsWith(FRONT) ? r.continue() : r.abort()));
const phone = await sctx.newPage();
await phone.goto(`${FRONT}/login`);
await phone.fill('input[name="email"]', "fathima.rahman@example.com");
await phone.fill('input[name="password"]', "Password@123");
await phone.click('button[type="submit"]');
await phone.waitForURL(/\/portal/, { timeout: 20000 }).catch(() => {});
await phone.goto(`${FRONT}/portal/documents`);
await phone.waitForTimeout(600);
const pickers = phone.locator('input[type="file"]');
if (await pickers.count()) {
  const pform = phone.locator("form", { has: pickers.first() }).first();
  await pform.locator('input[type="file"]').setInputFiles({ name: "passport.jpg", mimeType: "image/jpeg", buffer: pdf(3) });
  await pform.locator('button[type="submit"]').click();
  await phone.waitForTimeout(3500);
  const seen = (await phone.locator("body").innerText()).replace(/\s+/g, " ");
  check(!/screen stopped working/i.test(seen), "a student's oversize photo does not kill the portal");
  check(/refused the file because it is too large/.test(seen), "the student is told the server refused it for its size");
} else {
  console.log("  --  nothing outstanding to upload in the portal, skipped");
}

await browser.close();
front.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
