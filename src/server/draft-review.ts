import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { newBatchId, updateWithHistory } from "@/server/catalogue-history";
import type { ReviewFilters, ReviewOutcome, ReviewSource } from "@/lib/draft-review";

/**
 * The queries behind the draft review screens. Everything is counted in
 * Postgres: the catalogue holds over a hundred thousand drafts, and sending
 * them to the app to be counted would take longer than the desk would wait.
 */

const { programs: p, universities: u, countries: c } = schema;

export const LIST_PAGE = 50;
export const DRAFTS_PAGE = 100;

/** A draft, from one source when the desk has narrowed to one. */
const draftWhere = (source?: ReviewSource): SQL => (source ? sql`(${p.status} = 'DRAFT' and ${p.source} = ${source})` : sql`(${p.status} = 'DRAFT')`);

/**
 * The publish rules from publishProblems in src/lib/draft-review.ts, written
 * against the row being updated (`programs` in the update below), so a course
 * somebody changed while the press was on its way is judged as it is now.
 * Keep the two in step.
 */
const READY_TARGET = sql.raw(`cardinality(programs.intake_months) > 0 and (programs.work_rights = 'UNKNOWN' or coalesce(programs.work_rights_note, '') ~ '[^[:space:]]')`);
const HAS_INTAKES = sql`cardinality(${p.intakeMonths}) > 0`;
const HAS_EVIDENCE = sql`(${p.workRights} = 'UNKNOWN' or coalesce(${p.workRightsNote}, '') ~ '[^[:space:]]')`;

/** Every draft in the catalogue, for the link from the Programs screen. */
export async function draftTotal(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(p).where(eq(p.status, "DRAFT"));
  return row?.n ?? 0;
}

export type ReviewListRow = {
  id: string;
  name: string;
  country: string;
  drafts: number;
  withFee: number;
  withIelts: number;
  withIntakes: number;
  live: number;
};

/**
 * Universities with drafts, one row each, with how much of what a counsellor
 * needs the drafts already carry. One grouped query; the window functions
 * give the number of universities and of drafts across every page with it.
 */
export async function reviewList(f: ReviewFilters): Promise<{ rows: ReviewListRow[]; universities: number; drafts: number }> {
  const draft = draftWhere(f.source);
  const drafts = sql<number>`count(*) filter (where ${draft})`;
  const rows = await db
    .select({
      id: u.id,
      name: u.name,
      country: c.name,
      drafts: drafts.mapWith(Number),
      withFee: sql<number>`count(*) filter (where ${draft} and ${p.tuitionPerYear} is not null)`.mapWith(Number),
      withIelts: sql<number>`count(*) filter (where ${draft} and ${p.minIelts} is not null)`.mapWith(Number),
      withIntakes: sql<number>`count(*) filter (where ${draft} and ${HAS_INTAKES})`.mapWith(Number),
      live: sql<number>`count(*) filter (where ${p.status} = 'LIVE')`.mapWith(Number),
      universities: sql<number>`count(*) over ()`.mapWith(Number),
      allDrafts: sql<number>`sum(count(*) filter (where ${draft})) over ()`.mapWith(Number),
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    // Archived courses count for nothing on this screen, so they are not read.
    .where(and(inArray(p.status, ["DRAFT", "LIVE"]), f.country ? eq(c.code, f.country) : undefined, f.q ? ilike(u.name, `%${f.q}%`) : undefined))
    .groupBy(u.id, u.name, c.name)
    .having(sql`${drafts} > 0`)
    .orderBy(...(f.sort === "name" ? [asc(u.name), asc(c.name)] : [desc(drafts), asc(u.name)]), asc(u.id))
    .limit(LIST_PAGE)
    .offset((f.page - 1) * LIST_PAGE);
  // A page past the end has no rows to carry the totals, so they are asked for on their own.
  if (!rows.length && f.page > 1) return reviewList({ ...f, page: 1 }).then((r) => ({ ...r, rows: [] }));
  return {
    rows: rows.map((r) => ({ id: r.id, name: r.name, country: r.country, drafts: r.drafts, withFee: r.withFee, withIelts: r.withIelts, withIntakes: r.withIntakes, live: r.live })),
    universities: rows[0]?.universities ?? 0,
    drafts: rows[0]?.allDrafts ?? 0,
  };
}

export type ReviewUniversity = { id: string; name: string; country: string; currency: string; drafts: number; live: number };

/** One university's name and counts, for the head of its review screen. */
export async function reviewUniversity(id: string, source?: ReviewSource): Promise<ReviewUniversity | null> {
  const [uni] = await db
    .select({ id: u.id, name: u.name, country: c.name, currency: c.currency })
    .from(u)
    .innerJoin(c, eq(u.countryId, c.id))
    .where(eq(u.id, id));
  if (!uni) return null;
  const [counts] = await db
    .select({
      drafts: sql<number>`count(*) filter (where ${draftWhere(source)})`.mapWith(Number),
      live: sql<number>`count(*) filter (where ${p.status} = 'LIVE')`.mapWith(Number),
    })
    .from(p)
    .where(eq(p.universityId, id));
  return { ...uni, drafts: counts?.drafts ?? 0, live: counts?.live ?? 0 };
}

/** One page of a university's drafts, with the fields a checker reads. */
export async function universityDrafts(id: string, source: ReviewSource | undefined, page: number) {
  return db
    .select({
      id: p.id,
      name: p.name,
      level: p.level,
      source: p.source,
      durationMonths: p.durationMonths,
      tuitionPerYear: p.tuitionPerYear,
      tuitionTotal: p.tuitionTotal,
      applicationFee: p.applicationFee,
      intakeMonths: p.intakeMonths,
      minIelts: p.minIelts,
      minPte: p.minPte,
      minToefl: p.minToefl,
      entryRequirements: p.entryRequirements,
      workRights: p.workRights,
      workRightsNote: p.workRightsNote,
    })
    .from(p)
    .where(and(eq(p.universityId, id), draftWhere(source)))
    .orderBy(asc(p.name), asc(p.level), asc(p.id))
    .limit(DRAFTS_PAGE)
    .offset((Math.max(1, page) - 1) * DRAFTS_PAGE);
}

/**
 * The university to go to once this one is done: the next one on the list
 * the desk came from, with the same filters. In name order that is the next
 * name along, coming round to the start after the last.
 */
export async function nextUniversity(current: { id: string; name: string }, f: ReviewFilters): Promise<{ id: string; name: string; drafts: number } | null> {
  const drafts = sql<number>`count(*)`;
  const [row] = await db
    .select({ id: u.id, name: u.name, drafts: drafts.mapWith(Number) })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(and(draftWhere(f.source), ne(u.id, current.id), f.country ? eq(c.code, f.country) : undefined, f.q ? ilike(u.name, `%${f.q}%`) : undefined))
    .groupBy(u.id, u.name)
    .orderBy(...(f.sort === "name" ? [sql`${u.name} > ${current.name} desc`, asc(u.name)] : [desc(drafts), asc(u.name)]), asc(u.id))
    .limit(1);
  return row ?? null;
}

type Scope = { universityId: string; source?: ReviewSource; ids?: string[] };

/** The drafts a press is about: the ticked ones, or every draft at the university. */
const scopeWhere = (s: Scope) => and(eq(p.universityId, s.universityId), draftWhere(s.source), s.ids ? inArray(p.id, s.ids) : undefined);

const BATCH = 2000;

/**
 * Sets drafts to one status in batches, each batch writing its history in the
 * same statement (see updateWithHistory), all under one batch id so the
 * course histories show one press as one change. The second copy of the table
 * (o) holds each row as it was before the update, which is where the old
 * status comes from. Only rows still drafts when the update reaches them are
 * changed, so a course somebody published a moment earlier is not recorded
 * as changed again.
 */
async function moveDrafts(s: Scope, to: "LIVE" | "ARCHIVED", by: string): Promise<number> {
  const batchId = newBatchId();
  const started = Date.now();
  let total = 0;
  for (let i = 0; i < 100 && Date.now() - started < 200_000; i++) {
    const scope = db.select({ id: p.id }).from(p).where(and(scopeWhere(s), to === "LIVE" ? and(HAS_INTAKES, HAS_EVIDENCE) : undefined)).limit(BATCH);
    const changed = await updateWithHistory(
      db,
      "program",
      sql`
        update programs set status = ${to}::program_status, updated_at = now()
        from programs o
        where o.id = programs.id and ${inArray(p.id, scope)} and programs.status = 'DRAFT'${to === "LIVE" ? sql` and ${READY_TARGET}` : sql``}
        returning programs.id as entity_id, 'status'::text as field, to_jsonb(o.status) as before, to_jsonb(programs.status) as after`,
      { by, source: "review", batchId },
    );
    total += changed;
    if (changed < BATCH) break;
  }
  return total;
}

/** Drafts in the scope that are still drafts, and why each cannot go live. */
async function stillDrafts(s: Scope) {
  const [row] = await db
    .select({
      left: sql<number>`count(*) filter (where not (${HAS_INTAKES} and ${HAS_EVIDENCE}))`.mapWith(Number),
      noIntakes: sql<number>`count(*) filter (where not ${HAS_INTAKES})`.mapWith(Number),
      noEvidence: sql<number>`count(*) filter (where not ${HAS_EVIDENCE})`.mapWith(Number),
      drafts: count(),
    })
    .from(p)
    .where(scopeWhere(s));
  return { left: row?.left ?? 0, noIntakes: row?.noIntakes ?? 0, noEvidence: row?.noEvidence ?? 0, drafts: row?.drafts ?? 0 };
}

/**
 * Publishes the drafts in the scope that meet the publish rules and leaves
 * the rest as drafts, counting why. With ticked courses, any that were no
 * longer drafts when the press arrived are counted too, so the numbers in
 * the answer add up to what was ticked.
 */
export async function publishDrafts(s: Scope, by: string): Promise<ReviewOutcome> {
  const done = await moveDrafts(s, "LIVE", by);
  const after = await stillDrafts(s);
  const gone = s.ids ? Math.max(0, s.ids.length - done - after.drafts) : 0;
  return { op: "publish", done, left: after.left, noIntakes: after.noIntakes, noEvidence: after.noEvidence, gone };
}

/** Archives the ticked drafts. Archiving has no rules: it takes a course out of sight. */
export async function archiveDrafts(s: Scope & { ids: string[] }, by: string): Promise<ReviewOutcome> {
  const done = await moveDrafts(s, "ARCHIVED", by);
  const after = await stillDrafts(s);
  return { op: "archive", done, left: 0, noIntakes: 0, noEvidence: 0, gone: Math.max(0, s.ids.length - done - after.drafts) };
}
