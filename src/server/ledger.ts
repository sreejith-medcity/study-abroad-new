import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "@/db";
import { buildOts, CALENDARS, ChainCheck, GENESIS, seal, stampDue, stampStatement, type LedgerEntry, type LedgerFields, type Verification } from "@/lib/ledger";

/**
 * The ownership ledger: who owns each student and enquiry over time,
 * append-only and hash-chained (the arithmetic is in src/lib/ledger.ts).
 *
 * Entries are appended in the transaction that made the change they record,
 * with the head row locked, so two changes landing at once still get one
 * number each and a change that is rolled back leaves no entry behind. The
 * portal never updates or deletes an entry, and the database refuses to.
 *
 * No "server-only" import, because the bulk upload that records here can be
 * run from a plain script.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Writer = typeof db | Tx;

export type LedgerKind = "OPENING" | "CREATED" | "ASSIGNED" | "BRANCH_MOVE" | "HANDOVER" | "CONVERTED" | "REMOVED";

/** What a caller says happened. Names are looked up here, at the moment it happened. */
export type LedgerInput = {
  kind: LedgerKind;
  entity: "student" | "enquiry";
  entityId: string;
  orgId: string | null;
  ownerId: string | null;
  prevOrgId?: string | null;
  prevOwnerId?: string | null;
  detail?: string | null;
  actorId: string | null;
};

const HEAD = "main";

/**
 * Appends entries in order. A record that has never been on the ledger gets
 * an opening entry first, saying who held it before this change, so its
 * timeline starts from what was true rather than from nothing. Creations
 * need no opening entry: they are the start.
 */
export async function appendLedger(w: Writer, inputs: readonly LedgerInput[]): Promise<void> {
  if (!inputs.length) return;
  const run = async (tx: Tx) => {
    // The head is locked first, so the "already on the ledger" question below
    // cannot be answered differently by two appends running at once.
    await tx.insert(schema.ledgerHead).values({ id: HEAD, seq: 0, headHash: GENESIS }).onConflictDoNothing();
    const [head] = await tx.select().from(schema.ledgerHead).where(eq(schema.ledgerHead.id, HEAD)).for("update");

    const L = schema.ownershipLedger;
    const ids = [...new Set(inputs.filter((i) => i.kind !== "CREATED").map((i) => i.entityId))];
    const onLedger = new Set(
      ids.length ? (await tx.selectDistinct({ id: L.entityId }).from(L).where(inArray(L.entityId, ids))).map((r) => r.id) : [],
    );
    const list: LedgerInput[] = [];
    for (const i of inputs) {
      if (i.kind !== "CREATED" && !onLedger.has(i.entityId)) {
        // Who held it just before this change: the previous owner where the
        // change names one (null meaning nobody), otherwise the owner it has.
        list.push({
          kind: "OPENING",
          entity: i.entity,
          entityId: i.entityId,
          orgId: i.prevOrgId ?? i.orgId,
          ownerId: i.prevOwnerId !== undefined ? i.prevOwnerId : i.ownerId,
          detail: null,
          actorId: i.actorId,
        });
      }
      onLedger.add(i.entityId);
      list.push(i);
    }

    const people = new Set<string>();
    const orgs = new Set<string>();
    for (const i of list) {
      for (const p of [i.ownerId, i.prevOwnerId, i.actorId]) if (p) people.add(p);
      for (const o of [i.orgId, i.prevOrgId]) if (o) orgs.add(o);
    }
    const [userRows, orgRows] = await Promise.all([
      people.size ? tx.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [...people])) : [],
      orgs.size ? tx.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(inArray(schema.organizations.id, [...orgs])) : [],
    ]);
    const userName = new Map(userRows.map((r) => [r.id, r.name]));
    const orgName = new Map(orgRows.map((r) => [r.id, r.name]));
    // One moment for the whole append, to the millisecond the column keeps.
    const at = new Date();

    const fields: Omit<LedgerFields, "seq" | "prevHash">[] = list.map((i) => ({
      kind: i.kind,
      entity: i.entity,
      entityId: i.entityId,
      orgId: i.orgId ?? null,
      orgName: i.orgId ? (orgName.get(i.orgId) ?? null) : null,
      ownerId: i.ownerId ?? null,
      ownerName: i.ownerId ? (userName.get(i.ownerId) ?? null) : null,
      prevOrgId: i.kind === "OPENING" ? null : (i.prevOrgId ?? null),
      prevOrgName: i.kind !== "OPENING" && i.prevOrgId ? (orgName.get(i.prevOrgId) ?? null) : null,
      prevOwnerId: i.kind === "OPENING" ? null : (i.prevOwnerId ?? null),
      prevOwnerName: i.kind !== "OPENING" && i.prevOwnerId ? (userName.get(i.prevOwnerId) ?? null) : null,
      detail: i.detail ?? null,
      actorId: i.actorId,
      actorName: i.actorId ? (userName.get(i.actorId) ?? null) : null,
      createdAt: at,
    }));
    const { sealed, head: next } = seal({ seq: head.seq, hash: head.headHash }, fields);
    for (let k = 0; k < sealed.length; k += 1000) await tx.insert(L).values(sealed.slice(k, k + 1000).map((e) => ({ ...e, entity: e.entity as "student" | "enquiry" })));
    await tx.update(schema.ledgerHead).set({ seq: next.seq, headHash: next.hash, updatedAt: at }).where(eq(schema.ledgerHead.id, HEAD));
  };
  if (w === db) await db.transaction(run);
  else await run(w as Tx);
  stampSoon();
}

/** One record's ownership, oldest first. */
export async function ledgerFor(entity: "student" | "enquiry", entityId: string) {
  const L = schema.ownershipLedger;
  return db.select().from(L).where(and(eq(L.entity, entity), eq(L.entityId, entityId))).orderBy(asc(L.seq));
}

/** Recomputes every hash in order, five thousand entries at a time, and checks the head. */
export async function verifyLedger(): Promise<Verification> {
  const L = schema.ownershipLedger;
  const [head] = await db.select().from(schema.ledgerHead).where(eq(schema.ledgerHead.id, HEAD)).limit(1);
  const check = new ChainCheck();
  for (let after = 0; ; ) {
    const batch = await db.select().from(L).where(gt(L.seq, after)).orderBy(asc(L.seq)).limit(5000);
    if (!batch.length) break;
    let going = true;
    for (const e of batch) {
      if (!check.add(e as LedgerEntry)) {
        going = false;
        break;
      }
    }
    if (!going) break;
    after = batch.at(-1)!.seq;
  }
  return check.result(head ? { seq: head.seq, hash: head.headHash } : null);
}

export async function ledgerHeadRow() {
  const [head] = await db.select().from(schema.ledgerHead).where(eq(schema.ledgerHead.id, HEAD)).limit(1);
  return head ?? null;
}

// ---------- The public stamp ----------

async function submit(cal: string, digest: Buffer) {
  const r = await fetch(`${cal}/digest`, {
    method: "POST",
    body: new Uint8Array(digest),
    headers: { accept: "application/vnd.opentimestamps.v1", "content-type": "application/x-www-form-urlencoded", "user-agent": "medcity-overseas-portal" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`${new URL(cal).host} answered ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (!b.length || b.length > 10_000) throw new Error(`${new URL(cal).host} sent an unexpected reply`);
  return b;
}

/**
 * Stamps the ledger's head on the public calendars. Nothing to stamp when
 * the ledger is empty. With no network every calendar fails, the attempt is
 * kept as FAILED with the reason, and the ledger reads "not stamped".
 */
export async function stampLedger(): Promise<{ status: "EMPTY" } | { status: "SENT" | "FAILED"; calendars: string[]; error: string | null; uptoSeq: number }> {
  const head = await ledgerHeadRow();
  if (!head || head.seq === 0) return { status: "EMPTY" };
  const statement = stampStatement(head.seq, head.headHash, new Date());
  const digest = createHash("sha256").update(statement).digest();
  const ok: { cal: string; resp: Buffer }[] = [];
  const errors: string[] = [];
  await Promise.all(
    CALENDARS.map(async (cal) => {
      try {
        ok.push({ cal, resp: await submit(cal, digest) });
      } catch (e) {
        errors.push(e instanceof Error ? `${new URL(cal).host}: ${e.message}` : String(e));
      }
    }),
  );
  const proof = ok.length ? buildOts(digest.toString("hex"), ok.map((o) => o.resp)).toString("base64") : null;
  const status = ok.length ? "SENT" : "FAILED";
  const error = errors.length ? errors.join("; ").slice(0, 500) : null;
  await db.insert(schema.ledgerStamps).values({ uptoSeq: head.seq, headHash: head.headHash, statement, digest: digest.toString("hex"), proof, calendars: ok.map((o) => o.cal), status, error });
  return { status, calendars: ok.map((o) => o.cal), error, uptoSeq: head.seq };
}

/** Stamps when a stamp is due (once a day, or an hour after one that failed). Never throws. */
export async function stampIfDue(now = new Date()) {
  try {
    const head = await ledgerHeadRow();
    const [last] = await db.select().from(schema.ledgerStamps).orderBy(desc(schema.ledgerStamps.createdAt)).limit(1);
    if (!stampDue(last ?? null, head?.seq ?? 0, now)) return null;
    return await stampLedger();
  } catch {
    return null;
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * The daily stamp needs no scheduler: a few seconds after the ledger moves,
 * in the background, a stamp is made if one is due. At most one is waiting
 * at a time, and it never holds up the person whose change wrote the entry.
 */
function stampSoon() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void stampIfDue();
  }, 3000);
  pending.unref?.();
}

/** The latest stamps, newest first. */
export const recentStamps = (limit = 10) => db.select().from(schema.ledgerStamps).orderBy(desc(schema.ledgerStamps.createdAt)).limit(limit);

/** How many entries are in the ledger, and over how many records. */
export async function ledgerCounts() {
  const [row] = await db
    .select({
      entries: sql<number>`count(*)::int`,
      records: sql<number>`count(distinct (${schema.ownershipLedger.entity}, ${schema.ownershipLedger.entityId}))::int`,
      moves: sql<number>`(count(*) filter (where ${schema.ownershipLedger.kind} in ('ASSIGNED', 'BRANCH_MOVE')))::int`,
    })
    .from(schema.ownershipLedger);
  return row ?? { entries: 0, records: 0, moves: 0 };
}
