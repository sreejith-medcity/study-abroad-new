import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_DEPARTMENTS, DEPARTMENT_NAME_LENGTH, MAX_DEPARTMENTS, departmentChoice, parseDepartments } from "../src/lib/departments";

describe("the department list", () => {
  it("starts with the departments Medcity named", () => {
    assert.deepEqual([...DEFAULT_DEPARTMENTS], ["Study abroad", "Ausbildung", "NCLEX-RN", "Documentation", "Placement", "Visa", "Travel desk", "Finance", "Management"]);
  });

  it("reads one per line, trimmed, blanks dropped, duplicates once", () => {
    assert.deepEqual(parseDepartments("  Ausbildung \n\nNCLEX-RN\nausbildung\n Visa  desk \n"), ["Ausbildung", "NCLEX-RN", "Visa desk"]);
  });

  it("cuts a long name and stops at the limit", () => {
    const [cut] = parseDepartments("x".repeat(100));
    assert.equal(cut.length, DEPARTMENT_NAME_LENGTH);
    const many = parseDepartments(Array.from({ length: MAX_DEPARTMENTS + 10 }, (_, i) => `Desk ${i}`).join("\n"));
    assert.equal(many.length, MAX_DEPARTMENTS);
  });

  it("an empty box is an empty list, for the caller to fall back from", () => {
    assert.deepEqual(parseDepartments(""), []);
  });
});

describe("a person's department", () => {
  const list = ["Ausbildung", "NCLEX-RN"];

  it("empty means none", () => {
    assert.deepEqual(departmentChoice("", list), { ok: true, department: null });
    assert.deepEqual(departmentChoice(undefined, list), { ok: true, department: null });
  });

  it("takes a name on the list, in the list's own spelling", () => {
    assert.deepEqual(departmentChoice(" nclex-rn ", list), { ok: true, department: "NCLEX-RN" });
  });

  it("refuses a name that is not on the list", () => {
    const r = departmentChoice("Placement", list);
    assert.ok(!r.ok);
    assert.match(r.error, /Settings, Platform/);
  });
});
