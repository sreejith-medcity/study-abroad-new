import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBranchHead,
  isHeadOffice,
  matchingRules,
  mayEditRuleFor,
  mayManageRouting,
  mayMerge,
  orderRules,
  pickRoundRobin,
  planMerge,
  planRepeat,
  ruleMatches,
  ruleTarget,
  type MergeRecord,
  type RoutingRule,
} from "../src/lib/enquiry-routing";
import { DEFAULT_LOST_REASONS, NOT_RECORDED, csvCell, lostReasonText, lostReportCsv, reportPeriod, tallyLost } from "../src/lib/lost-reasons";
import { matchKey } from "../src/lib/phone";

const day = (d: string) => new Date(`${d}T10:00:00Z`);

const rule = (over: Partial<RoutingRule>): RoutingRule => ({
  id: over.id ?? "r1",
  name: "Rule",
  orgId: null,
  source: null,
  pathway: null,
  method: "ROUND_ROBIN",
  assignToId: null,
  priority: 100,
  active: true,
  createdAt: day("2026-01-01"),
  ...over,
});

// ---------- Routing rules ----------

test("an empty condition matches anything, a set one only its own value", () => {
  const ctx = { orgId: "kottayam", source: "WEBSITE" as const, pathway: "AUSBILDUNG" as const };
  assert.equal(ruleMatches(rule({}), ctx), true);
  assert.equal(ruleMatches(rule({ orgId: "kottayam" }), ctx), true);
  assert.equal(ruleMatches(rule({ orgId: "kochi" }), ctx), false);
  assert.equal(ruleMatches(rule({ source: "WEBSITE" }), ctx), true);
  assert.equal(ruleMatches(rule({ source: "WALK_IN" }), ctx), false);
  assert.equal(ruleMatches(rule({ pathway: "AUSBILDUNG" }), ctx), true);
  assert.equal(ruleMatches(rule({ pathway: "DEGREE" }), ctx), false);
});

test("a rule asking for a pathway does not take an enquiry with none given", () => {
  assert.equal(ruleMatches(rule({ pathway: "NURSING" }), { orgId: "o", source: "PHONE", pathway: null }), false);
});

test("a rule that is off never matches", () => {
  assert.equal(ruleMatches(rule({ active: false }), { orgId: "o", source: "PHONE", pathway: null }), false);
});

test("rules are tried by order number, then oldest first", () => {
  const a = rule({ id: "a", priority: 20, createdAt: day("2026-03-01") });
  const b = rule({ id: "b", priority: 10, createdAt: day("2026-05-01") });
  const c = rule({ id: "c", priority: 20, createdAt: day("2026-01-01") });
  assert.deepEqual(orderRules([a, b, c]).map((r) => r.id), ["b", "c", "a"]);
});

test("matchingRules keeps only the ones that match, in order", () => {
  const rules = [
    rule({ id: "kochi", orgId: "kochi", priority: 1 }),
    rule({ id: "web", source: "WEBSITE", priority: 5 }),
    rule({ id: "any", priority: 50 }),
  ];
  assert.deepEqual(matchingRules(rules, { orgId: "kottayam", source: "WEBSITE", pathway: null }).map((r) => r.id), ["web", "any"]);
});

test("round robin gives the enquiry to whoever holds the fewest open ones", () => {
  const pick = pickRoundRobin([
    { id: "u1", name: "Anu", open: 5, lastAssignedAt: day("2026-01-01") },
    { id: "u2", name: "Binu", open: 2, lastAssignedAt: day("2026-10-25") },
    { id: "u3", name: "Chitra", open: 3, lastAssignedAt: null },
  ]);
  assert.equal(pick?.id, "u2");
});

test("round robin settles a tie on workload by who was given one longest ago, never first", () => {
  const pick = pickRoundRobin([
    { id: "u1", name: "Anu", open: 2, lastAssignedAt: day("2026-10-20") },
    { id: "u2", name: "Binu", open: 2, lastAssignedAt: null },
    { id: "u3", name: "Chitra", open: 2, lastAssignedAt: day("2026-10-01") },
  ]);
  assert.equal(pick?.id, "u2");
  const next = pickRoundRobin([
    { id: "u1", name: "Anu", open: 2, lastAssignedAt: day("2026-10-20") },
    { id: "u3", name: "Chitra", open: 2, lastAssignedAt: day("2026-10-01") },
  ]);
  assert.equal(next?.id, "u3");
});

test("round robin takes turns when it is fed its own picks", () => {
  const pool = [
    { id: "u1", name: "Anu", open: 0, lastAssignedAt: null as Date | null },
    { id: "u2", name: "Binu", open: 0, lastAssignedAt: null as Date | null },
    { id: "u3", name: "Chitra", open: 0, lastAssignedAt: null as Date | null },
  ];
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    const p = pickRoundRobin(pool)!;
    order.push(p.name);
    p.open += 1;
    p.lastAssignedAt = new Date(Date.UTC(2026, 9, 1, 0, i));
  }
  assert.deepEqual(order, ["Anu", "Binu", "Chitra", "Anu", "Binu", "Chitra"]);
});

test("round robin over nobody picks nobody", () => {
  assert.equal(pickRoundRobin([]), null);
});

test("a rule says where it sends enquiries in words", () => {
  assert.equal(ruleTarget({ method: "PERSON", assignToId: "u1" }, "Anu"), "Anu");
  assert.equal(ruleTarget({ method: "PERSON", assignToId: null }, null), "A person no longer at the branch");
  assert.match(ruleTarget({ method: "ROUND_ROBIN", assignToId: null }), /Round robin/);
});

// ---------- Who may ----------

test("the head office sets every rule; a branch head only their own branch's", () => {
  const admin = { role: "ADMIN", orgId: "hq", orgType: "HQ" };
  const head = { role: "PARTNER", orgId: "kottayam", orgType: "BRANCH" };
  const counsellor = { role: "COUNSELLOR", orgId: "kottayam", orgType: "BRANCH" };
  assert.equal(isHeadOffice(admin), true);
  assert.equal(isBranchHead(head), true);
  // A sub-agent's owner signs in as PARTNER too, and runs no branch.
  assert.equal(isBranchHead({ role: "PARTNER", orgId: "agent", orgType: "SUB_AGENT" }), false);
  assert.equal(mayManageRouting({ role: "PARTNER", orgId: "agent", orgType: "SUB_AGENT" }), false);
  assert.equal(mayManageRouting(counsellor), false);
  assert.equal(mayManageRouting({ role: "MANAGEMENT", orgId: "hq", orgType: "HQ" }), false);
  assert.equal(mayEditRuleFor(admin, null), true);
  assert.equal(mayEditRuleFor(admin, "kochi"), true);
  assert.equal(mayEditRuleFor(head, "kottayam"), true);
  assert.equal(mayEditRuleFor(head, "kochi"), false);
  assert.equal(mayEditRuleFor(head, null), false);
});

test("a branch head merges only two enquiries of their own branch", () => {
  const head = { role: "PARTNER", orgId: "kottayam", orgType: "BRANCH" };
  assert.equal(mayMerge(head, "kottayam", "kottayam"), true);
  assert.equal(mayMerge(head, "kottayam", "kochi"), false);
  assert.equal(mayMerge({ role: "COUNSELLOR", orgId: "kottayam" }, "kottayam", "kottayam"), false);
  assert.equal(mayMerge({ role: "OPS_MANAGER", orgId: "hq" }, "kottayam", "kochi"), true);
});

// ---------- Phone numbers ----------

test("one number written three ways matches itself", () => {
  assert.equal(matchKey("+91 98470 12345"), "9847012345");
  assert.equal(matchKey("098470-12345"), "9847012345");
  assert.equal(matchKey("9847012345"), "9847012345");
});

test("a short number is matched on all its digits, and a scrap of one on nothing", () => {
  assert.equal(matchKey("0481 25 6789"), "0481256789");
  assert.equal(matchKey("25 6789"), "256789");
  assert.equal(matchKey("123"), null);
  assert.equal(matchKey(""), null);
});

// ---------- Repeat enquiries ----------

test("an open enquiry for the number takes a note instead of a second enquiry", () => {
  const plan = planRepeat([
    { id: "lost", stage: "LOST", createdAt: day("2026-09-01"), lastContactedAt: day("2026-09-02") },
    { id: "open", stage: "CONTACTED", createdAt: day("2026-05-01"), lastContactedAt: null },
  ]);
  assert.equal(plan.kind, "note");
  assert.equal(plan.kind === "note" && plan.target.id, "open");
});

test("a lost enquiry comes back as Contacted when somebody had spoken to them", () => {
  const plan = planRepeat([{ id: "lost", stage: "LOST", createdAt: day("2026-09-01"), lastContactedAt: day("2026-09-02") }]);
  assert.deepEqual(plan.kind === "reopen" && [plan.target.id, plan.stageAfter], ["lost", "CONTACTED"]);
});

test("a lost enquiry nobody had reached comes back as New", () => {
  const plan = planRepeat([{ id: "lost", stage: "LOST", createdAt: day("2026-09-01"), lastContactedAt: null }]);
  assert.equal(plan.kind === "reopen" && plan.stageAfter, "NEW");
});

test("of several lost enquiries the most recent is reopened", () => {
  const plan = planRepeat([
    { id: "old", stage: "LOST", createdAt: day("2025-01-01"), lastContactedAt: null },
    { id: "new", stage: "LOST", createdAt: day("2026-02-01"), lastContactedAt: null },
  ]);
  assert.equal(plan.kind === "reopen" && plan.target.id, "new");
});

test("a converted or merged enquiry is never reopened: the arrival is a new enquiry", () => {
  assert.equal(planRepeat([{ id: "c", stage: "CONVERTED", createdAt: day("2026-01-01"), lastContactedAt: null }]).kind, "create");
  assert.equal(planRepeat([{ id: "m", stage: "MERGED", createdAt: day("2026-01-01"), lastContactedAt: null, mergedIntoId: "x" }]).kind, "create");
  assert.equal(planRepeat([{ id: "m", stage: "LOST", createdAt: day("2026-01-01"), lastContactedAt: null, mergedIntoId: "x" }]).kind, "create");
  assert.equal(planRepeat([]).kind, "create");
});

// ---------- Merging ----------

const rec = (over: Partial<MergeRecord>): MergeRecord => ({
  id: "k",
  name: "Keep",
  orgId: "kottayam",
  stage: "CONTACTED",
  email: null,
  city: null,
  interestCountry: null,
  interestPathway: null,
  intakeMonth: null,
  intakeYear: null,
  budgetLakhs: null,
  assignedToId: null,
  nextFollowUpAt: null,
  lastContactedAt: null,
  studentId: null,
  submittedByOrgId: null,
  crmId: null,
  mergedIntoId: null,
  repeatCount: 0,
  answers: [],
  ...over,
});

test("a merge fills only the blanks on the enquiry kept", () => {
  const plan = planMerge(
    rec({ city: "Pala", email: null }),
    rec({ id: "r", city: "Kottayam", email: "a@example.com", interestCountry: "Germany", budgetLakhs: 0 }),
    { removeOwnerActive: true },
  );
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.set.city, undefined);
  assert.equal(plan.set.email, "a@example.com");
  assert.equal(plan.set.interestCountry, "Germany");
  // Nought lakhs is a figure somebody recorded, not a blank.
  assert.equal(plan.set.budgetLakhs, 0);
  assert.deepEqual(plan.filled, ["email", "destination", "budget"]);
});

test("the kept owner stays; the duplicate's owner is taken only when nobody holds it and they are active", () => {
  const kept = planMerge(rec({ assignedToId: "anu" }), rec({ id: "r", assignedToId: "binu" }), { removeOwnerActive: true });
  assert.ok(kept.ok && kept.set.assignedToId === undefined);
  const taken = planMerge(rec({}), rec({ id: "r", assignedToId: "binu" }), { removeOwnerActive: true });
  assert.ok(taken.ok && taken.set.assignedToId === "binu");
  const gone = planMerge(rec({}), rec({ id: "r", assignedToId: "binu" }), { removeOwnerActive: false });
  assert.ok(gone.ok && gone.set.assignedToId === undefined);
  const elsewhere = planMerge(rec({}), rec({ id: "r", orgId: "kochi", assignedToId: "binu" }), { removeOwnerActive: true });
  assert.ok(elsewhere.ok && elsewhere.set.assignedToId === undefined);
});

test("the sooner follow-up and the later last contact are kept", () => {
  const plan = planMerge(
    rec({ nextFollowUpAt: day("2026-11-10"), lastContactedAt: day("2026-10-01") }),
    rec({ id: "r", nextFollowUpAt: day("2026-11-01"), lastContactedAt: day("2026-10-20") }),
    { removeOwnerActive: true },
  );
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.set.nextFollowUpAt?.toISOString(), day("2026-11-01").toISOString());
  assert.equal(plan.set.lastContactedAt?.toISOString(), day("2026-10-20").toISOString());
});

test("a lost enquiry kept over one still being worked comes back to that stage", () => {
  const plan = planMerge(rec({ stage: "LOST" }), rec({ id: "r", stage: "QUALIFIED", nextFollowUpAt: day("2026-11-01") }), { removeOwnerActive: true });
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.set.stage, "QUALIFIED");
  assert.equal(plan.set.clearLost, true);
  assert.equal(plan.set.nextFollowUpAt?.toISOString(), day("2026-11-01").toISOString());
});

test("an open kept enquiry keeps its stage whatever the duplicate's", () => {
  const plan = planMerge(rec({ stage: "NEW" }), rec({ id: "r", stage: "LOST" }), { removeOwnerActive: true });
  assert.ok(plan.ok && plan.set.stage === undefined && !plan.set.clearLost);
});

test("a merge refuses the same enquiry, one already merged, and a duplicate that is a student", () => {
  assert.equal(planMerge(rec({}), rec({}), { removeOwnerActive: true }).ok, false);
  assert.equal(planMerge(rec({}), rec({ id: "r", mergedIntoId: "x", stage: "MERGED" }), { removeOwnerActive: true }).ok, false);
  assert.equal(planMerge(rec({ stage: "MERGED", mergedIntoId: "x" }), rec({ id: "r" }), { removeOwnerActive: true }).ok, false);
  const student = planMerge(rec({}), rec({ id: "r", stage: "CONVERTED", studentId: "s1" }), { removeOwnerActive: true });
  assert.equal(student.ok, false);
  assert.ok(!student.ok && /already a student/.test(student.why));
  // The converted one may be the one kept.
  assert.equal(planMerge(rec({ stage: "CONVERTED", studentId: "s1" }), rec({ id: "r" }), { removeOwnerActive: true }).ok, true);
});

test("the first referrer is kept, and two different referrers are left for the desk", () => {
  const carried = planMerge(rec({}), rec({ id: "r", submittedByOrgId: "horizon" }), { removeOwnerActive: true });
  assert.ok(carried.ok && carried.set.submittedByOrgId === "horizon");
  const clash = planMerge(rec({ submittedByOrgId: "horizon" }), rec({ id: "r", submittedByOrgId: "other" }), { removeOwnerActive: true });
  assert.equal(clash.ok, false);
});

test("answers to the branch's questions are joined without repeating any", () => {
  const plan = planMerge(
    rec({ answers: [{ question: "Course", answer: "IELTS" }] }),
    rec({ id: "r", answers: [{ question: "Course", answer: "IELTS" }, { question: "Batch", answer: "Morning" }], repeatCount: 2 }),
    { removeOwnerActive: true },
  );
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.deepEqual(plan.set.answers, [
    { question: "Course", answer: "IELTS" },
    { question: "Batch", answer: "Morning" },
  ]);
  // Both enquiries, and the duplicate's own repeats, count as the person coming again.
  assert.equal(plan.set.repeatCount, 3);
});

// ---------- Lost reasons ----------

test("the list starts with the usual study-abroad reasons, Other last", () => {
  assert.deepEqual([...DEFAULT_LOST_REASONS], ["Not reachable", "Budget", "Chose another agency", "Not eligible", "Postponed", "Visa concerns", "Other"]);
});

test("a reason reads as the label then the words beside it; an old free-text one as its words", () => {
  assert.equal(lostReasonText("Budget", "UK too costly"), "Budget: UK too costly");
  assert.equal(lostReasonText("Budget", null), "Budget");
  assert.equal(lostReasonText(null, "Chose another consultant"), "Chose another consultant");
  assert.equal(lostReasonText(null, "  "), NOT_RECORDED);
});

test("the report counts by reason, source and branch, with no reason counted as not recorded", () => {
  const t = tallyLost(
    [
      { reason: "Budget", detail: null, source: "WEBSITE", branch: "Kottayam" },
      { reason: "Budget", detail: "x", source: "WALK_IN", branch: "Kochi" },
      { reason: null, detail: "old text", source: "WEBSITE", branch: "Kottayam" },
      { reason: "Postponed", detail: null, source: "WEBSITE", branch: "Kottayam" },
    ],
    (s) => (s === "WEBSITE" ? "Website" : "Walk in"),
  );
  assert.equal(t.total, 4);
  assert.deepEqual(t.byReason.map((r) => [r.label, r.count]), [["Budget", 2], [NOT_RECORDED, 1], ["Postponed", 1]]);
  assert.deepEqual(t.bySource.map((r) => [r.label, r.count]), [["Website", 3], ["Walk in", 1]]);
  assert.deepEqual(t.byBranch.map((r) => [r.label, r.count]), [["Kottayam", 3], ["Kochi", 1]]);
  assert.equal(t.byReason[0].share, 0.5);
});

test("the report's file has the counts and every enquiry, with formulas made inert", () => {
  const csv = lostReportCsv(
    [
      { name: "=cmd", reason: "Budget", detail: null, source: "WEBSITE", branch: "Kottayam", owner: null, lostOn: "01/10/2026" },
      { name: "Asha", reason: null, detail: "old words", source: "WALK_IN", branch: "Kochi", owner: "Anu", lostOn: null },
    ],
    { from: "2026-10-01", to: "2026-10-26" },
  );
  assert.match(csv, /"Lost enquiries","2026-10-01 to 2026-10-26","2"/);
  assert.match(csv, /"By reason","Enquiries","Share"/);
  assert.match(csv, /"Budget","1","50%"/);
  assert.match(csv, /"'=cmd","Kottayam","WEBSITE","Budget","","Unassigned","01\/10\/2026"/);
  assert.match(csv, /"Asha","Kochi","WALK_IN","Not recorded","old words","Anu","Not recorded"/);
  assert.equal(csvCell("+91"), `"'+91"`);
});

test("the report period defaults to this month so far and puts its ends in order", () => {
  assert.deepEqual(reportPeriod(undefined, undefined, "2026-10-26"), { from: "2026-10-01", to: "2026-10-26" });
  assert.deepEqual(reportPeriod("2026-09-01", "2026-09-30", "2026-10-26"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(reportPeriod("2026-09-30", "2026-09-01", "2026-10-26"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(reportPeriod("nonsense", "2026-13-45", "2026-10-26"), { from: "2026-10-01", to: "2026-10-26" });
});
