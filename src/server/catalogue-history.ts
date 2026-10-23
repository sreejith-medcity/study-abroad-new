import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { createId } from "@/lib/id";
import { bestRankSort } from "@/lib/rankings";
import { diffFields, mergeRepeats, planRestore, programRestoreProblem, restorable, skippedText, type CatalogueEntity, type ChangeSource, type FieldChange } from "@/lib/catalogue-history";

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
 * would take longer than the update itself. Repeats of one field on one row
 * are merged first (see mergeRepeats), so a batch holds each field once.
 *
 * Pass the transaction that made the changes, so the change and its history
 * are kept or lost together.
 */
export async function recordChanges(w: Writer, changes: ChangeInput[], meta: { by: string | null; source: ChangeSource; batchId?: string }): Promise<string> {
  const batchId = meta.batchId ?? newBatchId();
  const merged = mergeRepeats(changes);
  for (let i = 0; i < merged.length; i += 1000) {
    await w.insert(schema.catalogueChanges).values(
      merged.slice(i, i + 1000).map((c) => ({
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

/**
 * Runs one update and writes its history in the same statement, and says how
 * many rows it changed. One statement is all or nothing on its own, so the
 * history can never miss a change or record one that did not happen, and a
 * bulk change over a hundred thousand courses never sends its rows to the app
 * and back.
 *
 * `update` must return, for each field it changed on each row, entity_id,
 * field, before and after, the last two as jsonb. Each row it returns is one
 * history entry, so an update that changes one field returns one row per
 * program, and the count is the number of programs.
 */
export async function updateWithHistory(w: Writer, entity: CatalogueEntity, update: SQL, meta: { by: string | null; source: ChangeSource; batchId?: string }): Promise<number> {
  const batchId = meta.batchId ?? newBatchId();
  const [row] = await w.execute<{ n: number }>(sql`
    with changed as (${update}),
    logged as (
      insert into catalogue_changes (id, entity, entity_id, field, before, after, changed_by_id, source, batch_id)
      select replace(gen_random_uuid()::text, '-', ''), ${entity}::text, entity_id, field, before, after, ${meta.by}::text, ${meta.source}::text, ${batchId}::text
      from changed
    )
    select count(*)::int as n from changed`);
  return Number(row?.n ?? 0);
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
export type RestoreResult = { ok?: string; error?: string; keep?: boolean; entity?: CatalogueEntity; entityId?: string };

type Outcome = { ok?: string; error?: string; keep?: boolean; fields?: string[] };

const restoredText = (n: number) => `Restored ${n} field${n === 1 ? "" : "s"}.`;

/**
 * The answer once the fields that can go back have been worked out: an error
 * when everything was left because it has changed since, and the reasons
 * beside the count when only some were.
 */
function outcome(applied: string[], note: string): Outcome {
  if (!applied.length) return note ? { error: note } : { ok: "Already at those values." };
  return note ? { ok: `${restoredText(applied.length)} ${note}`, keep: true, fields: applied } : { ok: restoredText(applied.length), fields: applied };
}

/** A unique index refusing the write, as postgres-js reports it directly or under drizzle's wrapper. */
const uniqueViolation = (e: unknown) => (e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505";

/**
 * Puts back what one change, or one whole save, replaced.
 *
 * Only fields that still hold the value the change gave them go back; one
 * changed again since keeps its newer value and the answer says so. The
 * values go back through the rules the edit screen applies to the same
 * fields, so a restore cannot leave a program live with no intake or a work
 * rights verdict with no evidence, and the restore is itself recorded, so it
 * can be undone the same way. The row is read locked, in the transaction
 * that writes it, so a save landing at the same moment cannot slip between
 * the check and the write.
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
          .orderBy(asc(c.createdAt), asc(c.id));
  if (!rows.length) return { error: "That change is no longer on record." };
  const { entity, entityId } = rows[0];
  const picked = rows.filter((r) => r.entity === entity && r.entityId === entityId && restorable(entity, r.field));
  if (!picked.length) return { error: "That change cannot be restored from here.", entity, entityId };

  let result: Outcome;
  try {
    result = await db.transaction((tx) => (entity === "program" ? restoreProgram(tx, entityId, picked, userId) : restoreUniversity(tx, entityId, picked, userId)));
  } catch (e) {
    // The name check inside the transaction cannot see a rename another
    // admin has not committed yet; the unique index then refuses this one,
    // and it gets the same answer as the check would have given.
    if (entity === "university" && uniqueViolation(e)) return { error: "Another university in this country now has that name, so the old name cannot come back.", entity, entityId };
    throw e;
  }
  if (result.fields) {
    await audit(userId, `${entity}.restore`, entity, entityId, { fields: result.fields, from: "changeId" in target ? target.changeId : target.batchId });
  }
  return { ok: result.ok, error: result.error, keep: result.keep, entity, entityId };
}

async function restoreProgram(tx: Tx, entityId: string, picked: FieldChange[], userId: string): Promise<Outcome> {
  const [current] = await tx.select().from(schema.programs).where(eq(schema.programs.id, entityId)).for("update");
  if (!current) return { error: "That program no longer exists." };
  const plan = planRestore(current, picked);
  const changes = changesOf("program", entityId, current, plan.values);
  let note = "";
  if (plan.skipped.length) {
    const [where] = await tx
      .select({ currency: schema.countries.currency })
      .from(schema.universities)
      .innerJoin(schema.countries, eq(schema.universities.countryId, schema.countries.id))
      .where(eq(schema.universities.id, current.universityId));
    const docLabels = plan.skipped.some((x) => x.field === "requiredDocs")
      ? Object.fromEntries((await tx.select({ code: schema.documentTypes.code, label: schema.documentTypes.label }).from(schema.documentTypes)).map((d) => [d.code, d.label]))
      : undefined;
    note = skippedText("program", plan.skipped, { currency: where?.currency ?? "", docLabels });
  }
  if (!changes.length) return outcome([], note);

  const values = Object.fromEntries(changes.map((x) => [x.field, plan.values[x.field]]));
  const merged = { ...current, ...values } as typeof current;
  const problem = programRestoreProblem(merged, changes.map((x) => x.field));
  if (problem) return { error: problem };
  // The same identity rule the edit screen applies, for the same reason: the
  // next import would merge two rows with one name, university and level.
  if ("name" in values || "level" in values) {
    const clash = await tx.query.programs.findFirst({
      where: and(eq(schema.programs.name, merged.name), eq(schema.programs.universityId, merged.universityId), eq(schema.programs.level, merged.level)),
    });
    if (clash && clash.id !== current.id && !current.externalCode && !clash.externalCode) {
      return { error: "This university already has another program with that name at that level, so the old name cannot come back." };
    }
  }
  await tx.update(schema.programs).set({ ...values, updatedAt: new Date() }).where(eq(schema.programs.id, entityId));
  await recordChanges(tx, changes, { by: userId, source: "restore" });
  return outcome(changes.map((x) => x.field), note);
}

async function restoreUniversity(tx: Tx, entityId: string, picked: FieldChange[], userId: string): Promise<Outcome> {
  const [current] = await tx.select().from(schema.universities).where(eq(schema.universities.id, entityId)).for("update");
  if (!current) return { error: "That university no longer exists." };
  const plan = planRestore(current, picked);
  const changes = changesOf("university", entityId, current, plan.values);
  // A university's fields read the same in any currency.
  const note = plan.skipped.length ? skippedText("university", plan.skipped, { currency: "" }) : "";
  if (!changes.length) return outcome([], note);

  const set: Record<string, unknown> = Object.fromEntries(changes.map((x) => [x.field, plan.values[x.field]]));
  // The edit screen's name rules, for the same reasons: a university needs a
  // name, and two in one country under one name would trip the unique index
  // or leave the rankings import unable to tell them apart.
  if ("name" in set) {
    const name = typeof set.name === "string" ? set.name.trim() : "";
    if (!name) return { error: "A university needs a name, so a blank one cannot come back." };
    const clash = await tx.query.universities.findFirst({
      where: and(eq(schema.universities.countryId, current.countryId), ne(schema.universities.id, entityId), sql`lower(${schema.universities.name}) = lower(${name})`),
      columns: { id: true },
    });
    if (clash) return { error: "Another university in this country now has that name, so the old name cannot come back." };
  }
  // The sort position is worked out from the two rankings, never stored on its own.
  if ("qsRank" in set || "theRank" in set) {
    const merged = { ...current, ...set } as typeof current;
    set.rankSort = bestRankSort(merged.qsRank, merged.theRank);
  }
  await tx.update(schema.universities).set(set).where(eq(schema.universities.id, entityId));
  await recordChanges(tx, changes, { by: userId, source: "restore" });
  return outcome(changes.map((x) => x.field), note);
}
