export const TICKET_CATEGORIES = ["APPLICATION", "COMMISSION", "CATALOGUE", "ACCESS", "OTHER"] as const;
export const TICKET_STATUSES = ["OPEN", "WAITING_PARTNER", "RESOLVED"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  APPLICATION: "An application or offer",
  COMMISSION: "Commission or payout",
  CATALOGUE: "A program or fee that looks wrong",
  ACCESS: "Sign in, users or seats",
  OTHER: "Something else",
};
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { OPEN: "With the Overseas team", WAITING_PARTNER: "Waiting on you", RESOLVED: "Resolved" };
export const TICKET_STATUS_TONE: Record<TicketStatus, "warn" | "info" | "ok"> = { OPEN: "warn", WAITING_PARTNER: "info", RESOLVED: "ok" };
