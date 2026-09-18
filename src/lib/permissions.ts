import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SessionUser } from "./auth";

/** Roles that work inside Medcity Overseas rather than at a partner. */
export const STAFF_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "MANAGEMENT"] as const;
/** Roles that process applications: status changes, programs, partners, money. */
export const ADMIN_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"] as const;
/** Everyone who reads the numbers: admins and management, but not the documentation team. */
export const REPORTING_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "MANAGEMENT"] as const;
/** Admins plus the documentation team, who work the same files without moving them. */
export const PROCESSING_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION"] as const;
export const PARTNER_ROLES = ["PARTNER", "COUNSELLOR"] as const;
/** Every signed-in role that uses the internal app shell. */
export const APP_ROLES = [
  "SUPER_ADMIN",
  "OPS_MANAGER",
  "ADMIN",
  "DOCUMENTATION",
  "MANAGEMENT",
  "PARTNER",
  "COUNSELLOR",
] as const;

/** One label per role, used in the header, the people table and confirmations. */
export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  OPS_MANAGER: "Ops manager",
  ADMIN: "Overseas admin",
  DOCUMENTATION: "Documentation team",
  MANAGEMENT: "Management",
  PARTNER: "Branch head",
  COUNSELLOR: "Counsellor",
  STUDENT: "Student",
};

/** One line each, shown wherever a role is chosen, so the choice is informed. */
export const ROLE_BLURB: Record<string, string> = {
  SUPER_ADMIN: "Owns the platform: every admin power, plus accounts, roles and the audit log",
  OPS_MANAGER: "Runs the desk: everything an admin does, plus partners, commission and staff accounts",
  ADMIN: "Processes applications: statuses, work queue, programs, partners and documents",
  DOCUMENTATION: "Works the files: documents, the pre-submission check and messages, without moving statuses",
  MANAGEMENT: "Reads everything, changes nothing",
  PARTNER: "Runs a branch or sub-agent: their own students, applications, team and wallet",
  COUNSELLOR: "Works their own students inside one branch",
  STUDENT: "Sees only their own application, in the student portal",
};

/** Roles that belong to Medcity Overseas itself rather than to a partner. */
export const HQ_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "MANAGEMENT"] as const;

export function isStaff(user: SessionUser) {
  return (HQ_ROLES as readonly string[]).includes(user.role);
}

/** Processes applications: status changes, programs, partners, documents, money. */
export function isAdmin(user: SessionUser) {
  return (ADMIN_ROLES as readonly string[]).includes(user.role);
}

/** The documentation team: the same files as an admin, but read-only on status. */
export function isDocumentationTeam(user: SessionUser) {
  return user.role === "DOCUMENTATION";
}

/** Can open a student file and work its documents, checks and messages. */
export function canWorkFiles(user: SessionUser) {
  return isAdmin(user) || isDocumentationTeam(user) || isPartner(user);
}

/**
 * Owns the platform itself. On top of everything an admin can do:
 * create and deactivate Medcity Overseas staff, change anyone's role,
 * reset passwords, and read the audit log.
 */
export function isSuperAdmin(user: SessionUser) {
  return user.role === "SUPER_ADMIN";
}

export function isPartner(user: SessionUser) {
  return user.role === "PARTNER" || user.role === "COUNSELLOR";
}

/**
 * Row scope for partner users: they only ever see their own organisation's data.
 * Medcity Overseas staff see everything. Returns undefined when no filter applies.
 */
export function orgScope(user: SessionUser, orgColumn: PgColumn): SQL | undefined {
  return isStaff(user) ? undefined : eq(orgColumn, user.orgId);
}

export function canChangeStatus(user: SessionUser) {
  return isAdmin(user);
}

/** Adding staff, changing roles: a super admin or an ops manager. */
export function canManageUsers(user: SessionUser) {
  return isSuperAdmin(user) || user.role === "OPS_MANAGER";
}

export function canResetPasswords(user: SessionUser) {
  return canManageUsers(user);
}

/** Only a super admin may create or change another super admin. */
export function canManageSuperAdmins(user: SessionUser) {
  return isSuperAdmin(user);
}

/** Commission rules, settlements and payouts. */
export function canManageMoney(user: SessionUser) {
  return isAdmin(user);
}

/** Platform-wide settings: names, branding, SLA days, tier targets, exchange rates. */
export function canManageSettings(user: SessionUser) {
  return isSuperAdmin(user);
}

export function canViewAuditLog(user: SessionUser) {
  return isSuperAdmin(user);
}

/** Passport and ID numbers are masked unless the role needs them (DPDP Act basics). */
export function canSeeFullPassport(user: SessionUser) {
  // The documentation team classifies passports, so they need the number.
  return isAdmin(user) || isDocumentationTeam(user) || user.role === "PARTNER";
}

export function maskPassport(value: string | null | undefined) {
  if (!value) return "";
  if (value.length <= 3) return "•••";
  return value[0] + "•".repeat(Math.max(3, value.length - 3)) + value.slice(-2);
}
