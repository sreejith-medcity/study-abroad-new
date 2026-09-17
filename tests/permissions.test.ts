import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ADMIN_ROLES,
  APP_ROLES,
  canChangeStatus,
  canManageUsers,
  canResetPasswords,
  canSeeFullPassport,
  canViewAuditLog,
  isAdmin,
  isPartner,
  isStaff,
  isSuperAdmin,
  maskPassport,
  orgScope,
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
  mustChangePassword: false,
});

test("every role in the app shell exists in the database enum", () => {
  for (const role of APP_ROLES) assert.ok(schema.role.enumValues.includes(role), `${role} missing from the enum`);
  for (const role of schema.role.enumValues) assert.ok(ROLE_LABEL[role], `${role} has no label`);
});

test("super admin is the only role that manages users, passwords and the audit log", () => {
  for (const role of schema.role.enumValues) {
    const expected = role === "SUPER_ADMIN";
    assert.equal(canManageUsers(as(role)), expected, `canManageUsers(${role})`);
    assert.equal(canResetPasswords(as(role)), expected, `canResetPasswords(${role})`);
    assert.equal(canViewAuditLog(as(role)), expected, `canViewAuditLog(${role})`);
    assert.equal(isSuperAdmin(as(role)), expected, `isSuperAdmin(${role})`);
  }
});

test("super admin inherits everything an admin can do", () => {
  for (const user of [as("SUPER_ADMIN"), as("ADMIN")]) {
    assert.ok(isAdmin(user));
    assert.ok(isStaff(user));
    assert.ok(canChangeStatus(user));
    assert.ok(canSeeFullPassport(user));
    assert.ok(!isPartner(user));
  }
  assert.deepEqual([...ADMIN_ROLES], ["SUPER_ADMIN", "ADMIN"]);
  assert.deepEqual([...STAFF_ROLES], ["SUPER_ADMIN", "ADMIN", "MANAGEMENT"]);
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
