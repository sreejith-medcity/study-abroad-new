import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, DEFAULTS, SETTABLE_ROLES, isChanged, matrixSummary, roleCan, type Capability } from "../src/lib/capabilities";

test("with nothing set, every role behaves exactly as the portal always did", () => {
  for (const capability of CAPABILITIES) {
    for (const role of SETTABLE_ROLES) {
      assert.equal(
        roleCan(role, capability, []),
        (DEFAULTS[capability] as readonly string[]).includes(role),
        `${role} / ${capability} moved without anybody setting it`,
      );
    }
  }
});

test("a super admin keeps everything, so nobody can lock the last person out", () => {
  for (const capability of CAPABILITIES) {
    assert.equal(roleCan("SUPER_ADMIN", capability, []), true);
    assert.equal(
      roleCan("SUPER_ADMIN", capability, [{ role: "SUPER_ADMIN", capability, allowed: false }]),
      true,
      "even a row saying otherwise is ignored",
    );
  }
  assert.ok(!SETTABLE_ROLES.includes("SUPER_ADMIN" as never), "and the screen never offers the box");
});

test("a student or a parent gains nothing, whatever the table says", () => {
  for (const role of ["STUDENT", "PARENT"]) {
    for (const capability of CAPABILITIES) {
      assert.equal(roleCan(role, capability, [{ role, capability, allowed: true }]), false, `${role} was granted ${capability}`);
    }
  }
});

test("a tick decides it where one exists, in both directions", () => {
  // The documentation team does not see money out of the box.
  assert.equal(roleCan("DOCUMENTATION", "SEE_MONEY", []), false);
  assert.equal(roleCan("DOCUMENTATION", "SEE_MONEY", [{ role: "DOCUMENTATION", capability: "SEE_MONEY", allowed: true }]), true);
  // And management does, until somebody says otherwise.
  assert.equal(roleCan("MANAGEMENT", "SEE_MONEY", []), true);
  assert.equal(roleCan("MANAGEMENT", "SEE_MONEY", [{ role: "MANAGEMENT", capability: "SEE_MONEY", allowed: false }]), false);
});

test("a row for one role and capability leaves every other alone", () => {
  const set = [{ role: "COUNSELLOR", capability: "VIEW_AUDIT_LOG", allowed: true }];
  assert.equal(roleCan("COUNSELLOR", "VIEW_AUDIT_LOG", set), true);
  assert.equal(roleCan("PARTNER", "VIEW_AUDIT_LOG", set), false);
  assert.equal(roleCan("COUNSELLOR", "RAISE_INVOICES", set), false);
});

test("a role nobody has heard of is refused rather than defaulted", () => {
  assert.equal(roleCan("AUDITOR", "SEE_MONEY", [{ role: "AUDITOR", capability: "SEE_MONEY", allowed: true }]), false);
});

test("the screen says whether anything is set, and counts only real changes", () => {
  assert.match(matrixSummary([]), /Nothing is changed/);
  // A row that agrees with the default is not a change, however it got there.
  const agrees = [{ role: "MANAGEMENT", capability: "SEE_MONEY", allowed: true }];
  assert.match(matrixSummary(agrees), /Nothing is changed/);
  const real = [{ role: "MANAGEMENT", capability: "SEE_MONEY", allowed: false }];
  assert.match(matrixSummary(real), /^1 thing is set differently/);
  assert.match(matrixSummary([...real, { role: "COUNSELLOR", capability: "RAISE_INVOICES" as Capability, allowed: true }]), /^2 things are/);
});

test("a moved box is marked as moved, and one in its place is not", () => {
  assert.equal(isChanged("DOCUMENTATION", "SEE_MONEY", true), true);
  assert.equal(isChanged("DOCUMENTATION", "SEE_MONEY", false), false);
  assert.equal(isChanged("ADMIN", "RAISE_INVOICES", true), false);
});
