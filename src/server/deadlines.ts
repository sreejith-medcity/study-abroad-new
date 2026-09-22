import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const today = () => sql`current_date`;

/** Deadlines of one program: everything still open, plus the last month of closed ones. */
export async function programDeadlines(programId: string) {
  const d = schema.programDeadlines;
  return db
    .select()
    .from(d)
    .where(and(eq(d.programId, programId), sql`${d.deadline} >= current_date - 31`))
    .orderBy(asc(d.deadline));
}

/** The next open deadline per program, for lists. */
export async function nextDeadlines(programIds: string[]) {
  if (!programIds.length) return new Map<string, { deadline: string; intakeMonth: number; intakeYear: number }>();
  const d = schema.programDeadlines;
  const rows = await db
    .selectDistinctOn([d.programId], { programId: d.programId, deadline: d.deadline, intakeMonth: d.intakeMonth, intakeYear: d.intakeYear })
    .from(d)
    .where(and(inArray(d.programId, programIds), gte(d.deadline, today())))
    .orderBy(d.programId, asc(d.deadline));
  return new Map(rows.map((r) => [r.programId, r]));
}

/** SQL for search: this program has an open deadline within `days` days. */
export const closingWithin = (days: number) => sql`exists (
  select 1 from program_deadlines pd
  where pd.program_id = programs.id and pd.deadline >= current_date and pd.deadline <= current_date + ${days}::int
)`;
