import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageOf,
  ageingTable,
  balanceDue,
  csvCell,
  dueWords,
  feeDocNumber,
  fyOf,
  fyStartYear,
  gstFor,
  isDay,
  istToday,
  longestOverdue,
  numberInWords,
  planProblem,
  receiptProblem,
  refundRoom,
  rupeesInWords,
  scheduleFrom,
  splitFee,
  stateAfterReceipts,
  stateFromGstin,
  gstWords,
  instalmentDueWords,
  itemGst,
  DUE_CHOICES,
  type FeePlanItem,
} from "../src/lib/student-fees";
import { FEE_STEP_PATHWAYS, FSJ_FEE_PATHWAY, ausbildungStepReached, feeStepReached, feeStepWords, fsjStepReached, isFeeStep, nclexStepReached, stageReached } from "../src/lib/fee-steps";
import { STAGE_ORDER } from "../src/lib/journey";
import { STARTER_PLANS } from "../src/lib/fee-plan-starters";
import { AUSBILDUNG_STEPS } from "../src/lib/ausbildung";
import { FSJ_STEPS, fsjStepOf } from "../src/lib/fsj";

const share = (label: string, s: number, over: Partial<FeePlanItem> = {}): FeePlanItem => ({ label, share: s, amount: null, due: "ON_APPLY", ...over });
const fixed = (label: string, a: number, over: Partial<FeePlanItem> = {}): FeePlanItem => ({ label, share: null, amount: a, due: "ON_APPLY", ...over });
const step = (pathway: string, stepKey: string | null, over: Partial<FeePlanItem> = {}): Partial<FeePlanItem> => ({ due: "STEP", pathway, stepKey, ...over });

// ---------- Splitting ----------

test("three equal shares of a fee add up to the fee, the last one taking the rupee left over", () => {
  const items = [share("First", 33.33), share("Second", 33.33), share("Third", 33.34)];
  assert.deepEqual(splitFee(items, 10000), [3333, 3333, 3334]);
  assert.equal(splitFee(items, 10000).reduce((s, n) => s! + n!, 0), 10000);
});

test("shares of an odd fee never lose or invent a rupee", () => {
  const items = [share("Registration", 25), share("On offer", 25), share("On visa", 50)];
  for (const fee of [1, 7, 99, 1001, 35001, 123457]) {
    const parts = splitFee(items, fee) as number[];
    assert.equal(parts.reduce((s, n) => s + n, 0), fee, `fee ${fee}`);
    assert.ok(parts.every((p) => p >= 0));
  }
});

test("a share of a fee nobody recorded stays empty rather than becoming nought", () => {
  assert.deepEqual(splitFee([share("Half", 50), share("Half", 50)], null), [null, null]);
});

test("fixed amounts are what they say whatever the fee", () => {
  assert.deepEqual(splitFee([fixed("Registration", 5000), fixed("Balance", 30000)], null), [5000, 30000]);
});

test("a plan is all amounts or all shares, and shares make a hundred", () => {
  assert.equal(planProblem([share("A", 50), share("B", 50)]), null);
  assert.match(planProblem([share("A", 50), share("B", 40)])!, /90%, not 100%/);
  assert.match(planProblem([share("A", 50), fixed("B", 100)])!, /all amounts or all shares/);
  assert.match(planProblem([{ ...fixed("A", 100), share: 10 }])!, /either an amount or a share/);
  assert.match(planProblem([fixed("A", 10.5)])!, /whole rupees/);
  assert.match(planProblem([fixed("A", 100, { due: "STEP" })])!, /choose the stage or step/);
  assert.match(planProblem([])!, /at least one/);
});

test("a schedule dates each instalment from the day the plan is applied, or ties it to a stage", () => {
  const rows = scheduleFrom(
    [fixed("Registration", 5000), fixed("After a month", 10000, { due: "DAYS", days: 30 }), fixed("On visa", 20000, step("JOURNEY", "VISA")), fixed("Fixed day", 1000, { due: "DATE", date: "2027-01-15" })],
    null,
    "2026-10-26",
  );
  assert.deepEqual(rows.map((r) => [r.dueOn, r.stepPathway, r.stepKey]), [["2026-10-26", null, null], ["2026-11-25", null, null], [null, "JOURNEY", "VISA"], ["2027-01-15", null, null]]);
});

test("a stage instalment falls due on its stage and on every stage after it", () => {
  assert.ok(stageReached("OFFER", "OFFER", STAGE_ORDER));
  assert.ok(stageReached("OFFER", "VISA", STAGE_ORDER));
  assert.ok(!stageReached("VISA", "OFFER", STAGE_ORDER));
});

test("due words read the way a person says them", () => {
  assert.equal(dueWords({ due: "STEP", pathway: "JOURNEY", stepKey: "OFFER" }), "on offer");
  assert.equal(dueWords({ due: "DAYS", days: 1 }), "1 day after the plan is applied");
  assert.equal(dueWords({ due: "DATE", date: "2027-01-15" }), "on 15/01/2027");
});

// ---------- GST ----------

const kerala = { gstin: "32ABCDE1234F1Z5", state: "Kerala" };

test("no GSTIN is a bill of supply with no tax on it at all", () => {
  const g = gstFor(10000, 18, { gstin: null, state: "Kerala" }, "Kerala");
  assert.equal(g.kind, "BILL_OF_SUPPLY");
  assert.equal(g.tax, null);
  assert.equal(g.total, 10000);
});

test("inside the seller's state the tax is split into CGST and SGST, rounded to the rupee", () => {
  const g = gstFor(10001, 18, kerala, "Kerala");
  assert.equal(g.kind, "TAX_INVOICE");
  assert.equal(g.cgst, 900);
  assert.equal(g.sgst, 900);
  assert.equal(g.igst, null);
  assert.equal(g.total, 11801);
});

test("a student whose recorded state is elsewhere is charged IGST", () => {
  const g = gstFor(10000, 18, kerala, "Karnataka");
  assert.equal(g.interState, true);
  assert.equal(g.igst, 1800);
  assert.equal(g.cgst, null);
  assert.equal(g.total, 11800);
});

test("a student with no state on record is taxed where the seller is", () => {
  assert.equal(gstFor(10000, 18, kerala, null).interState, false);
  assert.equal(gstFor(10000, 18, kerala, "  ").interState, false);
  assert.equal(gstFor(10000, 18, kerala, "KERALA").interState, false);
});

test("a GSTIN with no rate recorded gives no total, never a guessed one", () => {
  const g = gstFor(10000, null, kerala, "Kerala");
  assert.equal(g.missingRate, true);
  assert.equal(g.tax, null);
  assert.equal(g.total, null);
});

test("the state is read from the GSTIN's first two digits", () => {
  assert.equal(stateFromGstin("32ABCDE1234F1Z5"), "Kerala");
  assert.equal(stateFromGstin("29ABCDE1234F1Z5"), "Karnataka");
  assert.equal(stateFromGstin("99ABCDE1234F1Z5"), null);
  assert.equal(gstFor(100, 18, { gstin: "32ABCDE1234F1Z5", state: null }, "Karnataka").interState, true);
});

test("a state written loosely is still the same state, and one that names no state counts as not recorded", () => {
  for (const s of ["Kerala State", "Ernakulam, Kerala", "KL", "32", "Keralam"]) assert.equal(gstFor(10000, 18, kerala, s).interState, false, s);
  assert.equal(gstFor(10000, 18, kerala, "Narnia").interState, false);
  assert.equal(gstFor(10000, 18, kerala, "Mangalore, Karnataka").buyerState, "Karnataka");
  assert.equal(gstFor(10000, 18, kerala, "Jammu & Kashmir").buyerState, "Jammu and Kashmir");
});

test("shares within the tolerance of a hundred still add up to the whole fee", () => {
  const parts = splitFee([share("A", 33.333), share("B", 33.333), share("C", 33.3335)], 500000) as number[];
  assert.equal(parts.reduce((s, n) => s + n, 0), 500000);
});

test("a calendar day is a real day", () => {
  assert.equal(isDay("2027-02-30"), false);
  assert.equal(isDay("2028-02-29"), true);
  assert.equal(isDay("2026-13-01"), false);
});

test("a formula behind leading spaces is defused in a sheet", () => {
  assert.equal(csvCell(" =1+1"), `"' =1+1"`);
});

// ---------- Numbering ----------

test("the financial year turns in April", () => {
  assert.equal(fyOf("2026-03-31"), "25-26");
  assert.equal(fyOf("2026-04-01"), "26-27");
  assert.equal(fyOf("2099-12-31"), "99-00");
  assert.equal(fyStartYear("2027-02-01"), 2026);
});

test("a number names the kind, the branch, the year and the count", () => {
  assert.equal(feeDocNumber("INV", "KTM", "26-27", 7), "INV/KTM/26-27/0007");
  assert.equal(feeDocNumber("RCT", "KOC", "26-27", 12345), "RCT/KOC/26-27/12345");
});

test("India's day turns at half past six in the evening UTC", () => {
  assert.equal(istToday(new Date("2026-10-26T18:29:00Z")), "2026-10-26");
  assert.equal(istToday(new Date("2026-10-26T18:31:00Z")), "2026-10-27");
});

// ---------- Invoices and receipts ----------

test("an issued invoice follows its receipts; a draft or a closed one does not", () => {
  assert.equal(stateAfterReceipts("ISSUED", 1000, 0), "ISSUED");
  assert.equal(stateAfterReceipts("ISSUED", 1000, 400), "PART_PAID");
  assert.equal(stateAfterReceipts("PART_PAID", 1000, 1000), "PAID");
  assert.equal(stateAfterReceipts("CANCELLED", 1000, 1000), "CANCELLED");
  assert.equal(stateAfterReceipts("DRAFT", 1000, 0), "DRAFT");
});

test("a receipt is whole rupees and never more than is due", () => {
  assert.equal(receiptProblem(500, 1000), null);
  assert.match(receiptProblem(1500, 1000)!, /Only ₹1,000 is due/);
  assert.match(receiptProblem(0, 1000)!, /above nought/);
  assert.match(receiptProblem(10.5, 1000)!, /whole rupees/);
  assert.match(receiptProblem(10, 0)!, /Nothing is due/);
  assert.equal(balanceDue(1000, 1200), 0);
  assert.equal(balanceDue(null, 0), null);
});

test("a refund is never more than was received and not already going back", () => {
  assert.equal(refundRoom(10000, 2000, 3000), 5000);
  assert.equal(refundRoom(1000, 1000, 0), 0);
});

// ---------- Ageing ----------

test("ageing buckets: due today is not late, the boundaries fall where the labels say", () => {
  const today = "2026-10-26";
  assert.equal(ageOf("2026-10-26", today).bucket, "NOT_DUE");
  assert.equal(ageOf("2026-11-30", today).bucket, "NOT_DUE");
  assert.equal(ageOf("2026-10-25", today).bucket, "D1_30");
  assert.equal(ageOf("2026-09-26", today).bucket, "D1_30");
  assert.equal(ageOf("2026-09-25", today).bucket, "D31_60");
  assert.equal(ageOf("2026-08-27", today).bucket, "D31_60");
  assert.equal(ageOf("2026-08-26", today).bucket, "D61_90");
  assert.equal(ageOf("2026-07-28", today).bucket, "D61_90");
  assert.equal(ageOf("2026-07-27", today).bucket, "D90");
});

test("the ageing table adds up by branch and for all branches, skipping what is settled", () => {
  const today = "2026-10-26";
  const t = ageingTable(
    [
      { branch: "Kottayam", dueOn: "2026-11-01", balance: 1000 },
      { branch: "Kottayam", dueOn: "2026-10-01", balance: 500 },
      { branch: "Kochi", dueOn: "2026-06-01", balance: 2000 },
      { branch: "Kochi", dueOn: "2026-06-01", balance: 0 },
    ],
    today,
  );
  assert.equal(t.all.total, 3500);
  assert.equal(t.all.invoices, 3);
  assert.equal(t.all.NOT_DUE, 1000);
  assert.equal(t.all.D1_30, 500);
  assert.equal(t.all.D90, 2000);
  assert.deepEqual(t.branches.map((b) => b.branch), ["Kochi", "Kottayam"]);
});

test("the longest overdue list leaves out what is not late and puts the oldest first", () => {
  const rows = longestOverdue(
    [
      { branch: "A", dueOn: "2026-10-30", balance: 100 },
      { branch: "B", dueOn: "2026-09-01", balance: 100 },
      { branch: "C", dueOn: "2026-05-01", balance: 50 },
      { branch: "D", dueOn: "2026-05-01", balance: 70 },
    ],
    "2026-10-26",
  );
  assert.deepEqual(rows.map((r) => r.branch), ["D", "C", "B"]);
});

// ---------- Words ----------

test("amounts in words follow Indian grouping", () => {
  assert.equal(numberInWords(0), "Zero");
  assert.equal(numberInWords(15), "Fifteen");
  assert.equal(numberInWords(105), "One Hundred Five");
  assert.equal(numberInWords(12500), "Twelve Thousand Five Hundred");
  assert.equal(numberInWords(123456), "One Lakh Twenty Three Thousand Four Hundred Fifty Six");
  assert.equal(numberInWords(10000000), "One Crore");
  assert.equal(numberInWords(1234567890), "One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety");
  assert.equal(rupeesInWords(35400), "Rupees Thirty Five Thousand Four Hundred Only");
});

test("a spreadsheet cell cannot start a formula", () => {
  assert.equal(csvCell("=SUM(A1)"), `"'=SUM(A1)"`);
  assert.equal(csvCell('He said "hi"'), `"He said ""hi"""`);
  assert.equal(csvCell(null), `""`);
});

// ---------- Ausbildung and NCLEX-RN steps ----------

test("an instalment can wait for an Ausbildung step or an NCLEX-RN step, and the schedule keeps which", () => {
  const rows = scheduleFrom(
    [fixed("Registration", 10000), fixed("Application", 200000, step("AUSBILDUNG", "9")), fixed("Second", 25000, step("NCLEX", "SECOND_SERVICE_CHARGE"))],
    null,
    "2026-10-26",
    18,
  );
  assert.deepEqual(
    rows.map((r) => [r.dueOn, r.stepPathway, r.stepKey]),
    [["2026-10-26", null, null], [null, "AUSBILDUNG", "9"], [null, "NCLEX", "SECOND_SERVICE_CHARGE"]],
  );
  assert.equal(instalmentDueWords({ stepPathway: "AUSBILDUNG", stepKey: "9" }), "at Ausbildung step 9, profile submission to employers");
  assert.equal(instalmentDueWords({ stepPathway: "NCLEX", stepKey: "SECOND_SERVICE_CHARGE" }), 'when "Second service charge payment" is completed');
  assert.equal(instalmentDueWords({ stepPathway: "JOURNEY", stepKey: "OFFER" }), "on offer");
  assert.equal(instalmentDueWords({ stepPathway: "JOURNEY", stepKey: "NOWHERE" }), "on a stage not recorded");
  assert.equal(instalmentDueWords({ stepPathway: "SOMETHING_ELSE", stepKey: "X" }), "at a step not recorded");
});

test("a plan refuses a step that cannot bring an instalment due", () => {
  // Step 2, registration, has no status that puts a file at it, so nothing would ever raise the invoice.
  assert.match(planProblem([fixed("A", 100, step("AUSBILDUNG", "2"))])!, /choose the stage or step/);
  assert.match(planProblem([fixed("A", 100, step("NCLEX", null))])!, /choose the stage or step/);
  assert.match(planProblem([fixed("A", 100, step("NOT_A_PATHWAY", "OFFER"))])!, /choose the stage or step/);
  assert.match(planProblem([fixed("A", 100, { gstPercent: 40 })])!, /between 0 and 28/);
  assert.equal(planProblem([fixed("A", 100, step("AUSBILDUNG", "11")), fixed("B", 100, step("NCLEX", "VISA_SCREENING", { gstPercent: null }))]), null);
});

test("a step is a pathway and a key, read the same way whichever pathway it is", () => {
  assert.deepEqual(FEE_STEP_PATHWAYS.map((p) => p.key), ["JOURNEY", "AUSBILDUNG", "NCLEX", "FSJ_BFD"]);
  assert.ok(isFeeStep("JOURNEY", "OFFER"));
  assert.ok(isFeeStep("AUSBILDUNG", "11"));
  assert.ok(!isFeeStep("AUSBILDUNG", "11.5"));
  assert.ok(!isFeeStep("JOURNEY", null));
  assert.equal(feeStepWords("AUSBILDUNG", "11"), "at Ausbildung step 11, training contract (ausbildungsvertrag)");
  // One "due" choice per pathway, after the three kinds of day.
  assert.deepEqual(DUE_CHOICES.map((c) => c.value), ["ON_APPLY", "DAYS", "DATE", "JOURNEY", "AUSBILDUNG", "NCLEX", "FSJ_BFD"]);
  const at = { JOURNEY: ["OFFER"], AUSBILDUNG: ["10"], NCLEX: ["SECOND_SERVICE_CHARGE"] };
  assert.ok(feeStepReached("JOURNEY", "APPLICATION", at));
  assert.ok(!feeStepReached("JOURNEY", "VISA", at));
  assert.ok(feeStepReached("AUSBILDUNG", "9", at));
  assert.ok(!feeStepReached("AUSBILDUNG", "11", at));
  assert.ok(feeStepReached("NCLEX", "SECOND_SERVICE_CHARGE", at));
  assert.ok(!feeStepReached("NCLEX", "VISA_SCREENING", at));
  // A pathway the file has no progress on, or one not listed, never brings anything due.
  assert.ok(!feeStepReached("JOURNEY", "PROFILE", { AUSBILDUNG: ["19"] }));
  assert.ok(!feeStepReached("FSJ", "ANY", { FSJ: ["ANY"] }));
});

test("FSJ and BFD share one list of steps, the process's own, read in words and reached at the step or after", () => {
  assert.equal(FSJ_FEE_PATHWAY, "FSJ_BFD");
  const fsj = FEE_STEP_PATHWAYS.find((p) => p.key === FSJ_FEE_PATHWAY)!;
  // Every step a status can put a file at, and none that no status reaches.
  assert.deepEqual(
    fsj.steps.map((s) => s.key),
    FSJ_STEPS.filter((s) => s.statusCodes.length > 0).map((s) => String(s.step)),
  );
  assert.ok(!isFeeStep(FSJ_FEE_PATHWAY, "1"), "step 1, the enquiry, has no status, so nothing would raise the invoice");
  assert.ok(isFeeStep(FSJ_FEE_PATHWAY, "2"));
  assert.equal(feeStepWords(FSJ_FEE_PATHWAY, "6"), "at FSJ / BFD step 6, payment status check and application start");
  assert.equal(feeStepWords(FSJ_FEE_PATHWAY, "99"), "at an FSJ / BFD step not recorded");
  assert.ok(fsjStepReached(10, 10));
  assert.ok(fsjStepReached(2, 6));
  assert.ok(!fsjStepReached(12, 11));
  // A file on interview preparation (step 7) has reached registration and the application fee, not the offer.
  const at = { [FSJ_FEE_PATHWAY]: [String(fsjStepOf("INTERVIEW_PREPARATION")!.step)] };
  assert.ok(feeStepReached(FSJ_FEE_PATHWAY, "2", at));
  assert.ok(feeStepReached(FSJ_FEE_PATHWAY, "6", at));
  assert.ok(!feeStepReached(FSJ_FEE_PATHWAY, "10", at));
  // Progress on another pathway never brings an FSJ / BFD instalment due.
  assert.ok(!feeStepReached(FSJ_FEE_PATHWAY, "2", { AUSBILDUNG: ["19"], JOURNEY: ["ARRIVED"] }));
  assert.equal(planProblem([fixed("A", 100, step(FSJ_FEE_PATHWAY, "12"))]), null);
  assert.match(planProblem([fixed("A", 100, step(FSJ_FEE_PATHWAY, "1"))])!, /choose the stage or step/);
});

test("an Ausbildung instalment falls due at its step and every step after", () => {
  assert.ok(ausbildungStepReached(11, 11));
  assert.ok(ausbildungStepReached(9, 12));
  assert.ok(!ausbildungStepReached(12, 11));
});

test("an NCLEX-RN instalment falls due on its step or a later one, but a re-examination never bills the visa screening", () => {
  assert.ok(nclexStepReached("SECOND_SERVICE_CHARGE", "SECOND_SERVICE_CHARGE"));
  assert.ok(nclexStepReached("SECOND_SERVICE_CHARGE", "EXAM_BOOKED"));
  assert.ok(!nclexStepReached("EXAM_BOOKED", "SECOND_SERVICE_CHARGE"));
  assert.ok(nclexStepReached("VISA_SCREENING", "VISA_SCREENING"));
  assert.ok(!nclexStepReached("VISA_SCREENING", "REEXAMINATION"));
  assert.ok(nclexStepReached("EXAM_FEE", "REEXAMINATION"));
});

test("an instalment's own GST rate wins over the plan's, and a rate not recorded stays not recorded", () => {
  assert.equal(itemGst({}, 18), 18);
  assert.equal(itemGst({ gstPercent: null }, 18), null);
  assert.equal(itemGst({ gstPercent: 5 }, 18), 5);
  assert.equal(itemGst({}, null), null);
  assert.equal(gstWords(null), "Not recorded");
  assert.equal(gstWords(18), "18%");
  const rows = scheduleFrom([fixed("A", 100), fixed("B", 100, { gstPercent: null })], null, "2026-10-26", 18);
  assert.deepEqual(rows.map((r) => r.gstPercent), [18, null]);
});

// ---------- Starter plans from the fee sheets ----------

/** "₹2,00,000" as written on a sheet, to the number. */
const sheetRupees = (s: string) => Number(s.replace(/[₹,]/g, ""));

test("every starter plan's amounts and rates are the ones its fee sheet writes, and nothing else", () => {
  assert.equal(new Set(STARTER_PLANS.map((p) => p.key)).size, STARTER_PLANS.length);
  for (const p of STARTER_PLANS) {
    assert.equal(planProblem(p.items), null, p.key);
    // One "label: ₹amount + rate" per instalment, in order, from the sheet's own words.
    const lines = [...p.source.matchAll(/([^.:]+?): (₹[\d,]+) \+ (18% GST|GST)/g)].filter((m) => !/^\s*Total/.test(m[1]));
    assert.equal(lines.length, p.items.length, `${p.key}: one sheet line per instalment`);
    p.items.forEach((it, k) => {
      const [, label, amount, rate] = lines[k];
      assert.ok(label.trim().endsWith(it.label), `${p.key}: "${it.label}" is the sheet's "${label.trim()}"`);
      assert.equal(it.amount, sheetRupees(amount), `${p.key}: ${it.label} amount`);
      assert.equal(it.share, null, `${p.key}: fixed amounts, as the sheet writes them`);
      assert.equal(itemGst(it, p.gstPercent), rate === "18% GST" ? 18 : null, `${p.key}: ${it.label} GST is the sheet's, or not recorded`);
    });
    // The sheet's total, where it gives one in rupees, is what the instalments add up to.
    const total = p.source.match(/Total: (?:[^₹]*)(₹[\d,]+)/);
    if (total) assert.equal(p.items.reduce((s, i) => s + (i.amount ?? 0), 0), sheetRupees(total[1]), `${p.key}: adds up to the sheet's total`);
  }
});

test("the FSJ and BFD starter is the sheet's four instalments, tied to the FSJ / BFD steps they name", () => {
  const fsj = STARTER_PLANS.find((p) => p.key === "fsj-bfd")!;
  assert.deepEqual(
    fsj.items.map((i) => [i.label, i.amount, i.due, i.pathway ?? null, i.stepKey ?? null]),
    [
      ["Registration", 10000, "STEP", "FSJ_BFD", "2"],
      ["Application", 200000, "STEP", "FSJ_BFD", "6"],
      ["After Receiving Offer Letter", 200000, "STEP", "FSJ_BFD", "10"],
      ["Before Visa Submission", 90000, "STEP", "FSJ_BFD", "12"],
    ],
  );
  assert.equal(fsj.gstPercent, 18);
  // Registration at registration, the application fee at the payment check
  // where the application starts, the offer-letter stage at the offer and
  // contract, and the pre-visa payment where it is verified before VFS.
  assert.deepEqual(
    fsj.items.map((i) => FSJ_STEPS.find((s) => String(s.step) === i.stepKey)!.statusCodes[0]),
    ["REGISTRATION", "PAYMENT_CHECK", "EMPLOYER_CONFIRMED", "PRE_VISA_DOCUMENTS"],
  );
});

test("Ausbildung starters wait for guide steps a status can reach, NCLEX-RN starters for placement steps", () => {
  for (const p of STARTER_PLANS.filter((x) => x.key.startsWith("ausbildung"))) {
    const steps = p.items.filter((i) => i.due === "STEP");
    assert.ok(steps.length > 0 && steps.every((i) => i.pathway === "AUSBILDUNG"), p.key);
    for (const it of steps) assert.ok(AUSBILDUNG_STEPS.find((s) => String(s.step) === it.stepKey)!.statusCodes.length > 0, `${p.key}: step ${it.stepKey}`);
  }
  const nclex = STARTER_PLANS.find((p) => p.key === "nclex-rn-service-medcity")!;
  assert.deepEqual(nclex.items.map((i) => (i.due === "STEP" ? `${i.pathway}:${i.stepKey}` : null)), [null, "NCLEX:SECOND_SERVICE_CHARGE", "NCLEX:VISA_SCREENING"]);
});

test("no starter plan carries a long dash", () => {
  assert.ok(!JSON.stringify(STARTER_PLANS).includes("\u2014"));
});

test("the migration puts in exactly the starter plans this file lists", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const file = readdirSync("drizzle").find((f) => /_crm_billing\.sql$/.test(f));
  assert.ok(file, "the student fees migration is there");
  const sqlText = readFileSync(`drizzle/${file}`, "utf8");
  for (const p of STARTER_PLANS) {
    const items = JSON.stringify(p.items).replace(/'/g, "''");
    assert.ok(sqlText.includes(`'starter-${p.key}', '${p.key}', '${p.name.replace(/'/g, "''")}'`), `${p.key} is put in`);
    assert.ok(sqlText.includes(`'${items}'`), `${p.key}: its instalments are the ones listed here`);
  }
  assert.equal((sqlText.match(/\('starter-/g) ?? []).length, STARTER_PLANS.length);
});
