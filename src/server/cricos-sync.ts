import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildCricos, CRICOS_SOURCE, nameKey } from "@/lib/cricos";

/** data.gov.au's stable download links for the three register files. */
export const CRICOS_FILES = {
  institutions:
    "https://data.gov.au/data/dataset/e5ae7059-bfa8-4fa4-a5c0-c13cf3520193/resource/7f6941f3-5327-4db7-b556-5f16d77f63c1/download/cricos-institutions.csv",
  courses:
    "https://data.gov.au/data/dataset/e5ae7059-bfa8-4fa4-a5c0-c13cf3520193/resource/48cacf69-2082-415e-9595-f17d0c3a4af0/download/cricos-courses.csv",
  locations:
    "https://data.gov.au/data/dataset/e5ae7059-bfa8-4fa4-a5c0-c13cf3520193/resource/4cd2de02-8ba3-4eb2-bac2-fe272cae3f5f/download/cricos-course-locations.csv",
} as const;

export async function fetchCricosFiles() {
  const get = async (url: string) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`data.gov.au answered ${res.status} for ${url.split("/").pop()}`);
    return res.text();
  };
  const [institutions, courses, locations] = await Promise.all([get(CRICOS_FILES.institutions), get(CRICOS_FILES.courses), get(CRICOS_FILES.locations)]);
  return { institutions, courses, locations };
}

/** Notes this sync writes itself. A note that is not one of these was written by a person and is left alone. */
const RULE_NOTE_PREFIXES = ["485 Post-Higher Education Work:", "Degree under 92 weeks:", "Not a degree, so no 485"];

export type CricosSyncResult = {
  providers: number;
  courses: number;
  created: number;
  updated: number;
  archived: number;
  claimed: number;
  seconds: number;
};

/** True when nothing in the system points at this program. */
async function untouched(programId: string) {
  const [row] = await db.execute<{ n: number }>(sql`
    select (select count(*) from applications where program_id = ${programId})
         + (select count(*) from shortlists where program_id = ${programId})
         + (select count(*) from commission_rules where program_id = ${programId}) as n`);
  return Number(row?.n ?? 1) === 0;
}

const chunk = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Brings the catalogue in line with one release of the CRICOS register.
 *
 * - Providers attach to an existing university by register code, then by name,
 *   and are created otherwise.
 * - Courses are keyed by their CRICOS course code. New ones land as drafts
 *   unless `publish` is set. Existing CRICOS rows get the register's fields
 *   refreshed (name, level, field, duration, fee, campus); anything a person
 *   added (intakes, IELTS, documents, their own work rights note) is kept.
 * - A course that has left the register is archived, never deleted, so any
 *   application that points at it keeps its history.
 * - Rows from the hand-researched catalogue are claimed first, by a CRICOS code
 *   in their notes or by a unique exact name at the same provider, so the
 *   register does not duplicate them. A twin an earlier sync added is merged
 *   away when it is an untouched draft.
 */
export async function syncCricos(files: { institutions: string; courses: string; locations: string }, opts: { publish: boolean }): Promise<CricosSyncResult> {
  const started = Date.now();
  const { providers, courses } = buildCricos(files);
  if (courses.length < 1000) throw new Error(`Only ${courses.length} live courses found. The files look incomplete, so nothing was changed.`);

  const au = await db.query.countries.findFirst({ where: eq(schema.countries.code, "AU") });
  if (!au) throw new Error("Australia is missing from the countries table.");
  const u = schema.universities;
  const p = schema.programs;

  // ---- Providers ----
  const existing = await db.select({ id: u.id, name: u.name, externalCode: u.externalCode }).from(u).where(eq(u.countryId, au.id));
  const byCode = new Map(existing.filter((x) => x.externalCode).map((x) => [x.externalCode!, x.id]));
  const byName = new Map(existing.map((x) => [x.name.toLowerCase(), x.id]));
  const providerId = new Map<string, string>();
  const toCreate: typeof providers = [];
  for (const pr of providers) {
    const id = byCode.get(pr.code) ?? byName.get(pr.name.toLowerCase());
    if (id) providerId.set(pr.code, id);
    else toCreate.push(pr);
  }
  // Existing universities learn their code (unless they already have one) and website.
  for (const pr of providers) {
    const id = providerId.get(pr.code);
    if (!id) continue;
    await db
      .update(u)
      .set({
        externalCode: sql`coalesce(${u.externalCode}, ${byCode.has(pr.code) ? null : pr.code})`,
        website: sql`coalesce(${u.website}, ${pr.website})`,
        isPublic: sql`${u.isPublic} or ${pr.isPublic}`,
        city: sql`coalesce(${u.city}, ${pr.city})`,
      })
      .where(eq(u.id, id));
    byCode.set(pr.code, id);
  }
  for (const part of chunk(toCreate, 500)) {
    const rows = await db
      .insert(u)
      .values(part.map((pr) => ({ name: pr.name, city: pr.city, countryId: au.id, isPublic: pr.isPublic, website: pr.website, externalCode: pr.code })))
      .returning({ id: u.id, code: u.externalCode });
    for (const r of rows) providerId.set(r.code!, r.id);
  }

  // ---- Claim hand-researched rows ----
  // A hand row takes the register's code when its notes name one, or, failing
  // that, when exactly one register course at the same provider has the same
  // name. Either way the register then refreshes it in place instead of adding
  // a twin. A twin an earlier sync already added is merged away, but only when
  // it is an untouched draft: nobody has applied to it, shortlisted it or
  // attached a commission rule to it.
  const claimable = await db
    .select({ id: p.id, universityId: p.universityId, name: p.name, studyArea: p.studyArea, note: p.workRightsNote })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .where(and(eq(u.countryId, au.id), isNull(p.externalCode), sql`${p.source} is distinct from ${CRICOS_SOURCE}`));
  const liveCodes = new Set(courses.map((c) => c.code));
  const courseByName = new Map<string, string | null>();
  for (const c of courses) {
    const uni = providerId.get(c.providerCode);
    if (!uni) continue;
    const key = `${uni}|${nameKey(c.name)}`;
    // Two register courses with one name at one provider: too ambiguous to claim.
    courseByName.set(key, courseByName.has(key) ? null : c.code);
  }
  const holders = new Map(
    (await db.select({ id: p.id, code: p.externalCode, source: p.source, status: p.status }).from(p).where(sql`${p.externalCode} is not null`)).map((x) => [x.code!, x]),
  );
  let claimed = 0;
  for (const row of claimable) {
    const named = `${row.studyArea ?? ""} ${row.note ?? ""}`.match(/\b\d{6}[A-Z]\b/)?.[0];
    const code = named && liveCodes.has(named) ? named : courseByName.get(`${row.universityId}|${nameKey(row.name)}`);
    if (!code) continue;
    const holder = holders.get(code);
    if (holder) {
      if (holder.source !== CRICOS_SOURCE || holder.status !== "DRAFT" || !(await untouched(holder.id))) continue;
      await db.delete(p).where(eq(p.id, holder.id));
    }
    await db.update(p).set({ externalCode: code }).where(eq(p.id, row.id));
    holders.set(code, { id: row.id, code, source: null, status: "LIVE" });
    claimed++;
  }

  // ---- Courses ----
  let created = 0;
  let updated = 0;
  const ruleNote = sql.join(RULE_NOTE_PREFIXES.map((x) => sql`${p.workRightsNote} like ${x + "%"}`), sql` or `);
  for (const part of chunk(courses, 800)) {
    const rows = await db
      .insert(p)
      .values(
        part.map((c) => ({
          name: c.name,
          universityId: providerId.get(c.providerCode)!,
          campus: c.campus,
          pathway: "DEGREE" as const,
          level: c.level,
          studyArea: c.studyArea,
          durationMonths: c.durationMonths,
          tuitionTotal: c.tuitionTotal,
          workRights: c.workRights,
          workRightsNote: c.workRightsNote,
          source: CRICOS_SOURCE,
          externalCode: c.code,
          status: opts.publish ? ("LIVE" as const) : ("DRAFT" as const),
        })),
      )
      .onConflictDoUpdate({
        target: p.externalCode,
        // Only the register's own fields move. A row a person researched by hand
        // (source is not CRICOS) is never touched beyond its claimed code.
        set: {
          name: sql`case when ${p.source} = ${CRICOS_SOURCE} then excluded.name else ${p.name} end`,
          level: sql`case when ${p.source} = ${CRICOS_SOURCE} then excluded.level else ${p.level} end`,
          studyArea: sql`case when ${p.source} = ${CRICOS_SOURCE} then excluded.study_area else ${p.studyArea} end`,
          durationMonths: sql`case when ${p.source} = ${CRICOS_SOURCE} then excluded.duration_months else ${p.durationMonths} end`,
          tuitionTotal: sql`excluded.tuition_total`,
          campus: sql`case when ${p.source} = ${CRICOS_SOURCE} then excluded.campus else coalesce(${p.campus}, excluded.campus) end`,
          workRights: sql`case when ${p.source} = ${CRICOS_SOURCE} and (${p.workRightsNote} is null or ${ruleNote}) then excluded.work_rights else ${p.workRights} end`,
          workRightsNote: sql`case when ${p.source} = ${CRICOS_SOURCE} and (${p.workRightsNote} is null or ${ruleNote}) then excluded.work_rights_note else ${p.workRightsNote} end`,
          // A course that came back to the register comes back as a draft to review.
          status: sql`case when ${p.status} = 'ARCHIVED' and ${p.source} = ${CRICOS_SOURCE} then 'DRAFT'::program_status else ${p.status} end`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of rows) {
      if (r.inserted) created++;
      else updated++;
    }
  }

  // ---- Courses that left the register ----
  // One text parameter, not 26,000: a bound array is expanded into a parameter
  // per element, which is past Postgres's limit of 65,535.
  const codes = courses.map((c) => c.code);
  const gone = await db
    .update(p)
    .set({ status: "ARCHIVED", updatedAt: new Date() })
    .where(and(eq(p.source, CRICOS_SOURCE), ne(p.status, "ARCHIVED"), sql`not (${p.externalCode} = any(string_to_array(${codes.join(",")}, ',')))`))
    .returning({ id: p.id });

  return {
    providers: providers.length,
    courses: courses.length,
    created,
    updated,
    archived: gone.length,
    claimed,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}
