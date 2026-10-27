"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { CALLING_ROLES, CALL_OUTCOME_LABEL, isCallOutcome, needsLostReason, parseQueueKey, planCall, REPEAT_CALL_SECONDS, type CallOutcome } from "@/lib/calling";
import { autoKeys, isConnected } from "@/lib/crm";
import { dayText, istDay } from "@/lib/journal";
import { mayCall, recordFor } from "@/server/calling";
import { STAGE_LABEL } from "@/server/enquiries";
import { finishEnquiryFollowUp, syncEnquiryFollowUp } from "@/server/enquiry-tasks";
import { updateTracked } from "@/server/record-history";
import type { EnquiryStage } from "@/db/schema";

const { contactLog: cl, tasks: tk, enquiries: en, students: st } = schema;
const OPEN_STAGES: EnquiryStage[] = ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"];

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

  const today = istDay();
  const note = String(fd.get("note") ?? "").trim().slice(0, 1000) || null;
  const label = CALL_OUTCOME_LABEL[outcome as CallOutcome];
  const said = [label, note].filter(Boolean).join(". ");

  // An enquiry the call closes as lost carries a reason from the list kept in
  // Settings, the same as one closed from its own page, so the lost reasons
  // report can count it. Nothing is written until one is picked.
  let reason: { id: string; label: string } | null = null;
  if (needsLostReason(outcome as CallOutcome, { kind: rec.kind, stage: rec.enquiryStage })) {
    const reasonId = String(fd.get("lostReasonId") ?? "").trim();
    const found = reasonId
      ? await db.query.lostReasons.findFirst({ where: and(eq(schema.lostReasons.id, reasonId), eq(schema.lostReasons.active, true)), columns: { id: true, label: true } })
      : null;
    if (!found) redirect(back({ error: `${label} closes ${rec.name}'s enquiry as lost. Pick the reason from the list first.`, open: rec.key, skip: skipped.join(","), team }));
    reason = found!;
  }

  // The whole call is one transaction that first locks the enquiry or student
  // it is about. A double tap or a second tab waits here for the first to
  // finish, then finds the call already logged and logs nothing; an enquiry
  // closed, converted or merged while the screen was open is refused instead
  // of being written over.
  type Result =
    | { ok: false; error?: string; repeat?: boolean }
    | { ok: true; nextOn: string | null; kept: boolean; stageNow: string | null; lostAudit: { reasonId: string; reason: string; detail: string | null } | null; contact: string };
  const result: Result = await db.transaction(async (tx): Promise<Result> => {
    let stage: (typeof rec)["enquiryStage"] = null;
    let ownerId = rec.ownerId;
    if (rec.kind === "ENQUIRY") {
      const [row] = await tx
        .select({ stage: en.stage, mergedIntoId: en.mergedIntoId, orgId: en.orgId, assignedToId: en.assignedToId, createdById: en.createdById, submittedByOrgId: en.submittedByOrgId })
        .from(en)
        .where(eq(en.id, rec.id))
        .for("update");
      if (!row) return { ok: false, error: `${rec.name} is no longer in the portal.` };
      if (row.stage === "MERGED") {
        const [into] = row.mergedIntoId ? await tx.select({ name: en.name }).from(en).where(eq(en.id, row.mergedIntoId)).limit(1) : [];
        return { ok: false, error: `${rec.name} was merged into ${into?.name ?? "another enquiry"} meanwhile, so the call was not logged here. Log it on ${into?.name ?? "that enquiry"}.` };
      }
      if (!OPEN_STAGES.includes(row.stage)) return { ok: false, error: `${rec.name} is already closed (${STAGE_LABEL[row.stage]}), so the call was not logged.` };
      ownerId = row.assignedToId ?? (row.submittedByOrgId ? "" : row.createdById);
      if (!mayCall(user, { ownerId, orgId: row.orgId })) return { ok: false, error: `${rec.name} has been given to somebody else, so the call was not logged.` };
      stage = row.stage;
    } else {
      const [row] = await tx
        .select({ archived: st.archived, stage: st.journeyStage, orgId: st.orgId, assignedToId: st.assignedToId, createdById: st.createdById })
        .from(st)
        .where(eq(st.id, rec.id))
        .for("update");
      if (!row) return { ok: false, error: `${rec.name} is no longer in the portal.` };
      if (row.archived) return { ok: false, error: `${rec.name}'s file is archived, so the call was not logged.` };
      if (row.stage === "ARRIVED") return { ok: false, error: `${rec.name} has already arrived, so there is no follow-up call to log.` };
      ownerId = row.assignedToId ?? row.createdById ?? "";
      if (!mayCall(user, { ownerId, orgId: row.orgId })) return { ok: false, error: `${rec.name} has been given to somebody else, so the call was not logged.` };
    }

    // Read after the lock, so a call the other tab just committed is seen.
    // The database's own clock on both sides, so the app server's does not matter.
    const [repeat] = await tx
      .select({ id: cl.id })
      .from(cl)
      .where(
        and(
          eq(cl.byId, user.id),
          eq(cl.channel, "CALL"),
          rec.kind === "ENQUIRY" ? eq(cl.enquiryId, rec.id) : eq(cl.studentId, rec.id),
          sql`${cl.createdAt} > now() - make_interval(secs => ${REPEAT_CALL_SECONDS})`,
        ),
      )
      .limit(1);
    if (repeat) return { ok: false, repeat: true };

    const plan = planCall(outcome as CallOutcome, { kind: rec.kind, stage, today, callbackOn: String(fd.get("callbackOn") ?? "") || null });
    // Reopened since the page was read, so the lost reason was never asked for.
    if (plan.stage === "LOST" && !reason) return { ok: false, error: `${rec.name}'s enquiry changed meanwhile. Open it again and pick the lost reason.` };
    const [logged] = await tx
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
      const done = await finishEnquiryFollowUp(rec.id, user.id, said, tx);
      const now = new Date();
      const lostDetail = reason ? [plan.lostReason, note].filter(Boolean).join(". ") : null;
      // The stage condition stays as a second guard behind the lock.
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
        { by: user.id, action: reason ? "enquiry.lost" : "enquiry.call", tx, where: inArray(en.stage, OPEN_STAGES) },
      );
      if (!changed) {
        // The call happened and stays on the history, but it set nothing on
        // the enquiry, so no next date is claimed for it.
        await tx.update(cl).set({ nextActionOn: null, nextActionNote: null }).where(eq(cl.id, logged.id));
        const [now2] = await tx.select({ stage: en.stage }).from(en).where(eq(en.id, rec.id)).limit(1);
        await syncEnquiryFollowUp(rec.id, tx);
        if (done) await tx.update(cl).set({ taskId: done }).where(eq(cl.id, logged.id));
        return { ok: true, nextOn: null, kept: false, stageNow: now2 ? STAGE_LABEL[now2.stage] : null, lostAudit: null, contact: plan.contact };
      }
      if (plan.stage && plan.stage !== stage) {
        await tx.insert(schema.enquiryNotes).values({
          enquiryId: rec.id,
          authorId: user.id,
          body: reason ? `Closed as lost: ${reason.label}${lostDetail ? `. ${lostDetail}` : ""}` : `Stage moved from ${STAGE_LABEL[stage!]} to ${STAGE_LABEL[plan.stage]} after a call.`,
          stageAfter: plan.stage,
        });
      }
      await syncEnquiryFollowUp(rec.id, tx);
      const [next] = await tx.select({ id: tk.id }).from(tk).where(and(eq(tk.enquiryId, rec.id), isNull(tk.doneAt))).limit(1);
      if (next || done) await tx.update(cl).set({ taskId: next?.id ?? done }).where(eq(cl.id, logged.id));
      return {
        ok: true,
        nextOn: plan.nextOn,
        kept: true,
        stageNow: null,
        lostAudit: reason ? { reasonId: reason.id, reason: reason.label, detail: lostDetail } : null,
        contact: plan.contact,
      };
    }

    // The calls and follow-ups already due on this student are what the call was.
    await tx
      .update(tk)
      .set({ doneAt: new Date(), doneById: user.id, doneNote: said.slice(0, 300), updatedAt: new Date() })
      .where(and(eq(tk.studentId, rec.id), isNull(tk.doneAt), inArray(tk.kind, ["CALL", "FOLLOW_UP"]), lte(tk.dueOn, today), inArray(tk.assignedToId, [ownerId, user.id])));
    if (plan.nextOn) {
      const [made] = await tx
        .insert(tk)
        .values({
          orgId: rec.orgId,
          studentId: rec.id,
          kind: "CALL",
          title: plan.next ?? `Follow up with ${rec.name}`,
          detail: said || null,
          dueOn: plan.nextOn,
          firstDueOn: plan.nextOn,
          assignedToId: ownerId || user.id,
          createdById: user.id,
          source: `Call on ${today}`,
          autoKey: autoKeys.callFollowUp(logged.id),
        })
        .onConflictDoNothing({ target: tk.autoKey })
        .returning({ id: tk.id });
      if (made) await tx.update(cl).set({ taskId: made.id }).where(eq(cl.id, logged.id));
    }
    return { ok: true, nextOn: plan.nextOn, kept: true, stageNow: null, lostAudit: null, contact: plan.contact };
  });

  const moveOn = [...skipped, rec.key].join(",");
  if (!result.ok) {
    revalidatePath("/calls");
    if (result.repeat) redirect(back({ done: `${rec.name}: this call was logged a moment ago, so it was not logged twice`, skip: moveOn, team }));
    redirect(back({ error: result.error ?? "The call was not logged.", skip: moveOn, team }));
  }
  const res = result as Extract<Result, { ok: true }>;
  if (rec.kind === "ENQUIRY") {
    if (res.lostAudit) await audit(user.id, "enquiry.lost", "enquiry", rec.id, { ...res.lostAudit, via: "calling mode" });
    revalidatePath(`/enquiries/${rec.id}`);
    revalidatePath("/enquiries");
  } else {
    revalidatePath(`/students/${rec.id}`, "layout");
  }
  await audit(user.id, "contact.log", rec.kind === "ENQUIRY" ? "enquiry" : "student", rec.id, { channel: "CALL", outcome: res.contact, via: "calling mode", nextActionOn: res.nextOn });
  revalidatePath("/my-day");
  revalidatePath("/calls");
  if (!res.kept) {
    redirect(
      back({
        error: `${rec.name}: ${label} is on the contact history, but the enquiry itself was not changed${res.stageNow ? ` because it is now ${res.stageNow}` : ""}, so no next call was set. Open the enquiry to check it.`,
        skip: moveOn,
        team,
      }),
    );
  }
  redirect(back({ done: `${rec.name}: ${label}${res.nextOn ? `, next call ${dayText(res.nextOn)}` : ""}`, skip: moveOn, team }));
}
