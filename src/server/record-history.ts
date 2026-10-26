import { and, asc, desc, eq, exists, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { dayRange, idsToName, trackedChanges, type FieldChange, type HistoryEntity, type HistoryFilters, type NameBook } from "@/lib/record-history";
import { appendLedger, type LedgerInput } from "@/server/ledger";

/**
 * Version history for students, enquiries, applications and staff accounts,
 * and the one way the portal's actions update those records.
 *
 * Every action that changes one of them goes through updateTracked (one
 * record) or updateTrackedMany (several), which reads the row as it was,
 * writes the change, and records what moved in the same transaction: one
 * insert per changed record, never one per field. A change to who owns a
 * student or an enquiry, or to its branch, is also appended to the
 * ownership ledger there and then, so the two can never disagree.
 *
 * No "server-only" import, because the bulk uploads that record here can be
 * run from a plain script.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Writer = typeof db | Tx;

type StudentRow = typeof schema.students.$inferSelect;
type EnquiryRow = typeof schema.enquiries.$inferSelect;
type ApplicationRow = typeof schema.applications.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

type RowOf<E extends HistoryEntity> = E extends "student" ? StudentRow : E extends "enquiry" ? EnquiryRow : E extends "application" ? ApplicationRow : UserRow;
type SetOf<E extends HistoryEntity> = E extends "student"
  ? PgUpdateSetSource<typeof schema.students>
  : E extends "enquiry"
    ? PgUpdateSetSource<typeof schema.enquiries>
    : E extends "application"
      ? PgUpdateSetSource<typeof schema.applications>
      : PgUpdateSetSource<typeof schema.users>;

const TABLES = { student: schema.students, enquiry: schema.enquiries, application: schema.applications, user: schema.users } as const;

export type TrackMeta = {
  /** Who did it; null for the portal itself (a sync, a scheduled job). */
  by: string | null;
  /** What was done, for the feed: student.profile, enquiry.update, application.status. */
  action: string;
  /** The transaction the change belongs to, where the caller has one. */
  tx?: Tx;
  /** An extra condition on the update, as the caller would have written it. */
  where?: SQL;
  /** Said on the ledger entry, where the change moves ownership: why, or what it came with. */
  ledgerDetail?: string | null;
};

export type Tracked<E extends HistoryEntity> = { before: RowOf<E>; after: RowOf<E>; changes: FieldChange[] };

/** The version row for one changed record. */
function versionRow(entity: HistoryEntity, after: Record<string, unknown>, changes: FieldChange[], meta: TrackMeta) {
  const orgId = (after.orgId as string | null | undefined) ?? null;
  const studentId = entity === "student" ? (after.id as string) : entity === "application" ? ((after.studentId as string) ?? null) : entity === "enquiry" ? ((after.studentId as string | null) ?? null) : null;
  return {
    entity,
    entityId: after.id as string,
    orgId,
    // An enquiry is read by the enquiry's own rules, not the student's.
    studentId: entity === "enquiry" ? null : studentId,
    changes,
    action: meta.action,
    changedById: meta.by,
  };
}

/** The ledger entries a change makes: a new owner, a new branch, or both. */
function ownershipEntries(entity: HistoryEntity, before: Record<string, unknown>, after: Record<string, unknown>, changes: FieldChange[], meta: TrackMeta): LedgerInput[] {
  if (entity !== "student" && entity !== "enquiry") return [];
  const moved = changes.some((c) => c.field === "orgId");
  const reowned = changes.some((c) => c.field === "assignedToId");
  if (!moved && !reowned) return [];
  return [
    {
      kind: moved ? "BRANCH_MOVE" : "ASSIGNED",
      entity,
      entityId: after.id as string,
      orgId: (after.orgId as string) ?? null,
      ownerId: (after.assignedToId as string | null) ?? null,
      prevOrgId: (before.orgId as string) ?? null,
      prevOwnerId: (before.assignedToId as string | null) ?? null,
      detail: meta.ledgerDetail ?? null,
      actorId: meta.by,
    },
  ];
}

/**
 * An application handed to the documentation desk is a hand-over of the
 * student's file, so it goes on the student's line of the ledger, with the
 * student's owner and branch as they stand.
 */
async function handoverEntries(tx: Tx, rows: readonly { before: Record<string, unknown>; after: Record<string, unknown> }[], meta: TrackMeta): Promise<LedgerInput[]> {
  const handed = rows.filter((r) => !r.before.handedOverAt && r.after.handedOverAt);
  if (!handed.length) return [];
  const ids = [...new Set(handed.map((r) => r.after.studentId as string))];
  const students = await tx
    .select({ id: schema.students.id, orgId: schema.students.orgId, assignedToId: schema.students.assignedToId })
    .from(schema.students)
    .where(inArray(schema.students.id, ids));
  const byId = new Map(students.map((x) => [x.id, x]));
  return handed.flatMap((r) => {
    const st = byId.get(r.after.studentId as string);
    if (!st) return [];
    return [
      {
        kind: "HANDOVER" as const,
        entity: "student" as const,
        entityId: st.id,
        orgId: st.orgId,
        ownerId: st.assignedToId,
        detail: `Application ${String(r.after.ackNo ?? "")} handed to the desk`.trim(),
        actorId: meta.by,
      },
    ];
  });
}

async function inTx<T>(w: Tx | undefined, run: (tx: Tx) => Promise<T>): Promise<T> {
  return w ? run(w) : db.transaction(run);
}

/**
 * Updates one record and records what changed. Returns null when there was
 * no such row, or when `where` left it alone; otherwise the row before and
 * after and the fields that moved (none, when the write changed nothing that
 * is kept).
 */
export async function updateTracked<E extends HistoryEntity>(entity: E, id: string, set: SetOf<E>, meta: TrackMeta): Promise<Tracked<E> | null> {
  // One table at a time is all the typing can follow; the value types are
  // checked by SetOf at the call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = TABLES[entity] as any;
  return inTx(meta.tx, async (tx) => {
    const [before] = await tx.select().from(table).where(eq(table.id, id)).for("update");
    if (!before) return null;
    const [after] = await tx
      .update(table)
      .set(set)
      .where(meta.where ? and(eq(table.id, id), meta.where) : eq(table.id, id))
      .returning();
    if (!after) return null;
    const changes = trackedChanges(entity, before, after);
    if (changes.length) {
      await tx.insert(schema.recordVersions).values(versionRow(entity, after, changes, meta));
      const ledger = ownershipEntries(entity, before, after, changes, meta);
      if (entity === "application") ledger.push(...(await handoverEntries(tx, [{ before, after }], meta)));
      if (ledger.length) await appendLedger(tx, ledger);
    }
    return { before, after, changes } as Tracked<E>;
  });
}

/**
 * Updates every record `where` picks and records each one that changed: one
 * statement for the history of all of them together, and one for the ledger.
 */
export async function updateTrackedMany<E extends HistoryEntity>(entity: E, where: SQL, set: SetOf<E>, meta: Omit<TrackMeta, "where">): Promise<Tracked<E>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = TABLES[entity] as any;
  return inTx(meta.tx, async (tx) => {
    const beforeRows: Record<string, unknown>[] = await tx.select().from(table).where(where).for("update");
    if (!beforeRows.length) return [];
    const ids = beforeRows.map((r) => r.id as string);
    const afterRows: Record<string, unknown>[] = await tx.update(table).set(set).where(and(where, inArray(table.id, ids))).returning();
    const was = new Map(beforeRows.map((r) => [r.id as string, r]));
    const out: Tracked<E>[] = [];
    const versions: ReturnType<typeof versionRow>[] = [];
    const ledger: LedgerInput[] = [];
    for (const after of afterRows) {
      const before = was.get(after.id as string);
      if (!before) continue;
      const changes = trackedChanges(entity, before, after);
      out.push({ before, after, changes } as unknown as Tracked<E>);
      if (!changes.length) continue;
      versions.push(versionRow(entity, after, changes, meta));
      ledger.push(...ownershipEntries(entity, before, after, changes, meta));
    }
    for (let i = 0; i < versions.length; i += 1000) await tx.insert(schema.recordVersions).values(versions.slice(i, i + 1000));
    if (entity === "application") ledger.push(...(await handoverEntries(tx, out as unknown as { before: Record<string, unknown>; after: Record<string, unknown> }[], meta)));
    if (ledger.length) await appendLedger(tx, ledger);
    return out;
  });
}

/** A student or an enquiry put on the ledger as it is created. */
export async function ledgerCreated(w: Writer, entity: "student" | "enquiry", rows: readonly { id: string; orgId: string; assignedToId: string | null }[], by: string | null, detail?: string | null) {
  await appendLedger(
    w,
    rows.map((r) => ({ kind: "CREATED" as const, entity, entityId: r.id, orgId: r.orgId, ownerId: r.assignedToId, detail: detail ?? null, actorId: by })),
  );
}

// ---------- Reading ----------

export type VersionRow = {
  id: string;
  n: number;
  entity: HistoryEntity;
  entityId: string;
  changes: FieldChange[];
  action: string;
  createdAt: Date;
  byId: string | null;
  by: string | null;
};

/** Every version of one record, oldest first, numbered from 1. */
export async function versionsOf(entity: HistoryEntity, entityId: string): Promise<VersionRow[]> {
  const v = schema.recordVersions;
  const rows = await db
    .select({ id: v.id, entity: v.entity, entityId: v.entityId, changes: v.changes, action: v.action, createdAt: v.createdAt, byId: v.changedById, by: schema.users.name })
    .from(v)
    .leftJoin(schema.users, eq(v.changedById, schema.users.id))
    .where(and(eq(v.entity, entity), eq(v.entityId, entityId)))
    .orderBy(asc(v.createdAt), asc(v.id));
  return rows.map((r, i) => ({ ...r, n: i + 1 }));
}

/** Names for every id the given changes hold, read in one query per kind that has any. */
export async function nameBook(items: readonly { entity: HistoryEntity; changes: readonly FieldChange[] }[]): Promise<NameBook> {
  const want = {
    user: new Set<string>(),
    org: new Set<string>(),
    status: new Set<string>(),
    route: new Set<string>(),
    team: new Set<string>(),
    lostReason: new Set<string>(),
    enquiry: new Set<string>(),
  };
  for (const it of items) {
    const ids = idsToName(it.entity, it.changes);
    for (const k of Object.keys(want) as (keyof typeof want)[]) for (const id of ids[k]) want[k].add(id);
  }
  const book: NameBook = new Map();
  const list = (s: Set<string>) => [...s].slice(0, 5000);
  const [u, o, s, r, t, lr, en] = await Promise.all([
    want.user.size ? db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, list(want.user))) : [],
    want.org.size ? db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(inArray(schema.organizations.id, list(want.org))) : [],
    want.status.size ? db.select({ id: schema.statusDefinitions.id, name: schema.statusDefinitions.label }).from(schema.statusDefinitions).where(inArray(schema.statusDefinitions.id, list(want.status))) : [],
    want.route.size
      ? db
          .select({ id: schema.programRoutes.id, name: schema.vendors.name })
          .from(schema.programRoutes)
          .innerJoin(schema.vendors, eq(schema.programRoutes.vendorId, schema.vendors.id))
          .where(inArray(schema.programRoutes.id, list(want.route)))
      : [],
    want.team.size ? db.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams).where(inArray(schema.teams.id, list(want.team))) : [],
    want.lostReason.size
      ? db.select({ id: schema.lostReasons.id, name: schema.lostReasons.label }).from(schema.lostReasons).where(inArray(schema.lostReasons.id, list(want.lostReason)))
      : [],
    want.enquiry.size ? db.select({ id: schema.enquiries.id, name: schema.enquiries.name }).from(schema.enquiries).where(inArray(schema.enquiries.id, list(want.enquiry))) : [],
  ]);
  for (const row of [...u, ...o, ...s, ...r, ...t, ...lr, ...en]) book.set(row.id, row.name);
  return book;
}

// ---------- The feed ----------

/** What the feed needs to know about the person reading it. */
export type FeedViewer = {
  id: string;
  orgId: string;
  /** The head office: every record. */
  headOffice: boolean;
  /** Sees every student of their organisation (a branch head), not only their own. */
  seesBranch: boolean;
  /** The students this person may open, as studentWhere gives it (undefined for every student). */
  studentScope: SQL | undefined;
  /** Reads every staff account (the people who run accounts). */
  seesPeople: boolean;
  /** Reads the staff accounts of their own branch (the branch head, who runs its team). */
  seesBranchPeople: boolean;
};

/**
 * Which history rows this person may read. Never a row about a record they
 * could not open: a student or an application by the student scope, an
 * enquiry by its branch (and, for a counsellor, only their own), a staff
 * account by who runs accounts.
 */
export function feedScope(viewer: FeedViewer): SQL {
  const v = schema.recordVersions;
  const st = schema.students;
  const en = schema.enquiries;
  const us = schema.users;
  const studentRows = and(
    inArray(v.entity, ["student", "application"]),
    exists(
      db
        .select({ one: sql`1` })
        .from(st)
        .where(and(eq(st.id, v.studentId), viewer.studentScope)),
    ),
  );
  const enquiryRows = viewer.headOffice
    ? and(eq(v.entity, "enquiry"), exists(db.select({ one: sql`1` }).from(en).where(eq(en.id, v.entityId))))
    : and(
        eq(v.entity, "enquiry"),
        exists(
          db
            .select({ one: sql`1` })
            .from(en)
            .where(and(eq(en.id, v.entityId), eq(en.orgId, viewer.orgId), viewer.seesBranch ? undefined : or(eq(en.assignedToId, viewer.id), eq(en.createdById, viewer.id)))),
        ),
      );
  const userRows = viewer.seesPeople
    ? eq(v.entity, "user")
    : viewer.seesBranchPeople && !viewer.headOffice
      ? and(eq(v.entity, "user"), exists(db.select({ one: sql`1` }).from(us).where(and(eq(us.id, v.entityId), eq(us.orgId, viewer.orgId)))))
      : and(eq(v.entity, "user"), eq(v.entityId, viewer.id));
  return or(studentRows, enquiryRows, userRows)!;
}

export function feedWhere(viewer: FeedViewer, f: HistoryFilters): SQL {
  const v = schema.recordVersions;
  const { start, end } = dayRange(f.from, f.to);
  return and(
    feedScope(viewer),
    f.entity ? eq(v.entity, f.entity as HistoryEntity) : undefined,
    f.by ? (f.by === "system" ? sql`${v.changedById} is null` : eq(v.changedById, f.by)) : undefined,
    f.org ? eq(v.orgId, f.org) : undefined,
    start ? gte(v.createdAt, start) : undefined,
    end ? lt(v.createdAt, end) : undefined,
  )!;
}

export type FeedRow = {
  id: string;
  entity: HistoryEntity;
  entityId: string;
  studentId: string | null;
  orgId: string | null;
  changes: FieldChange[];
  action: string;
  createdAt: Date;
  byId: string | null;
  by: string | null;
  org: string | null;
};

/** A page of the feed, newest first. */
export async function feedPage(where: SQL, limit: number, offset: number): Promise<FeedRow[]> {
  const v = schema.recordVersions;
  return db
    .select({
      id: v.id,
      entity: v.entity,
      entityId: v.entityId,
      studentId: v.studentId,
      orgId: v.orgId,
      changes: v.changes,
      action: v.action,
      createdAt: v.createdAt,
      byId: v.changedById,
      by: schema.users.name,
      org: schema.organizations.name,
    })
    .from(v)
    .leftJoin(schema.users, eq(v.changedById, schema.users.id))
    .leftJoin(schema.organizations, eq(v.orgId, schema.organizations.id))
    .where(where)
    .orderBy(desc(v.createdAt), desc(v.id))
    .limit(limit)
    .offset(offset);
}

/** What each row is about, in words: a student's name, an enquiry's name, an application's number, a person's name. */
export async function recordTitles(rows: readonly { entity: HistoryEntity; entityId: string }[]): Promise<Map<string, { title: string; href: string | null }>> {
  const by = (e: HistoryEntity) => [...new Set(rows.filter((r) => r.entity === e).map((r) => r.entityId))];
  const [st, en, ap, us] = await Promise.all([
    by("student").length
      ? db.select({ id: schema.students.id, f: schema.students.firstName, l: schema.students.lastName }).from(schema.students).where(inArray(schema.students.id, by("student")))
      : [],
    by("enquiry").length ? db.select({ id: schema.enquiries.id, name: schema.enquiries.name }).from(schema.enquiries).where(inArray(schema.enquiries.id, by("enquiry"))) : [],
    by("application").length
      ? db.select({ id: schema.applications.id, ack: schema.applications.ackNo, studentId: schema.applications.studentId }).from(schema.applications).where(inArray(schema.applications.id, by("application")))
      : [],
    by("user").length ? db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, by("user"))) : [],
  ]);
  const out = new Map<string, { title: string; href: string | null }>();
  for (const s of st) out.set(s.id, { title: `${s.f} ${s.l}`, href: `/students/${s.id}/history` });
  for (const e of en) out.set(e.id, { title: e.name, href: `/enquiries/${e.id}/history` });
  for (const a of ap) out.set(a.id, { title: a.ack, href: `/students/${a.studentId}/applications/${a.id}/history` });
  for (const u of us) out.set(u.id, { title: u.name, href: null });
  return out;
}

/** The people who have made changes the viewer may read, for the "who" filter. */
export async function feedPeople(viewer: FeedViewer) {
  const v = schema.recordVersions;
  return db
    .selectDistinct({ id: schema.users.id, name: schema.users.name })
    .from(v)
    .innerJoin(schema.users, eq(v.changedById, schema.users.id))
    .where(feedScope(viewer))
    .orderBy(asc(schema.users.name))
    .limit(300);
}
