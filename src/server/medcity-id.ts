import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { branchCodeFrom, formatStudentId, nextCodeCandidate } from "@/lib/medcity-id";

/**
 * Minting the Medcity ID.
 *
 * Two things have to be true at once: the serial must never repeat inside a
 * branch and a year, and a bulk upload of two thousand students must not make
 * two thousand round trips. So the counter is bumped once per batch, in one
 * statement, and the reserved block is handed out in order.
 */

/**
 * The branch's letters, set once. Derived from the name when the branch has no
 * code yet, with a numeric tail if those letters are already somebody else's.
 * Called inside the mint, so no branch can register a student without a code.
 */
export async function ensureBranchCode(orgId: string): Promise<string> {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org) throw new Error("Unknown branch");
  if (org.idCode) return org.idCode;

  const base = branchCodeFrom(org.name);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = nextCodeCandidate(base, attempt);
    // Claimed with a guard rather than a check-then-write, so two branches
    // registering their first student together do not both take KTM.
    const [claimed] = await db
      .update(schema.organizations)
      .set({ idCode: candidate })
      .where(and(eq(schema.organizations.id, orgId), isNull(schema.organizations.idCode)))
      .returning({ idCode: schema.organizations.idCode })
      .catch(() => [] as { idCode: string | null }[]);
    if (claimed?.idCode) return claimed.idCode;
    // Either somebody else took the code, or another request set this branch's
    // code a moment ago. Re-read before trying the next candidate.
    const again = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
    if (again?.idCode) return again.idCode;
  }
  throw new Error(`Could not settle on a branch code for ${org.name}. Set one by hand.`);
}

/**
 * Takes a block of serials for one branch and one year, in a single statement.
 * The row holds the highest serial handed out, so the reserved block is the
 * numbers ending at the value that comes back.
 */
async function reserveSerials(orgId: string, year: number, count: number): Promise<number[]> {
  if (count <= 0) return [];
  const { idCounters: c } = schema;
  const [row] = await db
    .insert(c)
    .values({ scope: orgId, year, used: count })
    .onConflictDoUpdate({
      target: [c.scope, c.year],
      set: { used: sql`${c.used} + ${count}`, updatedAt: new Date() },
    })
    .returning({ used: c.used });
  const high = row.used;
  return Array.from({ length: count }, (_, i) => high - count + 1 + i);
}

/** One ID for one student about to be registered. */
export async function mintStudentId(orgId: string, when: Date = new Date()): Promise<string> {
  const [id] = await reserveStudentIds(orgId, 1, when);
  return id;
}

/** A block of IDs in registration order, for a bulk upload. */
export async function reserveStudentIds(orgId: string, count: number, when: Date = new Date()): Promise<string[]> {
  if (count <= 0) return [];
  const code = await ensureBranchCode(orgId);
  const year = when.getFullYear();
  const serials = await reserveSerials(orgId, year, count);
  return serials.map((serial) => formatStudentId(code, year, serial));
}

/**
 * Gives a student an ID if they are missing one, and returns what they carry.
 *
 * Used on the student file rather than in a migration: a row that predates the
 * numbering gets its ID the first time somebody opens it, in that branch's own
 * current year, which is honest about when the number was issued.
 */
export async function ensureStudentId(studentId: string): Promise<string | null> {
  const student = await db.query.students.findFirst({ where: eq(schema.students.id, studentId) });
  if (!student) return null;
  if (student.medcityId) return student.medcityId;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await mintStudentId(student.orgId);
    try {
      const [saved] = await db
        .update(schema.students)
        .set({ medcityId: candidate })
        .where(and(eq(schema.students.id, studentId), isNull(schema.students.medcityId)))
        .returning({ medcityId: schema.students.medcityId });
      if (saved?.medcityId) return saved.medcityId;
      // Somebody else got there first; whatever they wrote is the answer.
      const again = await db.query.students.findFirst({ where: eq(schema.students.id, studentId) });
      if (again?.medcityId) return again.medcityId;
    } catch {
      // A clash against the unique index: take the next serial and try again.
    }
  }
  return null;
}

/**
 * Mints an ID but never stops a registration.
 *
 * A counsellor with a family in front of them should not be turned away
 * because the numbering hiccuped. The student is registered without a number
 * and picks one up the next time the file is opened.
 */
export async function tryMintStudentId(orgId: string, when: Date = new Date()): Promise<string | null> {
  try {
    return await mintStudentId(orgId, when);
  } catch {
    return null;
  }
}
