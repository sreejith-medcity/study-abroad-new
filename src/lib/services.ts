export const SERVICE_TYPES = ["EDUCATION_LOAN", "FOREX", "ACCOMMODATION", "INSURANCE", "FLIGHT", "SIM", "PICKUP", "OTHER"] as const;
export const SERVICE_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "CANCELLED", "DECLINED"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_LABEL: Record<ServiceType, string> = {
  EDUCATION_LOAN: "Education loan",
  FOREX: "Forex and money transfer",
  ACCOMMODATION: "Accommodation",
  INSURANCE: "Health or travel insurance",
  FLIGHT: "Flight tickets",
  SIM: "SIM card",
  PICKUP: "Airport pickup",
  OTHER: "Something else",
};

export const SERVICE_HINT: Record<ServiceType, string> = {
  EDUCATION_LOAN: "Amount needed, collateral available, co-applicant",
  FOREX: "Amount, currency and what it is for (tuition, GIC, blocked account)",
  ACCOMMODATION: "City, budget per week or month, move-in date",
  INSURANCE: "Cover needed (OSHC, health, travel) and start date",
  FLIGHT: "From, to, travel date",
  SIM: "Destination, whether they want it before they fly or on arrival",
  PICKUP: "Airport, arrival date and time, how many bags",
  OTHER: "What the student needs",
};

/**
 * "Declined" is the student's answer, "cancelled" is ours. The departure board
 * and the leakage report read the difference, so the wording has to carry it.
 */
export const STATUS_LABEL: Record<ServiceStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
  DECLINED: "Student said no",
};
export const STATUS_TONE: Record<ServiceStatus, "info" | "warn" | "ok" | "neutral"> = { NEW: "info", IN_PROGRESS: "warn", DONE: "ok", CANCELLED: "neutral", DECLINED: "neutral" };
