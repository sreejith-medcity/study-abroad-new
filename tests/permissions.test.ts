import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ADMIN_ROLES,
  APP_ROLES,
  canChangeStatus,
  canManageUsers,
  canResetPasswords,
  canSeeFullPassport,
  canManageMoney,
  canManageSuperAdmins,
  canViewAuditLog,
  canWorkFiles,
  isAdmin,
  isDocumentationTeam,
  isPartner,
  isStaff,
  isSuperAdmin,
  maskPassport,
  orgScope,
  REPORTING_ROLES,
  ROLE_BLURB,
  ROLE_LABEL,
  STAFF_ROLES,
} from "../src/lib/permissions";
import { schema } from "../src/db";
import type { SessionUser } from "../src/lib/auth";

const as = (role: SessionUser["role"], orgId = "org-1"): SessionUser => ({
  id: `u-${role}`,
  name: role,
  email: `${role.toLowerCase()}@example.com`,
  role,
  orgId,
  orgName: "Org",
  orgType: role === "PARTNER" || role === "COUNSELLOR" ? "BRANCH" : "HQ",
  deskLabel: null,
  studentId: null,
  locale: "en",
  mustChangePassword: false,
});

test("every role has a label and a description, so nobody picks one blind", () => {
  for (const role of schema.role.enumValues) {
    assert.ok(ROLE_LABEL[role], `${role} has no label`);
    assert.ok(ROLE_BLURB[role], `${role} has no description`);
  }
});

test("every role in the app shell exists in the database enum", () => {
  for (const role of APP_ROLES) assert.ok(schema.role.enumValues.includes(role), `${role} missing from the enum`);
  for (const role of schema.role.enumValues) assert.ok(ROLE_LABEL[role], `${role} has no label`);
});

test("accounts and roles are handled by a super admin or an ops manager, the audit log only by a super admin", () => {
  for (const role of schema.role.enumValues) {
    const manages = role === "SUPER_ADMIN" || role === "OPS_MANAGER";
    assert.equal(canManageUsers(as(role)), manages, `canManageUsers(${role})`);
    assert.equal(canResetPasswords(as(role)), manages, `canResetPasswords(${role})`);
    assert.equal(canViewAuditLog(as(role)), role === "SUPER_ADMIN", `canViewAuditLog(${role})`);
    assert.equal(canManageSuperAdmins(as(role)), role === "SUPER_ADMIN", `canManageSuperAdmins(${role})`);
    assert.equal(isSuperAdmin(as(role)), role === "SUPER_ADMIN", `isSuperAdmin(${role})`);
  }
});

test("an ops manager processes like an admin and manages accounts, but never reads the audit log", () => {
  const ops = as("OPS_MANAGER");
  assert.ok(isAdmin(ops));
  assert.ok(isStaff(ops));
  assert.ok(canChangeStatus(ops));
  assert.ok(canManageMoney(ops));
  assert.ok(canManageUsers(ops));
  assert.ok(!canViewAuditLog(ops));
  assert.ok(!canManageSuperAdmins(ops));
});

test("the documentation team works files without moving them", () => {
  const docs = as("DOCUMENTATION");
  assert.ok(isStaff(docs), "they are Medcity Overseas staff");
  assert.ok(isDocumentationTeam(docs));
  assert.ok(canWorkFiles(docs), "they open student files");
  assert.ok(canSeeFullPassport(docs), "they classify passports");
  assert.ok(!isAdmin(docs));
  assert.ok(!canChangeStatus(docs), "statuses are not theirs to move");
  assert.ok(!canManageMoney(docs));
  assert.ok(!canManageUsers(docs));
  assert.ok(!canViewAuditLog(docs));
  assert.equal(orgScope(docs, schema.students.orgId), undefined, "they see every branch");
  assert.ok(!(REPORTING_ROLES as readonly string[]).includes("DOCUMENTATION"), "and they are not a reporting role");
});

test("super admin inherits everything an admin can do", () => {
  for (const user of [as("SUPER_ADMIN"), as("ADMIN"), as("OPS_MANAGER")]) {
    assert.ok(isAdmin(user));
    assert.ok(isStaff(user));
    assert.ok(canChangeStatus(user));
    assert.ok(canSeeFullPassport(user));
    assert.ok(!isPartner(user));
  }
  assert.deepEqual([...ADMIN_ROLES], ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"]);
  assert.deepEqual([...STAFF_ROLES], ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "MANAGEMENT"]);
});

test("management reads but never writes, and partners stay scoped to their own org", () => {
  const mgmt = as("MANAGEMENT");
  assert.ok(isStaff(mgmt));
  assert.ok(!isAdmin(mgmt));
  assert.ok(!canChangeStatus(mgmt));
  assert.equal(orgScope(mgmt, schema.students.orgId), undefined);

  for (const role of ["PARTNER", "COUNSELLOR"] as const) {
    const user = as(role);
    assert.ok(isPartner(user));
    assert.ok(!isStaff(user));
    assert.ok(!isAdmin(user));
    assert.notEqual(orgScope(user, schema.students.orgId), undefined, `${role} must be org scoped`);
  }
  assert.equal(orgScope(as("SUPER_ADMIN"), schema.students.orgId), undefined);
});

test("counsellors never see a full passport number", () => {
  assert.ok(canSeeFullPassport(as("PARTNER")));
  assert.ok(!canSeeFullPassport(as("COUNSELLOR")));
  assert.ok(!canSeeFullPassport(as("MANAGEMENT")));
  assert.equal(maskPassport("Z1234567"), "Z•••••67");
  assert.equal(maskPassport(null), "");
  assert.equal(maskPassport("AB"), "•••");
});
