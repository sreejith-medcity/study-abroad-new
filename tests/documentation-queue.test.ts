import { test } from "node:test";
import assert from "node:assert/strict";
import { documentCount, groupQueue, holdersText, QUEUE_PAGE, queuePageNumber, queuePaging, type QueueGroupRow } from "../src/lib/documentation-queue";
import type { JourneyStage } from "../src/db/schema";

const today = new Date("2026-10-26T10:00:00Z");
const hoursAgo = (h: number) => new Date(today.getTime() - h * 3_600_000);
const minutesAgo = (m: number) => new Date(today.getTime() - m * 60_000);

let n = 0;
const row = (over: Partial<QueueGroupRow> & { studentId: string; stage?: JourneyStage }): QueueGroupRow => ({
  id: `item-${++n}`,
  studentName: over.studentId === "s1" ? "Anu Thomas" : over.studentId === "s2" ? "Rahul Nair" : "Meera Pillai",
  branch: "Kottayam",
  stage: "APPLICATION",
  dueOn: null,
  uploadedAt: hoursAgo(1),
  vendorCode: null,
  vendorColour: null,
  claimedById: null,
  claimedAt: null,
  claimedByName: null,
  ...over,
});

test("one group per student, with every waiting document under it", () => {
  const rows = [row({ studentId: "s1" }), row({ studentId: "s2" }), row({ studentId: "s1" }), row({ studentId: "s1" })];
  const groups = groupQueue(rows, "OLDEST", { today });
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => [g.studentId, g.items.length]),
    [
      ["s1", 3],
      ["s2", 1],
    ].sort(),
  );
  assert.equal(groups.find((g) => g.studentId === "s1")?.studentName, "Anu Thomas");
});

test("oldest first: the student whose longest-waiting document has waited longest leads", () => {
  const rows = [
    row({ studentId: "s1", uploadedAt: hoursAgo(2) }),
    row({ studentId: "s2", uploadedAt: hoursAgo(1) }),
    row({ studentId: "s2", uploadedAt: hoursAgo(30) }),
    row({ studentId: "s3", uploadedAt: hoursAgo(5) }),
  ];
  const groups = groupQueue(rows, "OLDEST", { today });
  assert.deepEqual(
    groups.map((g) => g.studentId),
    ["s2", "s3", "s1"],
  );
  assert.equal(groups[0].oldestUploadedAt?.getTime(), hoursAgo(30).getTime());
  // Inside the student, the longest-waiting document comes first too.
  assert.deepEqual(
    groups[0].items.map((i) => i.uploadedAt?.getTime()),
    [hoursAgo(30).getTime(), hoursAgo(1).getTime()],
  );
});

test("a document with no time recorded goes to the back, not the front", () => {
  const rows = [row({ studentId: "s1", uploadedAt: null }), row({ studentId: "s2", uploadedAt: hoursAgo(1) })];
  assert.deepEqual(
    groupQueue(rows, "OLDEST", { today }).map((g) => g.studentId),
    ["s2", "s1"],
  );
  // The same under visa stage first: the two sorts agree about an unrecorded time.
  assert.deepEqual(
    groupQueue(rows, "VISA_FIRST", { today }).map((g) => g.studentId),
    ["s2", "s1"],
  );
  // Two with no time are equal, and fall back to the name.
  const neither = [row({ studentId: "s2", uploadedAt: null }), row({ studentId: "s1", uploadedAt: null })];
  assert.deepEqual(
    groupQueue(neither, "OLDEST", { today }).map((g) => g.studentId),
    ["s1", "s2"],
  );
});

test("the page number read from the address: the first unless a whole number past it is asked for", () => {
  assert.equal(queuePageNumber(undefined), 1);
  assert.equal(queuePageNumber(""), 1);
  assert.equal(queuePageNumber("0"), 1);
  assert.equal(queuePageNumber("-3"), 1);
  assert.equal(queuePageNumber("abc"), 1);
  assert.equal(queuePageNumber("2"), 2);
  assert.equal(queuePageNumber("2.9"), 2);
  assert.equal(queuePageNumber(["4", "9"]), 4);
});

test("the links at the foot: a page after only when this one was full, a page before only past the first", () => {
  assert.equal(QUEUE_PAGE, 60);
  assert.deepEqual(queuePaging(1, false), { previous: null, next: null });
  assert.deepEqual(queuePaging(1, true), { previous: null, next: 2 });
  assert.deepEqual(queuePaging(3, true), { previous: 2, next: 4 });
  assert.deepEqual(queuePaging(3, false), { previous: 2, next: null });
});

test("visa stage first: a student with a visa document leads, then the stages nearest it, oldest within", () => {
  const rows = [
    row({ studentId: "s1", stage: "PROFILE", uploadedAt: hoursAgo(100) }),
    row({ studentId: "s2", stage: "OFFER", uploadedAt: hoursAgo(3) }),
    row({ studentId: "s3", stage: "VISA", uploadedAt: hoursAgo(1) }),
    row({ studentId: "s3", stage: "PROFILE", uploadedAt: hoursAgo(200) }),
  ];
  const groups = groupQueue(rows, "VISA_FIRST", { today });
  assert.deepEqual(
    groups.map((g) => g.studentId),
    ["s3", "s2", "s1"],
  );
  // The visa document is the one shown first under that student.
  assert.equal(groups[0].items[0].stage, "VISA");
});

test("visa stage first: two students at the same stage fall back to who has waited longest", () => {
  const rows = [row({ studentId: "s1", stage: "VISA", uploadedAt: hoursAgo(2) }), row({ studentId: "s2", stage: "VISA", uploadedAt: hoursAgo(9) })];
  assert.deepEqual(
    groupQueue(rows, "VISA_FIRST", { today }).map((g) => g.studentId),
    ["s2", "s1"],
  );
});

test("the group's stage is the furthest stage among the waiting documents", () => {
  const rows = [row({ studentId: "s1", stage: "PROFILE" }), row({ studentId: "s1", stage: "DEPOSIT" }), row({ studentId: "s1", stage: "APPLICATION" })];
  assert.equal(groupQueue(rows, "OLDEST", { today })[0].stage, "DEPOSIT");
});

test("routes are listed once each, in the order they first appear", () => {
  const rows = [
    row({ studentId: "s1", vendorCode: "KC", vendorColour: "#111", uploadedAt: hoursAgo(5) }),
    row({ studentId: "s1", vendorCode: null, uploadedAt: hoursAgo(4) }),
    row({ studentId: "s1", vendorCode: "AE", vendorColour: "#222", uploadedAt: hoursAgo(3) }),
    row({ studentId: "s1", vendorCode: "KC", vendorColour: "#111", uploadedAt: hoursAgo(2) }),
  ];
  assert.deepEqual(groupQueue(rows, "OLDEST", { today })[0].routes, [
    { code: "KC", colour: "#111" },
    { code: "AE", colour: "#222" },
  ]);
});

test("the soonest wanted-by date is carried up to the student", () => {
  const rows = [row({ studentId: "s1", dueOn: "2026-11-20" }), row({ studentId: "s1", dueOn: "2026-11-02" }), row({ studentId: "s1", dueOn: null })];
  assert.equal(groupQueue(rows, "OLDEST", { today })[0].soonestDueOn, "2026-11-02");
});

test("holders count claims still held, the viewer first, and a lapsed claim does not count", () => {
  const rows = [
    row({ studentId: "s1", claimedById: "u-anjali", claimedByName: "Anjali", claimedAt: minutesAgo(5) }),
    row({ studentId: "s1", claimedById: "u-anjali", claimedByName: "Anjali", claimedAt: minutesAgo(2) }),
    row({ studentId: "s1", claimedById: "u-me", claimedByName: "Me", claimedAt: minutesAgo(1) }),
    row({ studentId: "s1", claimedById: "u-old", claimedByName: "Old", claimedAt: minutesAgo(45) }),
    row({ studentId: "s1" }),
  ];
  const [g] = groupQueue(rows, "OLDEST", { today, viewerId: "u-me" });
  assert.deepEqual(g.holders, [
    { id: "u-me", name: "Me", count: 1 },
    { id: "u-anjali", name: "Anjali", count: 2 },
  ]);
  assert.equal(holdersText(g.holders, "u-me"), "1 with you, 2 with Anjali");
});

test("the words on the row", () => {
  assert.equal(documentCount(1), "1 document");
  assert.equal(documentCount(3), "3 documents");
  assert.equal(holdersText([], "u-me"), "None claimed");
  assert.equal(holdersText([{ id: "u-x", name: null, count: 2 }], "u-me"), "2 with somebody");
});

test("mine first: the viewer's own claims lead under each student, and the student order still follows the queue", () => {
  const rows = [
    row({ studentId: "s1", uploadedAt: hoursAgo(50) }),
    row({ studentId: "s1", uploadedAt: hoursAgo(1), claimedById: "u-me", claimedAt: minutesAgo(1) }),
    row({ studentId: "s2", uploadedAt: hoursAgo(60), claimedById: "u-me", claimedAt: minutesAgo(1) }),
    row({ studentId: "s2", uploadedAt: hoursAgo(2) }),
  ];
  const groups = groupQueue(rows, "OLDEST", { today, viewerId: "u-me", mineFirst: true });
  assert.deepEqual(
    groups.map((g) => g.studentId),
    ["s2", "s1"],
    "placed by the longest-waiting document, not by the one the viewer claimed",
  );
  assert.deepEqual(
    groups.map((g) => g.items.map((i) => i.claimedById)),
    [
      ["u-me", null],
      ["u-me", null],
    ],
  );
});

test("an empty queue groups to nothing", () => {
  assert.deepEqual(groupQueue([], "OLDEST", { today }), []);
});
