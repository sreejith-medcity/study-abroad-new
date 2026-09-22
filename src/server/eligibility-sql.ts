import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { schema } from "@/db";
import { bestPercents, bestScores, CEFR_SCALE, OET_SCALE, type EligibilityInput } from "@/lib/eligibility";

const scale = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;

/**
 * Programs this student is not blocked from, as SQL: the same reading as
 * checkEligibility, where a practice score that already meets the bar or a
 * program that takes an MOI letter counts as on track, not blocked. Lets search
 * hide what the student cannot meet yet and still page and count correctly.
 */
export function notBlockedWhere(student: Pick<EligibilityInput, "backlogs" | "tests" | "academics">): SQL {
  const p = schema.programs;
  const b = bestScores(student.tests);
  const noEnglish = sql`(${p.minIelts} is null and ${p.minPte} is null and ${p.minToefl} is null and ${p.minDuolingo} is null)`;
  const english = [
    noEnglish,
    sql`${p.moiAccepted}`,
    b.ielts != null ? sql`${p.minIelts} <= ${b.ielts}::real` : undefined,
    b.pte != null ? sql`${p.minPte} <= ${b.pte}::real` : undefined,
    b.toefl != null ? sql`${p.minToefl} <= ${b.toefl}::real` : undefined,
    b.duolingo != null ? sql`${p.minDuolingo} <= ${b.duolingo}::real` : undefined,
    b.ieltsMock != null ? sql`${p.minIelts} <= ${b.ieltsMock}::real` : undefined,
  ].filter((x): x is SQL => !!x);
  const admission = (col: AnyPgColumn, have: number | null) => (have != null ? sql`(${col} is null or ${col} <= ${have}::real)` : sql`${col} is null`);
  const oet = b.oet >= 0 ? sql`coalesce(array_position(${scale(OET_SCALE)}, ${p.minOetGrade}) - 1, -1) <= ${b.oet}::int` : sql`false`;
  const german = b.german >= 0 ? sql`coalesce(array_position(${scale(CEFR_SCALE)}, ${p.minGermanLevel}) - 1, -1) <= ${b.german}::int` : sql`false`;
  const backlogs = student.backlogs != null ? sql`(${p.maxBacklogs} is null or ${p.maxBacklogs} >= ${student.backlogs}::int)` : sql`true`;
  // Blocked on marks only where a percentage is recorded at the qualifying level and falls short.
  let academic = sql`true`;
  if (student.academics) {
    const pct = bestPercents(student.academics);
    const below = (v: number | null) => (v != null ? sql`${p.minAcademicPercent} > ${v}::real` : sql`false`);
    academic = sql`(${p.minAcademicPercent} is null or not (case
      when ${p.level} in ('PG', 'PG_DIPLOMA', 'REGISTRATION') then ${below(pct.UG)}
      when ${p.level} = 'PHD' then ${below(pct.PG)}
      when ${p.level} = 'SCHOOL' then false
      else ${below(pct.SCHOOL)} end))`;
  }
  return sql`((${sql.join(english, sql` or `)})
    and ${admission(p.minGre, b.gre)}
    and ${admission(p.minGmat, b.gmat)}
    and ${admission(p.minSat, b.sat)}
    and (${p.minOetGrade} is null or ${oet})
    and (${p.minGermanLevel} is null or ${german})
    and ${backlogs}
    and ${academic})`;
}
