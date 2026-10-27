import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { runPreSubmissionCheck, type CheckResult } from "@/lib/checks";
import { fullName, intakeLabel } from "@/lib/format";
import { audit } from "@/lib/audit";
import { documentationIds, notifyUsers, partnerRecipients } from "./notify";
import { sendWhatsApp } from "./whatsapp";
import { isAdmin, isDocumentationTeam } from "@/lib/permissions";
import { handedToDeskByStatus, stepOfStatus } from "@/lib/ausbildung";
import { fsjPastBranch, fsjStepOf, isFsjPathway, needsFees } from "@/lib/fsj";
import { raiseAusbildungInstalments, raiseFsjInstalments } from "@/server/student-fees";
import { fsjStatusGate } from "@/server/fsj";
import { auPairPastBranch } from "@/lib/au-pair";
import { auPairStatusGate } from "@/server/au-pair";
import { EARNING_CODES, accrueCommission } from "./commission";
import { sendStatusChange } from "@/server/crm-out";
import { updateTracked } from "@/server/record-history";

export async function statusesFor(pathway: (typeof schema.pathway.enumValues)[number]) {
  return db
    .select()
    .from(schema.statusDefinitions)
    .where(and(eq(schema.statusDefinitions.pathway, pathway), eq(schema.statusDefinitions.active, true)))
    .orderBy(asc(schema.statusDefinitions.sortOrder));
}

export class StatusChangeError extends Error {}

/** Moves an application to a new status, recording history and informing the partner and student. */
/**
 * Moves one application's status.
 *
 * Normally an admin's job. The documentation team may move it too, but only as
 * part of recording what a vendor came back with: they are the desk, so an offer
 * they have just read should not wait for somebody else to type it in. They
 * still cannot move a status freely from the status screen.
 */
export async function changeStatus(
  user: SessionUser,
  applicationId: string,
  toStatusId: string,
  reason?: string,
  opts: { viaVendorUpdate?: boolean; viaMentor?: boolean; viaFsj?: boolean; viaAuPair?: boolean } = {},
) {
  // The documentation desk also moves an Ausbildung file to "Mentor assigned"
  // when it names the mentor: the guide gives that step to the desk, and the
  // mentor field is the one place it is recorded.
  // An FSJ / BFD step recorded on the student's FSJ tab moves the status as
  // part of it, by whichever department owns that step; the step's own action
  // has already checked who may record it (mayDo in src/lib/fsj.ts). The same
  // for an Au pair step on the Au pair tab (mayDoAuPair in src/lib/au-pair.ts).
  const allowed = isAdmin(user) || (isDocumentationTeam(user) && (opts.viaVendorUpdate === true || opts.viaMentor === true)) || opts.viaFsj === true || opts.viaAuPair === true;
  if (!allowed) throw new StatusChangeError("Only the Medcity Overseas team can change status.");

  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, applicationId),
    with: { status: true, student: true, program: { with: { university: true } } },
  });
  if (!app) throw new StatusChangeError("Application not found.");

  const to = await db.query.statusDefinitions.findFirst({ where: eq(schema.statusDefinitions.id, toStatusId) });
  if (!to) throw new StatusChangeError("Status not found.");
  if (to.pathway !== app.status.pathway) throw new StatusChangeError("That status belongs to a different pathway.");
  if (to.id === app.statusId) return;
  if (to.requiresReason && !reason?.trim()) throw new StatusChangeError(`A reason is required for "${to.label}".`);

  // An Ausbildung file moved to the mentor's step or past it is with the
  // documentation desk, whoever moved it, so it is handed over here if the
  // branch never pressed the button: the desk can only open a handed-over file.
  const fsj = isFsjPathway(app.program.pathway);
  const auPair = app.program.pathway === "AU_PAIR";
  const handsOver =
    !app.handedOverAt && ((app.program.pathway === "AUSBILDUNG" && handedToDeskByStatus(to.code)) || (fsj && fsjPastBranch(to.code)) || (auPair && auPairPastBranch(to.code)));

  // The FSJ / BFD gates, from any screen (the FSJ tab, the status picker, the
  // bulk import). The fee gate (step 6): the application does not start until
  // the registration and application fees are paid, by their fee invoices
  // where the student has a fee plan for the process, otherwise as marked paid
  // on the FSJ / BFD tab. The visa gate (step 12): the file does not go to VFS
  // without the pre-visa payment, the signed contract and the profile
  // documents. An admin may move a file past the visa gate from the status
  // picker or an import by giving the reason; the override is audited.
  let visaOverride: string[] | null = null;
  if (fsj) {
    const refusal = await fsjStatusGate(app, app.status.code, to.code);
    if (refusal?.gate === "FEES") throw new StatusChangeError(refusal.why);
    if (refusal?.gate === "VISA") {
      const mayOverride = isAdmin(user) && !opts.viaFsj;
      if (!mayOverride || !reason?.trim()) {
        throw new StatusChangeError(mayOverride ? `${refusal.why} To move it anyway, give the reason for the override; it is recorded in the audit log.` : refusal.why);
      }
      visaOverride = refusal.missing;
    }
  }
  // The Au pair gate before the visa appointment (step 10): the payments
  // verified, the signed host family contract and the required pre-visa
  // documents. An admin may override it from the status picker or an import
  // with a reason, as for FSJ / BFD; the override is audited.
  let auPairOverride: string[] | null = null;
  if (auPair) {
    const refusal = await auPairStatusGate({ studentId: app.studentId, fsjPreVisaPaymentOn: app.fsjPreVisaPaymentOn, fsjContractSignedOn: app.fsjContractSignedOn }, app.status.code, to.code);
    if (refusal) {
      const mayOverride = isAdmin(user) && !opts.viaAuPair;
      if (!mayOverride || !reason?.trim()) {
        throw new StatusChangeError(mayOverride ? `${refusal.why} To move it anyway, give the reason for the override; it is recorded in the audit log.` : refusal.why);
      }
      auPairOverride = refusal.missing;
    }
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    await updateTracked(
      "application",
      app.id,
      {
        statusId: to.id,
        statusChangedAt: now,
        updatedAt: now,
        // The first person on the processing desk (an admin or the
        // documentation team) to move the file becomes its officer, as before
        // the FSJ / BFD steps let others move it. A branch, or a desk
        // counsellor, recording an FSJ / BFD step of its own is not one.
        officerId: app.officerId ?? (isAdmin(user) || isDocumentationTeam(user) ? user.id : null),
        ...(handsOver ? { handedOverAt: now, handedOverById: user.id } : {}),
        // Moved onto a started-application status with both fees in (the
        // gate above), from the status picker or an import rather than the
        // payment check: the application has started, so the interview step
        // does not wait on a payment check the file has already passed.
        ...(fsj && needsFees(to.code) && !app.fsjApplicationStartedOn ? { fsjApplicationStartedOn: now.toISOString().slice(0, 10) } : {}),
      },
      { by: user.id, action: "application.status", tx },
    );
    // Once the team is actively working an application, the student's profile is locked for partners.
    if (!["NEW", "PENDING_PARTNER"].includes(to.group)) {
      await updateTracked("student", app.studentId, { profileLocked: true }, { by: user.id, action: "student.lock", tx });
    }
    await tx.insert(schema.statusHistory).values({
      applicationId: app.id,
      fromStatusId: app.statusId,
      toStatusId: to.id,
      reason: reason?.trim() || null,
      changedById: user.id,
    });
    await tx.insert(schema.comments).values({
      applicationId: app.id,
      channel: "TEAM",
      source: "SYSTEM",
      body: `Status changed from "${app.status.label}" to "${to.label}"${reason ? `. Reason: ${reason.trim()}` : ""}`,
      authorId: user.id,
    });
  });

  const title = `${app.ackNo}: ${to.label}`;
  const href = `/students/${app.studentId}/applications?app=${app.id}`;
  await notifyUsers(await partnerRecipients(app.orgId, app.student.assignedToId), title, fullName(app.student), href);
  await audit(user.id, "application.status", "application", app.id, { from: app.status.code, to: to.code, reason });
  if (visaOverride) await audit(user.id, "fsj.visa_gate_override", "application", app.id, { from: app.status.code, to: to.code, missing: visaOverride, reason: reason?.trim() });
  if (auPairOverride) await audit(user.id, "au_pair.visa_gate_override", "application", app.id, { from: app.status.code, to: to.code, missing: auPairOverride, reason: reason?.trim() });
  if (handsOver) {
    await audit(user.id, "application.handover", "application", app.id, { via: "status", to: to.code });
    if (fsj) await tellDeskFsjArrived({ studentId: app.studentId, student: fullName(app.student), branch: app.orgId, because: `moved to ${to.label}` });
    else if (auPair) await tellDeskAuPairArrived({ studentId: app.studentId, student: fullName(app.student), branch: app.orgId, because: `moved to ${to.label}` });
    else await tellDeskAusbildungArrived({ studentId: app.studentId, student: fullName(app.student), branch: app.orgId, because: `moved to ${to.label}` });
  }
  await sendStatusChange(app.id, {
    ackNo: app.ackNo,
    studentId: app.studentId,
    medcityId: app.student.medcityId,
    crmId: app.student.crmId,
    student: fullName(app.student),
    from: app.status.code,
    to: to.code,
    statusLabel: to.label,
    group: to.group,
    reason: reason ?? null,
  });

  // An Ausbildung file at a step of the guide: fee instalments tied to that
  // step, or to one before it, fall due now.
  const guideStep = app.program.pathway === "AUSBILDUNG" ? stepOfStatus(to.code) : null;
  if (guideStep) await raiseAusbildungInstalments(app.studentId, guideStep.step, user.id);
  // The same for an FSJ or BFD file at a step of its written process.
  const fsjStep = fsj ? fsjStepOf(to.code) : null;
  if (fsjStep) await raiseFsjInstalments(app.studentId, fsjStep.step, user.id);

  // A placement that reached a paying milestone accrues its commission once.
  if (EARNING_CODES.includes(to.code)) {
    const commission = await accrueCommission(app.id);
    if (commission) {
      await audit(user.id, "commission.accrue", "commission", commission.id, {
        applicationId: app.id,
        gross: commission.grossAmount,
        partner: commission.partnerAmount,
      });
    }
  }

  const branch = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, app.orgId), columns: { studentWhatsappMilestones: true } });
  if (to.isMilestone && app.student.whatsappOptIn && branch?.studentWhatsappMilestones !== false) {
    await sendWhatsApp({
      to: app.student.phone,
      template: "status_milestone",
      body: `Hi ${app.student.firstName}, update on your application to ${app.program.university.name} (${app.program.name}, ${intakeLabel(app.intakeMonth, app.intakeYear)}): ${to.studentLabel}. Reply here if you have questions. Medcity Overseas`,
    });
  }
}

/**
 * Tells the documentation desk that an Ausbildung file has reached it.
 *
 * Sent at the hand-over, whether the branch pressed the button or somebody
 * moved the status to the desk's first step, because that is the first moment
 * the desk can open the student: before it the desk hears nothing about the
 * file. The link goes to the Ausbildung tab, where the mentor is named.
 */
export async function tellDeskAusbildungArrived(args: { studentId: string; student: string; branch: string; because: string }) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, args.branch), columns: { name: true } });
  await notifyUsers(
    await documentationIds(),
    `${args.student}: Ausbildung file handed to the documentation desk`,
    `From ${org?.name ?? "the branch"}, ${args.because}. Name the mentor on the Ausbildung tab.`,
    `/students/${args.studentId}/ausbildung`,
  );
}

/**
 * Tells the documentation team that an FSJ / BFD file has reached it: the
 * branch's hand-over at the end of document collection (step 3), or a status
 * moved to the cross-check or later. The link goes to the FSJ / BFD tab.
 */
export async function tellDeskFsjArrived(args: { studentId: string; student: string; branch: string; because: string }) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, args.branch), columns: { name: true } });
  await notifyUsers(
    await documentationIds(),
    `${args.student}: FSJ / BFD file handed to the documentation team`,
    `From ${org?.name ?? "the branch"}, ${args.because}. The document cross-check (step 4) is next.`,
    `/students/${args.studentId}/fsj`,
  );
}

/**
 * Tells the documentation department that an Au pair file has reached it: the
 * branch's hand-over at the end of document collection (step 3), or a status
 * moved to the mentor's step or later. The link goes to the Au pair tab, where
 * the mentor is assigned.
 */
export async function tellDeskAuPairArrived(args: { studentId: string; student: string; branch: string; because: string }) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, args.branch), columns: { name: true } });
  await notifyUsers(
    await documentationIds(),
    `${args.student}: Au pair file handed to the documentation department`,
    `From ${org?.name ?? "the branch"}, ${args.because}. Assign the mentor (step 4) on the Au pair tab.`,
    `/students/${args.studentId}/au-pair`,
  );
}

/** Loads everything the pre-submission check needs for one application. */
export async function checkApplication(applicationId: string): Promise<CheckResult[]> {
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, applicationId),
    with: {
      program: true,
      // Only files still in use answer "has the student given us one of these".
      student: { with: { academics: true, tests: true, documents: { where: (d, { and, isNull }) => and(isNull(d.supersededAt), isNull(d.removedAt)) } } },
    },
  });
  if (!app) return [];
  const types = await db.select().from(schema.documentTypes);
  const labels = Object.fromEntries(types.map((t) => [t.code, t.label]));
  const s = app.student;
  return runPreSubmissionCheck(
    {
      ...s,
      academics: s.academics,
      tests: s.tests,
      documentTypeCodes: s.documents.map((d) => d.typeCode).filter((c): c is string => !!c),
    },
    app.program,
    { month: app.intakeMonth, year: app.intakeYear },
    labels,
  );
}
