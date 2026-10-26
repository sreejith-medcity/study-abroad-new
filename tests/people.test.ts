import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { emailProblem, normalizeEmail, planMove, roleFitRefusal, roleFitsOrg, type MoveInput } from "../src/lib/people";

describe("sign-in email rules", () => {
  it("normalises case and surrounding space", () => {
    assert.equal(normalizeEmail("  Anju.Mathew@Medcity.TEST "), "anju.mathew@medcity.test");
    assert.equal(normalizeEmail(null), "");
  });

  it("accepts ordinary addresses", () => {
    for (const good of ["anju@medcity.test", "first.last+tag@sub.example.co.in", "o'neil@example.com", "A@B.CO"]) {
      assert.equal(emailProblem(good), null, `${good} should be accepted`);
    }
  });

  it("refuses what is not an address", () => {
    assert.ok(emailProblem(""));
    assert.ok(emailProblem("   "));
    assert.ok(emailProblem("anju"));
    assert.ok(emailProblem("anju@"));
    assert.ok(emailProblem("@medcity.test"));
    assert.ok(emailProblem("anju@medcity"));
    assert.ok(emailProblem("anju@@medcity.test"));
    assert.ok(emailProblem("an ju@medcity.test"));
    assert.ok(emailProblem("anju@med..city.test"));
    assert.ok(emailProblem("anju@-medcity.test"));
    assert.ok(emailProblem(`${"a".repeat(250)}@medcity.test`));
  });
});

describe("which roles fit which organisation", () => {
  it("the head office takes its own roles and nothing else", () => {
    assert.ok(roleFitsOrg("ADMIN", "HQ"));
    assert.ok(roleFitsOrg("DESK_COUNSELLOR", "HQ"));
    assert.ok(!roleFitsOrg("PARTNER", "HQ"));
    assert.ok(!roleFitsOrg("COUNSELLOR", "HQ"));
  });

  it("a branch takes the branch head and the branch counsellor levels", () => {
    for (const role of ["PARTNER", "COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR"]) assert.ok(roleFitsOrg(role, "BRANCH"), role);
    assert.ok(!roleFitsOrg("SUB_AGENT_COUNSELLOR", "BRANCH"));
    assert.ok(!roleFitsOrg("ADMIN", "BRANCH"));
  });

  it("a sub-agent firm takes its owner and its own counsellor", () => {
    assert.ok(roleFitsOrg("PARTNER", "SUB_AGENT"));
    assert.ok(roleFitsOrg("SUB_AGENT_COUNSELLOR", "SUB_AGENT"));
    assert.ok(!roleFitsOrg("COUNSELLOR", "SUB_AGENT"));
    assert.ok(!roleFitsOrg("SENIOR_COUNSELLOR", "SUB_AGENT"));
  });

  it("a family sign-in fits nowhere on the staff side", () => {
    assert.ok(!roleFitsOrg("STUDENT", "BRANCH"));
    assert.ok(!roleFitsOrg("PARENT", "HQ"));
  });

  it("the refusal names the role and the kind of organisation", () => {
    const text = roleFitRefusal("SUB_AGENT_COUNSELLOR", "BRANCH");
    assert.match(text, /Sub-agent counsellor/);
    assert.match(text, /Medcity branch/);
  });
});

describe("the move plan", () => {
  const base: MoveInput = {
    person: { id: "u1", role: "COUNSELLOR", orgId: "kottayam" },
    from: { id: "kottayam", type: "BRANCH" },
    to: { id: "kochi", type: "BRANCH", active: true },
    students: 3,
    choice: "hand",
    colleague: { id: "u2", orgId: "kottayam", role: "SENIOR_COUNSELLOR", active: true },
  };
  const plan = (over: Partial<MoveInput>) => planMove({ ...base, ...over });

  it("hands the students to a named colleague at the old branch", () => {
    const r = plan({});
    assert.ok(r.ok);
    assert.deepEqual(r.plan, { handTo: "u2", students: 3 });
  });

  it("leaves them unassigned when asked to", () => {
    const r = plan({ choice: "leave", colleague: null });
    assert.ok(r.ok);
    assert.deepEqual(r.plan, { handTo: null, students: 3 });
  });

  it("needs no choice when nobody is assigned to them", () => {
    const r = plan({ students: 0, choice: "", colleague: null });
    assert.ok(r.ok);
    assert.deepEqual(r.plan, { handTo: null, students: 0 });
  });

  it("insists on a choice while students are assigned", () => {
    const r = plan({ choice: "", colleague: null });
    assert.ok(!r.ok);
    assert.match(r.error, /3 students/);
  });

  it("refuses the same organisation", () => {
    const r = plan({ to: { id: "kottayam", type: "BRANCH", active: true } });
    assert.ok(!r.ok);
    assert.match(r.error, /already/);
  });

  it("refuses a closed organisation", () => {
    const r = plan({ to: { id: "kochi", type: "BRANCH", active: false } });
    assert.ok(!r.ok);
    assert.match(r.error, /closed/);
  });

  it("refuses a branch role moving to the head office", () => {
    const r = plan({ to: { id: "hq", type: "HQ", active: true } });
    assert.ok(!r.ok);
    assert.match(r.error, /Medcity Overseas/);
  });

  it("refuses a sub-agent counsellor moving to a Medcity branch", () => {
    const r = plan({ person: { id: "u1", role: "SUB_AGENT_COUNSELLOR", orgId: "horizon" }, from: { id: "horizon", type: "SUB_AGENT" } });
    assert.ok(!r.ok);
    assert.match(r.error, /Medcity branch/);
  });

  it("lets a branch head move between a branch and a sub-agent firm", () => {
    const r = plan({ person: { id: "u1", role: "PARTNER", orgId: "kottayam" }, to: { id: "horizon", type: "SUB_AGENT", active: true }, students: 0, choice: "", colleague: null });
    assert.ok(r.ok);
  });

  it("refuses handing the students to nobody, to themselves, to another branch, to somebody switched off, or to somebody who cannot work files", () => {
    assert.match((plan({ colleague: null }) as { error: string }).error, /Pick the colleague/);
    assert.match((plan({ colleague: { id: "u1", orgId: "kottayam", role: "COUNSELLOR", active: true } }) as { error: string }).error, /leaving/);
    assert.match((plan({ colleague: { id: "u3", orgId: "kochi", role: "COUNSELLOR", active: true } }) as { error: string }).error, /branch the students belong to/);
    assert.match((plan({ colleague: { id: "u3", orgId: "kottayam", role: "COUNSELLOR", active: false } }) as { error: string }).error, /switched off/);
    assert.match((plan({ colleague: { id: "u3", orgId: "kottayam", role: "MANAGEMENT", active: true } }) as { error: string }).error, /cannot work student files/);
  });
});
