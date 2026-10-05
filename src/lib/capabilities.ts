import { APP_ROLES } from "@/lib/permissions";

/**
 * What each role may do, as something Medcity sets rather than something the
 * code decides.
 *
 * Every capability here starts at exactly what the portal did before this
 * screen existed, so turning it on changes nothing until somebody ticks a box.
 * The defaults are the record of how it used to work: read them as the answer
 * to "what was this before we touched it".
 *
 * Two things no tick can change, because a settings screen that can lock
 * everybody out of the settings screen is a trap rather than a feature:
 * a super admin keeps everything, and a student or a parent never gains any of
 * it whatever the matrix says.
 */

export const CAPABILITIES = [
  "SEE_MONEY",
  "DECIDE_DOCUMENTS",
  "READ_INVOICES",
  "RAISE_INVOICES",
  "SEE_FULL_PASSPORT",
  "VIEW_AUDIT_LOG",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type AppRole = (typeof APP_ROLES)[number];

export const CAPABILITY_LABEL: Record<Capability, string> = {
  SEE_MONEY: "See money",
  DECIDE_DOCUMENTS: "Accept or send back a document",
  READ_INVOICES: "Read the invoice queue",
  RAISE_INVOICES: "Raise and send an invoice",
  SEE_FULL_PASSPORT: "See a whole passport number",
  VIEW_AUDIT_LOG: "Read the audit log",
};

export const CAPABILITY_MEANS: Record<Capability, string> = {
  SEE_MONEY: "Commission figures in search and on a course, the student's income sheet, the wallet and the Monday read.",
  DECIDE_DOCUMENTS:
    "Checking what a student sent in. A branch also needs its own first pass switched on, on the Partners screen, and nobody ever passes a document they uploaded themselves.",
  READ_INVOICES: "What is owed by each vendor, and what is late. A branch owner sees only their own students' lines.",
  RAISE_INVOICES: "Turning what is owed into an invoice against a billing company, and sending it.",
  SEE_FULL_PASSPORT: "The whole number rather than the first and last characters. Every reveal is in the audit log either way.",
  VIEW_AUDIT_LOG: "Who did what, across the whole portal.",
};

/**
 * How the portal behaved before this screen existed.
 *
 * SUPER_ADMIN is left out on purpose: it is not a default anybody can change,
 * it is the rule below.
 */
export const DEFAULTS: Record<Capability, AppRole[]> = {
  SEE_MONEY: ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"],
  DECIDE_DOCUMENTS: ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION"],
  READ_INVOICES: ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "MANAGEMENT", "PARTNER"],
  RAISE_INVOICES: ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"],
  SEE_FULL_PASSPORT: ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "PARTNER"],
  VIEW_AUDIT_LOG: ["SUPER_ADMIN"],
};

/** A capability nobody may take off a super admin, whatever the matrix says. */
export const ALWAYS_SUPER_ADMIN = true;

export type Override = { role: string; capability: string; allowed: boolean };

/**
 * Whether this role may do this, given what Medcity has set.
 *
 * An override decides it where one exists; otherwise the portal's own default
 * stands. A super admin is never refused and a family role is never granted,
 * both before the overrides are consulted, so neither can be set by accident.
 */
export function roleCan(role: string, capability: Capability, overrides: Override[] = []): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (!(APP_ROLES as readonly string[]).includes(role)) return false;
  const set = overrides.find((o) => o.role === role && o.capability === capability);
  if (set) return set.allowed;
  return (DEFAULTS[capability] as readonly string[]).includes(role);
}

/** The roles a matrix row offers, which is every role but the one that always may. */
export const SETTABLE_ROLES = APP_ROLES.filter((r) => r !== "SUPER_ADMIN");

/** Whether a tick differs from how the portal behaves out of the box. */
export const isChanged = (role: string, capability: Capability, allowed: boolean) =>
  allowed !== (DEFAULTS[capability] as readonly string[]).includes(role);

/** What to say above the matrix, so nobody wonders whether it is on. */
export function matrixSummary(overrides: Override[]): string {
  const real = overrides.filter((o) => isChanged(o.role, o.capability as Capability, o.allowed));
  if (real.length === 0) return "Nothing is changed from how the portal works out of the box.";
  return `${real.length} ${real.length === 1 ? "thing is" : "things are"} set differently from how the portal works out of the box.`;
}
