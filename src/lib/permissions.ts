import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SessionUser } from "./auth";

/** Roles that work inside Medcity Overseas rather than at a partner. */
export const STAFF_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "APPLICATION_TEAM_LEADER", "FINANCE", "MANAGEMENT", "DESK_COUNSELLOR"] as const;
/** Roles that process applications: status changes, programs, partners, money. */
export const ADMIN_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"] as const;
/** Everyone who reads the numbers: admins and management, but not the documentation team. */
export const REPORTING_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "MANAGEMENT", "FINANCE"] as const;
/** Admins plus the documentation team, who work the same files without moving them. */
export const PROCESSING_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "APPLICATION_TEAM_LEADER"] as const;
/**
 * Everybody who works inside one organisation rather than at the desk: a branch
 * or a sub-agent firm. Every screen that scopes by organisation reads this, so a
 * role added here is scoped correctly everywhere at once.
 */
export const PARTNER_ROLES = ["PARTNER", "COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR"] as const;

/**
 * Everybody who works a student's own file: the branch that registered them, the
 * Overseas desk that processes them, and the desk's own counsellors.
 *
 * A desk counsellor advises students across every branch but belongs to none, so
 * they fell outside both of the groups this used to be written as, and could
 * open a student and change nothing on them: not the profile, not the stage, not
 * a comment, not a service request. One group, so the next role added lands in
 * one place rather than forty.
 */
export const STUDENT_WORK_ROLES = ["PARTNER", "COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR", "SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "APPLICATION_TEAM_LEADER", "DESK_COUNSELLOR"] as const;

/**
 * May this user type into a student's file, or only read it?
 *
 * Management reads a file for oversight and finance reads it to reconcile a
 * commission, and neither changes anything on it. The screens asked this by
 * naming MANAGEMENT, which is how finance arrived and was shown a Save button
 * the server then refused: the same bug as a sidebar link to the forbidden
 * screen, and worse, because somebody has already typed into it.
 */
export function worksStudentFiles(user: SessionUser) {
  return (STUDENT_WORK_ROLES as readonly string[]).includes(user.role);
}

/**
 * The roles that advise students, wherever they sit. A student created by one
 * of these is assigned to them by default, because they are the person the
 * student will ring.
 */
export const COUNSELLING_ROLES = ["COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR", "DESK_COUNSELLOR"] as const;

/** A counsellor who works inside one branch, at whatever level. */
export const BRANCH_COUNSELLOR_ROLES = ["COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR"] as const;

export const isCounsellor = (role: string) => (COUNSELLING_ROLES as readonly string[]).includes(role);
/** Every signed-in role that uses the internal app shell. */
export const APP_ROLES = [
  "SUPER_ADMIN",
  "OPS_MANAGER",
  "ADMIN",
  "DOCUMENTATION",
  "APPLICATION_TEAM_LEADER",
  "FINANCE",
  "MANAGEMENT",
  "PARTNER",
  "COUNSELLOR",
  "DESK_COUNSELLOR",
  "SENIOR_COUNSELLOR",
  "TRAINEE_COUNSELLOR",
  "SUB_AGENT_COUNSELLOR",
] as const;

/** One label per role, used in the header, the people table and confirmations. */
export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  OPS_MANAGER: "Ops manager",
  ADMIN: "Overseas admin",
  DOCUMENTATION: "Documentation team",
  APPLICATION_TEAM_LEADER: "Application team leader",
  FINANCE: "Finance",
  MANAGEMENT: "Management",
  PARTNER: "Branch head",
  COUNSELLOR: "Counsellor",
  DESK_COUNSELLOR: "Overseas desk counsellor",
  SENIOR_COUNSELLOR: "Senior counsellor",
  TRAINEE_COUNSELLOR: "Trainee counsellor",
  SUB_AGENT_COUNSELLOR: "Sub-agent counsellor",
  STUDENT: "Student",
  PARENT: "Parent or guardian",
};

/** One line each, shown wherever a role is chosen, so the choice is informed. */
export const ROLE_BLURB: Record<string, string> = {
  SUPER_ADMIN: "Owns the platform: every admin power, plus accounts, roles and the audit log",
  OPS_MANAGER: "Runs the desk: everything an admin does, plus partners, commission and staff accounts",
  ADMIN: "Processes applications: statuses, work queue, programs, partners and documents",
  DOCUMENTATION: "Works the files: documents, the pre-submission check and messages, without moving statuses",
  APPLICATION_TEAM_LEADER: "Runs the documentation desk and works files on it: the whole queue, who is carrying what, and moving a file between officers",
  FINANCE: "The money: what can be invoiced, what has been, credit notes, what is late and what came in. No students, no applications, no documents",
  MANAGEMENT: "Reads everything, changes nothing",
  PARTNER: "Runs a branch or sub-agent: their own students, applications, team and wallet",
  COUNSELLOR: "Works their own students inside one branch",
  DESK_COUNSELLOR: "Advises students across every branch, from the Overseas desk, without processing applications",
  SENIOR_COUNSELLOR: "Runs a branch's students without running the branch: no wallet, no team, no branch settings",
  TRAINEE_COUNSELLOR: "Works their own students while somebody else sends what goes out",
  SUB_AGENT_COUNSELLOR: "Works inside a sub-agent firm, under whoever signed its agreement",
  STUDENT: "Sees only their own application, in the student portal",
  PARENT: "Reads one student's journey and what is outstanding, and changes nothing",
};

/** Roles that belong to Medcity Overseas itself rather than to a partner. */
export const HQ_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "APPLICATION_TEAM_LEADER", "FINANCE", "MANAGEMENT", "DESK_COUNSELLOR"] as const;

/**
 * The family: a student and the parents who read that student's file. Neither
 * belongs anywhere in the staff app, and the two are gated together wherever
 * the question is "is this one of our people or one of theirs".
 */
export const FAMILY_ROLES = ["STUDENT", "PARENT"] as const;

export const isFamilyRole = (role: string) => (FAMILY_ROLES as readonly string[]).includes(role);

/** Where a role lands when it signs in, or when it reaches for a page it may not have. */
export function homeFor(role: string) {
  if (role === "STUDENT") return "/portal";
  if (role === "PARENT") return "/family";
  return "/dashboard";
}

export function isStaff(user: SessionUser) {
  return (HQ_ROLES as readonly string[]).includes(user.role);
}

/** Processes applications: status changes, programs, partners, documents, money. */
export function isAdmin(user: SessionUser) {
  return (ADMIN_ROLES as readonly string[]).includes(user.role);
}

/**
 * The documentation desk: the officers and whoever runs them.
 *
 * Both work the same files on the same terms, so every screen that asks "is
 * this the documentation desk" means both. What the leader has on top is asked
 * for by capability, not by this.
 */
export const DOCUMENTATION_ROLES = ["DOCUMENTATION", "APPLICATION_TEAM_LEADER"] as const;

/** The documentation desk: the same files as an admin, but read-only on status. */
export function isDocumentationTeam(user: SessionUser) {
  return (DOCUMENTATION_ROLES as readonly string[]).includes(user.role);
}

/** Can open a student file and work its documents, checks and messages. */
/**
 * Who may accept a document or send it back.
 *
 * The desk always may. A branch's own staff may only where Medcity has turned
 * the first pass on for that branch, and only, as everywhere else, for their own
 * students: the scope check is the same one every other action uses.
 */
export function mayDecideDocuments(user: SessionUser, branchChecksOwn: boolean) {
  if ((PROCESSING_ROLES as readonly string[]).includes(user.role)) return true;
  return branchChecksOwn && (PARTNER_ROLES as readonly string[]).includes(user.role);
}

/** What the branch is told when it is not their job. */
export const DECIDE_REFUSAL = "The Overseas desk checks documents for this branch.";

/**
 * Nobody marks their own document good.
 *
 * A branch doing its own first pass still needs two pairs of eyes: the person
 * who uploaded a file is not the person who says it is good enough to send. The
 * desk is outside the branch, so it is not bound by this.
 */
export function mayAcceptUpload(user: SessionUser, branchChecksOwn: boolean, uploadedById: string | null) {
  if ((PROCESSING_ROLES as readonly string[]).includes(user.role)) return true;
  if (!mayDecideDocuments(user, branchChecksOwn)) return false;
  return uploadedById !== user.id;
}

export const OWN_UPLOAD_REFUSAL = "Somebody else has to check a document you uploaded yourself.";

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
