import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { byNewest, CHANNEL_LABEL, OUTCOME_LABEL, TASK_KIND_LABEL, type TimelineEntry } from "@/lib/crm";
import { OUTCOME_LABEL as VENDOR_OUTCOME_LABEL } from "@/lib/desk";
import { stageLabel, STATE_LABEL } from "@/lib/journey";
import type { JourneyStage } from "@/db/schema";
import { fmtMoney, intakeLabel } from "@/lib/format";

/**
 * One student's whole story, in one feed.
 *
 * Assembled from what is already recorded rather than written twice: there is no
 * timeline table, because a second copy of the truth is a second thing to go
 * wrong. Every row names who did it, so a counsellor picking up somebody else's
 * file can read it top to bottom and know where they are.
 */
export async function studentTimeline(studentId: string, limit = 120): Promise<TimelineEntry[]> {
  const who = (u: { name: string; deskLabel?: string | null } | null | undefined) => (u ? (u.deskLabel ?? u.name) : null);
  const entries: TimelineEntry[] = [];

  const [contacts, documents, items, requests, apps, tasks, payments] = await Promise.all([
    db.query.contactLog.findMany({
      where: eq(schema.contactLog.studentId, studentId),
      with: { by: { columns: { name: true, deskLabel: true } } },
      orderBy: desc(schema.contactLog.happenedAt),
      limit: 60,
    }),
    db.query.documents.findMany({
      where: eq(schema.documents.studentId, studentId),
      with: { uploadedBy: { columns: { name: true, deskLabel: true } }, type: { columns: { label: true } } },
      orderBy: desc(schema.documents.createdAt),
      limit: 60,
    }),
    db.query.checklistItems.findMany({
      where: eq(schema.checklistItems.studentId, studentId),
      with: { type: { columns: { label: true } }, decidedBy: { columns: { name: true, deskLabel: true } }, reasonPicked: { columns: { label: true } } },
      limit: 120,
    }),
    db.query.documentRequests.findMany({
      where: eq(schema.documentRequests.studentId, studentId),
      with: { sentBy: { columns: { name: true, deskLabel: true } } },
      orderBy: desc(schema.documentRequests.createdAt),
      limit: 30,
    }),
    db.query.applications.findMany({
      where: eq(schema.applications.studentId, studentId),
      with: {
        program: { columns: { name: true }, with: { university: { columns: { name: true } } } },
        createdBy: { columns: { name: true, deskLabel: true } },
        handedOverBy: { columns: { name: true, deskLabel: true } },
        submittedBy: { columns: { name: true, deskLabel: true } },
        route: { with: { vendor: { columns: { name: true, code: true } } } },
        history: { with: { toStatus: { columns: { label: true } }, changedBy: { columns: { name: true, deskLabel: true } } }, orderBy: desc(schema.statusHistory.createdAt) },
        vendorUpdates: { with: { recordedBy: { columns: { name: true, deskLabel: true } } }, orderBy: desc(schema.vendorUpdates.createdAt) },
      },
    }),
    db.query.tasks.findMany({
      where: eq(schema.tasks.studentId, studentId),
      with: { assignedTo: { columns: { name: true, deskLabel: true } }, doneBy: { columns: { name: true, deskLabel: true } } },
      orderBy: desc(schema.tasks.createdAt),
      limit: 40,
    }),
    // Payments hang off the application rather than the student, so they are
    // read through the student's own applications.
    db
      .select({ id: schema.payments.id, purpose: schema.payments.purpose, amountMinor: schema.payments.amountMinor, currency: schema.payments.currency, paidAt: schema.payments.paidAt })
      .from(schema.payments)
      .innerJoin(schema.applications, eq(schema.applications.id, schema.payments.applicationId))
      .where(and(eq(schema.applications.studentId, studentId), eq(schema.payments.status, "PAID")))
      .orderBy(desc(schema.payments.paidAt))
      .limit(20),
  ]);

  for (const c of contacts) {
    entries.push({
      id: `contact-${c.id}`,
      at: c.happenedAt,
      kind: "CONTACT",
      title: `${CHANNEL_LABEL[c.channel]}${c.inbound ? " in" : ""}: ${OUTCOME_LABEL[c.outcome]}`,
      detail: [c.note, c.nextActionOn ? `Next: ${c.nextActionNote ?? "follow up"} on ${c.nextActionOn}` : null].filter(Boolean).join(" · ") || null,
      who: who(c.by),
    });
  }

  for (const d of documents) {
    entries.push({
      id: `doc-${d.id}`,
      at: d.createdAt,
      kind: "DOCUMENT",
      title: `${d.type?.label ?? d.fileName} uploaded`,
      detail: d.fileName,
      who: who(d.uploadedBy),
      href: `/api/documents/${d.id}`,
    });
  }

  for (const i of items) {
    // Only what somebody decided shows here: a list of everything not yet asked
    // for is the documentation tab's job, not the story of the file.
    if (i.decidedAt && (i.state === "ACCEPTED" || i.state === "REJECTED" || i.state === "NOT_NEEDED")) {
      entries.push({
        id: `item-${i.id}`,
        at: i.decidedAt,
        kind: "CHECKLIST",
        title: `${i.type.label}: ${STATE_LABEL[i.state].toLowerCase()}`,
        detail: [i.reasonPicked?.label, i.reason].filter(Boolean).join(". ") || null,
        who: who(i.decidedBy),
      });
    }
    if (i.askedAt) {
      entries.push({
        id: `asked-${i.id}`,
        at: i.askedAt,
        kind: "CHECKLIST",
        title: `${i.type.label} asked for`,
        detail: i.askedChannel ? `on ${i.askedChannel}` : null,
        who: null,
      });
    }
  }

  for (const r of requests) {
    entries.push({
      id: `req-${r.id}`,
      at: r.createdAt,
      kind: "REQUEST",
      title: `${r.kind === "NUDGE" ? "Reminder" : "Asked"} for ${r.itemCount} document${r.itemCount === 1 ? "" : "s"}`,
      detail: `${r.channel === "WHATSAPP" ? "WhatsApp" : "Portal only"}${r.locale === "ml" ? ", in Malayalam" : ""}${r.dueOn ? `, wanted by ${r.dueOn}` : ""}`,
      who: who(r.sentBy) ?? "the portal itself",
    });
  }

  for (const a of apps) {
    const name = `${a.program.name}, ${a.program.university.name}`;
    entries.push({
      id: `app-${a.id}`,
      at: a.createdAt,
      kind: "APPLICATION",
      title: `Application created: ${name}`,
      detail: `${a.ackNo}, ${intakeLabel(a.intakeMonth, a.intakeYear)}`,
      who: who(a.createdBy),
      href: `/students/${studentId}/applications?app=${a.id}`,
    });
    if (a.handedOverAt) {
      entries.push({
        id: `ho-${a.id}`,
        at: a.handedOverAt,
        kind: "HANDOVER",
        title: `${a.ackNo} handed to the Overseas desk`,
        detail: a.handoverNote,
        who: who(a.handedOverBy),
      });
    }
    if (a.routeChosenAt && a.route?.vendor) {
      entries.push({
        id: `route-${a.id}`,
        at: a.routeChosenAt,
        kind: "HANDOVER",
        title: `${a.ackNo} goes through ${a.route.vendor.name}`,
        detail: null,
        who: null,
      });
    }
    if (a.submittedToVendorAt) {
      entries.push({
        id: `sub-${a.id}`,
        at: a.submittedToVendorAt,
        kind: "HANDOVER",
        title: `${a.ackNo} lodged${a.route?.vendor ? ` with ${a.route.vendor.name}` : ""}`,
        detail: a.vendorReference ? `Their reference ${a.vendorReference}` : null,
        who: who(a.submittedBy),
      });
    }
    if (a.returnedAt) {
      entries.push({ id: `ret-${a.id}`, at: a.returnedAt, kind: "HANDOVER", title: `${a.ackNo} sent back to the branch`, detail: a.returnReason, who: null });
    }
    for (const h of a.history) {
      entries.push({
        id: `hist-${h.id}`,
        at: h.createdAt,
        kind: "STATUS",
        title: `${a.ackNo}: ${h.toStatus.label}`,
        detail: h.reason,
        who: who(h.changedBy),
      });
    }
    for (const u of a.vendorUpdates) {
      entries.push({
        id: `vu-${u.id}`,
        at: u.createdAt,
        kind: "VENDOR_UPDATE",
        title: `${a.ackNo}: ${VENDOR_OUTCOME_LABEL[u.outcome]}`,
        detail: [u.note, `they acted on ${u.happenedOn}`].filter(Boolean).join(" · "),
        who: who(u.recordedBy),
      });
    }
  }

  // A stage move leaves no row of its own, only the audit log, so that is where
  // it is read from rather than keeping a second copy of the same fact.
  const moves = await db
    .select({ id: schema.auditLogs.id, action: schema.auditLogs.action, meta: schema.auditLogs.meta, at: schema.auditLogs.createdAt, actor: schema.users.name, desk: schema.users.deskLabel })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(and(eq(schema.auditLogs.entityType, "student"), eq(schema.auditLogs.entityId, studentId), inArray(schema.auditLogs.action, ["student.stage", "gate.override"])))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(40);
  for (const m of moves) {
    const meta = (m.meta ?? {}) as { to?: string; from?: string; stage?: string; reason?: string; missing?: string[] };
    if (m.action === "student.stage" && meta.to) {
      entries.push({
        id: `stage-${m.id}`,
        at: m.at,
        kind: "STAGE",
        title: `Moved to ${stageLabel(meta.to as JourneyStage)}`,
        detail: meta.from ? `from ${stageLabel(meta.from as JourneyStage)}` : null,
        who: m.desk ?? m.actor,
      });
    }
    if (m.action === "gate.override" && meta.stage) {
      entries.push({
        id: `override-${m.id}`,
        at: m.at,
        kind: "STAGE",
        title: `${stageLabel(meta.stage as JourneyStage)} let through with a reason`,
        detail: [meta.reason, meta.missing?.length ? `Missing: ${meta.missing.join(", ")}` : null].filter(Boolean).join(" · ") || null,
        who: m.desk ?? m.actor,
      });
    }
  }

  for (const t of tasks) {
    entries.push({
      id: `task-${t.id}`,
      at: t.createdAt,
      kind: "TASK",
      title: `${TASK_KIND_LABEL[t.kind]}: ${t.title}`,
      detail: `due ${t.dueOn}, for ${who(t.assignedTo)}${t.source !== "by hand" ? ` (${t.source})` : ""}`,
      who: null,
    });
    if (t.doneAt) {
      entries.push({ id: `taskdone-${t.id}`, at: t.doneAt, kind: "TASK", title: `Done: ${t.title}`, detail: t.doneNote, who: who(t.doneBy) });
    }
  }

  for (const p of payments) {
    if (!p.paidAt) continue;
    entries.push({
      id: `pay-${p.id}`,
      at: p.paidAt,
      kind: "PAYMENT",
      title: `${fmtMoney(Math.round(p.amountMinor / 100), p.currency)} paid`,
      detail: p.purpose,
      who: null,
    });
  }

  return entries.sort(byNewest).slice(0, limit);
}
