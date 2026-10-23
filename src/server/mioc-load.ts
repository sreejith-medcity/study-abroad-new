import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MIOC_COUNTRIES, MIOC_SOURCE, miocCode, nameKey, type MiocCountry, type MiocLevel, type MiocProgram, type MiocUniversity } from "@/lib/mioc";

/**
 * Writes the MIOC app's catalogue into the portal, in two steps the browser
 * drives: first the countries and universities, then the programs a batch at
 * a time, so no single request runs long enough to hit the hosting's limit
 * and a run that stops halfway can simply be run again.
 *
 * The rules, so a second run never undoes a person's work:
 * - Nothing is renamed and nothing is deleted.
 * - A university already here is matched by name within its country and
 *   keeps everything it has; it only gains a city if it had none.
 * - A program researched by hand (no source) is left exactly as it is, and no
 *   MIOC copy is added beside it.
 * - A program from a public register (CRICOS) only has its empty fields
 *   filled: intakes, test scores and the like the register does not carry.
 * - A MIOC program already loaded is not touched again, so a figure somebody
 *   has since corrected, or cleared as wrong, stays as they left it. A run
 *   that stopped halfway loses nothing by this: every program gets all of its
 *   fields the moment it is first added.
 * - A hand-researched program is matched on its university and name whatever
 *   its level, because the app's levels are coarser than the portal's (its
 *   "Foundation" and "Pathway" both arrive as certificates).
 * - New programs land as drafts, for the desk to check and publish.
 */

const p = schema.programs;
const u = schema.universities;
const c = schema.countries;

const LEVELS: readonly MiocLevel[] = ["SCHOOL", "UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG", "PHD", "CERTIFICATE"];
const KNOWN_CODES = new Map(Object.values(MIOC_COUNTRIES).map((x) => [x.code, x]));

export type MiocPrepareResult = {
  countriesNew: string[];
  universitiesNew: number;
  universitiesHere: number;
  /** MIOC university id to portal university id. Empty on a check. */
  ids: Record<number, string>;
};

const chunk = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown, min: number, max: number, int = true) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v)) ? v : null;

/** Countries and universities. With `dryRun`, counts what would happen and writes nothing. */
export async function prepareMioc(input: { countries: MiocCountry[]; universities: MiocUniversity[] }, opts: { dryRun: boolean }): Promise<MiocPrepareResult> {
  // Only countries this import knows, with the code, name and currency it
  // knows for them: the browser's word is not taken for any of it.
  const wanted = [...new Set(input.countries.map((x) => x.code))].map((code) => KNOWN_CODES.get(code)).filter((x): x is MiocCountry => !!x);
  const here = await db.select({ id: c.id, code: c.code }).from(c);
  const countryId = new Map(here.map((x) => [x.code, x.id]));
  const countriesNew = wanted.filter((x) => !countryId.has(x.code));
  if (!opts.dryRun && countriesNew.length) {
    const made = await db
      .insert(c)
      .values(countriesNew.map((x) => ({ code: x.code, name: x.name, currency: x.currency })))
      .onConflictDoNothing({ target: c.code })
      .returning({ id: c.id, code: c.code });
    for (const m of made) countryId.set(m.code, m.id);
  }

  const unis = input.universities
    .map((x) => ({ miocId: num(x.miocId, 1, 1e9), name: text(x.name, 300), city: text(x.city, 200), code: String(x.countryCode) }))
    .filter((x): x is { miocId: number; name: string; city: string | null; code: string } => x.miocId != null && !!x.name && KNOWN_CODES.has(x.code));

  // Universities already here, by name within the country.
  const ids = [...new Set(unis.map((x) => countryId.get(x.code)).filter((x): x is string => !!x))];
  const existing = ids.length ? await db.select({ id: u.id, name: u.name, countryId: u.countryId, city: u.city }).from(u).where(inArray(u.countryId, ids)) : [];
  const byKey = new Map(existing.map((x) => [`${x.countryId}|${nameKey(x.name)}`, x]));

  const result: Record<number, string> = {};
  const toMake = new Map<string, { name: string; city: string | null; countryId: string; miocIds: number[] }>();
  const cityFor: { id: string; city: string }[] = [];
  let matched = 0;
  for (const x of unis) {
    const cid = countryId.get(x.code);
    const k = `${cid ?? x.code}|${nameKey(x.name)}`;
    const found = cid ? byKey.get(k) : undefined;
    if (found) {
      result[x.miocId] = found.id;
      matched++;
      if (!found.city && x.city) {
        cityFor.push({ id: found.id, city: x.city });
        found.city = x.city;
      }
      continue;
    }
    // A country that could not be set up has nothing to hang a university on.
    if (!cid && !opts.dryRun) continue;
    const pending = toMake.get(k);
    if (pending) pending.miocIds.push(x.miocId);
    else toMake.set(k, { name: x.name, city: x.city, countryId: cid ?? "", miocIds: [x.miocId] });
  }
  if (opts.dryRun) return { countriesNew: countriesNew.map((x) => x.name), universitiesNew: toMake.size, universitiesHere: matched, ids: {} };

  for (const part of chunk(cityFor, 500)) {
    await db.execute(sql`
      update universities set city = x.city
      from jsonb_to_recordset(${JSON.stringify(part)}::jsonb) as x(id text, city text)
      where universities.id = x.id and universities.city is null`);
  }
  for (const part of chunk([...toMake.values()], 500)) {
    await db
      .insert(u)
      .values(part.map((x) => ({ name: x.name, city: x.city, countryId: x.countryId })))
      .onConflictDoNothing({ target: [u.name, u.countryId] });
    // Read back by name, which also finds one made a moment ago by another run.
    const made = await db
      .select({ id: u.id, name: u.name, countryId: u.countryId })
      .from(u)
      .where(sql`(${u.name}, ${u.countryId}) in (select x.name, x.country_id from jsonb_to_recordset(${JSON.stringify(part.map((x) => ({ name: x.name, country_id: x.countryId })))}::jsonb) as x(name text, country_id text))`);
    const madeBy = new Map(made.map((m) => [`${m.countryId}|${m.name}`, m.id]));
    for (const x of part) {
      const id = madeBy.get(`${x.countryId}|${x.name}`);
      if (id) for (const m of x.miocIds) result[m] = id;
    }
  }
  return { countriesNew: countriesNew.map((x) => x.name), universitiesNew: toMake.size, universitiesHere: matched, ids: result };
}

export type MiocBatchResult = { created: number; filled: number; unchanged: number; keptResearched: number; noUniversity: number };

/** The program fields this import fills, as database column, JSON type, and how a blank reads. */
const FILLABLE = [
  ["study_area", "text"],
  ["duration_months", "int"],
  ["application_fee", "int"],
  ["fee_waiver", "text"],
  ["min_ielts", "real"],
  ["min_ielts_band", "real"],
  ["min_pte", "int"],
  ["min_toefl", "int"],
  ["min_duolingo", "int"],
  ["min_gre", "int"],
  ["min_gmat", "int"],
  ["min_sat", "int"],
  ["entry_requirements", "text"],
] as const;

type Clean = Omit<MiocProgram, "universityMiocId"> & { universityId: string };

/** What the browser sent, checked field by field. Anything out of shape is dropped to "not recorded". */
function clean(x: MiocProgram, universityId: string | undefined): Clean | null {
  const miocId = num(x.miocId, 1, 1e12);
  const name = text(x.name, 500);
  if (!miocId || !name || !universityId) return null;
  return {
    miocId,
    universityId,
    name,
    level: LEVELS.includes(x.level) ? x.level : "CERTIFICATE",
    studyArea: text(x.studyArea, 120),
    durationMonths: num(x.durationMonths, 1, 120),
    tuitionPerYear: num(x.tuitionPerYear, 1, 1e9),
    applicationFee: num(x.applicationFee, 1, 1e7),
    feeWaiver: text(x.feeWaiver, 200),
    intakeMonths: Array.isArray(x.intakeMonths) ? [...new Set(x.intakeMonths.filter((m) => num(m, 1, 12) != null))].sort((a, b) => a - b) : [],
    minIelts: num(x.minIelts, 3, 9, false),
    minIeltsBand: num(x.minIeltsBand, 3, 9, false),
    minPte: num(x.minPte, 10, 90),
    minToefl: num(x.minToefl, 1, 120),
    minDuolingo: num(x.minDuolingo, 10, 160),
    minGre: num(x.minGre, 260, 340),
    minGmat: num(x.minGmat, 200, 800),
    minSat: num(x.minSat, 400, 1600),
    entryRequirements: text(x.entryRequirements, 8000),
  };
}

const asRow = (id: string, x: Clean) => ({
  id,
  study_area: x.studyArea,
  duration_months: x.durationMonths,
  tuition_per_year: x.tuitionPerYear,
  application_fee: x.applicationFee,
  fee_waiver: x.feeWaiver,
  intake_months: x.intakeMonths,
  min_ielts: x.minIelts,
  min_ielts_band: x.minIeltsBand,
  min_pte: x.minPte,
  min_toefl: x.minToefl,
  min_duolingo: x.minDuolingo,
  min_gre: x.minGre,
  min_gmat: x.minGmat,
  min_sat: x.minSat,
  entry_requirements: x.entryRequirements,
});

/** Fills the empty fields of programs already here, and says how many gained anything. */
async function fillBlanks(rows: ReturnType<typeof asRow>[]) {
  if (!rows.length) return 0;
  const cols = FILLABLE.map(([col, type]) => sql.raw(`${col} ${type}`));
  const sets = FILLABLE.map(([col]) => sql.raw(`${col} = coalesce(p.${col}, x.${col})`));
  const gains = FILLABLE.map(([col]) => sql.raw(`(p.${col} is null and x.${col} is not null)`));
  let filled = 0;
  for (const part of chunk(rows, 500)) {
    const changed = await db.execute<{ id: string }>(sql`
      update programs p set
        ${sql.join(sets, sql`, `)},
        -- A yearly fee only where there is no fee at all: a register's
        -- whole-course fee is not to be joined by a yearly one from elsewhere.
        tuition_per_year = case when p.tuition_per_year is null and p.tuition_total is null then x.tuition_per_year else p.tuition_per_year end,
        intake_months = case when cardinality(p.intake_months) = 0 then x.intake_months else p.intake_months end,
        updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(part)}::jsonb) as x(id text, ${sql.join(cols, sql`, `)}, tuition_per_year int, intake_months int[])
      where p.id = x.id and (
        ${sql.join(gains, sql` or `)}
        or (p.tuition_per_year is null and p.tuition_total is null and x.tuition_per_year is not null)
        or (cardinality(p.intake_months) = 0 and cardinality(x.intake_months) > 0)
      )
      returning p.id`);
    filled += changed.length;
  }
  return filled;
}

/** One batch of programs, their universities already in place. */
export async function loadMiocPrograms(batch: MiocProgram[], universityIds: Record<number, string>): Promise<MiocBatchResult> {
  const result: MiocBatchResult = { created: 0, filled: 0, unchanged: 0, keptResearched: 0, noUniversity: 0 };
  // The map comes from the browser: only universities that exist are taken,
  // so a stale or altered map cannot hang courses on the wrong institution
  // or fail the whole batch on a missing one.
  const claimed = [...new Set(Object.values(universityIds ?? {}).filter((v): v is string => typeof v === "string" && v.length > 0 && v.length < 64))];
  const real = new Set(
    claimed.length ? (await db.select({ id: u.id }).from(u).where(sql`${u.id} = any(string_to_array(${claimed.join(",")}, ','))`)).map((x) => x.id) : [],
  );
  const rows: Clean[] = [];
  for (const x of batch) {
    const uni = universityIds?.[x.universityMiocId];
    const r = clean(x, uni && real.has(uni) ? uni : undefined);
    if (r) rows.push(r);
    else result.noUniversity++;
  }
  if (!rows.length) return result;

  // Loaded before, by its MIOC course id.
  const codes = rows.map((r) => miocCode(r.miocId));
  const loaded = new Map(
    (await db.select({ id: p.id, code: p.externalCode }).from(p).where(sql`${p.externalCode} = any(string_to_array(${codes.join(",")}, ','))`)).map((x) => [x.code!, x.id]),
  );

  // The same course at the same university and level from anywhere else.
  const uniIds = [...new Set(rows.map((r) => r.universityId))];
  const others = await db
    .select({ id: p.id, universityId: p.universityId, name: p.name, level: p.level, source: p.source })
    .from(p)
    .where(sql`${p.universityId} = any(string_to_array(${uniIds.join(",")}, ',')) and ${p.source} is distinct from ${MIOC_SOURCE}`);
  // Register rows match at the same level; hand-researched ones on name alone.
  const sameCourse = new Map<string, string>();
  const researched = new Set<string>();
  for (const o of others) {
    if (o.source == null) researched.add(`${o.universityId}|${nameKey(o.name)}`);
    else sameCourse.set(`${o.universityId}|${o.level}|${nameKey(o.name)}`, o.id);
  }

  const fill: ReturnType<typeof asRow>[] = [];
  const fresh: Clean[] = [];
  for (const r of rows) {
    if (loaded.has(miocCode(r.miocId))) {
      result.unchanged++;
      continue;
    }
    if (researched.has(`${r.universityId}|${nameKey(r.name)}`)) {
      result.keptResearched++;
      continue;
    }
    const twin = sameCourse.get(`${r.universityId}|${r.level}|${nameKey(r.name)}`);
    if (twin) {
      fill.push(asRow(twin, r));
      continue;
    }
    fresh.push(r);
  }

  for (const part of chunk(fresh, 400)) {
    const made = await db
      .insert(p)
      .values(
        part.map((r) => ({
          name: r.name,
          universityId: r.universityId,
          pathway: "DEGREE" as const,
          level: r.level,
          studyArea: r.studyArea,
          durationMonths: r.durationMonths,
          tuitionPerYear: r.tuitionPerYear,
          applicationFee: r.applicationFee,
          feeWaiver: r.feeWaiver,
          intakeMonths: r.intakeMonths,
          minIelts: r.minIelts,
          minIeltsBand: r.minIeltsBand,
          minPte: r.minPte,
          minToefl: r.minToefl,
          minDuolingo: r.minDuolingo,
          minGre: r.minGre,
          minGmat: r.minGmat,
          minSat: r.minSat,
          entryRequirements: r.entryRequirements,
          source: MIOC_SOURCE,
          externalCode: miocCode(r.miocId),
          status: "DRAFT" as const,
        })),
      )
      // Two runs at once: the second finds the first's row and leaves it.
      .onConflictDoNothing({ target: p.externalCode })
      .returning({ id: p.id });
    result.created += made.length;
    result.unchanged += part.length - made.length;
  }
  const filled = await fillBlanks(fill);
  result.filled += filled;
  result.unchanged += fill.length - filled;
  return result;
}
