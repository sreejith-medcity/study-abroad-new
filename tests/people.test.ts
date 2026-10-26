import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { emailProblem, moveSummary, normalizeEmail, planMove, roleFitRefusal, roleFitsOrg, taskTaker, type MoveInput } from "../src/lib/people";

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
    person: { id: "u1", role: "COUNSELLOR", orgId: "kottayam", active: true },
    from: { id: "kottayam", type: "BRANCH", name: "Medcity Kottayam" },
    to: { id: "kochi", type: "BRANCH", active: true, name: "Medcity Kochi" },
    students: 3,
    choice: "hand",
    colleague: { id: "u2", orgId: "kottayam", role: "SENIOR_COUNSELLOR", active: true },
    heads: { othersAtFrom: 1, atTarget: 1 },
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
    const r = plan({ to: { id: "kottayam", type: "BRANCH", active: true, name: "Medcity Kottayam" } });
    assert.ok(!r.ok);
    assert.match(r.error, /already/);
  });

  it("refuses a closed organisation", () => {
    const r = plan({ to: { id: "kochi", type: "BRANCH", active: false, name: "Medcity Kochi" } });
    assert.ok(!r.ok);
    assert.match(r.error, /closed/);
  });

  it("refuses a branch role moving to the head office", () => {
    const r = plan({ to: { id: "hq", type: "HQ", active: true, name: "Medcity Overseas" } });
    assert.ok(!r.ok);
    assert.match(r.error, /Medcity Overseas/);
  });

  it("refuses a sub-agent counsellor moving to a Medcity branch", () => {
    const r = plan({ person: { id: "u1", role: "SUB_AGENT_COUNSELLOR", orgId: "horizon", active: true }, from: { id: "horizon", type: "SUB_AGENT", name: "Horizon" } });
    assert.ok(!r.ok);
    assert.match(r.error, /Medcity branch/);
  });

  const head = { id: "u1", role: "PARTNER", orgId: "kottayam", active: true };
  const horizon = { id: "horizon", type: "SUB_AGENT" as const, active: true, name: "Horizon Consultants" };

  it("lets a branch head move between a branch and a sub-agent firm", () => {
    const r = plan({ person: head, to: horizon, students: 0, choice: "", colleague: null, heads: { othersAtFrom: 1, atTarget: 0 } });
    assert.ok(r.ok);
  });

  it("refuses to take the only active head away from a branch", () => {
    const r = plan({ person: head, to: horizon, students: 0, choice: "", colleague: null, heads: { othersAtFrom: 0, atTarget: 0 } });
    assert.ok(!r.ok);
    assert.match(r.error, /Medcity Kottayam would be left without a branch head/);
  });

  it("lets a head already switched off leave a branch that has no other", () => {
    const r = plan({ person: { ...head, active: false }, to: horizon, students: 0, choice: "", colleague: null, heads: { othersAtFrom: 0, atTarget: 0 } });
    assert.ok(r.ok);
  });

  it("refuses a second head for a branch that has one", () => {
    const r = plan({ person: head, to: horizon, students: 0, choice: "", colleague: null, heads: { othersAtFrom: 1, atTarget: 1 } });
    assert.ok(!r.ok);
    assert.match(r.error, /Horizon Consultants already has a branch head/);
  });

  it("reads the heads only for a branch head", () => {
    const r = plan({ heads: { othersAtFrom: 0, atTarget: 1 } });
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

describe("the tasks a mover leaves behind", () => {
  it("go to the colleague who took the students", () => {
    assert.equal(taskTaker({ handTo: "u2", students: 3 }, { id: "boss" }), "u2");
  });

  it("go to the branch head when the students were left unassigned", () => {
    assert.equal(taskTaker({ handTo: null, students: 3 }, { id: "boss" }), "boss");
    assert.equal(taskTaker({ handTo: null, students: 0 }, { id: "boss" }), "boss");
  });

  it("stay where they are when nobody at the branch can take them", () => {
    assert.equal(taskTaker({ handTo: null, students: 3 }, null), null);
  });
});

describe("what a move says afterwards", () => {
  const base = { name: "Anju Mathew", fromName: "Medcity Kottayam", toName: "Medcity Kochi", students: 2, colleagueName: "Ravi Nair", tasks: 3, tasksTo: "Ravi Nair" };

  it("says where they are, who took the students and who took the tasks", () => {
    const { forDesk, forPerson } = moveSummary(base);
    assert.equal(forDesk, "Anju Mathew is now at Medcity Kochi. 2 students handed to Ravi Nair. 3 open tasks handed to Ravi Nair. They have been signed out and told.");
    assert.match(forPerson, /2 students at Medcity Kottayam have been handed to Ravi Nair/);
    assert.match(forPerson, /3 open tasks there have gone to Ravi Nair/);
  });

  it("says the students were left and the tasks went to the head", () => {
    const { forDesk, forPerson } = moveSummary({ ...base, colleagueName: null, students: 1, tasks: 1, tasksTo: "Kottayam Head" });
    assert.match(forDesk, /1 student left unassigned at Medcity Kottayam\. 1 open task handed to Kottayam Head\./);
    assert.match(forPerson, /Your student at Medcity Kottayam stays there, unassigned for now\. Your open task there has gone to Kottayam Head\./);
  });

  it("counts the tasks nobody could take", () => {
    const { forDesk, forPerson } = moveSummary({ ...base, colleagueName: null, tasksTo: null });
    assert.match(forDesk, /3 open tasks at Medcity Kottayam stay on their name, because Medcity Kottayam has no branch head to take them\./);
    assert.match(forPerson, /3 open tasks there are still on your name/);
  });

  it("says only where they are when there was nothing to hand over", () => {
    const { forDesk, forPerson } = moveSummary({ ...base, students: 0, tasks: 0, colleagueName: null, tasksTo: null });
    assert.equal(forDesk, "Anju Mathew is now at Medcity Kochi. They have been signed out and told.");
    assert.equal(forPerson, "Your work from now on is at Medcity Kochi.");
  });
});
