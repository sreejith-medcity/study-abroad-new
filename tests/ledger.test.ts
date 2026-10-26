import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOts, dailyStampOn, GENESIS, hashOf, payloadOf, seal, sha256hex, stampDue, stampStatement, verifyChain, type LedgerEntry } from "../src/lib/ledger";

const at = new Date("2026-10-26T05:00:00.123Z");
const base = {
  kind: "ASSIGNED",
  entity: "student",
  entityId: "s1",
  orgId: "o1",
  orgName: "Medcity Kottayam",
  ownerId: "u2",
  ownerName: "Bindu",
  prevOrgId: "o1",
  prevOrgName: "Medcity Kottayam",
  prevOwnerId: "u1",
  prevOwnerName: "Anil",
  detail: null,
  actorId: "u9",
  actorName: "Head",
  createdAt: at,
};

function chain(n: number) {
  const entries = Array.from({ length: n }, (_, i) => ({ ...base, entityId: `s${i}` }));
  return seal({ seq: 0, hash: GENESIS }, entries);
}

test("each entry carries the hash of the one before it, starting from the genesis hash", () => {
  const { sealed, head } = chain(3);
  assert.equal(sealed[0].prevHash, GENESIS);
  assert.equal(sealed[1].prevHash, sealed[0].hash);
  assert.equal(sealed[2].prevHash, sealed[1].hash);
  assert.deepEqual(head, { seq: 3, hash: sealed[2].hash });
  assert.deepEqual(sealed.map((e) => e.seq), [1, 2, 3]);
});

test("the hash is the sha256 of the published payload", () => {
  const { sealed } = chain(1);
  assert.equal(sealed[0].hash, sha256hex(payloadOf(sealed[0])));
  assert.equal(JSON.parse(payloadOf(sealed[0]))[0], "mc-ledger-v1");
});

test("a name holding the separator cannot make two entries read the same", () => {
  const a = { ...base, seq: 1, prevHash: GENESIS, ownerName: "A|B", prevOwnerName: "C" };
  const b = { ...base, seq: 1, prevHash: GENESIS, ownerName: "A", prevOwnerName: "B|C" };
  assert.notEqual(hashOf(a), hashOf(b));
});

test("blank and missing read the same in the payload", () => {
  assert.equal(payloadOf({ ...base, seq: 1, prevHash: GENESIS, detail: "" }), payloadOf({ ...base, seq: 1, prevHash: GENESIS, detail: null }));
});

test("sealing continues an existing chain", () => {
  const first = chain(2);
  const more = seal(first.head, [{ ...base, entityId: "x" }]);
  assert.equal(more.sealed[0].seq, 3);
  assert.equal(more.sealed[0].prevHash, first.head.hash);
  assert.equal(verifyChain([...first.sealed, ...more.sealed], more.head).ok, true);
});

test("an intact chain verifies, and an empty ledger is intact", () => {
  const { sealed, head } = chain(5);
  const v = verifyChain(sealed, head);
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.checked, 5);
  assert.equal(verifyChain([], null).ok, true);
});

test("an entry edited after it was written is caught, by number", () => {
  const { sealed, head } = chain(5);
  const tampered: LedgerEntry[] = sealed.map((e) => (e.seq === 3 ? { ...e, ownerName: "Someone else" } : e));
  const v = verifyChain(tampered, head);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.brokenSeq, 3);
    assert.match(v.problem, /Entry 3 was changed after it was written/);
  }
});

test("an edit that also rewrites its own hash breaks the link to the next entry", () => {
  const { sealed, head } = chain(4);
  const edited = { ...sealed[1], ownerName: "Someone else" };
  edited.hash = hashOf(edited);
  const v = verifyChain([sealed[0], edited, sealed[2], sealed[3]], head);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.brokenSeq, 3);
    assert.match(v.problem, /does not point at the hash of entry 2/);
  }
});

test("a removed entry in the middle is caught as missing", () => {
  const { sealed, head } = chain(4);
  const v = verifyChain(sealed.filter((e) => e.seq !== 2), head);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.problem, /Entry 2 is missing/);
});

test("removing the last entries is caught against the head", () => {
  const { sealed, head } = chain(4);
  const v = verifyChain(sealed.slice(0, 2), head);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.problem, /only 2 were found/);
});

test("a head that does not match the last entry is caught", () => {
  const { sealed, head } = chain(2);
  const v = verifyChain(sealed, { seq: head.seq, hash: "f".repeat(64) });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.problem, /does not match/);
});

test("a stamp is due daily once the chain moves, an hour after a failure, never for an empty ledger", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  assert.equal(stampDue(null, 0, now), false);
  assert.equal(stampDue(null, 3, now), true);
  assert.equal(stampDue({ status: "SENT", uptoSeq: 3, createdAt: hoursAgo(30) }, 3, now), false);
  assert.equal(stampDue({ status: "SENT", uptoSeq: 3, createdAt: hoursAgo(5) }, 4, now), false);
  assert.equal(stampDue({ status: "SENT", uptoSeq: 3, createdAt: hoursAgo(24) }, 4, now), true);
  assert.equal(stampDue({ status: "FAILED", uptoSeq: 3, createdAt: hoursAgo(0.5) }, 4, now), false);
  assert.equal(stampDue({ status: "FAILED", uptoSeq: 3, createdAt: hoursAgo(2) }, 4, now), true);
});

test("the stamped statement names the head, and a proof starts with the OpenTimestamps header", () => {
  const s = stampStatement(7, "ab".repeat(32), at);
  assert.match(s, /Entries: 1 to 7/);
  assert.match(s, /Head hash: (ab){32}/);
  const proof = buildOts("00".repeat(32), [Buffer.from([0xf0, 0x01]), Buffer.from([0xf0, 0x02])]);
  assert.equal(proof.subarray(0, 31).toString("hex"), "004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294");
  assert.equal(proof[31], 0x01);
  assert.equal(proof[32], 0x08);
});

test("the daily stamp is off unless LEDGER_STAMP says on", () => {
  assert.equal(dailyStampOn(undefined), false);
  assert.equal(dailyStampOn(""), false);
  assert.equal(dailyStampOn("off"), false);
  assert.equal(dailyStampOn("no"), false);
  assert.equal(dailyStampOn("on"), true);
  assert.equal(dailyStampOn(" ON "), true);
  assert.equal(dailyStampOn("true"), true);
});
