import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { runPreSubmissionCheck, type CheckResult } from "@/lib/checks";
import { fullName, intakeLabel } from "@/lib/format";
import { audit } from "@/lib/audit";
import { notifyUsers, partnerRecipients } from "./notify";
import { sendWhatsApp } from "./whatsapp";
import { isAdmin } from "@/lib/permissions";
import { EARNING_CODES, accrueCommission } from "./commission";

export async function statusesFor(pathway: (typeof schema.pathway.enumValues)[number]) {
  return db
    .select()
    .from(schema.statusDefinitions)
    .where(and(eq(schema.statusDefinitions.pathway, pathway), eq(schema.statusDefinitions.active, true)))
    .orderBy(asc(schema.statusDefinitions.sortOrder));
}

export class StatusChangeError extends Error {}

/** Moves an application to a new status, recording history and informing the partner and student. */
export async function changeStatus(user: SessionUser, applicationId: string, toStatusId: string, reason?: string) {
  if (!isAdmin(user)) throw new StatusChangeError("Only the Medcity Overseas team can change status.");

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

  await db.transaction(async (tx) => {
    await tx
      .update(schema.applications)
      .set({ statusId: to.id, statusChangedAt: new Date(), updatedAt: new Date(), officerId: app.officerId ?? user.id })
      .where(eq(schema.applications.id, app.id));
    // Once the team is actively working an application, the student's profile is locked for partners.
    if (!["NEW", "PENDING_PARTNER"].includes(to.group)) {
      await tx.update(schema.students).set({ profileLocked: true }).where(eq(schema.students.id, app.studentId));
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

  if (to.isMilestone && app.student.whatsappOptIn) {
    await sendWhatsApp({
      to: app.student.phone,
      template: "status_milestone",
      body: `Hi ${app.student.firstName}, update on your application to ${app.program.university.name} (${app.program.name}, ${intakeLabel(app.intakeMonth, app.intakeYear)}): ${to.studentLabel}. Reply here if you have questions. Medcity Overseas`,
    });
  }
}

/** Loads everything the pre-submission check needs for one application. */
export async function checkApplication(applicationId: string): Promise<CheckResult[]> {
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, applicationId),
    with: {
      program: true,
      student: { with: { academics: true, tests: true, documents: true } },
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
