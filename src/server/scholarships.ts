import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Open scholarships at a university: active, and either no deadline or one
 * that has not passed. With a level, only those that apply to it.
 */
export async function openScholarships(universityId: string, level?: string) {
  const s = schema.scholarships;
  return db
    .select()
    .from(s)
    .where(
      and(
        eq(s.universityId, universityId),
        eq(s.active, true),
        or(sql`${s.deadline} is null`, sql`${s.deadline} >= current_date`),
        level ? sql`(cardinality(${s.levels}) = 0 or ${level}::study_level = any(${s.levels}))` : undefined,
      ),
    )
    .orderBy(sql`${s.deadline} nulls last`, asc(s.name));
}

/**
 * The same test as SQL, for search: does this program's university offer an
 * open scholarship at its level?
 *
 * Written as two IN lists rather than one EXISTS per row. Postgres works out
 * an uncorrelated list once and looks each program up in it; an EXISTS is run
 * again for every program, which over a catalogue of a hundred thousand
 * courses took most of a second for this one chip count.
 */
export const hasOpenScholarship = sql`(
  programs.university_id in (
    select sc.university_id from scholarships sc
    where sc.active and (sc.deadline is null or sc.deadline >= current_date) and cardinality(sc.levels) = 0)
  or (programs.university_id, programs.level) in (
    select sc.university_id, unnest(sc.levels) from scholarships sc
    where sc.active and (sc.deadline is null or sc.deadline >= current_date))
)`;
