import "server-only";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Has anything actually happened in this branch?
 *
 * The question behind "can this be deleted". A branch added by somebody
 * setting the portal up, with a name typed twice or a city spelt wrong, has
 * no students, no enquiries, and its accounts have never been signed in to.
 * There is nothing there to keep, and leaving it in every dropdown for good
 * is the wrong answer to a typo.
 *
 * A branch that has done anything at all, even one enquiry that came to
 * nothing, is closed rather than deleted, so what it did still reads.
 *
 * One definition, used by the screen to decide what to offer and by the
 * action to decide what to allow, because a screen that offers something the
 * action then refuses is worse than not offering it.
 */
export async function orgIsUntouched(orgId: string) {
  const [[students], [enquiries], [signedIn]] = await Promise.all([
    db.select({ n: count() }).from(schema.students).where(eq(schema.students.orgId, orgId)),
    db.select({ n: count() }).from(schema.enquiries).where(eq(schema.enquiries.orgId, orgId)),
    db
      .select({ n: count() })
      .from(schema.users)
      .where(and(eq(schema.users.orgId, orgId), isNotNull(schema.users.lastSignInAt))),
  ]);
  return students.n === 0 && enquiries.n === 0 && signedIn.n === 0;
}

/** The same question for a page of branches, in one go rather than per card. */
export async function untouchedOrgs(orgIds: string[]) {
  const out = new Set<string>();
  await Promise.all(orgIds.map(async (id) => { if (await orgIsUntouched(id)) out.add(id); }));
  return out;
}
