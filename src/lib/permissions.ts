import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SessionUser } from "./auth";

export const STAFF_ROLES = ["ADMIN", "MANAGEMENT"] as const;
export const PARTNER_ROLES = ["PARTNER", "COUNSELLOR"] as const;

export function isStaff(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "MANAGEMENT";
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
  return user.role === "ADMIN";
}

/** Passport and ID numbers are masked unless the role needs them (DPDP Act basics). */
export function canSeeFullPassport(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "PARTNER";
}

export function maskPassport(value: string | null | undefined) {
  if (!value) return "";
  if (value.length <= 3) return "•••";
  return value[0] + "•".repeat(Math.max(3, value.length - 3)) + value.slice(-2);
}
