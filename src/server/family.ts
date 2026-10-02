import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n";
import { homeFor } from "@/lib/permissions";

const LOCALE_COOKIE = "portal_locale";

/**
 * A parent's session: the guardian row, the student file it may read, and the
 * language to render in.
 *
 * Revoking access leaves the row in place with a date on it, so the check is
 * for a live row rather than for the row existing. A parent whose access was
 * taken away is signed out of the view at once, even if their cookie is good.
 */
export async function requireGuardian() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "PARENT") redirect(homeFor(session.role));
  if (session.mustChangePassword) redirect("/change-password");

  const guardian = await db.query.studentGuardians.findFirst({
    where: and(eq(schema.studentGuardians.userId, session.id), isNull(schema.studentGuardians.revokedAt)),
  });
  if (!guardian) redirect("/forbidden");

  const student = await db.query.students.findFirst({
    where: eq(schema.students.id, guardian.studentId),
    with: { assignedTo: true, org: true },
  });
  if (!student) redirect("/forbidden");

  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : isLocale(session.locale) ? session.locale : "en";
  return { session, guardian, student, locale };
}

/** The language choice sticks to the cookie and to the account, as it does for a student. */
export async function setFamilyLocale(locale: Locale, userId: string) {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  await db.update(schema.users).set({ locale }).where(eq(schema.users.id, userId));
}

/** Everyone who has ever been given access to a student's file, newest first. */
export async function guardiansFor(studentId: string) {
  const { studentGuardians: g, users: u } = schema;
  return db
    .select({
      id: g.id,
      relation: g.relation,
      seesMoney: g.seesMoney,
      createdAt: g.createdAt,
      revokedAt: g.revokedAt,
      studentToldAt: g.studentToldAt,
      name: u.name,
      email: u.email,
      phone: u.phone,
      active: u.active,
      lastSignInAt: u.lastSignInAt,
      userId: u.id,
    })
    .from(g)
    .innerJoin(u, eq(u.id, g.userId))
    .where(eq(g.studentId, studentId))
    .orderBy(desc(g.createdAt));
}

/** The live ones only, for the student's own "who can see my file" list. */
export async function liveGuardiansFor(studentId: string) {
  const rows = await guardiansFor(studentId);
  return rows.filter((r) => !r.revokedAt && r.active);
}

/**
 * The fees a parent is shown when the branch switched money on.
 *
 * Only what the student is the payer of: a service fee, a ticket, insurance.
 * What a university or a vendor pays Medcity is none of the family's business
 * and never leaves this filter. A line written off is dropped, because a family
 * should not be shown a bill nobody is going to send. Figures stay in the
 * currency they were recorded in and nothing is converted, so a blank stays
 * blank.
 */
export async function familyMoney(studentId: string) {
  const { incomeLines: il } = schema;
  return db
    .select({
      id: il.id,
      kind: il.kind,
      currency: il.currency,
      expectedAmount: il.expectedAmount,
      invoicedAmount: il.invoicedAmount,
      receivedAmount: il.receivedAmount,
      state: il.state,
    })
    .from(il)
    .where(and(eq(il.studentId, studentId), eq(il.payer, "STUDENT"), ne(il.state, "WRITTEN_OFF")))
    .orderBy(asc(il.createdAt));
}

/**
 * How many guardians a student may have. Enough for two parents and a sponsor,
 * and few enough that nobody quietly shares the file with a village.
 */
export const GUARDIAN_LIMIT = 4;

export async function liveGuardianCount(studentId: string) {
  const [{ live }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(schema.studentGuardians)
    .where(and(eq(schema.studentGuardians.studentId, studentId), isNull(schema.studentGuardians.revokedAt)));
  return live;
}
