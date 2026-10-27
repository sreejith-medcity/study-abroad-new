import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { assignGroups, moveConfirmText, moveValue, parseAssignChoice, teamLabel, teamValue } from "../src/lib/assign-choice";

describe("what an Assigned to choice means", () => {
  it("reads nobody, a person, a team, a team member and a move", () => {
    assert.deepEqual(parseAssignChoice(""), { kind: "none" });
    assert.deepEqual(parseAssignChoice(null), { kind: "none" });
    assert.deepEqual(parseAssignChoice("u-1"), { kind: "person", userId: "u-1" });
    assert.deepEqual(parseAssignChoice(teamValue("t-1")), { kind: "team", teamId: "t-1", userId: null });
    assert.deepEqual(parseAssignChoice(teamValue("t-1", "u-2")), { kind: "team", teamId: "t-1", userId: "u-2" });
    assert.deepEqual(parseAssignChoice(moveValue("o-1", "u-3")), { kind: "move", orgId: "o-1", userId: "u-3" });
  });
  it("refuses anything the dropdown never offers", () => {
    for (const v of ["move:o-1", "move:o-1:u:x", "team:", "team:t:u:v", "other:a:b", "a b", "x'; drop", "u".repeat(41)]) {
      assert.equal(parseAssignChoice(v), null, v);
    }
  });
});

describe("the dropdown's groups", () => {
  const p = (id: string, name: string, role?: string) => ({ id, name, deskLabel: null, role });
  const base = { orgId: "ktm", orgName: "Medcity Kottayam", branch: [p("c1", "Anu")], headOffice: [p("h1", "Docs desk", "DOCUMENTATION")], roleLabel: (r: string) => (r === "DOCUMENTATION" ? "Documentation" : r) };

  it("is the branch and the head office, as before, without the wider choices", () => {
    const g = assignGroups(base);
    assert.deepEqual(g.map((x) => x.label), ["Medcity Kottayam", "Head office"]);
    assert.deepEqual(g[1].options, [{ value: "h1", label: "Docs desk (Documentation)" }]);
  });

  it("adds a group per team and per other branch with people, for an admin", () => {
    const g = assignGroups({
      ...base,
      wider: {
        teams: [{ id: "t1", name: "Ausbildung", members: [p("m1", "Biju")] }, { id: "t2", name: "UK team", members: [] }],
        branches: [
          { id: "ktm", name: "Medcity Kottayam", people: [p("c1", "Anu")] },
          { id: "tsr", name: "Medcity Thrissur", people: [p("c9", "Devi")] },
          { id: "emp", name: "Empty branch", people: [] },
        ],
      },
    });
    assert.deepEqual(g.map((x) => x.label), ["Medcity Kottayam", "Head office", "Ausbildung team", "UK team", "Move to Medcity Thrissur"]);
    assert.deepEqual(g[2].options, [
      { value: "team:t1", label: "Whole team, nobody named yet" },
      { value: "team:t1:m1", label: "Biju" },
    ]);
    assert.equal(g[3].options.length, 1);
    assert.deepEqual(g[4].options, [{ value: "move:tsr:c9", label: "Devi" }]);
    assert.equal(g[4].branchName, "Medcity Thrissur");
    for (const grp of g) for (const o of grp.options) assert.ok(parseAssignChoice(o.value), o.value);
  });
});

describe("the words", () => {
  it("names a team once and says what a move keeps", () => {
    assert.equal(teamLabel("Ausbildung"), "Ausbildung team");
    assert.equal(teamLabel("UK team"), "UK team");
    assert.equal(moveConfirmText("Asha Joseph", "Medcity Thrissur"), "This moves Asha Joseph to Medcity Thrissur. Their Medcity ID, documents and invoices stay as they are.");
  });
});
