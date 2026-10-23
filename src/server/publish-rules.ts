import { and, sql } from "drizzle-orm";
import { programs as p } from "@/db/schema";

/**
 * The publish rules from src/lib/publish-rules.ts as SQL, for the updates
 * that set thousands of courses live in one statement. Keep the two in step:
 * a course publishProblems calls ready must be one these conditions take.
 *
 * Only the schema is imported, not the database, so the CRICOS sync and
 * other plain scripts can use this file too.
 */

/** At least one intake month. */
export const HAS_INTAKES = sql`cardinality(${p.intakeMonths}) > 0`;

/** No work rights verdict, or a verdict with evidence that is more than blank space. */
export const HAS_EVIDENCE = sql`(${p.workRights} = 'UNKNOWN' or coalesce(${p.workRightsNote}, '') ~ '[^[:space:]]')`;

/** Both rules, for picking the rows a batch will publish. */
export const READY = and(HAS_INTAKES, HAS_EVIDENCE)!;

/**
 * Both rules again, written against the row being updated by name
 * (`programs` in an `update programs ... from programs o` statement), so a
 * course somebody changed while the press was on its way is judged as it is
 * when the update reaches it rather than as it was when the batch was picked.
 */
export const READY_TARGET = sql.raw(`cardinality(programs.intake_months) > 0 and (programs.work_rights = 'UNKNOWN' or coalesce(programs.work_rights_note, '') ~ '[^[:space:]]')`);
