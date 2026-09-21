import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import { bestScores, CEFR_SCALE, OET_SCALE, type EligibilityInput } from "@/lib/eligibility";

const scale = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;

/**
 * Programs this student is not blocked from, as SQL: the same reading as
 * checkEligibility, where a practice score that already meets the bar or a
 * program that takes an MOI letter counts as on track, not blocked. Lets search
 * hide what the student cannot meet yet and still page and count correctly.
 */
export function notBlockedWhere(student: Pick<EligibilityInput, "backlogs" | "tests">): SQL {
  const p = schema.programs;
  const b = bestScores(student.tests);
  const english = [
    sql`(${p.minIelts} is null and ${p.minPte} is null)`,
    sql`${p.moiAccepted}`,
    b.ielts != null ? sql`${p.minIelts} <= ${b.ielts}::real` : undefined,
    b.pte != null ? sql`${p.minPte} <= ${b.pte}::real` : undefined,
    b.ieltsMock != null ? sql`${p.minIelts} <= ${b.ieltsMock}::real` : undefined,
  ].filter((x): x is SQL => !!x);
  const oet = b.oet >= 0 ? sql`coalesce(array_position(${scale(OET_SCALE)}, ${p.minOetGrade}) - 1, -1) <= ${b.oet}::int` : sql`false`;
  const german = b.german >= 0 ? sql`coalesce(array_position(${scale(CEFR_SCALE)}, ${p.minGermanLevel}) - 1, -1) <= ${b.german}::int` : sql`false`;
  const backlogs = student.backlogs != null ? sql`(${p.maxBacklogs} is null or ${p.maxBacklogs} >= ${student.backlogs}::int)` : sql`true`;
  return sql`((${sql.join(english, sql` or `)})
    and (${p.minOetGrade} is null or ${oet})
    and (${p.minGermanLevel} is null or ${german})
    and ${backlogs})`;
}
