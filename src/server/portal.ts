import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n";

const LOCALE_COOKIE = "portal_locale";

/**
 * A student session: the account, the one student file it may read, and the
 * language to render in. Anyone else is sent back to their own home.
 */
export async function requireStudent() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "STUDENT") redirect("/");
  if (session.mustChangePassword) redirect("/change-password");
  if (!session.studentId) redirect("/forbidden");

  const student = await db.query.students.findFirst({
    where: eq(schema.students.id, session.studentId),
    with: { assignedTo: true, org: true },
  });
  if (!student) redirect("/forbidden");

  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : isLocale(session.locale) ? session.locale : "en";
  return { session, student, locale };
}

export async function setPortalLocale(locale: Locale, userId: string) {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  await db.update(schema.users).set({ locale }).where(eq(schema.users.id, userId));
}

/** Everything the portal home needs: applications with student-facing wording. */
export async function studentApplications(studentId: string, locale: Locale = "en") {
  const { applications: a, statusDefinitions: sd, programs: p, universities: u, countries: c } = schema;
  return db
    .select({
      id: a.id,
      ackNo: a.ackNo,
      intakeMonth: a.intakeMonth,
      intakeYear: a.intakeYear,
      statusLabel: locale === "ml" ? sql<string>`coalesce(${sd.studentLabelMl}, ${sd.studentLabel})` : sd.studentLabel,
      statusGroup: sd.group,
      statusCode: sd.code,
      changedAt: a.statusChangedAt,
      program: p.name,
      university: u.name,
      country: c.name,
      requiredDocs: p.requiredDocs,
      offerType: a.offerType,
      offerAcceptBy: a.offerAcceptBy,
      offerConditions: a.offerConditions,
      visaLodgedOn: a.visaLodgedOn,
      visaDecision: a.visaDecision,
      visaDecisionOn: a.visaDecisionOn,
    })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(p, eq(a.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(eq(a.studentId, studentId))
    .orderBy(desc(a.createdAt));
}

/** Milestones only: the student sees the story, not every internal step. */
export async function studentTimeline(applicationIds: string[], locale: Locale = "en") {
  if (applicationIds.length === 0) return [];
  const { statusHistory: sh, statusDefinitions: sd } = schema;
  return db
    .select({
      id: sh.id,
      applicationId: sh.applicationId,
      label: locale === "ml" ? sql<string>`coalesce(${sd.studentLabelMl}, ${sd.studentLabel})` : sd.studentLabel,
      group: sd.group,
      createdAt: sh.createdAt,
    })
    .from(sh)
    .innerJoin(sd, eq(sh.toStatusId, sd.id))
    .where(and(inArray(sh.applicationId, applicationIds), eq(sd.isMilestone, true)))
    .orderBy(desc(sh.createdAt))
    .limit(30);
}

/** Documents the student has given us, and the ones still to come. */
export async function studentDocuments(studentId: string, requiredCodes: string[], locale: Locale = "en") {
  const held = await db
    .select({
      id: schema.documents.id,
      typeCode: schema.documents.typeCode,
      fileName: schema.documents.fileName,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.studentId, studentId))
    .orderBy(desc(schema.documents.createdAt));

  const types = await db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder));
  // What the branch chose to show the student, such as an offer letter.
  const shared = await db
    .select({ id: schema.documents.id, typeCode: schema.documents.typeCode, fileName: schema.documents.fileName, createdAt: schema.documents.createdAt })
    .from(schema.documents)
    .where(and(eq(schema.documents.studentId, studentId), eq(schema.documents.sharedWithStudent, true)))
    .orderBy(desc(schema.documents.createdAt));
  const heldCodes = new Set(held.map((d) => d.typeCode));
  const wanted = types.filter((t) => requiredCodes.includes(t.code) || heldCodes.has(t.code));
  const labelOf = (code: string | null) => {
    const t = types.find((x) => x.code === code);
    return t ? ((locale === "ml" ? t.labelMl : null) ?? t.label) : null;
  };
  return {
    held,
    types,
    shared: shared.map((d) => ({ ...d, label: labelOf(d.typeCode) })),
    rows: wanted.map((t) => ({
      code: t.code,
      label: (locale === "ml" ? t.labelMl : null) ?? t.label,
      byTeam: t.uploadedBy === "team",
      guidance: t.guidance,
      hasSample: !!t.sampleStorageKey,
      document: held.find((d) => d.typeCode === t.code) ?? null,
    })),
    missing: wanted
      .filter((t) => t.uploadedBy !== "team" && !heldCodes.has(t.code))
      .map((t) => ({ ...t, label: (locale === "ml" ? t.labelMl : null) ?? t.label })),
  };
}

/** The student channel only. Team notes are never exposed here. */
export async function studentThread(applicationIds: string[]) {
  if (applicationIds.length === 0) return [];
  const { comments: cm, users: us } = schema;
  return db
    .select({
      id: cm.id,
      applicationId: cm.applicationId,
      body: cm.body,
      source: cm.source,
      authorId: cm.authorId,
      authorName: us.name,
      authorLabel: cm.authorLabel,
      createdAt: cm.createdAt,
    })
    .from(cm)
    .leftJoin(us, eq(cm.authorId, us.id))
    .where(and(inArray(cm.applicationId, applicationIds), eq(cm.channel, "STUDENT")))
    .orderBy(asc(cm.createdAt))
    .limit(200);
}

/**
 * What the counsellor has shortlisted for the student, minus anything already
 * applied for and anything no longer open. Read-only in the portal.
 */
export async function studentShortlist(studentId: string) {
  const rows = await db.query.shortlists.findMany({
    where: eq(schema.shortlists.studentId, studentId),
    orderBy: asc(schema.shortlists.createdAt),
    with: { program: { with: { university: { with: { country: true } } } } },
  });
  const applied = new Set(
    (await db.select({ programId: schema.applications.programId }).from(schema.applications).where(eq(schema.applications.studentId, studentId))).map((a) => a.programId),
  );
  return rows
    .filter((r) => r.program.status === "LIVE" && !applied.has(r.programId))
    .map((r) => ({
      id: r.programId,
      name: r.program.name,
      university: r.program.university.name,
      country: r.program.university.country.name,
      campus: r.program.campus,
      currency: r.program.university.country.currency,
      tuitionPerYear: r.program.tuitionPerYear,
      tuitionTotal: r.program.tuitionTotal,
      durationMonths: r.program.durationMonths,
      workRights: r.program.workRights,
    }));
}
