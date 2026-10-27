import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { DOCUMENTATION_ROLES } from "@/lib/permissions";
import {
  AU_PAIR_CONTACT_AREA,
  AU_PAIR_PRE_VISA,
  AU_PAIR_PROFILE_DOCUMENTS,
  AU_PAIR_TEAM,
  auPairStepOf,
  auPairVisaGate,
  auPairVisaGateText,
  crossesAuPairVisaGate,
  daysBetween,
  listMissing,
  type AuPairTeam,
  type AuPairVisaFacts,
  type MockResult,
} from "@/lib/au-pair";
import { ownStudentsOnly, ownedByPerson, studentOrgScope } from "@/server/scope";
import { studentChecklist, syncChecklist } from "@/server/documentation";

/*
 * The Au pair written process on the database. It reads and writes what the
 * FSJ / BFD process stores (the fsj_ columns with the same meaning and the
 * fsj_events rounds), so the History tab, the recorded moments and the
 * hand-over to the documentation desk work the same way; the rules are in
 * src/lib/au-pair.ts.
 */

const { students: s, applications: a, programs: pg, statusDefinitions: sd, organizations: og, users: us, fsjEvents: fe } = schema;

/** The student_people part the Au pair mentor is named under: it also lets the mentor open the file. */
export const AU_PAIR_MENTOR_PART = "Au pair mentor";

/** Who this is about: a student registered for Au pair, or with an application on an Au pair course. */
export const isAuPairSql = sql<boolean>`(
  "students"."preferred_pathway" = 'AU_PAIR'
  or exists (select 1 from applications xa join programs xp on xp.id = xa.program_id where xa.student_id = "students"."id" and xp.pathway = 'AU_PAIR')
)`;

const appColumns = {
  id: a.id,
  ackNo: a.ackNo,
  studentId: a.studentId,
  orgId: a.orgId,
  statusId: a.statusId,
  statusCode: sd.code,
  statusLabel: sd.label,
  statusGroup: sd.group,
  statusSince: a.statusChangedAt,
  pathway: pg.pathway,
  programName: pg.name,
  intakeMonth: a.intakeMonth,
  intakeYear: a.intakeYear,
  handedOverAt: a.handedOverAt,
  registrationFeePaidOn: a.fsjRegistrationFeePaidOn,
  agreementSignedOn: a.fsjAgreementSignedOn,
  paymentsVerifiedOn: a.fsjPreVisaPaymentOn,
  consentOn: a.auPairConsentOn,
  hostFamily: a.fsjEmployer,
  platform: a.auPairPlatform,
  interviewAt: a.fsjInterviewAt,
  interviewLink: a.fsjInterviewLink,
  outcome: a.fsjFeedback,
  pocketMoney: a.auPairPocketMoney,
  weeklyHours: a.auPairWeeklyHours,
  durationMonths: a.auPairDurationMonths,
  contractSignedOn: a.fsjContractSignedOn,
  appointmentAt: a.auPairAppointmentAt,
  appointmentPlace: a.auPairAppointmentPlace,
  visaLodgedOn: a.visaLodgedOn,
  visaDecision: a.visaDecision,
  visaDecisionOn: a.visaDecisionOn,
  visaReason: a.fsjVisaReason,
  joiningOn: a.fsjJoiningOn,
  departedOn: a.fsjDepartedOn,
  done: a.fsjDone,
};

const openAuPair = (where: SQL) =>
  db
    .select(appColumns)
    .from(a)
    .innerJoin(pg, eq(pg.id, a.programId))
    .innerJoin(sd, eq(sd.id, a.statusId))
    .where(and(where, eq(pg.pathway, "AU_PAIR"), sql`${sd.group} <> 'CLOSED'`))
    .orderBy(sql`(${sd.group} = 'SUCCESS') asc`, desc(a.statusChangedAt));

/**
 * The student's current Au pair application: the open one that moved most
 * recently, a finished one giving way to one still being worked. The tab, the
 * actions and the tracker all read this one, so a button acts on the file the
 * tab describes.
 */
export async function currentAuPairApplication(studentId: string) {
  const [row] = await openAuPair(eq(a.studentId, studentId)).limit(1);
  return row ?? null;
}

export type AuPairApplication = NonNullable<Awaited<ReturnType<typeof currentAuPairApplication>>>;

/** The outcome kept on a visa decision when the host family withdrew and the file went back to interview preparation. */
export const FAMILY_WITHDRAWN = "FAMILY_WITHDRAWN";

/** The host families that did not select the candidate, or withdrew after a visa refusal, so they are not put forward again. */
export async function declinedBy(applicationId: string) {
  const rows = await db
    .select({ family: fe.employer })
    .from(fe)
    .where(and(eq(fe.applicationId, applicationId), or(and(eq(fe.kind, "FEEDBACK"), eq(fe.outcome, "NOT_SELECTED")), and(eq(fe.kind, "VISA_DECISION"), eq(fe.outcome, FAMILY_WITHDRAWN)))));
  return rows.map((r) => r.family).filter((e): e is string => !!e);
}

/** The latest mock interview's result on this application, or null before the first. */
export async function lastMock(applicationId: string): Promise<MockResult | null> {
  const [row] = await db
    .select({ outcome: fe.outcome })
    .from(fe)
    .where(and(eq(fe.applicationId, applicationId), eq(fe.kind, "MOCK_INTERVIEW")))
    .orderBy(desc(fe.createdAt), desc(fe.id))
    .limit(1);
  return (row?.outcome as MockResult | undefined) ?? null;
}

/** The mentor named on the file, or null while nobody is. */
export async function auPairMentor(studentId: string) {
  const [row] = await db
    .select({ id: us.id, name: us.name, email: us.email, phone: us.phone })
    .from(schema.studentPeople)
    .innerJoin(us, eq(us.id, schema.studentPeople.userId))
    .where(and(eq(schema.studentPeople.studentId, studentId), eq(schema.studentPeople.part, AU_PAIR_MENTOR_PART), eq(us.active, true)))
    .orderBy(desc(schema.studentPeople.createdAt))
    .limit(1);
  return row ?? null;
}

/** The people a mentor can be: active documentation officers. */
export async function mentorChoices() {
  return db
    .select({ id: us.id, name: us.name })
    .from(us)
    .where(and(inArray(us.role, [...DOCUMENTATION_ROLES]), eq(us.active, true)))
    .orderBy(asc(us.name));
}

/** The student's documentation list, as the two Au pair lists read it. */
export async function docStates(studentId: string, opts: { sync?: boolean } = {}) {
  // A screen only reads the checklist; an action brings it up to date first.
  if (opts.sync) await syncChecklist(studentId);
  const rows = await studentChecklist(studentId);
  return rows.map((r) => ({ typeCode: r.typeCode, state: r.state, label: r.label, stage: r.stage }));
}

/** Step 3's required documents still missing, the same list the branch's hand-over waits on. */
export async function profileMissing(studentId: string, opts: { sync?: boolean } = {}) {
  return listMissing(AU_PAIR_PROFILE_DOCUMENTS, await docStates(studentId, opts));
}

/** An application's columns the visa gate reads. */
export type AuPairGateApp = { studentId: string; fsjPreVisaPaymentOn: string | null; fsjContractSignedOn: string | null };

export const auPairGateAppOf = (app: Pick<AuPairApplication, "studentId" | "paymentsVerifiedOn" | "contractSignedOn">): AuPairGateApp => ({
  studentId: app.studentId,
  fsjPreVisaPaymentOn: app.paymentsVerifiedOn,
  fsjContractSignedOn: app.contractSignedOn,
});

/** What the visa gate reads: the payments verified, the signed contract and the pre-visa documents still missing. */
export async function auPairVisaFacts(app: AuPairGateApp, opts: { sync?: boolean } = {}): Promise<AuPairVisaFacts> {
  const rows = await docStates(app.studentId, { sync: opts.sync !== false });
  return { paymentsVerifiedOn: app.fsjPreVisaPaymentOn, contractSignedOn: app.fsjContractSignedOn, documentsMissing: listMissing(AU_PAIR_PRE_VISA, rows) };
}

/**
 * The gate an Au pair status move must pass, from any screen: onto the visa
 * appointment or past it from before it needs the payments verified, the
 * signed contract and the required pre-visa documents. Null when the move may
 * go ahead.
 */
export async function auPairStatusGate(app: AuPairGateApp, fromCode: string | null | undefined, toCode: string): Promise<{ gate: "VISA"; missing: string[]; why: string } | null> {
  if (!crossesAuPairVisaGate(fromCode, toCode)) return null;
  const facts = await auPairVisaFacts(app);
  const g = auPairVisaGate(facts);
  return g.clear ? null : { gate: "VISA", missing: g.missing, why: `The file is not ready for the visa appointment. ${auPairVisaGateText(facts)}` };
}

/**
 * The fee invoices still open on the student: issued and not paid in full, or
 * written off. The payment verification (step 9) waits on these, as the
 * guide's "all applicable payments completed".
 */
export async function openInvoices(studentId: string) {
  const fi = schema.feeInvoices;
  return db
    .select({ id: fi.id, number: fi.number, state: fi.state, total: fi.total, received: fi.received })
    .from(fi)
    .where(and(eq(fi.studentId, studentId), inArray(fi.state, ["ISSUED", "PART_PAID", "WRITTEN_OFF"])))
    .orderBy(asc(fi.issuedOn));
}

/**
 * The registration address on the Contacts list, where the team edits it.
 * While the list has no row for the area (a database the SQL has not
 * reached), the guide's own address is used.
 */
export async function auPairContacts() {
  const t = schema.teamContacts;
  const rows = await db
    .select({ id: t.id, name: t.name, title: t.title, email: t.email })
    .from(t)
    .where(and(eq(t.area, AU_PAIR_CONTACT_AREA), eq(t.active, true)))
    .orderBy(asc(t.level), asc(t.sortOrder), asc(t.name));
  if (rows.length) return { rows, fromList: true };
  return { rows: AU_PAIR_TEAM.map((c) => ({ id: c.email, name: c.name, title: c.title, email: c.email })), fromList: false };
}

/** Whether a student belongs on the Au pair tab. */
export async function showsAuPairTab(studentId: string) {
  const [row] = await db.select({ yes: isAuPairSql }).from(s).where(eq(s.id, studentId));
  return Boolean(row?.yes);
}

/* ---------------- The tracker ---------------- */

export type AuPairTrackerFilters = { q?: string; org?: string; of?: string; step?: number; team?: AuPairTeam; stuck?: number };

/**
 * One row per Au pair student this person may see: the current application
 * placed on the guide's step, the team that owns it, the days it has sat
 * there, the mentor, the host family and the visa. Students registered for
 * Au pair with no application yet are listed too, as not started.
 */
export async function auPairTrackerRows(user: SessionUser, f: AuPairTrackerFilters, limit = 300) {
  const conds: (SQL | undefined)[] = [studentOrgScope(user), await ownStudentsOnly(user), eq(s.archived, false), isAuPairSql];
  if (f.org) conds.push(eq(s.orgId, f.org));
  if (f.of) conds.push(await ownedByPerson(f.of));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(s.firstName, like), ilike(s.lastName, like), ilike(sql`${s.firstName} || ' ' || ${s.lastName}`, like), ilike(s.medcityId, like), ilike(s.phone, like)));
  }
  const students = await db
    .select({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      medcityId: s.medcityId,
      branch: og.name,
      orgId: s.orgId,
      counsellor: sql<string | null>`coalesce(${us.deskLabel}, ${us.name})`,
      mentor: sql<string | null>`(
        select xu.name from student_people xsp join users xu on xu.id = xsp.user_id
        where xsp.student_id = "students"."id" and xsp.part = ${AU_PAIR_MENTOR_PART} and xu.active
        order by xsp.created_at desc limit 1
      )`,
    })
    .from(s)
    .innerJoin(og, eq(og.id, s.orgId))
    .leftJoin(us, eq(us.id, s.assignedToId))
    .where(and(...conds))
    .orderBy(desc(s.createdAt))
    .limit(1000);
  const ids = students.map((x) => x.id);
  const apps = ids.length ? await openAuPair(inArray(a.studentId, ids)) : [];
  // The first row per student is the current one, by the order above.
  const current = new Map<string, (typeof apps)[number]>();
  for (const app of apps) if (!current.has(app.studentId)) current.set(app.studentId, app);

  const now = new Date();
  let rows = students.map((st) => {
    const app = current.get(st.id) ?? null;
    const step = auPairStepOf(app?.statusCode);
    return { ...st, app, step, team: step?.team ?? null, days: app?.statusSince ? daysBetween(new Date(app.statusSince), now) : null };
  });
  if (f.step) rows = rows.filter((r) => r.step?.step === f.step);
  if (f.team) rows = rows.filter((r) => r.team === f.team);
  if (f.stuck != null) rows = rows.filter((r) => r.days != null && r.days >= f.stuck!);
  rows.sort((x, y) => (x.step?.step ?? 0) - (y.step?.step ?? 0) || (y.days ?? -1) - (x.days ?? -1));
  return rows.slice(0, limit);
}

export type AuPairTrackerRow = Awaited<ReturnType<typeof auPairTrackerRows>>[number];
