import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { defaultMoveRole, emailProblem, emailTakenMessage, mayMovePerson, moveSummary, normalizeEmail, planMove, roleFitRefusal, roleFitsOrg, rolesFor, taskTaker, type EmailHolder, type MoveInput } from "../src/lib/people";
import { HQ_ROLE_OPTIONS, PARTNER_ROLE_OPTIONS } from "../src/lib/permissions";

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
    assert.deepEqual(r.plan, { handTo: "u2", students: 3, role: "COUNSELLOR", roleChanged: false, leavesHeadOffice: false });
  });

  it("leaves them unassigned when asked to", () => {
    const r = plan({ choice: "leave", colleague: null });
    assert.ok(r.ok);
    assert.equal(r.plan.handTo, null);
    assert.equal(r.plan.students, 3);
  });

  it("needs no choice when nobody is assigned to them", () => {
    const r = plan({ students: 0, choice: "", colleague: null });
    assert.ok(r.ok);
    assert.equal(r.plan.handTo, null);
    assert.equal(r.plan.students, 0);
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

describe("a move that changes the role in the same step", () => {
  const hq = { id: "hq", type: "HQ" as const, name: "Medcity Overseas" };
  const nclex = { id: "nclex", type: "BRANCH" as const, active: true, name: "NCLEX RN" };
  const vyshna: MoveInput = {
    person: { id: "v1", role: "DESK_COUNSELLOR", orgId: "hq", active: true },
    from: hq,
    to: nclex,
    role: "PARTNER",
    students: 0,
    tasks: 0,
    choice: "",
    colleague: null,
    heads: { othersAtFrom: 0, atTarget: 0 },
  };
  const plan = (over: Partial<MoveInput>) => planMove({ ...vyshna, ...over });

  it("takes a head office person to a branch as its head", () => {
    const r = plan({});
    assert.ok(r.ok);
    assert.deepEqual(r.plan, { handTo: null, students: 0, role: "PARTNER", roleChanged: true, leavesHeadOffice: true });
  });

  it("still refuses a head office role at a branch when the role is not changed", () => {
    const r = plan({ role: undefined });
    assert.ok(!r.ok);
    assert.match(r.error, /Overseas desk counsellor is not a role at a Medcity branch/);
  });

  it("refuses a new role that does not fit, asking for another one", () => {
    const r = plan({ role: "ADMIN" });
    assert.ok(!r.ok);
    assert.match(r.error, /Overseas admin is not a role at a Medcity branch\. Pick one of the roles that fit it\./);
    const s = plan({ role: "SUB_AGENT_COUNSELLOR" });
    assert.ok(!s.ok);
  });

  it("refuses making somebody head of a branch that already has an active one", () => {
    const r = plan({ heads: { othersAtFrom: 0, atTarget: 1 } });
    assert.ok(!r.ok);
    assert.equal(r.error, "NCLEX RN already has an active branch head. Pick another role for this person, or move them somewhere without one.");
  });

  it("lets a counsellor become head of another branch with none", () => {
    const r = plan({
      person: { id: "c1", role: "COUNSELLOR", orgId: "kottayam", active: true },
      from: { id: "kottayam", type: "BRANCH", name: "Medcity Kottayam" },
      heads: { othersAtFrom: 1, atTarget: 0 },
    });
    assert.ok(r.ok);
    assert.equal(r.plan.role, "PARTNER");
    assert.equal(r.plan.leavesHeadOffice, false);
  });

  it("still keeps a head at the branch a head leaves, whatever they become", () => {
    const r = plan({
      person: { id: "h1", role: "PARTNER", orgId: "kottayam", active: true },
      from: { id: "kottayam", type: "BRANCH", name: "Medcity Kottayam" },
      to: { id: "hq", type: "HQ", active: true, name: "Medcity Overseas" },
      role: "ADMIN",
      heads: { othersAtFrom: 0, atTarget: 0 },
    });
    assert.ok(!r.ok);
    assert.match(r.error, /Medcity Kottayam would be left without a branch head/);
  });

  it("takes a branch head to the head office in a head office role", () => {
    const r = plan({
      person: { id: "h1", role: "PARTNER", orgId: "kottayam", active: true },
      from: { id: "kottayam", type: "BRANCH", name: "Medcity Kottayam" },
      to: { id: "hq", type: "HQ", active: true, name: "Medcity Overseas" },
      role: "DESK_COUNSELLOR",
      heads: { othersAtFrom: 1, atTarget: 0 },
    });
    assert.ok(r.ok);
    assert.equal(r.plan.role, "DESK_COUNSELLOR");
  });

  it("moves a sub-agent counsellor to a branch as a branch counsellor", () => {
    const r = plan({
      person: { id: "s1", role: "SUB_AGENT_COUNSELLOR", orgId: "horizon", active: true },
      from: { id: "horizon", type: "SUB_AGENT", name: "Horizon" },
      role: "COUNSELLOR",
      heads: { othersAtFrom: 1, atTarget: 1 },
    });
    assert.ok(r.ok);
    assert.equal(r.plan.roleChanged, true);
  });

  it("moves a branch counsellor to a sub-agent firm as its counsellor", () => {
    const r = plan({
      person: { id: "c1", role: "SENIOR_COUNSELLOR", orgId: "kottayam", active: true },
      from: { id: "kottayam", type: "BRANCH", name: "Medcity Kottayam" },
      to: { id: "horizon", type: "SUB_AGENT", active: true, name: "Horizon" },
      role: "SUB_AGENT_COUNSELLOR",
      heads: { othersAtFrom: 0, atTarget: 1 },
    });
    assert.ok(r.ok);
  });

  it("never makes anybody a family sign-in", () => {
    const r = plan({ role: "STUDENT" });
    assert.ok(!r.ok);
    assert.match(r.error, /student's file/);
  });

  it("asks what happens to a head office person's students and tasks, wherever they are", () => {
    const r = plan({ students: 2, tasks: 3 });
    assert.ok(!r.ok);
    assert.match(r.error, /2 students and 3 open tasks on their name: hand them to a colleague at Medcity Overseas/);
    const t = plan({ students: 0, tasks: 1 });
    assert.ok(!t.ok);
    assert.match(t.error, /the open task on their name/);
  });

  it("hands a head office person's work to a colleague at the head office only", () => {
    const ok = plan({ students: 2, tasks: 3, choice: "hand", colleague: { id: "d2", orgId: "hq", role: "DESK_COUNSELLOR", active: true } });
    assert.ok(ok.ok);
    assert.equal(ok.plan.handTo, "d2");
    const away = plan({ students: 2, choice: "hand", colleague: { id: "k2", orgId: "kottayam", role: "COUNSELLOR", active: true } });
    assert.ok(!away.ok);
    assert.match(away.error, /has to be at the head office/);
  });

  it("lets a head office person leave their work where it is", () => {
    const r = plan({ students: 2, tasks: 3, choice: "leave" });
    assert.ok(r.ok);
    assert.equal(r.plan.handTo, null);
  });

  it("ignores open tasks for a branch mover, whose head takes them", () => {
    const r = plan({
      person: { id: "c1", role: "COUNSELLOR", orgId: "kottayam", active: true },
      from: { id: "kottayam", type: "BRANCH", name: "Medcity Kottayam" },
      role: undefined,
      tasks: 5,
    });
    assert.ok(r.ok);
  });
});

describe("the roles a move offers", () => {
  const all = [...HQ_ROLE_OPTIONS, ...PARTNER_ROLE_OPTIONS];
  it("lists only what fits the organisation picked", () => {
    assert.deepEqual(rolesFor("SUB_AGENT", all), ["PARTNER", "SUB_AGENT_COUNSELLOR"]);
    assert.ok(!rolesFor("BRANCH", all).includes("DESK_COUNSELLOR"));
    assert.ok(rolesFor("HQ", all).every((r) => roleFitsOrg(r, "HQ")));
  });

  it("starts on the role they have when it fits, otherwise the first that does", () => {
    assert.equal(defaultMoveRole("COUNSELLOR", "BRANCH", all), "COUNSELLOR");
    assert.equal(defaultMoveRole("DESK_COUNSELLOR", "BRANCH", all), "PARTNER");
    assert.equal(defaultMoveRole("COUNSELLOR", "SUB_AGENT", all), "PARTNER");
  });
});

describe("who may move whom", () => {
  const superAdmin = { id: "sa", role: "SUPER_ADMIN", managesUsers: true, managesSuperAdmins: true };
  const ops = { id: "ops", role: "OPS_MANAGER", managesUsers: true, managesSuperAdmins: false };
  const admin = { id: "ad", role: "ADMIN", managesUsers: false, managesSuperAdmins: false };
  const deskPerson = { id: "v1", role: "DESK_COUNSELLOR", orgType: "HQ" as const };
  const counsellor = { id: "c1", role: "COUNSELLOR", orgType: "BRANCH" as const };

  it("lets those who manage accounts move somebody out of the head office in a new role", () => {
    assert.ok(mayMovePerson({ actor: superAdmin, person: deskPerson, toType: "BRANCH", role: "PARTNER" }).ok);
    assert.ok(mayMovePerson({ actor: ops, person: deskPerson, toType: "BRANCH", role: "PARTNER" }).ok);
  });

  it("keeps an admin out of moves into or out of the head office, and out of role changes", () => {
    const out = mayMovePerson({ actor: admin, person: deskPerson, toType: "BRANCH", role: "PARTNER" });
    assert.ok(!out.ok);
    assert.match(out.error, /into or out of Medcity Overseas/);
    assert.ok(!mayMovePerson({ actor: admin, person: counsellor, toType: "HQ", role: "ADMIN" }).ok);
    const change = mayMovePerson({ actor: admin, person: counsellor, toType: "BRANCH", role: "PARTNER" });
    assert.ok(!change.ok);
    assert.match(change.error, /change a role/);
    assert.ok(mayMovePerson({ actor: admin, person: counsellor, toType: "BRANCH" }).ok);
  });

  it("never moves yourself, a family sign-in, or a super admin for anybody but a super admin", () => {
    assert.ok(!mayMovePerson({ actor: superAdmin, person: { id: "sa", role: "SUPER_ADMIN", orgType: "HQ" }, toType: "BRANCH", role: "PARTNER" }).ok);
    assert.ok(!mayMovePerson({ actor: superAdmin, person: { id: "s1", role: "STUDENT", orgType: "BRANCH" }, toType: "BRANCH" }).ok);
    assert.ok(!mayMovePerson({ actor: ops, person: { id: "s2", role: "SUPER_ADMIN", orgType: "HQ" }, toType: "BRANCH", role: "PARTNER" }).ok);
    assert.ok(!mayMovePerson({ actor: ops, person: counsellor, toType: "HQ", role: "SUPER_ADMIN" }).ok);
    assert.ok(!mayMovePerson({ actor: { id: "p", role: "PARTNER", managesUsers: false, managesSuperAdmins: false }, person: counsellor, toType: "BRANCH" }).ok);
  });
});

describe("what an email already in use says", () => {
  const vyshna: EmailHolder = { id: "v1", name: "Vyshna", role: "PARTNER", active: true, org: { id: "nclex", name: "NCLEX RN", type: "BRANCH" } };
  const desk = { orgId: "hq", seesEveryOrg: true };

  it("tells the head office who has it, in what role and where", () => {
    const r = emailTakenMessage(vyshna, desk);
    assert.equal(r.text, "That email already belongs to Vyshna, Branch head at NCLEX RN.");
    assert.ok(r.detailed);
  });

  it("says when their account is switched off, and offers the move when allowed", () => {
    const r = emailTakenMessage({ ...vyshna, active: false }, desk, { mayMove: true });
    assert.equal(r.text, "That email already belongs to Vyshna, Branch head at NCLEX RN. Their account is switched off. Move them instead of adding a second account.");
  });

  it("tells a branch head about their own people", () => {
    const r = emailTakenMessage(vyshna, { orgId: "nclex", seesEveryOrg: false });
    assert.match(r.text, /Vyshna, Branch head at NCLEX RN/);
  });

  it("tells a branch head nothing about anybody at another organisation", () => {
    const r = emailTakenMessage(vyshna, { orgId: "kottayam", seesEveryOrg: false }, { mayMove: true });
    assert.equal(r.text, "That email belongs to someone at another organisation. Ask the head office to move them.");
    assert.ok(!r.detailed);
    assert.doesNotMatch(r.text, /Vyshna|NCLEX/);
  });

  it("points a family sign-in at the student's file and never offers a move", () => {
    const r = emailTakenMessage({ ...vyshna, role: "STUDENT", name: "Anu Joseph" }, desk, { mayMove: true });
    assert.equal(r.text, "That email is already the student portal sign-in of Anu Joseph at NCLEX RN. A student or parent sign-in is managed from the student's file.");
    const p = emailTakenMessage({ ...vyshna, role: "PARENT", name: "Joseph K" }, desk);
    assert.match(p.text, /parent sign-in of Joseph K/);
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

  it("names the new role when the move changed it", () => {
    const { forDesk, forPerson } = moveSummary({ ...base, name: "Vyshna", fromName: "Medcity Overseas", toName: "NCLEX RN", students: 0, tasks: 0, colleagueName: null, tasksTo: null, newRole: "Branch head", fromHq: true });
    assert.equal(forDesk, "Vyshna is now Branch head at NCLEX RN. They have been signed out and told.");
    assert.equal(forPerson, "You are now Branch head at NCLEX RN.");
  });

  it("says tasks left at the head office stay because nobody was named", () => {
    const { forDesk } = moveSummary({ ...base, fromName: "Medcity Overseas", students: 0, colleagueName: null, tasksTo: null, fromHq: true });
    assert.match(forDesk, /3 open tasks stay on their name, because nobody at Medcity Overseas was named to take them\./);
  });

  it("does not place a head office person's students and tasks at the head office", () => {
    const { forPerson } = moveSummary({ ...base, fromName: "Medcity Overseas", toName: "NCLEX RN", students: 1, tasks: 1, colleagueName: "Anita Menon", tasksTo: "Anita Menon", newRole: "Branch head", fromHq: true });
    assert.equal(forPerson, "You are now Branch head at NCLEX RN. Your student has been handed to Anita Menon. Your open task has gone to Anita Menon.");
  });
});
