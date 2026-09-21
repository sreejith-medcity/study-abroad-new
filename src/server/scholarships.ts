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

/** The same test as SQL, for search: does this program's university offer an open scholarship at its level? */
export const hasOpenScholarship = sql`exists (
  select 1 from scholarships sc
  where sc.university_id = programs.university_id and sc.active
    and (sc.deadline is null or sc.deadline >= current_date)
    and (cardinality(sc.levels) = 0 or programs.level = any(sc.levels))
)`;
