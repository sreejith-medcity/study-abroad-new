// AI features: off without a key, the owner's settings, the assistant with its
// catalogue tool, a practice interview that never sends the student's name,
// reading a passport into the profile only after a person checks it, the
// monthly allowance and the switch. Wants the plain seed and the server
// started with ANTHROPIC_API_BASE=http://localhost:4011.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const OUT = "/tmp/smoke-ai";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${String(e).slice(0, 80)}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const main = (page) => page.locator("main").innerText();
async function go(page, p) { await page.goto(BASE + p); return main(page); }
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);


// The destination the stand-in will answer with when the finder asks it to read
// a description. Set from the catalogue below, so the test does not assume one.
let aiCountry = "CA";

// A stand-in for Anthropic's Messages API. The app must run with ANTHROPIC_API_BASE=http://localhost:4011.
const calls = [];
const text = (t) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } });
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = JSON.parse(b || "{}");
    calls.push({ key: req.headers["x-api-key"], version: req.headers["anthropic-version"], body });
    const all = JSON.stringify(body.messages);
    let out;
    if (body.tools && !all.includes("tool_result")) {
      out = { content: [{ type: "tool_use", id: "tu_1", name: "search_programs", input: { query: "Westbridge" } }], stop_reason: "tool_use", usage: { input_tokens: 200, output_tokens: 30 } };
    } else if (body.tools) {
      const link = (all.match(/\/programs\/[A-Za-z0-9_-]+/) || ["none"])[0];
      out = text(`Here is one at **Westbridge**: ${link}\n- tuition as the catalogue records it`);
    } else if (all.includes("Give feedback")) {
      out = text("Verdict: nearly ready.\n**Strong answers**\n- clear course choice\n**Answers to work on**\n- finances were vague");
    } else if (/"type":"(image|document)"/.test(all) && all.includes("passport")) {
      out = text('{"passportNumber": "Z1234567", "passportIssue": "2022-03-01", "passportExpiry": "2032-02-28", "passportIssueCountry": "India", "dateOfBirth": "2001-05-17", "cityOfBirth": "Kottayam"}');
    } else if (String(body.system || "").includes("filters for a program catalogue")) {
      // A destination that does not exist, a field nobody offers and a score:
      // the portal must drop all three and keep only what it offered itself.
      out = text(`{"country": "${aiCountry},ZZ", "level": "PG", "field": "Underwater Basket Weaving", "scholarship": "1", "ae_ielts": "9"}`);
    } else if (all.includes("Ask the next question") || all.includes("Begin the interview")) {
      const n = (all.match(/Student:/g) || []).length + 1;
      out = text(`Question number ${n}: why this course?`);
    } else out = text("{}");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => mock.listen(4011, r));

sql("delete from ai_usage; delete from interview_sessions; delete from ai_settings");
const sid = sql("select id from students where first_name = 'Aswin'");
sql(`update students set profile_locked = false, passport_number = null, city_of_birth = null where id = '${sid}'`);

// --- Off by default.
const partner = await signIn("kottayam@medcity.test", "10.104.1.2");
const pp = partner.page;
let t = await go(pp, "/assistant");
check(/not switched on/.test(t) && !/Assistant/.test(await pp.locator("nav").first().innerText()), "off: no key, no assistant");

// --- The owner switches AI on.
const owner = await signIn("sreejith@miak.in", "10.104.1.1");
const op = owner.page;
await go(op, "/settings/platform");
await op.waitForLoadState("networkidle");
const f = op.locator("#ai form");
await f.locator('[name="apiKey"]').fill("not-a-key");
await f.locator('[name="enabled"]').check();
await f.getByRole("button", { name: "Save AI settings" }).click();
check(await f.getByText("An Anthropic key starts sk-ant-").waitFor({ timeout: 10000 }).then(() => true, () => false), "settings: key format checked");
await f.locator('[name="apiKey"]').fill("sk-ant-test-0123456789abcdefghijklmnop");
await f.getByRole("button", { name: "Save AI settings" }).click();
await toast(op, /AI features are on/);
check(!sql("select api_key_enc from ai_settings").includes("sk-ant"), "settings: key sealed");

// --- Assistant.
t = await go(pp, "/assistant");
check(/Assistant/.test(await pp.locator("nav").first().innerText()), "nav: assistant appears once on");
await pp.getByLabel("Your question").fill("Anything at Westbridge?");
await pp.getByRole("button", { name: "Ask", exact: true }).click();
await pp.locator('[data-role="assistant"]').first().waitFor({ timeout: 20000 }).catch(() => {});
const answer = pp.locator('[data-role="assistant"]').first();
check(await answer.locator("strong", { hasText: "Westbridge" }).count() === 1 && await answer.getByRole("link", { name: "Open the program" }).count() === 1, "assistant: answer with a program link from the catalogue tool");
const toolRound = calls.find((c) => JSON.stringify(c.body.messages).includes("tool_result"));
check(!!toolRound && /University of Westbridge/.test(JSON.stringify(toolRound.body.messages)) && /not recorded|tuition/.test(JSON.stringify(toolRound.body.messages)), "assistant: the tool searched the real catalogue");
check(calls[0].key === "sk-ant-test-0123456789abcdefghijklmnop" && calls[0].version === "2023-06-01" && calls[0].body.model === "claude-sonnet-4-5", "assistant: key, version and model sent");
check(sql("select count(*) from ai_usage where feature = 'assistant'") === "1", "assistant: one request counted for the whole answer");

// --- Practice interview, tied to an application: no name leaves the portal.
const app = sql(`select id from applications where student_id = '${sid}' limit 1`);
calls.length = 0;
await go(pp, `/interview?app=${app}`);
await pp.waitForLoadState("networkidle");
await pp.getByRole("button", { name: "Start the interview" }).click();
for (let i = 1; i <= 6; i++) {
  await pp.getByText(`Question number ${i}`).waitFor({ timeout: 20000 }).catch(() => {});
  await pp.getByLabel("Answer").fill(`Answer ${i}: because it fits my plan.`);
  await pp.getByRole("button", { name: i === 6 ? "Answer and get feedback" : "Answer", exact: true }).click();
}
await pp.getByTestId("feedback").waitFor({ timeout: 20000 }).catch(() => {});
t = await pp.getByTestId("feedback").innerText().catch(() => "");
check(/nearly ready/.test(t) && /finances were vague/.test(t), "interview: feedback after six answers");
check(calls.length === 7, `interview: seven requests, six questions and the feedback (${calls.length})`);
check(!calls.some((c) => /Aswin/.test(JSON.stringify(c))), "interview: the student's name is never sent");
check(sql("select count(*) from interview_sessions") === "1", "interview: saved");
t = await go(pp, "/interview");
check(/Past practice/.test(t) && /UK university credibility interview/.test(t), "interview: listed");

// --- Reading a passport into the profile.
await go(pp, `/students/${sid}/documents`);
await pp.waitForLoadState("networkidle");
const up = pp.locator("div.rounded-md.border-dashed").filter({ hasText: "Upload another document" });
await up.locator("select").selectOption("PASSPORT");
await up.locator('input[type="file"]').setInputFiles({ name: "passport.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
await up.getByRole("button", { name: "Upload" }).click();
await pp.getByText("passport.png").first().waitFor({ timeout: 10000 }).catch(() => {});
calls.length = 0;
await go(pp, `/students/${sid}/profile`);
await pp.waitForLoadState("networkidle");
await pp.getByRole("button", { name: /^Read Passport/ }).first().click();
await pp.getByTestId("autofill-review").waitFor({ timeout: 20000 }).catch(() => {});
check((await pp.locator("#af-pn").inputValue()) === "Z1234567" && (await pp.locator("#af-cob").inputValue()) === "Kottayam", "autofill: passport fields filled for checking");
check(calls.length === 1 && /"type":"image"/.test(JSON.stringify(calls[0].body)), "autofill: the image was sent to be read");
check(sql(`select coalesce(passport_number, '') from students where id = '${sid}'`) === "", "autofill: nothing saved before the person saves");
await pp.getByRole("button", { name: "Save passport details" }).click();
await toast(pp, /Passport details saved/);
check(sql(`select passport_number || '|' || city_of_birth || '|' || to_char(passport_expiry, 'YYYY-MM-DD') from students where id = '${sid}'`) === "Z1234567|Kottayam|2032-02-28", "autofill: saved after checking");

// --- The course finder reads a description, and takes only what it offered itself.
aiCountry = sql("select c.code from countries c join universities u on u.country_id = c.id join programs p on p.university_id = u.id where p.status = 'LIVE' group by c.code order by count(*) desc limit 1");
const before = calls.length;
await go(pp, "/finder");
await pp.fill('textarea[name="brief"]', "a student who wants a masters abroad, IELTS 6.5");
await pp.getByRole("button", { name: "Read this" }).click();
await pp.waitForFunction(() => new URL(location.href).searchParams.has("level"), null, { timeout: 20000 }).catch(() => {});
{
  const p = new URL(pp.url()).searchParams;
  check(p.get("country") === aiCountry, `finder: the AI's destination is kept when the portal offers it (${p.get("country")})`);
  check(p.get("scholarship") === "1", "finder: what the AI read from the family's ask is kept");
  check(p.get("field") === null, "finder: a field the portal does not offer is dropped");
  check(p.get("ae_ielts") === "6.5", "finder: the score comes from the portal's own reader, not the AI");
  const sent = calls[calls.length - 1];
  check(/filters for a program catalogue/.test(String(sent.body.system)), "finder: the AI is given the portal's own lists");
  check(calls.length === before + 1 && !sent.body.tools, "finder: one request, with no tools");
}

// --- Allowance.
sql(`update ai_settings set monthly_quota = '{"SILVER":0,"GOLD":0,"ELITE":0,"PLATINUM":0}'::jsonb`);
await go(pp, "/assistant");
await pp.getByLabel("Your question").fill("One more?");
await pp.getByRole("button", { name: "Ask", exact: true }).click();
check(await pp.getByRole("alert").filter({ hasText: /used this month's 0 AI requests/ }).waitFor({ timeout: 10000 }).then(() => true, () => false), "allowance: a branch past its monthly requests is stopped");

// --- Switched off.
sql("update ai_settings set enabled = false");
t = await go(pp, `/students/${sid}/profile`);
check(!/Fill from a document/.test(t), "off: the autofill panel goes");

mock.close();
for (const [who, e] of [["owner", owner.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
