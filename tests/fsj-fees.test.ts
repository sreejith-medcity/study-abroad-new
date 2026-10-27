import { test } from "node:test";
import assert from "node:assert/strict";
import { FSJ_PAYMENT_STAGES, effectivePayments, fsjPlanPayments, stagePaymentWords, type FsjPayments, type PlanInstalment, type PlanInvoice } from "../src/lib/fsj-fees";
import { feeGate } from "../src/lib/fsj";
import { STARTER_PLANS } from "../src/lib/fee-plan-starters";

const ins = (stepKey: string, state: string, invoiceId: string | null, stepPathway: string | null = "FSJ_BFD"): PlanInstalment => ({ stepPathway, stepKey, state, invoiceId });
const inv = (id: string, state: string, paidOn: string | null = null, number: string | null = `INV-${id}`): PlanInvoice => ({ id, number, state, paidOn });
const marked: FsjPayments = { registrationFeePaidOn: "2026-10-01", applicationFeePaidOn: "2026-10-02", offerPaymentOn: null, preVisaPaymentOn: "2026-10-03" };

test("the payment stages are the FSJ / BFD starter plan's steps, in the sheet's order", () => {
  const fsj = STARTER_PLANS.find((p) => p.key === "fsj-bfd")!;
  assert.deepEqual(
    FSJ_PAYMENT_STAGES.map((s) => String(s.step)),
    fsj.items.map((i) => i.stepKey),
  );
});

test("a student with no instalments on the FSJ / BFD steps has no plan: every stage keeps the day marked on the tab", () => {
  const plan = fsjPlanPayments([ins("OFFER", "SCHEDULED", null, "JOURNEY"), ins("2", "CANCELLED", null)], []);
  assert.equal(plan.planned, false);
  const eff = effectivePayments(marked, plan);
  assert.deepEqual({ ...eff, source: undefined, settled: undefined }, { ...marked, source: undefined, settled: undefined });
  assert.deepEqual(Object.values(eff.source), ["MARKED", "MARKED", "MARKED", "MARKED"]);
  assert.deepEqual(eff.settled, { registration: true, application: true, offer: false, preVisa: true }, "a marked stage is settled when it has a day");
});

test("with a plan, a stage is paid only when its invoice is paid in full, on the day of the last receipt, whatever was marked by hand", () => {
  const plan = fsjPlanPayments(
    [ins("2", "INVOICED", "a"), ins("6", "INVOICED", "b"), ins("10", "SCHEDULED", null), ins("12", "SCHEDULED", null)],
    [inv("a", "PAID", "2026-10-20"), inv("b", "PART_PAID", "2026-10-21")],
  );
  assert.equal(plan.planned, true);
  const eff = effectivePayments(marked, plan);
  assert.equal(eff.registrationFeePaidOn, "2026-10-20");
  // Marked paid on the tab, but the invoice is only part paid: the invoice wins.
  assert.equal(eff.applicationFeePaidOn, null);
  assert.equal(eff.preVisaPaymentOn, null, "a stage still waiting for its step is not paid, whatever was marked");
  assert.deepEqual(feeGate(eff), { clear: false, missing: ["application fee"] });
  assert.deepEqual(eff.source, { registration: "INVOICES", application: "INVOICES", offer: "INVOICES", preVisa: "INVOICES" });
});

test("a stage the plan has no instalment for keeps the day marked on the tab", () => {
  const plan = fsjPlanPayments([ins("6", "INVOICED", "b")], [inv("b", "PAID", "2026-10-22")]);
  const eff = effectivePayments(marked, plan);
  assert.equal(eff.registrationFeePaidOn, "2026-10-01");
  assert.equal(eff.applicationFeePaidOn, "2026-10-22");
  assert.equal(eff.source.registration, "MARKED");
  assert.equal(eff.source.application, "INVOICES");
  assert.deepEqual(feeGate(eff), { clear: true, missing: [] });
});

test("a stage split over two instalments is paid when both invoices are, on the later day; a cancelled instalment does not count", () => {
  const both = fsjPlanPayments([ins("6", "INVOICED", "b"), ins("6", "INVOICED", "c"), ins("6", "CANCELLED", null)], [inv("b", "PAID", "2026-10-22"), inv("c", "PAID", "2026-10-25")]);
  assert.equal(both.stages.application!.paidOn, "2026-10-25");
  const one = fsjPlanPayments([ins("6", "INVOICED", "b"), ins("6", "INVOICED", "c")], [inv("b", "PAID", "2026-10-22"), inv("c", "ISSUED")]);
  assert.equal(one.stages.application!.paidOn, null);
  const written = fsjPlanPayments([ins("6", "INVOICED", "b")], [inv("b", "WRITTEN_OFF", "2026-10-22")]);
  assert.equal(written.stages.application!.paidOn, null, "an invoice written off was not paid");
});

test("each stage read from invoices says where it stands in words", () => {
  const plan = fsjPlanPayments(
    [ins("2", "INVOICED", "a"), ins("6", "INVOICED", "b"), ins("10", "SCHEDULED", null)],
    [inv("a", "PAID", "2026-10-20", "MO/KTM/26-27/0001"), inv("b", "ISSUED", null, "MO/KTM/26-27/0002")],
  );
  assert.equal(stagePaymentWords(plan.stages.registration!), "Paid on 2026-10-20, invoice MO/KTM/26-27/0001");
  assert.equal(stagePaymentWords(plan.stages.application!), "Not paid yet: invoice MO/KTM/26-27/0002 is to pay");
  assert.equal(stagePaymentWords(plan.stages.offer!), "Not invoiced yet: it is raised when the file reaches its step");
  assert.equal(stagePaymentWords(plan.stages.registration!, (d) => d.split("-").reverse().join("/")), "Paid on 20/10/2026, invoice MO/KTM/26-27/0001");
  assert.equal(plan.stages.preVisa, null);
});

test("nothing here carries a long dash", () => {
  const words = [stagePaymentWords({ paidOn: null, waiting: true, invoices: [] }), ...FSJ_PAYMENT_STAGES.map((s) => s.label)];
  assert.ok(!words.join(" ").includes("\u2014"));
});

test("a paid invoice whose money went back in a refund no longer counts as the fee paid", () => {
  const refunded: PlanInvoice = { ...inv("a", "PAID", "2026-10-20"), total: 11800, held: 0 };
  const kept: PlanInvoice = { ...inv("b", "PAID", "2026-10-21"), total: 236000, held: 236000 };
  const plan = fsjPlanPayments([ins("2", "INVOICED", "a"), ins("6", "INVOICED", "b")], [refunded, kept]);
  const eff = effectivePayments(marked, plan);
  assert.equal(eff.registrationFeePaidOn, null);
  assert.equal(eff.applicationFeePaidOn, "2026-10-21");
  assert.deepEqual(feeGate(eff), { clear: false, missing: ["registration fee"] });
});

test("an instalment cancelled while its invoice still stands stays on the stage: a day marked by hand does not get past the unpaid invoice", () => {
  const plan = fsjPlanPayments([ins("6", "CANCELLED", "b")], [inv("b", "ISSUED")]);
  assert.equal(plan.planned, true);
  const eff = effectivePayments(marked, plan);
  assert.equal(eff.source.application, "INVOICES");
  assert.equal(eff.applicationFeePaidOn, null, "marked paid on the tab, but the issued invoice is not paid");
  assert.deepEqual(feeGate(eff), { clear: false, missing: ["application fee"] });
  // Paid, it counts as paid; cancelled with the schedule, the stage falls back to the day marked.
  assert.equal(fsjPlanPayments([ins("6", "CANCELLED", "b")], [inv("b", "PAID", "2026-10-22")]).stages.application!.paidOn, "2026-10-22");
  const gone = fsjPlanPayments([ins("6", "CANCELLED", "b")], [inv("b", "CANCELLED")]);
  assert.equal(gone.stages.application, null);
  assert.equal(effectivePayments(marked, gone).applicationFeePaidOn, "2026-10-02");
});

test("a waived instalment is settled for the gate, with no day of payment invented", () => {
  const plan = fsjPlanPayments([ins("2", "WAIVED", null), ins("6", "INVOICED", "b")], [inv("b", "PAID", "2026-10-22")]);
  const eff = effectivePayments(marked, plan);
  assert.equal(eff.registrationFeePaidOn, null, "nothing was paid, so no day");
  assert.equal(eff.settled.registration, true);
  assert.deepEqual(feeGate(eff), { clear: true, missing: [] });
  assert.equal(stagePaymentWords(plan.stages.registration!), "Waived: nothing is owed for this stage");
  // Half waived, half paid: paid on the day of the paid part.
  const split = fsjPlanPayments([ins("6", "WAIVED", null), ins("6", "INVOICED", "c")], [inv("c", "PAID", "2026-10-25")]);
  assert.equal(split.stages.application!.paidOn, "2026-10-25");
  assert.equal(stagePaymentWords(split.stages.application!), "Paid on 2026-10-25, invoice INV-c, the rest waived");
});

test("a written-off invoice keeps the gate closed until the head office settles the stage", () => {
  const instalments = [ins("2", "INVOICED", "a"), ins("6", "INVOICED", "b")];
  const invoices = [inv("a", "PAID", "2026-10-20"), inv("b", "WRITTEN_OFF", null, "MO/KTM/26-27/0009")];
  const held = fsjPlanPayments(instalments, invoices);
  assert.equal(held.stages.application!.writtenOff, true);
  assert.equal(held.stages.application!.settled, false);
  assert.deepEqual(feeGate(effectivePayments(marked, held)), { clear: false, missing: ["application fee"] });
  assert.equal(stagePaymentWords(held.stages.application!), "Invoice MO/KTM/26-27/0009 is written off: the head office decides whether this file goes on");
  const let_ = fsjPlanPayments(instalments, invoices, ["application"]);
  assert.equal(let_.stages.application!.settled, true);
  assert.equal(let_.stages.application!.paidOn, null, "settled, not paid: no day is invented");
  assert.deepEqual(feeGate(effectivePayments(marked, let_)), { clear: true, missing: [] });
  assert.equal(stagePaymentWords(let_.stages.application!), "Settled by the head office: invoice MO/KTM/26-27/0009 written off");
  // The head office's word lets the written-off invoice through, not another one still to pay.
  const mixed = fsjPlanPayments([ins("6", "INVOICED", "b"), ins("6", "INVOICED", "c")], [inv("b", "WRITTEN_OFF"), inv("c", "ISSUED")], ["application"]);
  assert.equal(mixed.stages.application!.settled, false);
  // A settlement recorded for a stage with nothing written off changes nothing.
  assert.equal(fsjPlanPayments([ins("6", "INVOICED", "c")], [inv("c", "ISSUED")], ["application"]).stages.application!.settled, false);
});

test("a skipped instalment counts through the earlier invoice that billed it, and drops out where there is none", () => {
  const billed = fsjPlanPayments([ins("2", "SKIPPED", "old")], [inv("old", "PAID", "2026-09-01")]);
  assert.equal(billed.stages.registration!.paidOn, "2026-09-01");
  const unbilled = fsjPlanPayments([ins("2", "SKIPPED", null), ins("6", "INVOICED", "b")], [inv("b", "ISSUED")]);
  assert.equal(unbilled.stages.registration, null);
  assert.equal(effectivePayments(marked, unbilled).registrationFeePaidOn, "2026-10-01", "the stage keeps the day marked on the tab");
});
