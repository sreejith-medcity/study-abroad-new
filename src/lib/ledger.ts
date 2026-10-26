import { createHash } from "node:crypto";

/**
 * The ownership ledger's arithmetic: what each entry's hash covers, how the
 * next entry is sealed onto the chain, and how a whole chain is checked.
 * Pure, so the rule that catches an edited, removed or reordered entry is
 * tested on its own, and anybody holding an export can recheck it outside the
 * portal with the formula written here.
 *
 * hash = sha256 of the JSON array
 *   ["mc-ledger-v1", seq, kind, entity, entityId, orgId, orgName, ownerId,
 *    ownerName, prevOrgId, prevOrgName, prevOwnerId, prevOwnerName, detail,
 *    actorId, actorName, createdAt as ISO 8601, prevHash]
 * with every missing value as null. A JSON array rather than fields joined by
 * a separator, so a name with the separator in it cannot make two different
 * entries read the same.
 */

export const GENESIS = "0".repeat(64);
export const FORMULA = "mc-ledger-v1";

export const LEDGER_KIND_LABEL: Record<string, string> = {
  OPENING: "On record when the ledger started",
  CREATED: "Created",
  ASSIGNED: "Owner changed",
  BRANCH_MOVE: "Moved to another branch",
  HANDOVER: "Handed to the documentation desk",
  CONVERTED: "Registered as a student",
  MERGED: "Merged into another enquiry",
  REMOVED: "Removed",
};

/** The fields an entry is sealed over, apart from its own hash. */
export type LedgerFields = {
  seq: number;
  kind: string;
  entity: string;
  entityId: string;
  orgId: string | null;
  orgName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  prevOrgId: string | null;
  prevOrgName: string | null;
  prevOwnerId: string | null;
  prevOwnerName: string | null;
  detail: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
  prevHash: string;
};

export type LedgerEntry = LedgerFields & { hash: string };

export const sha256hex = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** The exact text an entry's hash covers. */
export function payloadOf(e: LedgerFields): string {
  const n = (v: string | null | undefined) => (v === undefined || v === "" ? null : v);
  return JSON.stringify([
    FORMULA,
    e.seq,
    e.kind,
    e.entity,
    e.entityId,
    n(e.orgId),
    n(e.orgName),
    n(e.ownerId),
    n(e.ownerName),
    n(e.prevOrgId),
    n(e.prevOrgName),
    n(e.prevOwnerId),
    n(e.prevOwnerName),
    n(e.detail),
    n(e.actorId),
    n(e.actorName),
    new Date(e.createdAt).toISOString(),
    e.prevHash,
  ]);
}

export const hashOf = (e: LedgerFields) => sha256hex(payloadOf(e));

export type Head = { seq: number; hash: string };

/**
 * Seals entries onto the chain after `head`, in order: each gets the next
 * number, the previous entry's hash, and its own hash. Returns the sealed
 * entries and the new head.
 */
export function seal(head: Head, entries: readonly Omit<LedgerFields, "seq" | "prevHash">[]): { sealed: LedgerEntry[]; head: Head } {
  let seq = head.seq;
  let prev = head.hash;
  const sealed: LedgerEntry[] = [];
  for (const e of entries) {
    seq += 1;
    const fields: LedgerFields = { ...e, seq, prevHash: prev };
    const hash = hashOf(fields);
    sealed.push({ ...fields, hash });
    prev = hash;
  }
  return { sealed, head: { seq, hash: prev } };
}

export type Verification = { ok: true; checked: number; head: Head } | { ok: false; checked: number; brokenSeq: number | null; problem: string };

/**
 * Checks a chain read in batches: feed it every entry in number order, then
 * ask for the answer against the recorded head. Each entry must carry the
 * next number, point at the hash of the one before it, and hash to what it
 * says. The first entry that does not is the one reported.
 */
export class ChainCheck {
  private prev = GENESIS;
  private expect = 1;
  private checked = 0;
  private failure: Verification | null = null;

  /** Takes the next entry. False once something is wrong, after which nothing more is read. */
  add(e: LedgerEntry): boolean {
    if (this.failure) return false;
    if (e.seq !== this.expect) {
      this.failure = {
        ok: false,
        checked: this.checked,
        brokenSeq: this.expect,
        problem: e.seq > this.expect ? `Entry ${this.expect} is missing: the chain jumps from ${this.expect - 1} to ${e.seq}` : `Entry ${e.seq} appears out of order, where entry ${this.expect} should be`,
      };
      return false;
    }
    if (e.prevHash !== this.prev) {
      this.failure = { ok: false, checked: this.checked, brokenSeq: e.seq, problem: `Entry ${e.seq} does not point at the hash of entry ${e.seq - 1}` };
      return false;
    }
    if (hashOf(e) !== e.hash) {
      this.failure = { ok: false, checked: this.checked, brokenSeq: e.seq, problem: `Entry ${e.seq} was changed after it was written: its contents no longer match its hash` };
      return false;
    }
    this.prev = e.hash;
    this.expect += 1;
    this.checked += 1;
    return true;
  }

  /** The answer, given the head the database recorded. No head and no entries is an empty, intact chain. */
  result(head: Head | null): Verification {
    if (this.failure) return this.failure;
    const h = head ?? { seq: 0, hash: GENESIS };
    if (this.checked !== h.seq) {
      return {
        ok: false,
        checked: this.checked,
        brokenSeq: this.checked < h.seq ? this.checked + 1 : h.seq + 1,
        problem: this.checked < h.seq ? `The ledger head says ${h.seq} entries but only ${this.checked} were found: the last ${h.seq - this.checked} are missing` : `There are ${this.checked} entries but the ledger head says ${h.seq}`,
      };
    }
    if (this.prev !== h.hash) return { ok: false, checked: this.checked, brokenSeq: h.seq, problem: "The last entry does not match the hash the ledger head recorded" };
    return { ok: true, checked: this.checked, head: h };
  }
}

/** Checks a whole chain held in memory. */
export function verifyChain(entries: readonly LedgerEntry[], head: Head | null): Verification {
  const check = new ChainCheck();
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) if (!check.add(e)) break;
  return check.result(head);
}

// ---------- The public stamp ----------

/** The free public OpenTimestamps calendars. No account, no key, no fee. */
export const CALENDARS = ["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org", "https://a.pool.eternitywall.com", "https://ots.btc.catallaxy.com"];
const OTS_MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");

/** The text that is stamped: the head of the chain on a given day. Its sha256 is what the calendars receive. */
export function stampStatement(seq: number, headHash: string, at: Date) {
  return ["Medcity Overseas ownership ledger checkpoint", `Entries: 1 to ${seq}`, `Head hash: ${headHash}`, `Formula: ${FORMULA}`, `Stamped at: ${at.toISOString()}`, ""].join("\n");
}

/**
 * A detached .ots proof for a sha256 digest, built from the calendars'
 * answers the way the ots client builds it: several answers are joined as
 * branches, with 0xff before every branch but the last.
 */
export function buildOts(digestHex: string, responses: readonly Buffer[]) {
  const single = responses.filter((r) => r.length && r[0] !== 0xff);
  const branches = single.length ? single : responses.slice(0, 1);
  const parts: Buffer[] = [OTS_MAGIC, Buffer.from([0x01, 0x08]), Buffer.from(digestHex, "hex")];
  branches.forEach((r, i) => {
    if (i < branches.length - 1) parts.push(Buffer.from([0xff]));
    parts.push(r);
  });
  return Buffer.concat(parts);
}

/**
 * Whether a stamp is due: once a day after one that reached a calendar, and
 * an hour after one that did not, and never while the chain has not moved
 * since the last good one.
 */
export function stampDue(last: { status: string; uptoSeq: number; createdAt: Date } | null, headSeq: number, now: Date): boolean {
  if (headSeq <= 0) return false;
  if (!last) return true;
  const ageH = (now.getTime() - new Date(last.createdAt).getTime()) / 3_600_000;
  if (last.status === "FAILED") return ageH >= 1;
  if (last.uptoSeq >= headSeq) return false;
  return ageH >= 23;
}
