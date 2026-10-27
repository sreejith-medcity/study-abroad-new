"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { CALLING_ROLES, CALL_OUTCOME_LABEL, isCallOutcome, needsLostReason, parseQueueKey, planCall } from "@/lib/calling";
import { autoKeys, isConnected } from "@/lib/crm";
import { dayText, istDay } from "@/lib/journal";
import { mayCall, recordFor } from "@/server/calling";
import { STAGE_LABEL } from "@/server/enquiries";
import { finishEnquiryFollowUp, syncEnquiryFollowUp } from "@/server/enquiry-tasks";
import { updateTracked } from "@/server/record-history";

const { contactLog: cl, tasks: tk, enquiries: en } = schema;

const back = (params: Record<string, string>) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `/calls${q ? `?${q}` : ""}`;
};

/**
 * One call from calling mode: what came of it goes on the contact history,
 * the follow-up it was is finished, the next one is set from the outcome, and
 * the next person in the queue opens.
 */
export async function logCallAction(fd: FormData): Promise<void> {
  const user = await requireUser([...CALLING_ROLES]);
  const key = String(fd.get("key") ?? "");
  const outcome = String(fd.get("outcome") ?? "");
  const team = fd.get("team") === "1" ? "1" : "";
  const skipped = String(fd.get("skip") ?? "")
    .split(",")
    .filter((k) => parseQueueKey(k))
    .slice(-200);
  const target = parseQueueKey(key);
  if (!target || !isCallOutcome(outcome)) redirect(back({ error: "Pick what came of the call.", team }));
  const record = await recordFor(target!.kind, target!.id);
  if (!record || !mayCall(user, record)) redirect(back({ error: "That one is not in your queue.", team }));
  const rec = record!;
  if (rec.kind === "ENQUIRY" && !["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"].includes(rec.enquiryStage ?? "")) {
    redirect(back({ error: `${rec.name} is already closed.`, team }));
  }

  const today = istDay();
  const note = String(fd.get("note") ?? "").trim().slice(0, 1000) || null;
  const plan = planCall(outcome as Parameters<typeof planCall>[0], {
    kind: rec.kind,
    stage: rec.enquiryStage,
    today,
    callbackOn: String(fd.get("callbackOn") ?? "") || null,
  });
  const label = CALL_OUTCOME_LABEL[outcome as keyof typeof CALL_OUTCOME_LABEL];
  const said = [label, note].filter(Boolean).join(". ");

  // An enquiry the call closes as lost carries a reason from the list kept in
  // Settings, the same as one closed from its own page, so the lost reasons
  // report can count it. Nothing is written until one is picked.
  let reason: { id: string; label: string } | null = null;
  if (needsLostReason(outcome as Parameters<typeof planCall>[0], { kind: rec.kind, stage: rec.enquiryStage })) {
    const reasonId = String(fd.get("lostReasonId") ?? "").trim();
    const found = reasonId
      ? await db.query.lostReasons.findFirst({ where: and(eq(schema.lostReasons.id, reasonId), eq(schema.lostReasons.active, true)), columns: { id: true, label: true } })
      : null;
    if (!found) redirect(back({ error: `${label} closes ${rec.name}'s enquiry as lost. Pick the reason from the list first.`, open: rec.key, skip: skipped.join(","), team }));
    reason = found!;
  }

  const [logged] = await db
    .insert(cl)
    .values({
      orgId: rec.orgId,
      studentId: rec.kind === "STUDENT" ? rec.id : null,
      enquiryId: rec.kind === "ENQUIRY" ? rec.id : null,
      channel: "CALL",
      outcome: plan.contact,
      note,
      byId: user.id,
      nextActionOn: plan.nextOn,
      nextActionNote: plan.next,
    })
    .returning({ id: cl.id });

  if (rec.kind === "ENQUIRY") {
    const done = await finishEnquiryFollowUp(rec.id, user.id, said);
    const now = new Date();
    const lostDetail = reason ? [plan.lostReason, note].filter(Boolean).join(". ") : null;
    // The stage condition keeps a call from reopening or overwriting an
    // enquiry that was converted, merged or closed while the screen was open.
    const changed = await updateTracked(
      "enquiry",
      rec.id,
      {
        ...(plan.stage ? { stage: plan.stage } : {}),
        ...(reason ? { lostReasonId: reason.id, lostReason: lostDetail, lostAt: now } : {}),
        nextFollowUpAt: plan.nextOn ? new Date(`${plan.nextOn}T00:00:00Z`) : null,
        ...(isConnected(plan.contact) ? { lastContactedAt: now } : {}),
        updatedAt: now,
      },
      { by: user.id, action: reason ? "enquiry.lost" : "enquiry.call", where: inArray(en.stage, ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"]) },
    );
    if (changed && plan.stage && plan.stage !== rec.enquiryStage) {
      await db.insert(schema.enquiryNotes).values({
        enquiryId: rec.id,
        authorId: user.id,
        body: reason ? `Closed as lost: ${reason.label}${lostDetail ? `. ${lostDetail}` : ""}` : `Stage moved from ${STAGE_LABEL[rec.enquiryStage!]} to ${STAGE_LABEL[plan.stage]} after a call.`,
        stageAfter: plan.stage,
      });
    }
    if (changed && reason) await audit(user.id, "enquiry.lost", "enquiry", rec.id, { reasonId: reason.id, reason: reason.label, detail: lostDetail, via: "calling mode" });
    await syncEnquiryFollowUp(rec.id);
    const [next] = await db.select({ id: tk.id }).from(tk).where(and(eq(tk.enquiryId, rec.id), isNull(tk.doneAt))).limit(1);
    if (next || done) await db.update(cl).set({ taskId: next?.id ?? done }).where(eq(cl.id, logged.id));
    revalidatePath(`/enquiries/${rec.id}`);
    revalidatePath("/enquiries");
  } else {
    // The calls and follow-ups already due on this student are what the call was.
    await db
      .update(tk)
      .set({ doneAt: new Date(), doneById: user.id, doneNote: said.slice(0, 300), updatedAt: new Date() })
      .where(and(eq(tk.studentId, rec.id), isNull(tk.doneAt), inArray(tk.kind, ["CALL", "FOLLOW_UP"]), lte(tk.dueOn, today), inArray(tk.assignedToId, [rec.ownerId, user.id])));
    if (plan.nextOn) {
      const [made] = await db
        .insert(tk)
        .values({
          orgId: rec.orgId,
          studentId: rec.id,
          kind: "CALL",
          title: plan.next ?? `Follow up with ${rec.name}`,
          detail: said || null,
          dueOn: plan.nextOn,
          assignedToId: rec.ownerId || user.id,
          createdById: user.id,
          source: `Call on ${today}`,
          autoKey: autoKeys.callFollowUp(logged.id),
        })
        .onConflictDoNothing({ target: tk.autoKey })
        .returning({ id: tk.id });
      if (made) await db.update(cl).set({ taskId: made.id }).where(eq(cl.id, logged.id));
    }
    revalidatePath(`/students/${rec.id}`, "layout");
  }
  await audit(user.id, "contact.log", rec.kind === "ENQUIRY" ? "enquiry" : "student", rec.id, { channel: "CALL", outcome: plan.contact, via: "calling mode", nextActionOn: plan.nextOn });
  revalidatePath("/my-day");
  revalidatePath("/calls");
  redirect(back({ done: `${rec.name}: ${label}${plan.nextOn ? `, next call ${dayText(plan.nextOn)}` : ""}`, skip: [...skipped, rec.key].join(","), team }));
}
