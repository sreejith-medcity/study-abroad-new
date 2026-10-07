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

test("the application team leader gets what runs a desk, and nobody else gains it", () => {
  const lead = "APPLICATION_TEAM_LEADER";
  for (const cap of ["RUN_DOCUMENTATION_DESK", "REASSIGN_DOCUMENTS", "SET_DOCUMENT_RULES", "OVERRIDE_GATE"] as const) {
    assert.equal(roleCan(lead, cap), true, `${cap} is theirs`);
    assert.equal(roleCan("DOCUMENTATION", cap), false, `${cap} is not an officer's`);
    assert.equal(roleCan("PARTNER", cap), false, `${cap} is not a branch's`);
    assert.equal(roleCan("MANAGEMENT", cap), false, `${cap} is not management's`);
    // An admin had all four before this role existed, and keeps them.
    assert.equal(roleCan("ADMIN", cap), true, `${cap} was an admin's and stays one`);
  }
  // They also work files, on the same terms as the officers they run.
  for (const cap of ["DECIDE_DOCUMENTS", "SEE_FULL_PASSPORT", "MESSAGE_STUDENT", "SEE_EVERY_STUDENT"] as const) {
    assert.equal(roleCan(lead, cap), true, `${cap} is theirs too`);
  }
  assert.equal(roleCan(lead, "RAISE_INVOICES"), false, "running the desk is not running the money");
  assert.equal(roleCan(lead, "VIEW_AUDIT_LOG"), false);
});

test("everybody who acts can register a student; management, which changes nothing, cannot", () => {
  for (const role of ["ADMIN", "OPS_MANAGER", "DOCUMENTATION", "APPLICATION_TEAM_LEADER", "PARTNER", "COUNSELLOR", "TRAINEE_COUNSELLOR", "DESK_COUNSELLOR"] as const) {
    assert.equal(roleCan(role, "REGISTER_STUDENT"), true, `${role} registers students`);
  }
  assert.equal(roleCan("MANAGEMENT", "REGISTER_STUDENT"), false, "management reads and changes nothing");
  assert.equal(roleCan("SUPER_ADMIN", "REGISTER_STUDENT"), true, "a super admin is never refused anything");
  // And it is a tick like any other, so Medcity can take it off a role.
  assert.equal(roleCan("DOCUMENTATION", "REGISTER_STUDENT", [{ role: "DOCUMENTATION", capability: "REGISTER_STUDENT", allowed: false }]), false);
});

test("finance holds the money and none of the files", () => {
  const fin = "FINANCE";
  for (const cap of ["SEE_MONEY", "READ_INVOICES", "RAISE_INVOICES"] as const) {
    assert.equal(roleCan(fin, cap), true, `${cap} is theirs`);
  }
  // Asked for in these words: everyone can register a student except finance.
  assert.equal(roleCan(fin, "REGISTER_STUDENT"), false, "finance does not start a student file");
  assert.equal(roleCan("MANAGEMENT", "REGISTER_STUDENT"), false, "nor does management");
  assert.equal(roleCan("DOCUMENTATION", "REGISTER_STUDENT"), true, "the desk still does");
  for (const cap of ["DECIDE_DOCUMENTS", "RUN_DOCUMENTATION_DESK", "REASSIGN_DOCUMENTS", "SET_DOCUMENT_RULES", "OVERRIDE_GATE", "SUBMIT_APPLICATION", "MESSAGE_STUDENT"] as const) {
    assert.equal(roleCan(fin, cap), false, `${cap} is not finance's job`);
  }
  // An invoice names students, so the lines on it are readable.
  assert.equal(roleCan(fin, "SEE_EVERY_STUDENT"), true);
  assert.equal(roleCan(fin, "VIEW_AUDIT_LOG"), false);
});
