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
  assert.deepEqual({ ...eff, source: undefined }, { ...marked, source: undefined });
  assert.deepEqual(Object.values(eff.source), ["MARKED", "MARKED", "MARKED", "MARKED"]);
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
