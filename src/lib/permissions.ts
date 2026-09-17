import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SessionUser } from "./auth";

/** Roles that work inside Medcity Overseas rather than at a partner. */
export const STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGEMENT"] as const;
/** Roles that can process applications: everything an admin can do. */
export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
export const PARTNER_ROLES = ["PARTNER", "COUNSELLOR"] as const;
/** Every signed-in role that uses the internal app shell. */
export const APP_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"] as const;

/** One label per role, used in the header, the people table and confirmations. */
export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Overseas admin",
  MANAGEMENT: "Management",
  PARTNER: "Partner owner",
  COUNSELLOR: "Counsellor",
  STUDENT: "Student",
};

export function isStaff(user: SessionUser) {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN" || user.role === "MANAGEMENT";
}

/** Processes applications: status changes, programs, partners, documents. */
export function isAdmin(user: SessionUser) {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN";
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

export function canManageUsers(user: SessionUser) {
  return isSuperAdmin(user);
}

export function canResetPasswords(user: SessionUser) {
  return isSuperAdmin(user);
}

export function canViewAuditLog(user: SessionUser) {
  return isSuperAdmin(user);
}

/** Passport and ID numbers are masked unless the role needs them (DPDP Act basics). */
export function canSeeFullPassport(user: SessionUser) {
  return isAdmin(user) || user.role === "PARTNER";
}

export function maskPassport(value: string | null | undefined) {
  if (!value) return "";
  if (value.length <= 3) return "•••";
  return value[0] + "•".repeat(Math.max(3, value.length - 3)) + value.slice(-2);
}
