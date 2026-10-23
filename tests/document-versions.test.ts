import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOnly, documentFamilies, familyOf, isCurrent, versionDay, versionLine, type VersionRow } from "../src/lib/document-versions";

type Row = VersionRow & { uploadedById: string | null };

const at = (iso: string) => new Date(iso);
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  replacesId: null,
  createdAt: at("2026-11-01T06:00:00Z"),
  supersededAt: null,
  supersededById: null,
  removedAt: null,
  uploadedById: "u-anita",
  ...over,
});
const names: Record<string, string> = { "u-anita": "Anita", "u-nithin": "Nithin", "u-student": "the student" };
const nameOf = (id: string | null) => (id ? (names[id] ?? null) : null);
const uploader = (r: Row) => nameOf(r.uploadedById);

/** A replacement as the server makes it: stamped with the moment the old one was set aside. */
function replaced(old: Row, id: string, when: string, by = "u-anita"): [Row, Row] {
  return [{ ...old, supersededAt: at(when), supersededById: by }, row(id, { replacesId: old.id, createdAt: at(when), uploadedById: by })];
}

test("a document with one file is one family, current, with nothing earlier and no version line", () => {
  const [f] = documentFamilies([row("a")]);
  assert.equal(f.current?.id, "a");
  assert.equal(f.current?.version, 1);
  assert.deepEqual(f.earlier, []);
  assert.equal(versionLine(f, nameOf, uploader), null);
});

test("a replacement is version two, and the replaced file is listed as an earlier version", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  const families = documentFamilies([v2, v1]);
  assert.equal(families.length, 1, "one document, not two");
  const [f] = families;
  assert.equal(f.current?.id, "v2");
  assert.equal(f.current?.version, 2);
  assert.deepEqual(f.earlier.map((v) => [v.id, v.version]), [["v1", 1]]);
  assert.equal(f.restored, null);
  assert.equal(versionLine(f, nameOf, uploader), "Version 2, replaced 3 Nov 2026 by Anita");
});

test("bringing back version one makes it current and says who restored it and when", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  const back = [
    { ...v1, supersededAt: null, supersededById: null },
    { ...v2, supersededAt: at("2026-11-04T05:00:00Z"), supersededById: "u-nithin" },
  ];
  const [f] = documentFamilies(back);
  assert.equal(f.current?.id, "v1");
  assert.equal(f.current?.version, 1, "version numbers do not change on a restore");
  assert.deepEqual(f.earlier.map((v) => v.id), ["v2"]);
  assert.deepEqual(f.restored, { at: at("2026-11-04T05:00:00Z"), byId: "u-nithin" });
  assert.equal(versionLine(f, nameOf, uploader), "Version 1, restored 4 Nov 2026 by Nithin");
});

test("replacing a restored file numbers the new one after every version, and it reads as a replacement", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  const v2Aside = { ...v2, supersededAt: at("2026-11-04T05:00:00Z"), supersededById: "u-nithin" };
  const [v1Aside, v3] = replaced(v1, "v3", "2026-11-05T05:00:00Z", "u-student");
  const [f] = documentFamilies([v1Aside, v2Aside, v3]);
  assert.equal(f.current?.id, "v3");
  assert.equal(f.current?.version, 3);
  assert.deepEqual(f.earlier.map((v) => v.id), ["v2", "v1"], "newest first");
  assert.equal(f.restored, null);
  assert.equal(versionLine(f, nameOf, uploader), "Version 3, replaced 5 Nov 2026 by the student");
});

test("restoring back and forth keeps reading as a restore, dated by the latest one", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  // Version one brought back on the 4th, then version two brought back on the 6th.
  const rows = [
    { ...v1, supersededAt: at("2026-11-06T05:00:00Z"), supersededById: "u-anita" },
    { ...v2, supersededAt: null, supersededById: null },
  ];
  const [f] = documentFamilies(rows);
  assert.equal(f.current?.id, "v2");
  assert.equal(versionLine(f, nameOf, uploader), "Version 2, restored 6 Nov 2026 by Anita");
});

test("a removed current file leaves the document with nothing current, and removed files are not earlier versions", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  const [f] = documentFamilies([v1, { ...v2, removedAt: at("2026-11-04T05:00:00Z") }]);
  assert.equal(f.current, null);
  assert.deepEqual(f.earlier.map((v) => v.id), ["v1"]);
  assert.equal(versionLine(f, nameOf, uploader), null);
});

test("version one current again after a later one was removed says when it was uploaded, not replaced", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  const [f] = documentFamilies([{ ...v1, supersededAt: null }, { ...v2, removedAt: at("2026-11-04T05:00:00Z") }]);
  assert.equal(f.current?.id, "v1");
  assert.equal(versionLine(f, nameOf, uploader), "Version 1, uploaded 1 Nov 2026 by Anita");
});

test("two files of one kind that never replaced each other are two documents", () => {
  const families = documentFamilies([row("a"), row("b", { createdAt: at("2026-11-02T06:00:00Z") })]);
  assert.equal(families.length, 2);
  assert.deepEqual(families.map((f) => f.current?.id), ["b", "a"], "newest first");
});

test("if a race left two current files in one document, the newer is current and the other is still listed", () => {
  const v1 = row("v1", { supersededAt: at("2026-11-03T05:00:00Z") });
  const a = row("a", { replacesId: "v1", createdAt: at("2026-11-03T05:00:00Z") });
  const b = row("b", { replacesId: "v1", createdAt: at("2026-11-03T05:00:01Z") });
  const [f] = documentFamilies([v1, a, b]);
  assert.equal(f.current?.id, "b");
  assert.deepEqual(f.earlier.map((v) => v.id).sort(), ["a", "v1"]);
});

test("links that go round in a circle, or to a row not loaded, do not hang or lose files", () => {
  const families = documentFamilies([row("x", { replacesId: "y" }), row("y", { replacesId: "x", supersededAt: at("2026-11-02T00:00:00Z") }), row("z", { replacesId: "gone" })]);
  const ids = families.flatMap((f) => f.all.map((v) => v.id)).sort();
  assert.deepEqual(ids, ["x", "y", "z"]);
});

test("familyOf finds the document any version belongs to", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  assert.equal(familyOf([v1, v2, row("other")], "v1")?.current?.id, "v2");
  assert.equal(familyOf([v1, v2], "missing"), null);
});

test("counting current versions counts a replaced document once and a removed one not at all", () => {
  const [v1, v2] = replaced(row("v1"), "v2", "2026-11-03T05:00:00Z");
  const rows = [v1, v2, row("r", { removedAt: at("2026-11-04T00:00:00Z") }), row("other")];
  assert.equal(currentOnly(rows).length, 2);
  assert.equal(isCurrent(v1), false);
  assert.equal(isCurrent(v2), true);
});

test("dates are Kerala dates", () => {
  // 8.30 pm UTC on the 2nd is already the 3rd in India.
  assert.equal(versionDay(at("2026-11-02T20:30:00Z")), "3 Nov 2026");
});
