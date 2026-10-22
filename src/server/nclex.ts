import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { NclexStepKey } from "@/lib/nclex";

/*
 * Writing NCLEX-RN steps, for the actions and the upload route. Kept out of
 * the actions file on purpose: everything exported from a "use server" file
 * can be called from a browser, and these take the user's id as given.
 */

const { nclexCases: nc, nclexSteps: ns } = schema;

/** The case a step belongs to, opened the first time anything is recorded on it. */
export async function ensureNclexCase(studentId: string, userId: string) {
  await db.insert(nc).values({ studentId, updatedById: userId }).onConflictDoNothing({ target: nc.studentId });
}

/** Records one step on a student's file. */
export async function recordNclexStep(studentId: string, step: NclexStepKey, userId: string, values: { completed?: boolean; completedOn?: string | null; documentId?: string | null }) {
  await ensureNclexCase(studentId, userId);
  const held = await db.query.nclexSteps.findFirst({ where: and(eq(ns.studentId, studentId), eq(ns.step, step)) });
  const next = { ...values, updatedById: userId, updatedAt: new Date() };
  if (held) await db.update(ns).set(next).where(eq(ns.id, held.id));
  else await db.insert(ns).values({ studentId, step, completed: false, ...next });
}

