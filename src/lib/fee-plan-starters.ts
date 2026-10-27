/**
 * The starter fee plans, taken from Medcity's own fee sheets (the programme
 * sheets the CRM keeps in src/data/medcity-programmes.ts).
 *
 * Every amount and every GST rate is the sheet's, word for word in `source`
 * and as a number in the items. Nothing is converted or worked out: where a
 * sheet says "+ GST" without a rate, the instalment's rate is null and reads
 * "Not recorded"; where a sheet quotes a fee in US dollars, it is left off the
 * plan and named in the note, because the portal bills in rupees and a
 * dollar fee turned into rupees would be a figure nobody wrote.
 *
 * When each instalment falls due is the one thing the sheet says in words
 * ("After Receiving Offer Letter", "Before Visa Submission"), so it is tied to
 * the matching step (src/lib/fee-steps.ts): a journey stage, an Ausbildung
 * step, an NCLEX-RN step or an FSJ / BFD step. Finance can change any of it
 * on the Fee plans screen.
 *
 * These are put in by the "Migration for student fees" migration, once each,
 * by their key. Editing this list does not change plans already in a
 * database: a change to a starter goes in by a new data migration as well,
 * never by editing that one. tests/student-fees.test.ts holds the list to its
 * sources.
 */
import type { JourneyStage } from "@/db/schema";
import type { NclexStepKey } from "./nclex";
import { FSJ_FEE_PATHWAY } from "./fee-steps";
import type { FeePlanItem } from "./student-fees";

export type StarterPlan = {
  key: string;
  name: string;
  /** The sheet's own fee lines, as written (dashes in labels given as commas). */
  source: string;
  note: string | null;
  gstPercent: number | null;
  items: FeePlanItem[];
};

const on = (label: string, amount: number): FeePlanItem => ({ label, amount, share: null, due: "ON_APPLY" });
const atStep = (label: string, amount: number, pathway: string, stepKey: string, gst?: number | null): FeePlanItem => ({
  label,
  amount,
  share: null,
  due: "STEP",
  pathway,
  stepKey,
  ...(gst !== undefined ? { gstPercent: gst } : {}),
});
const atStage = (label: string, amount: number, stage: JourneyStage) => atStep(label, amount, "JOURNEY", stage);
const atAusbildung = (label: string, amount: number, step: number) => atStep(label, amount, "AUSBILDUNG", String(step));
const atNclex = (label: string, amount: number, step: NclexStepKey, gst?: number | null) => atStep(label, amount, "NCLEX", step, gst);
const atFsj = (label: string, amount: number, step: number) => atStep(label, amount, FSJ_FEE_PATHWAY, String(step));

/*
 * FSJ / BFD steps used below, from src/lib/fsj.ts: 2 is "Registration and
 * agreement", 6 is "Payment status check and application start" (the
 * application fee is checked there before the application starts), 10 is
 * "Employer confirmation and contract" (the offer letter) and 12 is "Visa
 * document preparation" (the pre-visa payment is verified there, before the
 * visa is submitted at step 13).
 *
 * Ausbildung steps used below, from src/lib/ausbildung.ts: 9 is "Profile
 * submission to employers" (the application), 11 is "Training contract" (the
 * offer letter) and 12 is "Pre-visa documentation" (before the visa is
 * submitted at step 13).
 */
export const STARTER_PLANS: StarterPlan[] = [
  {
    key: "fsj-bfd",
    name: "FSJ and BFD, Germany",
    source:
      "Registration: ₹10,000 + 18% GST. Application: ₹2,00,000 + 18% GST. After Receiving Offer Letter: ₹2,00,000 + 18% GST. Before Visa Submission: ₹90,000 + 18% GST. Total: ₹5,00,000 + 18% GST.",
    note: "Airfare not included.",
    gstPercent: 18,
    items: [
      atFsj("Registration", 10000, 2),
      atFsj("Application", 200000, 6),
      atFsj("After Receiving Offer Letter", 200000, 10),
      atFsj("Before Visa Submission", 90000, 12),
    ],
  },
  {
    key: "nursing-assistant-germany",
    name: "Nursing Assistant Program, Germany",
    source:
      "Registration: ₹10,000 + 18% GST. Application: ₹2,00,000 + 18% GST. After Receiving Offer Letter: ₹2,00,000 + 18% GST. Before Visa Submission: ₹90,000 + 18% GST. Total: ₹5,00,000 + 18% GST (4 instalments).",
    note: "Airfare not included.",
    gstPercent: 18,
    items: [
      on("Registration", 10000),
      atStage("Application", 200000, "APPLICATION"),
      atStage("After Receiving Offer Letter", 200000, "OFFER"),
      atStage("Before Visa Submission", 90000, "VISA"),
    ],
  },
  {
    key: "ausbildung-general-b1-full-b2-part",
    name: "Ausbildung Program (General), for B1 Full/B2 Part",
    source:
      "For B1 Full/B2 Part, Registration: ₹10,000 + 18% GST. For B1 Full/B2 Part, Application: ₹2,00,000 + 18% GST. For B1 Full/B2 Part, After offer letter: ₹2,00,000 + 18% GST. For B1 Full/B2 Part, Before visa submission: ₹90,000 + 18% GST. Total: B1/B2 Part ₹5,00,000 + GST.",
    note:
      "Refund policy: if candidate withdraws after B2 completion, course fee is deducted and balance refunded. If Medcity fails to secure Ausbildung admission within 1 year of B2 completion, full fee refunded.",
    gstPercent: 18,
    items: [on("Registration", 10000), atAusbildung("Application", 200000, 9), atAusbildung("After offer letter", 200000, 11), atAusbildung("Before visa submission", 90000, 12)],
  },
  {
    key: "ausbildung-general-b2-full",
    name: "Ausbildung Program (General), for B2 Full",
    source:
      "For B2 Full, Registration: ₹10,000 + 18% GST. For B2 Full, Application: ₹2,00,000 + 18% GST. For B2 Full, After offer letter: ₹2,00,000 + 18% GST. For B2 Full, Before visa submission: ₹40,000 + 18% GST. Total: B2 Full ₹4,50,000 + GST.",
    note:
      "Refund policy: if candidate withdraws after B2 completion, course fee is deducted and balance refunded. If Medcity fails to secure Ausbildung admission within 1 year of B2 completion, full fee refunded.",
    gstPercent: 18,
    items: [on("Registration", 10000), atAusbildung("Application", 200000, 9), atAusbildung("After offer letter", 200000, 11), atAusbildung("Before visa submission", 40000, 12)],
  },
  {
    key: "ausbildung-nursing-without-interview",
    name: "Ausbildung Nursing (Without Interview)",
    source:
      "Registration: ₹10,000 + 18% GST. Application: ₹2,50,000 + 18% GST. After Receiving Offer Letter: ₹2,50,000 + 18% GST. Before Visa Submission: ₹1,90,000 + 18% GST. Total: ₹7,00,000 + GST (4 instalments).",
    // Put on plans already in a database by the fee_schedule_guard migration.
    note: "Candidate must additionally pay a refundable €1,000 to the employer.",
    gstPercent: 18,
    items: [
      on("Registration", 10000),
      atAusbildung("Application", 250000, 9),
      atAusbildung("After Receiving Offer Letter", 250000, 11),
      atAusbildung("Before Visa Submission", 190000, 12),
    ],
  },
  {
    key: "nclex-rn-service-medcity",
    name: "NCLEX-RN Registration and Coaching, service charge (Medcity students)",
    source:
      "Service, Initial Payment: ₹25,000 + 18% GST. Service, Second Payment: ₹25,000 + 18% GST. Service, Third (visa screen), Medcity students: ₹10,000 + GST.",
    note:
      "The third payment's sheet line says + GST without a rate, so its rate is not recorded. The sheet's fees in US dollars (credential evaluation, board of nursing application, exam registration, exam scheduling, visa screen) and the optional Quick Result are not on this plan. No Refund Policy applies.",
    gstPercent: 18,
    items: [
      { label: "Service, Initial Payment", amount: 25000, share: null, due: "ON_APPLY" },
      atNclex("Service, Second Payment", 25000, "SECOND_SERVICE_CHARGE"),
      atNclex("Service, Third (visa screen), Medcity students", 10000, "VISA_SCREENING", null),
    ],
  },
  {
    key: "nclex-rn-service-outside",
    name: "NCLEX-RN Registration and Coaching, service charge (outside candidates)",
    source:
      "Service, Initial Payment: ₹25,000 + 18% GST. Service, Second Payment: ₹25,000 + 18% GST. Service, Third (visa screen), outside candidates: ₹25,000 + GST.",
    note:
      "The third payment's sheet line says + GST without a rate, so its rate is not recorded. The sheet's fees in US dollars (credential evaluation, board of nursing application, exam registration, exam scheduling, visa screen) and the optional Quick Result are not on this plan. No Refund Policy applies.",
    gstPercent: 18,
    items: [
      { label: "Service, Initial Payment", amount: 25000, share: null, due: "ON_APPLY" },
      atNclex("Service, Second Payment", 25000, "SECOND_SERVICE_CHARGE"),
      atNclex("Service, Third (visa screen), outside candidates", 25000, "VISA_SCREENING", null),
    ],
  },
];
