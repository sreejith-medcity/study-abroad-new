import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { orgScope } from "@/lib/permissions";
import { GERMAN_LEVELS } from "@/lib/ausbildung";
import {
  FSJ_CONTACT_AREA,
  FSJ_STEPS,
  FSJ_TEAM,
  crossesVisaGate,
  daysBetween,
  feeGate,
  feeGateRefusal,
  fsjStepOf,
  isFsjPathway,
  needsFees,
  visaGate,
  visaGateText,
  type FsjDepartment,
  type FsjPathway,
  type VisaFacts,
} from "@/lib/fsj";
import { ownStudentsOnly, ownedByPerson, studentOrgScope } from "@/server/scope";
import { effectivePayments } from "@/lib/fsj-fees";
import { fsjFeeFacts, fsjPaymentsFor, fsjPlanPaymentsFor, type MarkedColumns } from "@/server/fsj-fees";
import { stageGate, studentChecklist, studentContext, syncChecklist } from "@/server/documentation";

const { students: s, applications: a, programs: pg, statusDefinitions: sd, organizations: og, users: us, fsjEvents: fe } = schema;

/*
 * Who this is about: a student registered for FSJ or BFD, or with an
 * application on an FSJ or BFD course. Read from the file every time.
 */
export const isFsjSql = sql<boolean>`(
  "students"."preferred_pathway" in ('FSJ', 'BFD')
  or exists (select 1 from applications xa join programs xp on xp.id = xa.program_id where xa.student_id = "students"."id" and xp.pathway in ('FSJ', 'BFD'))
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
  handedOverAt: a.handedOverAt,
  registrationFeePaidOn: a.fsjRegistrationFeePaidOn,
  agreementSignedOn: a.fsjAgreementSignedOn,
  applicationFeePaidOn: a.fsjApplicationFeePaidOn,
  offerPaymentOn: a.fsjOfferPaymentOn,
  preVisaPaymentOn: a.fsjPreVisaPaymentOn,
  applicationStartedOn: a.fsjApplicationStartedOn,
  languageLevel: a.fsjLanguageLevel,
  languageResult: a.fsjLanguageResult,
  languageAssessedOn: a.fsjLanguageAssessedOn,
  employer: a.fsjEmployer,
  interviewAt: a.fsjInterviewAt,
  interviewLink: a.fsjInterviewLink,
  responsibilities: a.fsjResponsibilities,
  requirements: a.fsjRequirements,
  feedback: a.fsjFeedback,
  offerOn: a.fsjOfferOn,
  contractSignedOn: a.fsjContractSignedOn,
  vfsSlotOn: a.fsjVfsSlotOn,
  visaLodgedOn: a.visaLodgedOn,
  visaDecision: a.visaDecision,
  visaDecisionOn: a.visaDecisionOn,
  visaReason: a.fsjVisaReason,
  joiningOn: a.fsjJoiningOn,
  departedOn: a.fsjDepartedOn,
  done: a.fsjDone,
};

/**
 * The student's current FSJ or BFD application, with everything the process
 * keeps on it: the open one that moved most recently, a finished one giving
 * way to one still being worked. The tab, the actions and the tracker all read
 * this one, so a button acts on the file the tab describes.
 *
 * The four payment days are the ones the process works from: read from the
 * student's fee invoices for each stage their fee plan covers, and as marked
 * on the tab otherwise. The days marked by hand are kept in `marked`, and what
 * the plan holds per stage in `feePlan`.
 */
export async function currentFsjApplication(studentId: string) {
  const row = await currentFsjRow(studentId);
  if (!row) return null;
  const marked = {
    registrationFeePaidOn: row.registrationFeePaidOn,
    applicationFeePaidOn: row.applicationFeePaidOn,
    offerPaymentOn: row.offerPaymentOn,
    preVisaPaymentOn: row.preVisaPaymentOn,
  };
  const feePlan = await fsjPlanPaymentsFor(studentId);
  const { source, ...paid } = effectivePayments(marked, feePlan);
  return { ...row, ...paid, marked, feePlan, paymentSource: source };
}

async function currentFsjRow(studentId: string) {
  const [row] = await db
    .select(appColumns)
    .from(a)
    .innerJoin(pg, eq(pg.id, a.programId))
    .innerJoin(sd, eq(sd.id, a.statusId))
    .where(and(eq(a.studentId, studentId), inArray(pg.pathway, ["FSJ", "BFD"]), sql`${sd.group} <> 'CLOSED'`))
    .orderBy(sql`(${sd.group} = 'SUCCESS') asc`, desc(a.statusChangedAt))
    .limit(1);
  return row ?? null;
}

export type FsjApplication = NonNullable<Awaited<ReturnType<typeof currentFsjApplication>>>;

/** Every recorded moment on one application, newest first. */
export async function fsjEventsOf(applicationId: string) {
  return db
    .select({
      id: fe.id,
      kind: fe.kind,
      step: fe.step,
      outcome: fe.outcome,
      level: fe.level,
      employer: fe.employer,
      at: fe.at,
      on: fe.on,
      link: fe.link,
      detail: fe.detail,
      createdAt: fe.createdAt,
      by: us.name,
    })
    .from(fe)
    .leftJoin(us, eq(us.id, fe.createdById))
    .where(eq(fe.applicationId, applicationId))
    .orderBy(desc(fe.createdAt), desc(fe.id));
}

/** The outcome kept on a visa decision when the employer withdrew and the file went back to interview preparation. */
export const EMPLOYER_WITHDRAWN = "EMPLOYER_WITHDRAWN";

/**
 * The employers that returned "not selected" on this application, or withdrew
 * after a visa refusal, so they are not asked again.
 */
export async function notSelectedBy(applicationId: string) {
  const rows = await db
    .select({ employer: fe.employer })
    .from(fe)
    .where(and(eq(fe.applicationId, applicationId), or(and(eq(fe.kind, "FEEDBACK"), eq(fe.outcome, "NOT_SELECTED")), and(eq(fe.kind, "VISA_DECISION"), eq(fe.outcome, EMPLOYER_WITHDRAWN)))));
  return rows.map((r) => r.employer).filter((e): e is string => !!e);
}

/** An application's columns the status gates read. */
export type FsjGateApp = MarkedColumns & { studentId: string; fsjContractSignedOn: string | null };

/** The gate columns of the current FSJ / BFD application, as the tab and the step actions hold it. */
export const gateAppOf = (app: Pick<FsjApplication, "studentId" | "marked" | "contractSignedOn">): FsjGateApp => ({
  studentId: app.studentId,
  fsjRegistrationFeePaidOn: app.marked.registrationFeePaidOn,
  fsjApplicationFeePaidOn: app.marked.applicationFeePaidOn,
  fsjOfferPaymentOn: app.marked.offerPaymentOn,
  fsjPreVisaPaymentOn: app.marked.preVisaPaymentOn,
  fsjContractSignedOn: app.contractSignedOn,
});

/**
 * What the visa gate reads: the pre-visa payment as the process works from it
 * (the fee invoice where the fee plan has one, otherwise the day marked), the
 * signed contract, and the profile documents still missing on the checklist,
 * the same list the branch's hand-over waits on.
 */
export async function fsjVisaFacts(app: FsjGateApp, opts: { sync?: boolean } = {}): Promise<VisaFacts> {
  const pay = await fsjPaymentsFor(app.studentId, app);
  // A screen only reads the checklist; a status move brings it up to date first.
  if (opts.sync !== false) await syncChecklist(app.studentId);
  const rows = await studentChecklist(app.studentId);
  const profileMissing = rows.length ? stageGate(rows, "PROFILE", (await studentContext(app.studentId)).courseStart).missing.map((m) => m.label) : [];
  return { preVisaPaymentOn: pay.preVisaPaymentOn, preVisaSettled: pay.settled.preVisa, contractSignedOn: app.fsjContractSignedOn, profileMissing };
}

/**
 * The gates an FSJ / BFD status move must pass, from any screen: the fee gate
 * (step 6) for every started-application status, and the visa gate (step 12)
 * for a move onto the VFS submission or past it from before it. Null when the
 * move may go ahead; otherwise which gate refused it, what is missing and why.
 */
export async function fsjStatusGate(app: FsjGateApp, fromCode: string | null | undefined, toCode: string): Promise<{ gate: "FEES" | "VISA"; missing: string[]; why: string } | null> {
  if (needsFees(toCode)) {
    const g = feeGate(await fsjFeeFacts(app.studentId, app));
    if (!g.clear) return { gate: "FEES", missing: g.missing, why: feeGateRefusal(g.missing) };
  }
  if (crossesVisaGate(fromCode, toCode)) {
    const facts = await fsjVisaFacts(app);
    const g = visaGate(facts);
    if (!g.clear) return { gate: "VISA", missing: g.missing, why: `The visa file is not ready for VFS. ${visaGateText(facts)}` };
  }
  return null;
}

/** Active staff in these roles, for telling a department. */
export async function roleIds(roles: readonly string[]) {
  const rows = await db
    .select({ id: us.id })
    .from(us)
    .where(and(inArray(us.role, [...roles] as (typeof us.role.enumValues)[number][]), eq(us.active, true)));
  return rows.map((r) => r.id);
}

/** The branch head(s) of a branch: the branch owner accounts, active, with their email. */
export async function branchHeads(orgId: string) {
  return db
    .select({ id: us.id, name: us.name, email: us.email })
    .from(us)
    .where(and(eq(us.orgId, orgId), eq(us.role, "PARTNER"), eq(us.active, true)))
    .orderBy(asc(us.name));
}

/**
 * The facts the hand-over and the email drafts read off the student: the
 * parent's number from the contacts, the current German level from the German
 * record or the latest German test, the gap, the counsellor and the branch.
 */
export async function fsjStudentFacts(studentId: string) {
  const student = await db.query.students.findFirst({
    where: eq(s.id, studentId),
    with: { org: { columns: { name: true } }, assignedTo: { columns: { id: true, name: true, email: true, phone: true } } },
  });
  if (!student) return null;
  const [contacts, modules, tests, heads] = await Promise.all([
    db.select({ relation: schema.studentContacts.relation, phone: schema.studentContacts.phone }).from(schema.studentContacts).where(eq(schema.studentContacts.studentId, studentId)),
    db.select({ level: schema.germanModules.level, state: schema.germanModules.state }).from(schema.germanModules).where(eq(schema.germanModules.studentId, studentId)),
    db
      .select({ overall: schema.testScores.overall, takenOn: schema.testScores.takenOn })
      .from(schema.testScores)
      .where(and(eq(schema.testScores.studentId, studentId), eq(schema.testScores.test, "GERMAN"), eq(schema.testScores.isMock, false), eq(schema.testScores.state, "TAKEN")))
      .orderBy(desc(schema.testScores.takenOn)),
    branchHeads(student.orgId),
  ]);
  const parent = contacts.find((c) => c.phone && /father|mother|parent|guardian/i.test(c.relation));
  const completed = GERMAN_LEVELS.filter((l) => modules.some((m) => m.level === l && m.state === "COMPLETED"));
  const germanLevel = completed.length ? completed[completed.length - 1] : (tests.find((t) => t.overall)?.overall ?? null);
  return {
    student,
    parentPhone: parent?.phone ?? null,
    germanLevel,
    gapRecorded: student.gapYears != null,
    gap: student.gapYears != null ? `${student.gapYears} ${student.gapYears === 1 ? "year" : "years"}` : null,
    counsellor: student.assignedTo ?? null,
    branch: student.org.name,
    heads,
  };
}

/**
 * The registration addresses on the Contacts list, where the team edits them.
 * While the list has no row for the area (a database the SQL has not reached),
 * the guide's own addresses are used.
 */
export async function fsjContacts() {
  const t = schema.teamContacts;
  const rows = await db
    .select({ id: t.id, name: t.name, title: t.title, email: t.email })
    .from(t)
    .where(and(eq(t.area, FSJ_CONTACT_AREA), eq(t.active, true)))
    .orderBy(asc(t.level), asc(t.sortOrder), asc(t.name));
  if (rows.length) return { rows, fromList: true };
  return { rows: FSJ_TEAM.map((c) => ({ id: c.email, name: c.name, title: c.title, email: c.email })), fromList: false };
}

/** The German record (A1 to B2, one row per level), for the counsellor's step 1 details on the tab. */
export async function germanRecord(studentId: string) {
  const gm = schema.germanModules;
  return db.select({ level: gm.level, state: gm.state, completedOn: gm.completedOn }).from(gm).where(eq(gm.studentId, studentId));
}

/** Whether a student belongs on the FSJ / BFD tab. */
export async function showsFsjTab(studentId: string) {
  const [row] = await db.select({ fsj: isFsjSql }).from(s).where(eq(s.id, studentId));
  return Boolean(row?.fsj);
}

/* ---------------- The tracker ---------------- */

export type FsjTrackerFilters = {
  q?: string;
  org?: string;
  /** One person's own students, by the rule their students list applies, the way a dashboard figure links here. */
  of?: string;
  step?: number;
  dept?: FsjDepartment;
  /** At the current step for at least this many days: the reader's own number, not a rule. */
  stuck?: number;
  programme?: FsjPathway;
  /** On hold for the application fee. */
  hold?: boolean;
};

/**
 * One row per FSJ / BFD student this person may see: the current application
 * placed on the guide's step, its owner department and the days it has sat
 * there, the language result, the interview and the visa. Students registered
 * for FSJ or BFD with no application yet are listed too, as not started.
 */
export async function fsjTrackerRows(user: SessionUser, f: FsjTrackerFilters, limit = 300) {
  const conds: (SQL | undefined)[] = [studentOrgScope(user), await ownStudentsOnly(user), eq(s.archived, false), isFsjSql];
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
      preferredPathway: s.preferredPathway,
      registeredAt: s.createdAt,
      branch: og.name,
      orgId: s.orgId,
      counsellor: sql<string | null>`coalesce(${us.deskLabel}, ${us.name})`,
    })
    .from(s)
    .innerJoin(og, eq(og.id, s.orgId))
    .leftJoin(us, eq(us.id, s.assignedToId))
    .where(and(...conds))
    .orderBy(desc(s.createdAt))
    .limit(1000);
  const ids = students.map((x) => x.id);
  const apps = ids.length
    ? await db
        .select(appColumns)
        .from(a)
        .innerJoin(pg, eq(pg.id, a.programId))
        .innerJoin(sd, eq(sd.id, a.statusId))
        .where(and(inArray(a.studentId, ids), inArray(pg.pathway, ["FSJ", "BFD"]), sql`${sd.group} <> 'CLOSED'`))
        .orderBy(sql`(${sd.group} = 'SUCCESS') asc`, desc(a.statusChangedAt))
    : [];
  // The first row per student is the current one, by the order above.
  const current = new Map<string, (typeof apps)[number]>();
  for (const app of apps) if (!current.has(app.studentId)) current.set(app.studentId, app);

  const now = new Date();
  let rows = students.map((st) => {
    const app = current.get(st.id) ?? null;
    const step = fsjStepOf(app?.statusCode);
    return {
      ...st,
      app,
      programme: (app?.pathway && isFsjPathway(app.pathway) ? app.pathway : isFsjPathway(st.preferredPathway) ? st.preferredPathway : null) as FsjPathway | null,
      step,
      department: step?.department ?? null,
      days: app?.statusSince ? daysBetween(new Date(app.statusSince), now) : null,
    };
  });
  if (f.programme) rows = rows.filter((r) => r.programme === f.programme);
  if (f.step) rows = rows.filter((r) => r.step?.step === f.step);
  if (f.dept) rows = rows.filter((r) => r.department === f.dept);
  if (f.stuck != null) rows = rows.filter((r) => r.days != null && r.days >= f.stuck!);
  if (f.hold) rows = rows.filter((r) => r.app?.statusCode === "APPLICATION_ON_HOLD");
  // The longest-waiting first within a step filter reads best; otherwise by step, then days.
  rows.sort((x, y) => (x.step?.step ?? 0) - (y.step?.step ?? 0) || (y.days ?? -1) - (x.days ?? -1));
  return rows.slice(0, limit);
}

export type FsjTrackerRow = Awaited<ReturnType<typeof fsjTrackerRows>>[number];

/** The step codes a department owns, for counting. */
export const departmentCodes = (dept: FsjDepartment) => FSJ_STEPS.filter((st) => st.department === dept).flatMap((st) => st.statusCodes);

/**
 * The figures for the placements card: FSJ / BFD students, files at the
 * language assessment, applications on hold for the fee, files at the
 * interview and employer stage and files with the visa team. Read through the tracker's own rows, so a figure
 * is exactly the list its link opens.
 */
export async function fsjFigures(user: SessionUser, scope: { org?: string; of?: string }) {
  const rows = await fsjTrackerRows(user, scope, 1000);
  const at = (codes: string[]) => rows.filter((r) => r.app && codes.includes(r.app.statusCode)).length;
  return {
    students: rows.length,
    language: rows.filter((r) => r.step?.step === 5).length,
    onHold: at(["APPLICATION_ON_HOLD"]),
    interview: rows.filter((r) => r.department === "INTERVIEW").length,
    visa: rows.filter((r) => r.department === "VISA").length,
  };
}

/** The branches the tracker can be narrowed to, for this user. */
export async function fsjBranchChoices(user: SessionUser) {
  return db
    .select({ id: og.id, name: og.name })
    .from(og)
    .where(and(orgScope(user, og.id), sql`${og.type} <> 'HQ'`, eq(og.active, true)))
    .orderBy(asc(og.name));
}
