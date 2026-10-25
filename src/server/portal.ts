import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { outstandingForStudent } from "./documentation";
import { serviceCharges } from "./ausbildung";
import { getSession } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n";
import { documentFamilies } from "@/lib/document-versions";
import { MENTOR_PART, moduleStanding } from "@/lib/ausbildung";

const LOCALE_COOKIE = "portal_locale";

/**
 * A student session: the account, the one student file it may read, and the
 * language to render in. Anyone else is sent back to their own home.
 */
export async function requireStudent() {
  const who = await getPortalStudent();
  if (!who) redirect("/login");
  return who;
}

/**
 * The same session, but answered rather than redirected away from. A route
 * that a phone posts a file to has to say "your sign-in ran out" in words the
 * page can show; a redirect to the login screen would reach the browser as a
 * page of HTML where an answer was expected.
 */
export async function getPortalStudent() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "STUDENT") return null;
  if (session.mustChangePassword) return null;
  if (!session.studentId) return null;

  const student = await db.query.students.findFirst({
    where: eq(schema.students.id, session.studentId),
    with: { assignedTo: true, org: true },
  });
  if (!student) return null;

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
      pathway: p.pathway,
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

/**
 * What the Ausbildung journey card needs on top of the applications: the
 * German levels, the service charge paid so far, and the mentor's name.
 *
 * The charge comes from the same service fee income lines the staff tab sums,
 * so the student and the counsellor read one figure. The mentor is the person
 * on the file under the mentor's part, the latest if two were ever named, and
 * only their name crosses over: no email, no desk label.
 */
export async function studentAusbildungJourney(studentId: string) {
  const { germanModules: gm, studentPeople: sp, users: us } = schema;
  const [modules, charges, [mentor]] = await Promise.all([
    db.select({ level: gm.level, state: gm.state, completedOn: gm.completedOn }).from(gm).where(eq(gm.studentId, studentId)),
    serviceCharges([studentId]),
    db
      .select({ name: us.name })
      .from(sp)
      .innerJoin(us, eq(us.id, sp.userId))
      .where(and(eq(sp.studentId, studentId), eq(sp.part, MENTOR_PART), eq(us.active, true)))
      .orderBy(desc(sp.createdAt))
      .limit(1),
  ]);
  const charge = charges.get(studentId) ?? null;
  // Rupees where the charge was raised in rupees, else whatever currency it was raised in.
  const line = charge?.byCurrency.find((b) => b.currency === "INR") ?? charge?.byCurrency[0] ?? null;
  return {
    modules,
    german: moduleStanding(modules),
    /** The charge raised and received in one currency; null while nothing is raised, which reads "Not recorded". */
    charge: line,
    mentorName: mentor?.name ?? null,
  };
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

/**
 * Documents the student has given us, and the ones still to come.
 *
 * Counted by current version, so a passport sent twice is one passport. With
 * the viewer's account given, each document also carries the earlier versions
 * that viewer may open, which are the ones the download route lets them open:
 * files they sent and files the branch shared.
 */
export async function studentDocuments(studentId: string, requiredCodes: string[], locale: Locale = "en", viewerId?: string) {
  const rows = await db
    .select({
      id: schema.documents.id,
      typeCode: schema.documents.typeCode,
      fileName: schema.documents.fileName,
      createdAt: schema.documents.createdAt,
      uploadedById: schema.documents.uploadedById,
      sharedWithStudent: schema.documents.sharedWithStudent,
      replacesId: schema.documents.replacesId,
      supersededAt: schema.documents.supersededAt,
      supersededById: schema.documents.supersededById,
      removedAt: schema.documents.removedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.studentId, studentId))
    .orderBy(desc(schema.documents.createdAt));
  const opens = (d: (typeof rows)[number]) => !!viewerId && (d.uploadedById === viewerId || d.sharedWithStudent);
  // Kinds of document the team has accepted, which the student no longer
  // replaces themselves; the upload route refuses the same.
  const accepted = new Set(
    (
      await db
        .select({ typeCode: schema.checklistItems.typeCode })
        .from(schema.checklistItems)
        .where(and(eq(schema.checklistItems.studentId, studentId), eq(schema.checklistItems.state, "ACCEPTED")))
    ).map((r) => r.typeCode),
  );
  const families = documentFamilies(rows).filter((f) => f.current);
  const held = families.map((f) => {
    const theirs = opens(f.current!);
    const locked = !!f.current!.typeCode && accepted.has(f.current!.typeCode);
    return {
      ...f.current!,
      earlier: f.earlier.filter(opens),
      /** A student replaces only what they can see and the team has not accepted; the route checks the same. */
      replaceable: theirs && !locked,
      /** One they could replace but for the team having accepted it, which the page explains. */
      acceptedLock: theirs && locked,
    };
  });

  const types = await db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder));
  // What the branch chose to show the student, such as an offer letter.
  const shared = held.filter((d) => d.sharedWithStudent);
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

/**
 * What the student still owes, in their own language, with the reason against
 * anything sent back. Only what they owe: paper waiting on the university, the
 * vendor or Medcity is not the student's problem and is not shown to them.
 *
 * The internal notes never cross over. What a student reads is the document's
 * name, the reason the team picked from its own list, and the day it is wanted.
 */
export async function studentChecklist(studentId: string, locale: Locale = "en") {
  const outstanding = await outstandingForStudent(studentId, locale);
  const accepted = await db
    .select({ typeCode: schema.checklistItems.typeCode, label: schema.documentTypes.label, labelMl: schema.documentTypes.labelMl })
    .from(schema.checklistItems)
    .innerJoin(schema.documentTypes, eq(schema.documentTypes.code, schema.checklistItems.typeCode))
    .where(and(eq(schema.checklistItems.studentId, studentId), eq(schema.checklistItems.state, "ACCEPTED")))
    .orderBy(asc(schema.documentTypes.sortOrder));
  const waiting = await db
    .select({ typeCode: schema.checklistItems.typeCode, label: schema.documentTypes.label, labelMl: schema.documentTypes.labelMl })
    .from(schema.checklistItems)
    .innerJoin(schema.documentTypes, eq(schema.documentTypes.code, schema.checklistItems.typeCode))
    .where(and(eq(schema.checklistItems.studentId, studentId), inArray(schema.checklistItems.state, ["UPLOADED", "IN_REVIEW"] as const)))
    .orderBy(asc(schema.documentTypes.sortOrder));
  const name = (r: { label: string; labelMl: string | null }) => (locale === "ml" ? (r.labelMl ?? r.label) : r.label);
  return {
    /** Everything the student has to do something about. */
    outstanding: outstanding.map((i) => ({
      code: i.typeCode,
      label: i.labelForStudent,
      reason: i.reasonForStudent,
      dueOn: i.dueOn,
      sentBack: i.state === "REJECTED",
      asked: i.state === "ASKED",
    })),
    /** In, and checked. */
    done: accepted.map(name),
    /** In, and with the team. */
    withUs: waiting.map(name),
  };
}
