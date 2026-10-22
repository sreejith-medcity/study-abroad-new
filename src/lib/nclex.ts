/**
 * The NCLEX-RN (USA) placement, step by step, as Medcity runs it.
 *
 * Taken from the USA placement sheet the Overseas team works to: every step
 * is Completed or Pending, some carry a file, and the result decides whether
 * the student goes on to visa screening or back to the exam. Kept as a list
 * here rather than in the database because it is a process, not a setting:
 * adding a step is a change to how the work is done, and is made here with
 * the reason in the commit.
 */

export type NclexStepKey =
  | "REGISTERED"
  | "CGFNS_FORM"
  | "CGFNS_ACCOUNT"
  | "CES_CVS_PAYMENT"
  | "CGFNS_SUBMISSION"
  | "CGFNS_PROCESSING"
  | "REQUIRED_DOCUMENTS"
  | "READY_FOR_REVIEW"
  | "CGFNS_REPORT"
  | "SECOND_SERVICE_CHARGE"
  | "STATE_REQUIREMENTS"
  | "BOARD_APPLICATION"
  | "FINAL_SUBMISSION"
  | "WAITING_ATT"
  | "EXAM_APPROVED"
  | "EXAM_FEE"
  | "EXAM_BOOKED"
  | "EXAM_RESULTS"
  | "VISA_SCREENING"
  | "REEXAMINATION";

export type NclexStep = {
  key: NclexStepKey;
  label: string;
  /** What the sheet says beside it, where it says something. */
  hint?: string;
  /** Whether the step carries a file: the sheet's "Browse and Upload". */
  upload?: boolean;
  /** Only after a pass, or only after a fail. */
  after?: "PASS" | "FAIL";
};

export const NCLEX_STEPS: NclexStep[] = [
  { key: "REGISTERED", label: "Registered for the USA NCLEX-RN process" },
  { key: "CGFNS_FORM", label: "CGFNS form shared", hint: "The form is filled and submitted.", upload: true },
  { key: "CGFNS_ACCOUNT", label: "CGFNS account created", hint: "Then the state is chosen and the payment link sent." },
  { key: "CES_CVS_PAYMENT", label: "CES / CVS payment" },
  { key: "CGFNS_SUBMISSION", label: "CGFNS account submitted", upload: true },
  { key: "CGFNS_PROCESSING", label: "CGFNS processing" },
  { key: "REQUIRED_DOCUMENTS", label: "Required documents", upload: true },
  { key: "READY_FOR_REVIEW", label: "Ready for review by CGFNS" },
  { key: "CGFNS_REPORT", label: "CGFNS report issued", upload: true },
  { key: "SECOND_SERVICE_CHARGE", label: "Second service charge payment" },
  { key: "STATE_REQUIREMENTS", label: "Fingerprints / New York course / Nursing Jurisprudence Exam", upload: true },
  { key: "BOARD_APPLICATION", label: "Board application and Pearson VUE payment", upload: true },
  { key: "FINAL_SUBMISSION", label: "Final submission", upload: true },
  { key: "WAITING_ATT", label: "Waiting for ATT" },
  { key: "EXAM_APPROVED", label: "NCLEX-RN exam approved" },
  { key: "EXAM_FEE", label: "Exam fee payment" },
  { key: "EXAM_BOOKED", label: "NCLEX-RN exam booked", hint: "Upload the confirmation if there is one.", upload: true },
  { key: "EXAM_RESULTS", label: "NCLEX-RN exam results" },
  { key: "VISA_SCREENING", label: "Visa screening", after: "PASS" },
  { key: "REEXAMINATION", label: "Re-examination", after: "FAIL" },
];

export const NCLEX_STEP_KEYS = NCLEX_STEPS.map((s) => s.key);

/**
 * The boards a student can be put through, with the fee the placement sheet
 * gives for each, in US dollars.
 */
export const NCLEX_STATES = [
  { code: "FL", name: "Florida", feeUsd: 485 },
  { code: "TX", name: "Texas", feeUsd: 485 },
  { code: "IL", name: "Illinois", feeUsd: 485 },
  { code: "NY", name: "New York", feeUsd: 425 },
] as const;
export type NclexStateCode = (typeof NCLEX_STATES)[number]["code"];

export type NclexResult = "PASS" | "FAIL";

/** The steps that apply to this student: the last one depends on the result. */
export function stepsFor(result: NclexResult | null) {
  return NCLEX_STEPS.filter((s) => !s.after || s.after === result);
}

/**
 * Where a student is: how many of their steps are done, and the first one
 * that is not. Before the result is in, the two branches after it are not
 * counted, because neither applies yet.
 */
export function nclexStanding(done: Set<string>, result: NclexResult | null) {
  const steps = stepsFor(result);
  const finished = steps.filter((s) => done.has(s.key)).length;
  const next = steps.find((s) => !done.has(s.key)) ?? null;
  return { steps, finished, total: steps.length, next };
}
