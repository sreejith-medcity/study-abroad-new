export const DEADLINE_TYPES = ["APPLICATION", "PAYMENT", "CAS_REQUEST", "OFFER_ACCEPTANCE", "GS_SUBMISSION", "ENROLMENT", "VISA", "COURSE_START", "OTHER"] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export const DEADLINE_LABEL: Record<DeadlineType, string> = {
  APPLICATION: "Application",
  PAYMENT: "Payment",
  CAS_REQUEST: "CAS / I-20 / CoE request",
  OFFER_ACCEPTANCE: "Offer acceptance",
  GS_SUBMISSION: "GS / GTE submission",
  ENROLMENT: "Enrolment",
  VISA: "Visa",
  COURSE_START: "Course start",
  OTHER: "Other",
};
/** Dashboard windows, in days from today. */
export const DEADLINE_WINDOWS = [["today", "Today", 0, 0], ["tomorrow", "Tomorrow", 1, 1], ["7", "In 7 days", 0, 7], ["14", "In 14 days", 0, 14]] as const;
