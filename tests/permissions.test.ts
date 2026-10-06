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
  isCounsellor,
  isStaff,
  HQ_ROLES,
  PARTNER_ROLES,
  isSuperAdmin,
  maskPassport,
  mayAcceptUpload,
  mayDecideDocuments,
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
  // The desk counsellor is staff too: they sit at Medcity Overseas and see
  // across branches, which is what staff means here. So is whoever runs the
  // documentation desk.
  assert.deepEqual(
    [...STAFF_ROLES],
    ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "APPLICATION_TEAM_LEADER", "MANAGEMENT", "DESK_COUNSELLOR"],
  );
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

test("who may accept a document or send it back", () => {
  const at = (role: string, orgId = "branch-1") => ({ id: "u1", name: "Somebody", email: "s@x.test", role, orgId, orgName: "A branch" }) as never;

  // The desk always may, whatever the branch is set to.
  for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION"]) {
    assert.equal(mayDecideDocuments(at(role), false), true, `${role} checks documents wherever the student is`);
    assert.equal(mayDecideDocuments(at(role), true), true);
  }

  // A branch's own staff only where Medcity has turned the first pass on.
  for (const role of ["PARTNER", "COUNSELLOR"]) {
    assert.equal(mayDecideDocuments(at(role), false), false, `${role} does not check documents by default`);
    assert.equal(mayDecideDocuments(at(role), true), true, `${role} does once the branch is set to`);
  }

  // Nobody else, switch or no switch.
  for (const role of ["MANAGEMENT", "STUDENT", "PARENT"]) {
    assert.equal(mayDecideDocuments(at(role), true), false, `${role} never decides a document`);
  }
});

test("nobody at a branch marks their own upload good", () => {
  const at = (role: string, id = "u1") => ({ id, name: "Somebody", email: "s@x.test", role, orgId: "branch-1", orgName: "A branch" }) as never;

  // The desk is outside the branch, so it is not bound by this.
  assert.equal(mayAcceptUpload(at("DOCUMENTATION", "desk"), true, "desk"), true);

  // A branch doing its own first pass needs a second pair of eyes.
  assert.equal(mayAcceptUpload(at("COUNSELLOR", "me"), true, "me"), false, "the person who sent it in does not pass it");
  assert.equal(mayAcceptUpload(at("COUNSELLOR", "me"), true, "colleague"), true, "a colleague at the same branch does");
  assert.equal(mayAcceptUpload(at("COUNSELLOR", "me"), true, null), true, "a row with no file behind it is a decision, not a self-check");

  // And none of it applies where the branch does not check its own documents.
  assert.equal(mayAcceptUpload(at("COUNSELLOR", "me"), false, "colleague"), false);
});

test("the four new counsellors are scoped where they sit", () => {
  const at = (role: string, orgId = "branch-1") => ({ id: "u1", name: "Somebody", email: "s@x.test", role, orgId, orgName: "A branch" }) as never;

  // The desk counsellor sits at Medcity Overseas, so they see across branches.
  assert.equal(isStaff(at("DESK_COUNSELLOR")), true);
  assert.ok((HQ_ROLES as readonly string[]).includes("DESK_COUNSELLOR"));

  // The other three work inside one organisation, so every screen that scopes
  // by organisation scopes them.
  for (const role of ["SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR"]) {
    assert.equal(isStaff(at(role)), false, `${role} must not see other branches`);
    assert.ok((PARTNER_ROLES as readonly string[]).includes(role), `${role} is not scoped to its organisation`);
  }

  // None of them runs the branch.
  for (const role of ["DESK_COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR"]) {
    assert.equal(isAdmin(at(role)), false);
    assert.equal(canManageUsers(at(role)), false);
  }
});

test("a counsellor of any level is who a student they take on belongs to", () => {
  for (const role of ["COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR", "DESK_COUNSELLOR"]) {
    assert.equal(isCounsellor(role), true, `${role} should be counted as a counsellor`);
  }
  for (const role of ["PARTNER", "ADMIN", "DOCUMENTATION", "MANAGEMENT", "STUDENT"]) {
    assert.equal(isCounsellor(role), false, `${role} is not a counsellor`);
  }
});

test("the application team leader runs the desk and works it", () => {
  const lead = as("APPLICATION_TEAM_LEADER");
  assert.ok(isStaff(lead), "they sit at Medcity Overseas, not at a branch");
  assert.ok(!isAdmin(lead), "but they do not process applications or move statuses");
  assert.ok(isDocumentationTeam(lead), "they work files on the same terms as an officer");
  assert.ok(isDocumentationTeam(as("DOCUMENTATION")), "and so does an officer");
  assert.equal(orgScope(lead, schema.students.orgId), undefined, "one desk across every branch");
  assert.ok(!(REPORTING_ROLES as readonly string[]).includes("APPLICATION_TEAM_LEADER"), "they are not a reporting role");
});
