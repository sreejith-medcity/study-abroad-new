import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { counsellorProblem, filePeopleToTakeOff, mayMoveStudents, MOVE_KEEPS, planStudentMove, studentMoveSummary, targetProblem, taskTakerFor, type StudentMoveInput } from "../src/lib/student-move";

const from = { id: "nclex", name: "NCLEX RN" };
const kottayam = { id: "ktm", name: "Medcity Kottayam", type: "BRANCH" as const, active: true };
const docs = { id: "u-docs", name: "UK Docs", orgId: "ktm", role: "COUNSELLOR", active: true };
const student = (over: Partial<StudentMoveInput["students"][number]> = {}) => ({ id: "s1", orgId: "nclex", archived: false, assignedToId: "u-old", counsellorAtHeadOffice: false, ...over });
const input = (over: Partial<StudentMoveInput> = {}): StudentMoveInput => ({ students: [student()], from, to: kottayam, choice: "assign", counsellor: docs, targetHeads: 1, ...over });
const refusal = (i: StudentMoveInput) => {
  const r = planStudentMove(i);
  assert.equal(r.ok, false);
  return (r as { error: string }).error;
};

describe("who moves students", () => {
  it("is the head office admins", () => {
    for (const r of ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"]) assert.ok(mayMoveStudents(r), r);
    for (const r of ["PARTNER", "COUNSELLOR", "DOCUMENTATION", "MANAGEMENT", "FINANCE"]) assert.ok(!mayMoveStudents(r), r);
  });
});

describe("where a student can go", () => {
  it("refuses the same branch, the head office, a closed branch and no branch", () => {
    assert.match(targetProblem(from, { ...kottayam, id: "nclex", name: "NCLEX RN" })!, /already at NCLEX RN/);
    assert.match(targetProblem(from, { ...kottayam, type: "HQ", name: "Medcity Overseas" })!, /belongs to a branch, not the head office/);
    assert.match(targetProblem(from, { ...kottayam, active: false })!, /Medcity Kottayam is closed/);
    assert.match(targetProblem(from, null)!, /Pick the branch/);
  });

  it("accepts an open branch or sub-agent firm", () => {
    assert.equal(targetProblem(from, kottayam), null);
    assert.equal(targetProblem(from, { ...kottayam, type: "SUB_AGENT" }), null);
  });
});

describe("the counsellor there", () => {
  it("must be at the target, switched on and able to work files", () => {
    assert.match(counsellorProblem(kottayam, "assign", { ...docs, orgId: "nclex" }, 1)!, /UK Docs is not at Medcity Kottayam/);
    assert.match(counsellorProblem(kottayam, "assign", { ...docs, active: false }, 1)!, /switched off/);
    assert.match(counsellorProblem(kottayam, "assign", { ...docs, role: "FINANCE" }, 1)!, /cannot work student files/);
    assert.match(counsellorProblem(kottayam, "assign", null, 1)!, /Pick the counsellor/);
    assert.equal(counsellorProblem(kottayam, "assign", docs, 0), null);
  });

  it("can be nobody, only where the branch has a head", () => {
    assert.equal(counsellorProblem(kottayam, "leave", null, 1), null);
    assert.match(counsellorProblem(kottayam, "leave", null, 0)!, /no active branch head/);
  });

  it("asks for a choice", () => {
    assert.match(counsellorProblem(kottayam, "", null, 1)!, /Say who counsels them/);
  });
});

describe("planning a move", () => {
  it("gives every student the named counsellor", () => {
    const r = planStudentMove(input({ students: [student(), student({ id: "s2", assignedToId: null })], bulk: true }));
    assert.ok(r.ok);
    assert.deepEqual(r.plan.moves, [
      { studentId: "s1", from: "u-old", to: "u-docs" },
      { studentId: "s2", from: null, to: "u-docs" },
    ]);
    assert.equal(r.plan.counsellorId, "u-docs");
    assert.equal(r.plan.to.id, "ktm");
  });

  it("left unassigned, clears a branch counsellor and keeps a head office one", () => {
    const r = planStudentMove(input({ choice: "leave", counsellor: null, students: [student(), student({ id: "s2", assignedToId: "u-desk", counsellorAtHeadOffice: true })], bulk: true }));
    assert.ok(r.ok);
    assert.deepEqual(r.plan.moves.map((m) => m.to), [null, "u-desk"]);
    assert.equal(r.plan.counsellorId, null);
  });

  it("refuses an archived student on their own, not in a whole branch", () => {
    assert.match(refusal(input({ students: [student({ archived: true })] })), /archived/);
    assert.ok(planStudentMove(input({ students: [student({ archived: true })], bulk: true })).ok);
  });

  it("refuses a student who is not at the branch any more", () => {
    assert.match(refusal(input({ students: [student({ orgId: "ktm" })] })), /no longer at NCLEX RN/);
  });

  it("refuses a branch with nobody to move", () => {
    assert.match(refusal(input({ students: [], bulk: true })), /NCLEX RN has no active students to move/);
  });

  it("checks where before who", () => {
    assert.match(refusal(input({ to: { ...kottayam, active: false }, counsellor: null })), /closed/);
  });
});

describe("what goes with the student", () => {
  it("hands tasks to the counsellor, else the branch head, else nobody", () => {
    assert.equal(taskTakerFor("u-docs", { id: "u-head" }), "u-docs");
    assert.equal(taskTakerFor(null, { id: "u-head" }), "u-head");
    assert.equal(taskTakerFor(null, null), null);
  });

  it("takes the old branch's people off the file, but not the team or the head office", () => {
    const off = filePeopleToTakeOff(
      [
        { id: "p1", userOrgId: "nclex", onTeam: false },
        { id: "p2", userOrgId: "nclex", onTeam: true },
        { id: "p3", userOrgId: "hq", onTeam: false },
        { id: "p4", userOrgId: "kannur", onTeam: true },
      ],
      "nclex",
    );
    assert.deepEqual(off, ["p1"]);
  });
});

describe("what the desk is told", () => {
  it("says what moved and what stayed, for one student", () => {
    const said = studentMoveSummary({
      studentName: "Asha Joseph",
      students: 1,
      fromName: "NCLEX RN",
      toName: "Medcity Kottayam",
      counsellorName: "UK Docs",
      unassigned: 0,
      applications: 2,
      enquiries: 1,
      tasks: 1,
      tasksTo: "UK Docs",
      tasksLeft: 0,
      takenOffFiles: 1,
    });
    assert.equal(
      said,
      "Asha Joseph is now at Medcity Kottayam. Counsellor: UK Docs. 2 applications went with them. 1 enquiry moved too. 1 open task handed to UK Docs. 1 person from NCLEX RN taken off the file. " +
        MOVE_KEEPS("NCLEX RN"),
    );
    assert.match(said, /Medcity ID stays as it is/);
    assert.match(said, /Fee invoices and receipts already issued stay with NCLEX RN/);
    assert.ok(!said.includes(String.fromCharCode(0x2014)), "no em dashes");
  });

  it("counts a whole branch left for the branch head", () => {
    const said = studentMoveSummary({
      studentName: null,
      students: 3,
      fromName: "NCLEX RN",
      toName: "Medcity Kottayam",
      counsellorName: null,
      unassigned: 3,
      applications: 0,
      enquiries: 0,
      tasks: 0,
      tasksTo: null,
      tasksLeft: 0,
      takenOffFiles: 0,
      archivedLeft: 1,
    });
    assert.match(said, /^3 students are now at Medcity Kottayam\. 3 students left unassigned for the branch head to hand out\./);
    assert.match(said, /1 archived student stays at NCLEX RN\./);
  });
});
