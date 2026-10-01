"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import { canHandOver, OUTCOME_LABEL, SETTLES_IT, TELLS_THE_BRANCH, vendorTurnaround } from "@/lib/desk";
import { changeStatus, StatusChangeError } from "@/server/applications";
import { stageGate, studentChecklist, studentContext } from "@/server/documentation";
import { deskIds, notifyUsers, partnerRecipients } from "@/server/notify";
import { getApplicationForUser } from "@/server/queries";
import type { FormState } from "@/lib/form-state";
import type { VendorOutcome } from "@/db/schema";

const { applications: ap, vendorUpdates: vu } = schema;

const asDate = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the screens and the notices need about one application. */
async function loadApplication(id: string) {
  return db.query.applications.findFirst({
    where: eq(ap.id, id),
    with: {
      status: true,
      student: { columns: { id: true, firstName: true, lastName: true, orgId: true, assignedToId: true } },
      program: { columns: { id: true, name: true, pathway: true }, with: { university: { columns: { name: true } } } },
      route: { with: { vendor: { columns: { name: true, code: true } } } },
    },
  });
}

const refresh = (studentId: string) => {
  revalidatePath(`/students/${studentId}`, "layout");
  revalidatePath("/admin/desk");
  revalidatePath("/applications");
};

/**
 * The branch hands the file over.
 *
 * Gated on the documents, because a file that reaches the desk short of paper
 * only comes back, and each round trip costs the student a week. What is missing
 * is named rather than hidden behind a refusal.
 */
export async function handOverAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const id = String(fd.get("applicationId") ?? "");
  const note = String(fd.get("note") ?? "").trim().slice(0, 400) || null;
  await getApplicationForUser(user, id);
  const app = await loadApplication(id);
  if (!app) return { error: "That application no longer exists." };

  const rows = await studentChecklist(app.studentId);
  const ctx = await studentContext(app.studentId);
  const gate = rows.length ? stageGate(rows, "APPLICATION", ctx.courseStart) : { clear: true, missing: [] as { label: string }[] };
  const verdict = canHandOver({
    deskStage: app.deskStage,
    gateClear: gate.clear,
    missing: gate.missing.map((m) => m.label),
    closed: app.status.group === "CLOSED",
  });
  if (!verdict.ready) return { error: verdict.why ?? "This cannot be handed over yet." };

  const now = new Date();
  await db
    .update(ap)
    .set({ deskStage: "READY", deskStageAssumed: false, handedOverAt: now, handedOverById: user.id, handoverNote: note, returnedAt: null, returnReason: null, returnedById: null, updatedAt: now })
    .where(eq(ap.id, id));
  await notifyUsers(
    await deskIds(),
    `${app.student.firstName} ${app.student.lastName} is ready for the desk`,
    `${app.program.name}, ${app.program.university.name}, ${intakeLabel(app.intakeMonth, app.intakeYear)}. ${app.ackNo}.${note ? ` ${note}` : ""}`,
    `/admin/desk?app=${id}`,
  );
  await audit(user.id, "application.handover", "application", id, { note });
  refresh(app.studentId);
  return { ok: "Handed to the Overseas desk. They choose the vendor and lodge it." };
}

const returnSchema = z.object({ applicationId: z.string().min(1), reason: z.string().trim().min(5, "Say what the branch has to fix").max(400) });

/** The desk sends it back, with the reason the counsellor reads. */
export async function returnToBranchAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = returnSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say what the branch has to fix." };
  const app = await loadApplication(parsed.data.applicationId);
  if (!app) return { error: "That application no longer exists." };
  if (app.deskStage === "SUBMITTED") return { error: "This is already lodged with the vendor. Record an update instead." };
  const now = new Date();
  await db
    .update(ap)
    .set({ deskStage: "RETURNED", returnedAt: now, returnedById: user.id, returnReason: parsed.data.reason, updatedAt: now })
    .where(eq(ap.id, app.id));
  await notifyUsers(
    await partnerRecipients(app.student.orgId, app.student.assignedToId),
    `${app.ackNo} came back from the Overseas desk`,
    parsed.data.reason,
    `/students/${app.studentId}/applications?app=${app.id}`,
  );
  await audit(user.id, "application.returned", "application", app.id, { reason: parsed.data.reason });
  refresh(app.studentId);
  return { ok: `Sent back to ${app.student.firstName}'s branch with the reason.` };
}

const routeSchema = z.object({ applicationId: z.string().min(1), routeId: z.string().min(1, "Choose the road it goes down"), note: z.string().trim().max(400).optional() });

/**
 * The desk picks the road. This is the decision that sets the commission, the
 * extra paperwork and who gets invoiced at the end, so it is recorded with who
 * made it and when.
 */
export async function chooseRouteAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = routeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Choose the road it goes down." };
  const app = await loadApplication(parsed.data.applicationId);
  if (!app) return { error: "That application no longer exists." };
  const route = await db.query.programRoutes.findFirst({
    where: and(eq(schema.programRoutes.id, parsed.data.routeId), eq(schema.programRoutes.programId, app.program.id)),
    with: { vendor: { columns: { name: true, code: true, active: true } } },
  });
  if (!route) return { fieldErrors: { routeId: ["That route is not recorded for this course"] }, error: "Choose the road it goes down." };
  if (!route.active || !route.vendor.active) return { fieldErrors: { routeId: ["That route is paused"] }, error: "Choose the road it goes down." };
  const changing = app.routeId && app.routeId !== route.id;
  if (app.deskStage === "SUBMITTED") {
    return { error: "This is lodged with the vendor already. Changing the road now is a withdrawal and a fresh application, which is what actually happens in practice." };
  }
  const now = new Date();
  await db
    .update(ap)
    .set({ routeId: route.id, routeChosenById: user.id, routeChosenAt: now, deskStage: "CHOSEN", updatedAt: now })
    .where(eq(ap.id, app.id));
  await audit(user.id, changing ? "application.route_changed" : "application.route_chosen", "application", app.id, {
    vendor: route.vendor.name,
    from: app.route?.vendor.name ?? null,
    note: parsed.data.note ?? null,
  });
  refresh(app.studentId);
  return { ok: `${app.ackNo} goes through ${route.vendor.name}. Lodge it in their portal next.` };
}

const submitSchema = z.object({
  applicationId: z.string().min(1),
  vendorReference: z.string().trim().max(60).optional(),
  submittedOn: z.string().optional(),
  statusId: z.string().optional(),
});

/**
 * Recorded once the desk has lodged it in the vendor's or the university's own
 * portal. The date is the day it was lodged, which is where every turnaround
 * figure starts counting from.
 */
export async function recordSubmissionAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = submitSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const app = await loadApplication(parsed.data.applicationId);
  if (!app) return { error: "That application no longer exists." };
  if (!app.routeId) return { error: "Choose the road it goes down first." };
  const when = asDate(parsed.data.submittedOn) ?? new Date();
  if (when.getTime() > Date.now() + 86_400_000) return { fieldErrors: { submittedOn: ["That day has not happened yet"] }, error: "Check the highlighted fields." };
  const now = new Date();
  await db
    .update(ap)
    .set({
      deskStage: "SUBMITTED",
      submittedToVendorAt: when,
      submittedById: user.id,
      vendorReference: parsed.data.vendorReference || app.vendorReference,
      updatedAt: now,
    })
    .where(eq(ap.id, app.id));
  // The status the team keeps for "submitted to the institution", where they
  // chose one on the form. Nothing is moved behind their back.
  if (parsed.data.statusId) {
    try {
      await changeStatus(user, app.id, parsed.data.statusId, undefined, { viaVendorUpdate: true });
    } catch (e) {
      if (!(e instanceof StatusChangeError)) throw e;
      return { ok: `Lodged on ${dateOnly(when)}. The status did not move: ${e.message}` };
    }
  }
  await notifyUsers(
    await partnerRecipients(app.student.orgId, app.student.assignedToId),
    `${app.ackNo} has been lodged${app.route?.vendor ? ` with ${app.route.vendor.name}` : ""}`,
    parsed.data.vendorReference ? `Their reference: ${parsed.data.vendorReference}` : undefined,
    `/students/${app.studentId}/applications?app=${app.id}`,
  );
  await audit(user.id, "application.submitted_to_vendor", "application", app.id, { on: dateOnly(when), reference: parsed.data.vendorReference ?? null });
  refresh(app.studentId);
  return { ok: `Lodged on ${dateOnly(when)}. Everything from here is what they tell us.` };
}

const updateSchema = z.object({
  applicationId: z.string().min(1),
  outcome: z.string().min(1, "Pick what they came back with"),
  happenedOn: z.string().min(1, "The day they acted"),
  note: z.string().trim().max(1000).optional(),
  statusId: z.string().optional(),
  reason: z.string().trim().max(400).optional(),
});

/**
 * What the vendor said, typed in by the desk.
 *
 * None of these portals tell us anything by themselves, so this is the only
 * record there will ever be. The date is theirs, not ours: a turnaround built on
 * when somebody got round to typing it in is a number nobody should trust.
 */
export async function recordVendorUpdateAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = updateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!(d.outcome in OUTCOME_LABEL)) return { fieldErrors: { outcome: ["Pick one from the list"] }, error: "Check the highlighted fields." };
  const outcome = d.outcome as VendorOutcome;
  const app = await loadApplication(d.applicationId);
  if (!app) return { error: "That application no longer exists." };
  if (app.deskStage !== "SUBMITTED") return { error: "Record that it was lodged with the vendor first, so the turnaround has somewhere to count from." };
  const happened = asDate(d.happenedOn);
  if (!happened) return { fieldErrors: { happenedOn: ["Give the day they acted"] }, error: "Check the highlighted fields." };
  if (happened.getTime() > Date.now() + 86_400_000) return { fieldErrors: { happenedOn: ["That day has not happened yet"] }, error: "Check the highlighted fields." };
  if (app.submittedToVendorAt && happened.getTime() < app.submittedToVendorAt.getTime() - 86_400_000) {
    return { fieldErrors: { happenedOn: ["Earlier than the day it was lodged"] }, error: "Check the highlighted fields." };
  }

  let moved: string | null = null;
  if (d.statusId) {
    try {
      await changeStatus(user, app.id, d.statusId, d.reason, { viaVendorUpdate: true });
      const to = await db.query.statusDefinitions.findFirst({ where: eq(schema.statusDefinitions.id, d.statusId) });
      moved = to?.label ?? null;
    } catch (e) {
      if (!(e instanceof StatusChangeError)) throw e;
      return { error: e.message };
    }
  }
  await db.insert(vu).values({
    applicationId: app.id,
    outcome,
    happenedOn: dateOnly(happened),
    note: d.note || null,
    toStatusId: d.statusId || null,
    recordedById: user.id,
  });
  const took = SETTLES_IT.includes(outcome) ? vendorTurnaround(app.submittedToVendorAt, happened) : null;
  if (TELLS_THE_BRANCH.includes(outcome)) {
    await notifyUsers(
      await partnerRecipients(app.student.orgId, app.student.assignedToId),
      `${app.ackNo}: ${OUTCOME_LABEL[outcome]}`,
      [d.note, moved ? `Status moved to ${moved}.` : null].filter(Boolean).join(" ") || undefined,
      `/students/${app.studentId}/applications?app=${app.id}`,
    );
  }
  await audit(user.id, "application.vendor_update", "application", app.id, { outcome, happenedOn: dateOnly(happened), moved, took });
  refresh(app.studentId);
  return {
    ok: `${OUTCOME_LABEL[outcome]} recorded${took != null ? `, ${took} day${took === 1 ? "" : "s"} after it was lodged` : ""}.${moved ? ` Status moved to ${moved}.` : ""}`,
  };
}

/** Puts right an update typed against the wrong application or with the wrong date. */
export async function deleteVendorUpdateAction(fd: FormData): Promise<void> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("updateId") ?? "");
  const held = await db.query.vendorUpdates.findFirst({ where: eq(vu.id, id), with: { application: { columns: { studentId: true } } } });
  if (!held) return;
  await db.delete(vu).where(eq(vu.id, id));
  await audit(user.id, "application.vendor_update_removed", "application", held.applicationId, { outcome: held.outcome, happenedOn: held.happenedOn });
  refresh(held.application.studentId);
}
