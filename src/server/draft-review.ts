import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db, schema } from "@/db";
import { newBatchId, updateWithHistory } from "@/server/catalogue-history";
import type { ReviewFilters, ReviewOutcome, ReviewSource } from "@/lib/draft-review";
import {
  DURATION_NOTE,
  FEE_IN_WORDS_NOTE,
  FEE_MEDIAN_MIN_COURSES,
  FEE_OUTLIER_HIGH,
  FEE_OUTLIER_LOW,
  MAX_DURATION_MONTHS,
  MAX_IELTS,
  MAX_PG_MONTHS,
  MIN_IELTS,
  MIN_PTE,
  MIN_TOEFL,
  MIN_UG_MONTHS,
  REVIEW_FLAGS,
  SHORT_UG_COUNTRIES,
  type DuplicateOf,
  type ReviewFlag,
  type ShowFilter,
} from "@/lib/review-flags";
import { HAS_EVIDENCE, HAS_INTAKES, READY, READY_TARGET } from "@/server/publish-rules";

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

/* ---------------- Worth a look flags ---------------- */

/** A number the rules file fixed, written into the SQL as it is rather than sent as a parameter of unknown type. */
const fixed = (n: number) => sql.raw(String(n));

/** nameKey from src/lib/mioc.ts as SQL: lower case, "&" read as "and", then only letters and digits. */
const nameKeySql = (col: SQLWrapper) => sql`regexp_replace(replace(lower(${col}), '&', ' and '), '[^a-z0-9]+', '', 'g')`;

/**
 * The flag rules from src/lib/review-flags.ts as SQL. Each reads the same
 * constants as the row-at-a-time rule there; a row reviewFlags flags must be
 * one these conditions take, and the unit tests pin the rules down. Each is
 * wrapped in coalesce because a comparison with a missing figure is null in
 * SQL, and a null flag would read as neither set nor clear.
 */
const FEE_OUTLIER = sql`coalesce(${p.tuitionPerYear} is not null and medians.courses >= ${fixed(FEE_MEDIAN_MIN_COURSES)}
  and (${p.tuitionPerYear} < medians.median * ${fixed(FEE_OUTLIER_LOW)} or ${p.tuitionPerYear} > medians.median * ${fixed(FEE_OUTLIER_HIGH)}), false)`;
const FEE_IN_WORDS = sql`coalesce(${p.tuitionPerYear} is null and strpos(coalesce(${p.entryRequirements}, ''), ${FEE_IN_WORDS_NOTE}) > 0, false)`;
const NO_INTAKES = sql`(not ${HAS_INTAKES})`;
const SHORT_UG = SHORT_UG_COUNTRIES.length
  ? sql` and home.country_code not in (${sql.join(
      SHORT_UG_COUNTRIES.map((code) => sql`${code}`),
      sql`, `,
    )})`
  : sql``;
const ODD_DURATION = sql`coalesce(
  (${p.durationMonths} is null and strpos(coalesce(${p.entryRequirements}, ''), ${DURATION_NOTE}) > 0)
  or ${p.durationMonths} > ${fixed(MAX_DURATION_MONTHS)}
  or (${p.level} = 'PG' and ${p.durationMonths} > ${fixed(MAX_PG_MONTHS)})
  or (${p.level} = 'UG' and ${p.durationMonths} < ${fixed(MIN_UG_MONTHS)}${SHORT_UG}), false)`;
const SCORE_ODD = sql`coalesce(${p.minIelts} < ${fixed(MIN_IELTS)} or ${p.minIelts} > ${fixed(MAX_IELTS)} or ${p.minPte} < ${fixed(MIN_PTE)} or ${p.minToefl} < ${fixed(MIN_TOEFL)}, false)`;

/**
 * Every draft at the chosen universities with its flags, as one subquery with
 * these columns: id, university_id, the duplicate's other_id, other_name,
 * other_level, other_duration and other_status (null when there is none),
 * fee_median and fee_courses behind the fee test, one boolean per flag, and
 * flagged, true when any is set.
 *
 * The work is bounded by what is chosen, never by the catalogue: the fee
 * medians are taken once per level over the courses of the chosen
 * universities' countries (percentile_cont, one pass), and duplicates are
 * found by joining each university's courses to themselves on the name key,
 * computed once per course. A page of fifty universities or one university's
 * thousands of drafts both finish in well under a second over 104,000 rows.
 *
 * `unis` is a condition on the universities table that picks the universities.
 */
function flaggedDrafts(unis: SQL, source?: ReviewSource): SQL {
  return sql`(with
    home as (
      select ${u.id} as id, ${u.countryId} as country_id, ${c.code} as country_code
      from universities join countries on ${c.id} = ${u.countryId}
      where ${unis}
    ),
    medians as (
      select ${u.countryId} as country_id, ${p.level} as level,
        percentile_cont(0.5) within group (order by ${p.tuitionPerYear}) as median,
        count(*)::int as courses
      from programs join universities on ${u.id} = ${p.universityId}
      where ${u.countryId} in (select country_id from home)
        and ${p.status} in ('LIVE', 'DRAFT') and ${p.tuitionPerYear} is not null
      group by ${u.countryId}, ${p.level}
    ),
    here as (
      select ${p.id} as id, ${p.universityId} as university_id, ${p.name} as name, ${p.level} as level,
        ${p.durationMonths} as duration_months, ${p.status} as status, ${nameKeySql(p.name)} as key
      from programs where ${p.universityId} in (select id from home)
    ),
    twin as (
      select distinct on (a.id) a.id, b.id as other_id, b.name as other_name, b.level::text as other_level,
        b.duration_months as other_duration, b.status::text as other_status
      from here a
      join here b on b.university_id = a.university_id and b.key = a.key and b.id <> a.id
        and (b.level <> a.level or b.duration_months is distinct from a.duration_months)
      where a.status = 'DRAFT'
      order by a.id, (b.status = 'LIVE') desc, b.name, b.id
    )
  select ${p.id} as id, ${p.universityId} as university_id,
    twin.other_id, twin.other_name, twin.other_level, twin.other_duration, twin.other_status,
    medians.median as fee_median, coalesce(medians.courses, 0) as fee_courses,
    ${FEE_OUTLIER} as fee_outlier,
    ${FEE_IN_WORDS} as fee_in_words,
    ${NO_INTAKES} as no_intakes,
    ${ODD_DURATION} as odd_duration,
    ${SCORE_ODD} as score_odd,
    (twin.other_id is not null or ${FEE_OUTLIER} or ${FEE_IN_WORDS} or ${NO_INTAKES} or ${ODD_DURATION} or ${SCORE_ODD}) as flagged
  from programs
  join home on home.id = ${p.universityId}
  left join medians on medians.country_id = home.country_id and medians.level = ${p.level}
  left join twin on twin.id = ${p.id}
  where ${draftWhere(source)})`;
}

/** The flag columns as the subquery returns them. */
type FlagColumns = {
  other_id: string | null;
  other_name: string | null;
  other_level: string | null;
  other_duration: number | null;
  other_status: string | null;
  fee_median: number | null;
  fee_courses: number;
  fee_outlier: boolean;
  fee_in_words: boolean;
  no_intakes: boolean;
  odd_duration: boolean;
  score_odd: boolean;
};

const FLAG_COLUMN: Record<ReviewFlag, keyof FlagColumns> = {
  DUPLICATE: "other_id",
  FEE_OUTLIER: "fee_outlier",
  FEE_IN_WORDS: "fee_in_words",
  NO_INTAKES: "no_intakes",
  ODD_DURATION: "odd_duration",
  SCORE_ODD: "score_odd",
};

/** The flags one row trips, in chip order, and the course it duplicates. */
function readFlags(r: FlagColumns): { flags: ReviewFlag[]; duplicateOf: DuplicateOf | null } {
  const flags = REVIEW_FLAGS.filter((f) => !!r[FLAG_COLUMN[f]]);
  const duplicateOf =
    r.other_id && r.other_name && r.other_level && r.other_status
      ? { id: r.other_id, name: r.other_name, level: r.other_level, durationMonths: r.other_duration, status: r.other_status }
      : null;
  return { flags, duplicateOf };
}

/** Which of a university's drafts the desk asked to see. */
const showWhere = (show: ShowFilter): SQL => (show === "flagged" ? sql`flags.flagged` : show === "clean" ? sql`not flags.flagged` : sql`true`);

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
  /** Drafts with a worth-a-look flag, see src/lib/review-flags.ts. */
  flagged: number;
};

/** How many of each listed university's drafts carry a flag, counted once for the page. */
async function flaggedCounts(ids: string[], source?: ReviewSource): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db.execute<{ university_id: string; flagged: number }>(sql`
    select flags.university_id, (count(*) filter (where flags.flagged))::int as flagged
    from ${flaggedDrafts(inArray(u.id, ids), source)} flags
    group by flags.university_id`);
  return new Map(rows.map((r) => [r.university_id, Number(r.flagged)]));
}

/**
 * Universities with drafts, one row each, with how much of what a counsellor
 * needs the drafts already carry. One grouped query; the window functions
 * give the number of universities and of drafts across every page with it.
 * The flagged counts come from a second query over the page's universities
 * alone, since the flags need the medians and twins the first query has no
 * place for.
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
  const flagged = await flaggedCounts(
    rows.map((r) => r.id),
    f.source,
  );
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      drafts: r.drafts,
      withFee: r.withFee,
      withIelts: r.withIelts,
      withIntakes: r.withIntakes,
      live: r.live,
      flagged: flagged.get(r.id) ?? 0,
    })),
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

export type DraftRow = {
  id: string;
  name: string;
  level: string;
  source: string | null;
  durationMonths: number | null;
  tuitionPerYear: number | null;
  tuitionTotal: number | null;
  applicationFee: number | null;
  intakeMonths: number[];
  minIelts: number | null;
  minPte: number | null;
  minToefl: number | null;
  entryRequirements: string | null;
  workRights: string;
  workRightsNote: string | null;
  flags: ReviewFlag[];
  duplicateOf: DuplicateOf | null;
  /** The median yearly fee at this level in this country and how many courses it stands on, behind a fee flag. */
  feeMedian: number | null;
  feeCourses: number;
};

type DraftRaw = FlagColumns & {
  id: string;
  name: string;
  level: string;
  source: string | null;
  duration_months: number | null;
  tuition_per_year: number | null;
  tuition_total: number | null;
  application_fee: number | null;
  intake_months: number[] | null;
  min_ielts: number | null;
  min_pte: number | null;
  min_toefl: number | null;
  entry_requirements: string | null;
  work_rights: string;
  work_rights_note: string | null;
  shown: number;
  flagged_total: number;
};

export type DraftsPage = {
  rows: DraftRow[];
  /** Drafts the show filter lets through, across every page. */
  shown: number;
  /** Drafts with any flag, whatever the filter shows. */
  flagged: number;
};

/**
 * One page of a university's drafts, with the fields a checker reads and the
 * worth-a-look flags on each, narrowed to the flagged or the clean ones when
 * asked. One query: the flags subquery runs once over the university's
 * drafts, the page is cut from it, and the two totals are counted from the
 * same pass.
 */
export async function universityDrafts(id: string, source: ReviewSource | undefined, page: number, show: ShowFilter = "all"): Promise<DraftsPage> {
  const where = showWhere(show);
  const raw = await db.execute<DraftRaw>(sql`
    with flags as ${flaggedDrafts(sql`${u.id} = ${id}`, source)}
    select ${p.id} as id, ${p.name} as name, ${p.level}::text as level, ${p.source} as source,
      ${p.durationMonths} as duration_months, ${p.tuitionPerYear} as tuition_per_year, ${p.tuitionTotal} as tuition_total,
      ${p.applicationFee} as application_fee, ${p.intakeMonths} as intake_months,
      ${p.minIelts} as min_ielts, ${p.minPte} as min_pte, ${p.minToefl} as min_toefl,
      ${p.entryRequirements} as entry_requirements, ${p.workRights}::text as work_rights, ${p.workRightsNote} as work_rights_note,
      flags.other_id, flags.other_name, flags.other_level, flags.other_duration, flags.other_status,
      flags.fee_median, flags.fee_courses, flags.fee_outlier, flags.fee_in_words, flags.no_intakes, flags.odd_duration, flags.score_odd,
      (select count(*)::int from flags where ${where}) as shown,
      (select count(*)::int from flags where flags.flagged) as flagged_total
    from programs
    join flags on flags.id = ${p.id}
    where ${where}
    order by ${p.name}, ${p.level}, ${p.id}
    limit ${DRAFTS_PAGE} offset ${(Math.max(1, page) - 1) * DRAFTS_PAGE}`);
  const rows: DraftRow[] = raw.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level,
    source: r.source,
    durationMonths: r.duration_months,
    tuitionPerYear: r.tuition_per_year,
    tuitionTotal: r.tuition_total,
    applicationFee: r.application_fee,
    intakeMonths: r.intake_months ?? [],
    minIelts: r.min_ielts,
    minPte: r.min_pte,
    minToefl: r.min_toefl,
    entryRequirements: r.entry_requirements,
    workRights: r.work_rights,
    workRightsNote: r.work_rights_note,
    feeMedian: r.fee_median,
    feeCourses: Number(r.fee_courses ?? 0),
    ...readFlags(r),
  }));
  if (raw.length) return { rows, shown: Number(raw[0].shown), flagged: Number(raw[0].flagged_total) };
  // An empty page has no row to carry the totals, so they are asked for on their own.
  const [totals] = await db.execute<{ shown: number; flagged: number }>(sql`
    select (count(*) filter (where ${where}))::int as shown, (count(*) filter (where flags.flagged))::int as flagged
    from ${flaggedDrafts(sql`${u.id} = ${id}`, source)} flags`);
  return { rows: [], shown: Number(totals?.shown ?? 0), flagged: Number(totals?.flagged ?? 0) };
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

type Scope = {
  universityId: string;
  source?: ReviewSource;
  ids?: string[];
  /** Only drafts with no worth-a-look flag, for "Publish all clean drafts". */
  clean?: boolean;
};

/** The drafts at the university with no flag, as a list of ids to test membership of. */
const cleanIds = (s: Scope): SQL => sql`(select flags.id from ${flaggedDrafts(sql`${u.id} = ${s.universityId}`, s.source)} flags where not flags.flagged)`;

/** The drafts a press is about: the ticked ones, the clean ones, or every draft at the university. */
const scopeWhere = (s: Scope) =>
  and(eq(p.universityId, s.universityId), draftWhere(s.source), s.ids ? inArray(p.id, s.ids) : undefined, s.clean ? sql`${p.id} in ${cleanIds(s)}` : undefined);

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
    const scope = db.select({ id: p.id }).from(p).where(and(scopeWhere(s), to === "LIVE" ? READY : undefined)).limit(BATCH);
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
      left: sql<number>`count(*) filter (where not (${READY}))`.mapWith(Number),
      noIntakes: sql<number>`count(*) filter (where not ${HAS_INTAKES})`.mapWith(Number),
      noEvidence: sql<number>`count(*) filter (where not ${HAS_EVIDENCE})`.mapWith(Number),
      drafts: count(),
    })
    .from(p)
    .where(scopeWhere(s));
  return { left: row?.left ?? 0, noIntakes: row?.noIntakes ?? 0, noEvidence: row?.noEvidence ?? 0, drafts: row?.drafts ?? 0 };
}

/** Drafts at the university, in the source, that carry a flag: what a clean publish leaves for the desk. */
async function flaggedLeft(s: Scope): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select (count(*) filter (where flags.flagged))::int as n from ${flaggedDrafts(sql`${u.id} = ${s.universityId}`, s.source)} flags`);
  return Number(row?.n ?? 0);
}

/**
 * Publishes the drafts in the scope that meet the publish rules and leaves
 * the rest as drafts, counting why. With ticked courses, any that were no
 * longer drafts when the press arrived are counted too, so the numbers in
 * the answer add up to what was ticked. A clean publish also counts the
 * flagged drafts it left alone, so the answer says they are waiting.
 */
export async function publishDrafts(s: Scope, by: string): Promise<ReviewOutcome> {
  const done = await moveDrafts(s, "LIVE", by);
  const after = await stillDrafts(s);
  const gone = s.ids ? Math.max(0, s.ids.length - done - after.drafts) : 0;
  const flagged = s.clean ? await flaggedLeft(s) : undefined;
  return { op: "publish", done, left: after.left, noIntakes: after.noIntakes, noEvidence: after.noEvidence, gone, ...(flagged !== undefined ? { flagged } : {}) };
}

/** Archives the ticked drafts. Archiving has no rules: it takes a course out of sight. */
export async function archiveDrafts(s: Scope & { ids: string[] }, by: string): Promise<ReviewOutcome> {
  const done = await moveDrafts(s, "ARCHIVED", by);
  const after = await stillDrafts(s);
  return { op: "archive", done, left: 0, noIntakes: 0, noEvidence: 0, gone: Math.max(0, s.ids.length - done - after.drafts) };
}
