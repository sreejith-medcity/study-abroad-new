export const SERVICE_TYPES = ["EDUCATION_LOAN", "FOREX", "ACCOMMODATION", "INSURANCE", "FLIGHT", "OTHER"] as const;
export const SERVICE_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_LABEL: Record<ServiceType, string> = {
  EDUCATION_LOAN: "Education loan",
  FOREX: "Forex and money transfer",
  ACCOMMODATION: "Accommodation",
  INSURANCE: "Health or travel insurance",
  FLIGHT: "Flight tickets",
  OTHER: "Something else",
};

export const SERVICE_HINT: Record<ServiceType, string> = {
  EDUCATION_LOAN: "Amount needed, collateral available, co-applicant",
  FOREX: "Amount, currency and what it is for (tuition, GIC, blocked account)",
  ACCOMMODATION: "City, budget per week or month, move-in date",
  INSURANCE: "Cover needed (OSHC, health, travel) and start date",
  FLIGHT: "From, to, travel date",
  OTHER: "What the student needs",
};

export const STATUS_LABEL: Record<ServiceStatus, string> = { NEW: "New", IN_PROGRESS: "In progress", DONE: "Done", CANCELLED: "Cancelled" };
export const STATUS_TONE: Record<ServiceStatus, "info" | "warn" | "ok" | "neutral"> = { NEW: "info", IN_PROGRESS: "warn", DONE: "ok", CANCELLED: "neutral" };
