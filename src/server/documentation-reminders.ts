import "server-only";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { buildAskMessage, reminderFor, type ReminderItem } from "@/lib/ask";
import { EXPIRY_WARNING_DAYS, stageLabel } from "@/lib/journey";
import { notifyUsers, partnerRecipients } from "@/server/notify";
import { outstandingForStudent, portalLink, rowStanding, stageGate, studentChecklist, studentContext } from "@/server/documentation";
import { sendWhatsAppRecorded } from "@/server/whatsapp";

const { checklistItems: ci, students: st } = schema;

export type ReminderRun = {
  nudged: number;
  messagesSent: number;
  escalated: number;
  expiryFlagged: number;
  gatesAnnounced: number;
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
  const run: ReminderRun = { nudged: 0, messagesSent: 0, escalated: 0, expiryFlagged: 0, gatesAnnounced: 0 };

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
    run.gatesAnnounced += 1;
  }

  await audit(null, "checklist.reminders", "student", "*", { ...run, via: "scheduled" });
  return run;
}
