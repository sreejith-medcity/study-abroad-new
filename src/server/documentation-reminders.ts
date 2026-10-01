import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { buildAskMessage, reminderFor, type ReminderItem } from "@/lib/ask";
import { EXPIRY_WARNING_DAYS, stageLabel } from "@/lib/journey";
import { autoKeys } from "@/lib/crm";
import { SETTLES_IT, vendorSilence } from "@/lib/desk";
import { raiseTask } from "@/server/tasks";
import { deskIds, notifyUsers, partnerRecipients } from "@/server/notify";
import { outstandingForStudent, portalLink, rowStanding, stageGate, studentChecklist, studentContext } from "@/server/documentation";
import { sendWhatsAppRecorded } from "@/server/whatsapp";

const { checklistItems: ci, students: st } = schema;

export type ReminderRun = {
  nudged: number;
  messagesSent: number;
  escalated: number;
  expiryFlagged: number;
  gatesAnnounced: number;
  tasksRaised: number;
};

/**
 * The chasing nobody should have to remember.
 *
 * Run on a schedule. Every student who has gone quiet gets one message with the
 * same list, shorter; the counsellor is told once when a document has been
 * outstanding a week; a document that runs out before the course starts is
 * flagged once; and whoever owns the next step is told when a gate clears.
 *
 * Nothing here decides anything about a document. It only says what is already
 * true on the file, to whoever needs to hear it.
 */
export async function runDocumentReminders(today = new Date()): Promise<ReminderRun> {
  const run: ReminderRun = { nudged: 0, messagesSent: 0, escalated: 0, expiryFlagged: 0, gatesAnnounced: 0, tasksRaised: 0 };
  const day = today.toISOString().slice(0, 10);

  // Only files with something actually outstanding are looked at.
  const live = await db
    .select({ studentId: ci.studentId })
    .from(ci)
    .where(and(eq(ci.owedBy, "STUDENT"), inArray(ci.state, ["ASKED", "REJECTED"] as const)))
    .groupBy(ci.studentId);

  for (const { studentId } of live) {
    const student = await db.query.students.findFirst({
      where: eq(st.id, studentId),
      with: { org: { columns: { name: true, studentWhatsappMessages: true } } },
    });
    if (!student || student.archived) continue;
    const items = await db.select().from(ci).where(and(eq(ci.studentId, studentId), eq(ci.owedBy, "STUDENT"), inArray(ci.state, ["ASKED", "REJECTED"] as const)));

    const toNudge: string[] = [];
    const toEscalate: { id: string; typeCode: string }[] = [];
    for (const item of items) {
      const verdict = reminderFor(item as ReminderItem, today);
      if (verdict === "NUDGE") toNudge.push(item.id);
      if (verdict === "ESCALATE") toEscalate.push({ id: item.id, typeCode: item.typeCode });
    }

    if (toEscalate.length) {
      await db.update(ci).set({ escalatedAt: today, updatedAt: today }).where(inArray(ci.id, toEscalate.map((x) => x.id)));
      await notifyUsers(
        await partnerRecipients(student.orgId, student.assignedToId),
        `${student.firstName} ${student.lastName} has not sent ${toEscalate.length} document${toEscalate.length === 1 ? "" : "s"}`,
        "Asked for a week ago and nothing back. A call usually works better than another message.",
        `/students/${studentId}/documentation?view=student`,
      );
      // A notice is read once and gone. A task sits on the desk until somebody
      // deals with it, which is the difference between knowing and doing.
      for (const e of toEscalate) {
        const raised = await raiseTask({
          orgId: student.orgId,
          assignedToId: student.assignedToId ?? (await partnerRecipients(student.orgId, null)).filter(Boolean)[0] ?? "",
          studentId,
          kind: "DOCUMENT",
          title: `Chase ${student.firstName} ${student.lastName} for a document`,
          detail: "Asked for a week ago and nothing back. A call usually works better than another message.",
          dueOn: day,
          source: "documents",
          autoKey: autoKeys.documentSilent(e.id),
        });
        if (raised) run.tasksRaised += 1;
      }
      run.escalated += toEscalate.length;
    }

    if (toNudge.length) {
      const locale = student.preferredLanguage === "ml" ? "ml" : "en";
      const outstanding = (await outstandingForStudent(studentId, locale)).filter((i) => toNudge.includes(i.id));
      if (outstanding.length) {
        const body = buildAskMessage(
          {
            firstName: student.firstName,
            branchName: student.org.name,
            link: portalLink(),
            // Whichever of the chased items is wanted soonest is the date to repeat.
            dueOn: outstanding.map((i) => i.dueOn).filter(Boolean).sort()[0] ?? null,
            reminder: true,
            items: outstanding.map((i) => ({ label: i.labelForStudent, reason: i.reasonForStudent })),
          },
          locale,
        );
        const canWhatsApp = student.whatsappOptIn && student.org.studentWhatsappMessages !== false;
        let messageId: string | null = null;
        if (canWhatsApp) {
          const sent = await sendWhatsAppRecorded({ to: student.phone, template: "documents_reminder", body });
          messageId = sent.messageId;
          if (sent.ok) run.messagesSent += 1;
        } else {
          // No channel to the student means the reminder is the counsellor's to make.
          await notifyUsers(
            await partnerRecipients(student.orgId, student.assignedToId),
            `${student.firstName} ${student.lastName} needs chasing for ${outstanding.length} document${outstanding.length === 1 ? "" : "s"}`,
            "There is no WhatsApp channel to this student, so nothing was sent.",
            `/students/${studentId}/documentation/ask`,
          );
        }
        await db.insert(schema.documentRequests).values({
          studentId,
          kind: "NUDGE",
          channel: canWhatsApp ? "WHATSAPP" : "PORTAL",
          locale,
          body,
          dueOn: outstanding.map((i) => i.dueOn).filter(Boolean).sort()[0] ?? null,
          itemCount: outstanding.length,
          sentById: null,
          messageId,
        });
        await db.update(ci).set({ lastChasedAt: today, chaseCount: sql`${ci.chaseCount} + 1`, updatedAt: today }).where(inArray(ci.id, outstanding.map((i) => i.id)));
        run.nudged += outstanding.length;
      }
    }
  }

  // A document that runs out before the course starts, or soon after it does.
  const dated = await db
    .select({ studentId: ci.studentId })
    .from(ci)
    .where(and(eq(ci.state, "ACCEPTED"), isNotNull(ci.validTo), isNull(ci.expiryFlaggedAt)))
    .groupBy(ci.studentId);
  for (const { studentId } of dated) {
    const student = await db.query.students.findFirst({
      where: eq(st.id, studentId),
      columns: { firstName: true, lastName: true, orgId: true, assignedToId: true, archived: true },
    });
    if (!student || student.archived) continue;
    const rows = await studentChecklist(studentId);
    const ctx = await studentContext(studentId);
    // Anything accepted whose date does not reach the course start, or only just
    // does. Flagged once, so the counsellor is not told the same thing daily.
    const trouble = rows.filter((r) => {
      if (r.state !== "ACCEPTED" || !r.validTo || r.expiryFlaggedAt) return false;
      const s = rowStanding(r, ctx.courseStart, today).standing;
      return s === "EXPIRING" || s === "EXPIRED";
    });
    if (!trouble.length) continue;
    await db.update(ci).set({ expiryFlaggedAt: today, updatedAt: today }).where(inArray(ci.id, trouble.map((r) => r.id)));
    await notifyUsers(
      await partnerRecipients(student.orgId, student.assignedToId),
      `${student.firstName} ${student.lastName}: ${trouble.map((r) => r.label).join(", ")} runs out too early`,
      ctx.courseStart
        ? `Measured against the course start. Anything inside ${EXPIRY_WARNING_DAYS} days of it has to be renewed before the visa file goes in.`
        : "No course start is on record, so this is measured against today.",
      `/students/${studentId}/documentation?view=expiring`,
    );
    run.expiryFlagged += trouble.length;
  }

  // A gate that has just come clear, told to whoever owns the next step.
  const staged = await db
    .select({ id: st.id, firstName: st.firstName, lastName: st.lastName, orgId: st.orgId, assignedToId: st.assignedToId, stage: st.journeyStage, noticed: st.gateNoticeStage })
    .from(st)
    .where(and(eq(st.archived, false), or(isNull(st.gateNoticeStage), sql`${st.gateNoticeStage} <> ${st.journeyStage}`)));
  for (const s of staged) {
    const rows = await studentChecklist(s.id);
    if (!rows.length) continue;
    const ctx = await studentContext(s.id);
    const gate = stageGate(rows, s.stage, ctx.courseStart, today);
    if (!gate.clear) continue;
    await db.update(st).set({ gateNoticeStage: s.stage, updatedAt: today }).where(eq(st.id, s.id));
    await notifyUsers(
      await partnerRecipients(s.orgId, s.assignedToId),
      `${s.firstName} ${s.lastName}: ${stageLabel(s.stage)} is clear`,
      "Every required document for this stage is in and accepted. The file can move on.",
      `/students/${s.id}/documentation`,
    );
    const owner = s.assignedToId;
    if (owner) {
      const raised = await raiseTask({
        orgId: s.orgId,
        assignedToId: owner,
        studentId: s.id,
        kind: "APPLICATION",
        title: `${s.firstName} ${s.lastName}: take the next step after ${stageLabel(s.stage)}`,
        detail: "Every required document for this stage is in and accepted.",
        dueOn: day,
        source: "documents",
        autoKey: autoKeys.gateClear(s.id, s.stage),
      });
      if (raised) run.tasksRaised += 1;
    }
    run.gatesAnnounced += 1;
  }

  // A vendor that has said nothing for a week is the desk's to chase, the same
  // way a silent student is the counsellor's.
  const lodged = await db
    .select({
      id: schema.applications.id,
      ackNo: schema.applications.ackNo,
      orgId: schema.applications.orgId,
      studentId: schema.applications.studentId,
      firstName: st.firstName,
      lastName: st.lastName,
      submittedAt: schema.applications.submittedToVendorAt,
      officerId: schema.applications.officerId,
      vendor: schema.vendors.name,
      statusGroup: schema.statusDefinitions.group,
    })
    .from(schema.applications)
    .innerJoin(st, eq(st.id, schema.applications.studentId))
    .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, schema.applications.statusId))
    .leftJoin(schema.programRoutes, eq(schema.programRoutes.id, schema.applications.routeId))
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.programRoutes.vendorId))
    .where(and(eq(schema.applications.deskStage, "SUBMITTED"), isNotNull(schema.applications.submittedToVendorAt)));
  const desk = await deskIds();
  for (const a of lodged) {
    if (a.statusGroup === "CLOSED" || a.statusGroup === "SUCCESS") continue;
    const [latest] = await db
      .select({ at: schema.vendorUpdates.createdAt, outcome: schema.vendorUpdates.outcome })
      .from(schema.vendorUpdates)
      .where(eq(schema.vendorUpdates.applicationId, a.id))
      .orderBy(desc(schema.vendorUpdates.createdAt))
      .limit(1);
    if (latest && SETTLES_IT.includes(latest.outcome)) continue;
    const silence = vendorSilence({ submittedAt: a.submittedAt, lastUpdateAt: latest?.at ?? null, settled: false }, today);
    if (!silence.quiet) continue;
    const since = (latest?.at ?? a.submittedAt ?? today).toISOString().slice(0, 10);
    const raised = await raiseTask({
      orgId: a.orgId,
      assignedToId: a.officerId ?? desk[0] ?? "",
      studentId: a.studentId,
      applicationId: a.id,
      kind: "APPLICATION",
      title: `Chase ${a.vendor ?? "the vendor"} on ${a.ackNo}`,
      detail: `${a.firstName} ${a.lastName}. Nothing heard for ${silence.days} days since ${since}.`,
      dueOn: day,
      source: "the desk",
      autoKey: autoKeys.vendorQuiet(a.id, since),
    });
    if (raised) run.tasksRaised += 1;
  }

  await audit(null, "checklist.reminders", "student", "*", { ...run, via: "scheduled" });
  return run;
}
