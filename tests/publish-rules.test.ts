import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { bulkOutcomeText, canGoLive, heldBackText, publishProblems, refusalText, type BulkOutcome } from "../src/lib/publish-rules";
import { publishProblems as reviewPublishProblems } from "../src/lib/draft-review";
import { heldBackSummary, parseProgramCsv } from "../src/lib/program-import";
import { cricosPublishText } from "../src/lib/cricos";
import { programRestoreProblem } from "../src/lib/catalogue-history";
import { HAS_EVIDENCE, HAS_INTAKES, READY, READY_TARGET } from "../src/server/publish-rules";

const ready = { intakeMonths: [9], workRights: "UNKNOWN", workRightsNote: null };

test("the draft review screens read the very same rule", () => {
  assert.equal(reviewPublishProblems, publishProblems);
});

test("a course with an intake and no work rights verdict can go live", () => {
  assert.deepEqual(publishProblems(ready), []);
  assert.equal(canGoLive(ready), true);
});

test("no intake, or a verdict with blank evidence, keeps a course from going live", () => {
  assert.deepEqual(publishProblems({ ...ready, intakeMonths: [] }), ["intakes"]);
  assert.deepEqual(publishProblems({ ...ready, workRights: "ELIGIBLE", workRightsNote: " \t" }), ["evidence"]);
  assert.deepEqual(publishProblems({ ...ready, workRights: "INELIGIBLE", workRightsNote: undefined }), ["evidence"]);
  assert.deepEqual(publishProblems({ intakeMonths: null, workRights: "ELIGIBLE", workRightsNote: "" }), ["intakes", "evidence"]);
  assert.equal(canGoLive({ ...ready, intakeMonths: [] }), false);
});

test("the row on the Programs list says which rule stopped it", () => {
  assert.equal(refusalText(["intakes"]), "Not set live: it has no intakes.");
  assert.equal(refusalText(["evidence"]), "Not set live: its post-study work answer has no evidence behind it.");
  assert.match(refusalText(["intakes", "evidence"]), /no intakes, and its post-study work answer has no evidence/);
  assert.equal(refusalText([]), "");
});

test("held-back courses read as one because, or as a list of reasons", () => {
  assert.equal(heldBackText({ left: 3, noIntakes: 3, noEvidence: 0 }, "3 left as drafts"), "3 left as drafts because they have no intakes.");
  assert.equal(heldBackText({ left: 1, noIntakes: 0, noEvidence: 1 }, "1 left as a draft"), "1 left as a draft because it has a post-study work answer with no evidence behind it.");
  assert.equal(heldBackText({ left: 3, noIntakes: 2, noEvidence: 1 }, "3 left as drafts"), "3 left as drafts: 2 have no intakes, 1 has a post-study work answer with no evidence behind it.");
});

const bulk: BulkOutcome = { to: "LIVE", done: 0, leftDrafts: 0, leftArchived: 0, noIntakes: 0, noEvidence: 0, unreached: 0 };

test("a bulk publish says how many went live and how many stayed drafts and why", () => {
  assert.equal(bulkOutcomeText({ ...bulk, done: 1200 }), "Published 1,200.");
  assert.equal(
    bulkOutcomeText({ ...bulk, done: 4, leftDrafts: 2, noIntakes: 2 }),
    "Published 4. 2 left as drafts because they have no intakes. Open each one to add what is missing.",
  );
  assert.equal(
    bulkOutcomeText({ ...bulk, leftDrafts: 1, noEvidence: 1 }),
    "Nothing published. 1 left as a draft because it has a post-study work answer with no evidence behind it. Open it to add what is missing.",
  );
  assert.equal(
    bulkOutcomeText({ ...bulk, done: 10, leftDrafts: 25889, noIntakes: 25889, noEvidence: 3 }),
    "Published 10. 25,889 left as drafts: 25,889 have no intakes, 3 have a post-study work answer with no evidence behind them. Open each one to add what is missing.",
  );
});

test("archived courses a publish could not take are said to stay archived", () => {
  assert.equal(
    bulkOutcomeText({ ...bulk, done: 1, leftDrafts: 1, leftArchived: 2, noIntakes: 3 }),
    "Published 1. 1 left as a draft and 2 left archived because they have no intakes. Open each one to add what is missing.",
  );
  assert.match(bulkOutcomeText({ ...bulk, leftArchived: 1, noIntakes: 1 }), /^Nothing published\. 1 left archived because it has no intakes\./);
});

test("a run the time guard stopped says pressing again carries on", () => {
  assert.match(bulkOutcomeText({ ...bulk, done: 400000, unreached: 5000 }), /^Published 4,00,000\. 5,000 more were not reached before the time limit\. Press the button again to carry on\.$/);
});

test("back to draft and archive are counted without any publish rule", () => {
  assert.equal(bulkOutcomeText({ ...bulk, to: "DRAFT", done: 7 }), "Moved 7 back to draft.");
  assert.equal(bulkOutcomeText({ ...bulk, to: "DRAFT" }), "Nothing moved: every match was already a draft.");
  assert.equal(bulkOutcomeText({ ...bulk, to: "ARCHIVED", done: 2 }), "Archived 2.");
});

const h = "program,university,country_code,level,intakes,work_rights,work_rights_note,status";

test("a CSV row marked LIVE with a verdict and no evidence comes in as a draft, and says why", () => {
  const { rows, errors } = parseProgramCsv(`${h}\nA,Uni,GB,PG,Sep,ELIGIBLE,,LIVE\nB,Uni,GB,PG,Sep,ELIGIBLE,Graduate Route on gov.uk,LIVE\nC,Uni,GB,PG,Sep,INELIGIBLE,,DRAFT`, []);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].status, "DRAFT");
  assert.deepEqual(rows[0].heldBack, ["evidence"]);
  assert.equal(rows[1].status, "LIVE");
  assert.equal(rows[1].heldBack, undefined);
  // A row the file already marks as a draft was never going live, so nothing was held back.
  assert.equal(rows[2].status, "DRAFT");
  assert.equal(rows[2].heldBack, undefined);
});

test("a blank status means LIVE, so the same rule applies to it", () => {
  const { rows } = parseProgramCsv(`${h}\nA,Uni,GB,PG,Sep,YES,,`, []);
  assert.equal(rows[0].status, "DRAFT");
  assert.deepEqual(rows[0].heldBack, ["evidence"]);
});

test("a CSV row marked LIVE with no intake is still refused, as it always was", () => {
  const { rows, errors } = parseProgramCsv(`${h}\nA,Uni,GB,PG,,UNKNOWN,,LIVE`, []);
  assert.equal(rows.length, 0);
  assert.match(errors[0].message, /at least one intake month is required/);
});

test("the import result says how many rows came in as drafts", () => {
  assert.equal(heldBackSummary([{}, { heldBack: undefined }]), "");
  assert.equal(
    heldBackSummary([{ heldBack: ["evidence"] }, {}]),
    "1 row marked LIVE came in as a draft because it has a post-study work answer with no evidence behind it. Open it to add what is missing, then set it live.",
  );
  assert.match(heldBackSummary([{ heldBack: ["evidence"] }, { heldBack: ["evidence"] }]), /^2 rows marked LIVE came in as drafts because they have/);
});

test("the CRICOS report counts new courses kept as drafts", () => {
  assert.equal(
    cricosPublishText({ published: 0, keptAsDrafts: 412, keptNoIntakes: 412, keptNoEvidence: 0 }),
    "No new course was published. 412 new courses were kept as drafts because they have no intakes.",
  );
  assert.equal(cricosPublishText({ published: 3, keptAsDrafts: 0, keptNoIntakes: 0, keptNoEvidence: 0 }), "Published 3 new.");
  assert.equal(
    cricosPublishText({ published: 0, keptAsDrafts: 1, keptNoIntakes: 1, keptNoEvidence: 0 }),
    "No new course was published. 1 new course was kept as a draft because it has no intakes.",
  );
});

test("restoring from the history still applies the same two rules", () => {
  const row = { name: "MSc X", level: "PG", pathway: "DEGREE", status: "LIVE", intakeMonths: [], workRights: "UNKNOWN", workRightsNote: null };
  assert.match(programRestoreProblem(row, ["status"]) ?? "", /live program with no intake/);
  assert.equal(programRestoreProblem({ ...row, status: "DRAFT" }, ["status"]), null);
  // A rule binds only when the restore touches its fields.
  assert.equal(programRestoreProblem(row, ["name"]), null);
  assert.match(programRestoreProblem({ ...row, intakeMonths: [9], workRights: "ELIGIBLE", workRightsNote: "  " }, ["workRights"]) ?? "", /no evidence/);
  assert.equal(programRestoreProblem({ ...row, intakeMonths: [9], workRights: "ELIGIBLE", workRightsNote: "Graduate Route" }, ["workRights", "status"]), null);
});

test("the SQL form of the rule checks the same columns as the row form", () => {
  const dialect = new PgDialect();
  const text = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(q).sql;
  assert.match(text(HAS_INTAKES), /cardinality\("programs"\."intake_months"\) > 0/);
  assert.match(text(HAS_EVIDENCE), /"programs"\."work_rights" = 'UNKNOWN' or coalesce\("programs"\."work_rights_note", ''\) ~ '\[\^\[:space:\]\]'/);
  assert.equal(text(READY), `(${text(HAS_INTAKES)} and ${text(HAS_EVIDENCE)})`);
  // The form written against the row being updated says the same thing.
  assert.equal(text(READY_TARGET).replace(/programs\.(\w+)/g, '"programs"."$1"'), text(READY).slice(1, -1));
});

test("no text an admin reads uses a long dash", () => {
  const all = [
    bulkOutcomeText({ ...bulk, done: 1, leftDrafts: 1, leftArchived: 1, noIntakes: 2, noEvidence: 1, unreached: 3 }),
    refusalText(["intakes", "evidence"]),
    heldBackSummary([{ heldBack: ["intakes", "evidence"] }]),
    cricosPublishText({ published: 1, keptAsDrafts: 2, keptNoIntakes: 2, keptNoEvidence: 1 }),
  ].join(" ");
  assert.equal(/\u2014|\u2013/.test(all), false);
});
