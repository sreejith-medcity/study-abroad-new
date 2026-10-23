import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { createId } from "@/lib/id";
import { bestRankSort } from "@/lib/rankings";
import { diffFields, programRestoreProblem, restorable, type CatalogueEntity, type ChangeSource, type FieldChange } from "@/lib/catalogue-history";

export { diffFields };

/**
 * The catalogue's change history: what each program and university field said
 * before somebody, or a sync, changed it, and putting it back.
 *
 * No "server-only" import, because the CRICOS sync that records here is also
 * run from a plain script.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Writer = typeof db | Tx;

export type ChangeInput = FieldChange & { entity: CatalogueEntity; entityId: string };

/** A fresh id for one save, one bulk action or one sync run. */
export const newBatchId = () => createId();

/** The changes between a row as it was and the values about to be written to it. */
export function changesOf(entity: CatalogueEntity, entityId: string, current: Record<string, unknown>, next: Record<string, unknown>, ignore: readonly string[] = []): ChangeInput[] {
  return diffFields(current, next, ignore).map((c) => ({ ...c, entity, entityId }));
}

/**
 * Writes the changes, a thousand rows to a statement. A bulk publish over the
 * whole CRICOS register changes about 27,000 statuses, and one insert per row
 * would take longer than the update itself.
 */
export async function recordChanges(w: Writer, changes: ChangeInput[], meta: { by: string | null; source: ChangeSource; batchId?: string }): Promise<string> {
  const batchId = meta.batchId ?? newBatchId();
  for (let i = 0; i < changes.length; i += 1000) {
    await w.insert(schema.catalogueChanges).values(
      changes.slice(i, i + 1000).map((c) => ({
        entity: c.entity,
        entityId: c.entityId,
        field: c.field,
        before: c.before ?? null,
        after: c.after ?? null,
        changedById: meta.by,
        source: meta.source,
        batchId,
      })),
    );
  }
  return batchId;
}

export type HistoryRow = {
  id: string;
  field: string;
  before: unknown;
  after: unknown;
  source: string;
  batchId: string;
  createdAt: Date;
  by: string | null;
};

/** The latest changes to one program or university, newest first. */
export async function changeHistory(entity: CatalogueEntity, entityId: string, limit = 50): Promise<{ rows: HistoryRow[]; more: boolean }> {
  const c = schema.catalogueChanges;
  const rows = await db
    .select({ id: c.id, field: c.field, before: c.before, after: c.after, source: c.source, batchId: c.batchId, createdAt: c.createdAt, by: schema.users.name })
    .from(c)
    .leftJoin(schema.users, eq(c.changedById, schema.users.id))
    .where(and(eq(c.entity, entity), eq(c.entityId, entityId)))
    .orderBy(desc(c.createdAt), asc(c.batchId), asc(c.id))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

/** The batch id of the latest restore of one program or university, or null when there has been none. */
export async function latestRestore(entity: CatalogueEntity, entityId: string): Promise<string | null> {
  const c = schema.catalogueChanges;
  const [row] = await db
    .select({ batchId: c.batchId })
    .from(c)
    .where(and(eq(c.entity, entity), eq(c.entityId, entityId), eq(c.source, "restore")))
    .orderBy(desc(c.createdAt))
    .limit(1);
  return row?.batchId ?? null;
}

export type RestoreTarget = { changeId: string } | { batchId: string; entity: CatalogueEntity; entityId: string };
export type RestoreResult = { ok?: string; error?: string; entity?: CatalogueEntity; entityId?: string };

/**
 * Puts back what one change, or one whole save, replaced.
 *
 * The values go back through the rules the edit screen applies to the same
 * fields, so a restore cannot leave a program live with no intake or a work
 * rights verdict with no evidence, and the restore is itself recorded, so it
 * can be undone the same way.
 */
export async function restoreChanges(target: RestoreTarget, userId: string): Promise<RestoreResult> {
  const c = schema.catalogueChanges;
  const rows =
    "changeId" in target
      ? await db.select().from(c).where(eq(c.id, target.changeId))
      : await db
          .select()
          .from(c)
          .where(and(eq(c.batchId, target.batchId), eq(c.entity, target.entity), eq(c.entityId, target.entityId)))
          .orderBy(asc(c.id));
  if (!rows.length) return { error: "That change is no longer on record." };
  const { entity, entityId } = rows[0];

  // One value per field. A save records each field once, so this only
  // matters if a batch ever holds the same field twice; the first one wins.
  const values: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.entity !== entity || r.entityId !== entityId || !restorable(entity, r.field) || r.field in values) continue;
    values[r.field] = r.before;
  }
  if (!Object.keys(values).length) return { error: "That change cannot be restored from here.", entity, entityId };

  if (entity === "program") {
    const current = await db.query.programs.findFirst({ where: eq(schema.programs.id, entityId) });
    if (!current) return { error: "That program no longer exists.", entity, entityId };
    const changes = changesOf("program", entityId, current, values);
    if (!changes.length) return { ok: "Already at those values.", entity, entityId };
    const merged = { ...current, ...values } as typeof current;
    const problem = programRestoreProblem(merged, changes.map((x) => x.field));
    if (problem) return { error: problem, entity, entityId };
    // The same identity rule the edit screen applies, for the same reason: the
    // next import would merge two rows with one name, university and level.
    if ("name" in values || "level" in values) {
      const clash = await db.query.programs.findFirst({
        where: and(eq(schema.programs.name, merged.name), eq(schema.programs.universityId, merged.universityId), eq(schema.programs.level, merged.level)),
      });
      if (clash && clash.id !== current.id && !current.externalCode && !clash.externalCode) {
        return { error: "This university already has another program with that name at that level, so the old name cannot come back.", entity, entityId };
      }
    }
    const set = Object.fromEntries(changes.map((x) => [x.field, values[x.field]]));
    await db.transaction(async (tx) => {
      await tx.update(schema.programs).set({ ...set, updatedAt: new Date() }).where(eq(schema.programs.id, entityId));
      await recordChanges(tx, changes, { by: userId, source: "restore" });
    });
    await audit(userId, "program.restore", "program", entityId, { fields: changes.map((x) => x.field), from: "changeId" in target ? target.changeId : target.batchId });
    return { ok: `Restored ${changes.length} field${changes.length === 1 ? "" : "s"}.`, entity, entityId };
  }

  const current = await db.query.universities.findFirst({ where: eq(schema.universities.id, entityId) });
  if (!current) return { error: "That university no longer exists.", entity, entityId };
  const changes = changesOf("university", entityId, current, values);
  if (!changes.length) return { ok: "Already at those values.", entity, entityId };
  const set: Record<string, unknown> = Object.fromEntries(changes.map((x) => [x.field, values[x.field]]));
  // The sort position is worked out from the two rankings, never stored on its own.
  if ("qsRank" in set || "theRank" in set) {
    const merged = { ...current, ...set } as typeof current;
    set.rankSort = bestRankSort(merged.qsRank, merged.theRank);
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.universities).set(set).where(eq(schema.universities.id, entityId));
    await recordChanges(tx, changes, { by: userId, source: "restore" });
  });
  await audit(userId, "university.restore", "university", entityId, { fields: changes.map((x) => x.field), from: "changeId" in target ? target.changeId : target.batchId });
  return { ok: `Restored ${changes.length} field${changes.length === 1 ? "" : "s"}.`, entity, entityId };
}
