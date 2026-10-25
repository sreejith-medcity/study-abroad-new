import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { STAFF_GUIDES, guideHref, guideText } from "../src/lib/staff-guides";
import { FIGURE_LABEL, STANDING_LABEL } from "../src/lib/journal";
import { STATUS_SEED } from "../src/db/statuses";
import { translator } from "../src/lib/i18n";
import { APP_ROLES } from "../src/lib/permissions";

/**
 * Every label the guides may put in double quotes, as the code writes it. The
 * ones with a count in them are quoted with N where the screen puts the number,
 * and matched against the fragment the code has before the number.
 */
const t = translator("en");
const SCREEN_LABELS: Record<string, string> = Object.fromEntries(
  [
    // The day end report, its popup, the consolidated report and the settings.
    "Your day end report for today",
    "Minimise",
    "Read every line on the full report",
    "My day end report",
    "Day end report",
    "Day end reports",
    "Day end figures",
    "Something here is wrong",
    "Flag my report",
    "Your last two weeks",
    "The day's figures",
    "The day in totals",
    "The month's figures",
    "Days answered",
    "Days missed",
    "Close",
    "Show",
    "Download as Excel",
    "Reports issued",
    "Signed in after hours",
    "Everybody issued a day end report",
    "Day before",
    "Day after",
    "Month",
    "Day ends",
    "Sign-ins after hours from",
    "Unanswered reports missed at",
    "Issue day end reports on Sundays too",
    ...Object.values(FIGURE_LABEL),
    ...Object.values(STANDING_LABEL),
    // The Ausbildung screens: the student's tabs, the tracker, the desk forms.
    "Applications",
    "Update status",
    "Ausbildung",
    "The written process",
    "Placement tracker",
    "Desk and step",
    "Desk",
    "Over turnaround",
    "Documentation",
    "Ask",
    "Upload",
    "Hand to the documentation desk",
    "Hand it over",
    "Hand-overs in the written process",
    "Mentor",
    "Set the mentor",
    "Change the mentor",
    "Save Ausbildung details",
    "Service charge",
    "Due now",
    "Timeline",
    "Waiting on somebody",
    "Services",
    "German",
    ...STATUS_SEED.AUSBILDUNG.map((s) => s.label),
    // The student's portal card.
    t("ausbildungJourney"),
    t("whereYouAre"),
    t("whatHappensNext"),
    t("whoToContact"),
    t("germanLevels"),
    t("paymentsTitle"),
  ].map((label) => [label, label]),
);
// Labels that carry a number on the screen: the fragment the code has.
SCREEN_LABELS["I have checked these N lines: verified"] = "I have checked these {count}";
SCREEN_LABELS["Step N is over its turnaround"] = "is over its turnaround";

/** Every .ts and .tsx file under src, read once, so a label can be shown to exist in the code. */
function sourceText(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      // The guides themselves are left out: a label has to be found on a screen, not in the guide quoting it.
      else if (/\.tsx?$/.test(name) && name !== "staff-guides.ts") out.push(readFileSync(p, "utf8"));
    }
  };
  walk(path.join(__dirname, "..", "src"));
  // JSX writes an apostrophe as &apos;, which is undone so the guide's plain text matches.
  return out.join("\n").replace(/&apos;/g, "'");
}

const quoted = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test("there are two staff guides, each 400 to 700 words, with no em dash anywhere in them", () => {
  assert.equal(STAFF_GUIDES.length, 2);
  for (const g of STAFF_GUIDES) {
    const text = guideText(g);
    const words = text.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 400 && words <= 700, `${g.title} is ${words} words`);
    for (const s of [text, g.title, g.summary, g.course.description, ...g.course.questions.flatMap((q) => [q.prompt, ...q.options])]) {
      assert.ok(!s.includes("—"), `em dash in ${g.title}: ${s.slice(0, 60)}`);
    }
  }
});

test("every screen or button a guide quotes is a label the code has", () => {
  const src = sourceText();
  for (const g of STAFF_GUIDES) {
    for (const label of new Set(quoted(guideText(g)))) {
      const fragment = SCREEN_LABELS[label];
      assert.ok(fragment, `${g.title} quotes "${label}", which is not on the list of screen labels`);
      assert.ok(src.includes(fragment), `"${label}" is on the list but the code no longer has "${fragment}"`);
    }
  }
});

test("each guide's course has five questions whose answers are in the guide, with a pass mark of 80", () => {
  for (const g of STAFF_GUIDES) {
    const text = guideText(g).toLowerCase();
    assert.equal(g.course.passMark, 80, g.title);
    assert.equal(g.course.questions.length, 5, g.title);
    for (const q of g.course.questions) {
      assert.ok(q.options.length >= 2, q.prompt);
      assert.ok(q.correctIndex >= 0 && q.correctIndex < q.options.length, q.prompt);
      assert.equal(new Set(q.options).size, q.options.length, `${q.prompt}: an option is listed twice`);
      const answer = (q.evidence ?? q.options[q.correctIndex]).toLowerCase();
      assert.ok(text.includes(answer), `${q.prompt}: the guide does not say "${answer}"`);
    }
  }
});

test("a guide's audience is made of real roles and its address is under the learning library", () => {
  for (const g of STAFF_GUIDES) {
    assert.ok(g.audience.length > 0, g.title);
    for (const r of g.audience) assert.ok((APP_ROLES as readonly string[]).includes(r), `${g.title}: ${r} is not a role`);
    assert.match(guideHref(g.slug), /^\/learning\/guides\/[a-z-]+$/);
    assert.ok(g.audience.includes("COUNSELLOR") && g.audience.includes("PARTNER"), `${g.title} is for counsellors and branch heads`);
  }
  const dayEnd = STAFF_GUIDES.find((g) => g.slug === "day-end-report")!;
  assert.ok(!dayEnd.audience.includes("SUB_AGENT_COUNSELLOR"), "a sub-agent firm is not issued a day end report");
  assert.ok(dayEnd.audience.includes("ADMIN") && dayEnd.audience.includes("MANAGEMENT"), "the report's readers get the guide too");
});

test("the guides say plainly what the portal does not do", () => {
  const ausbildung = guideText(STAFF_GUIDES.find((g) => g.slug === "ausbildung-process")!);
  assert.match(ausbildung, /does not send the hand-over emails/);
  assert.match(ausbildung, /does not grade/);
});
