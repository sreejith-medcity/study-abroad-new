"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, DOCUMENTATION_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { fromIstInput, fullName } from "@/lib/format";
import { AUSBILDUNG_HANDOVER_ROLES, GERMAN_LEVELS, MENTOR_PART, MENTOR_SETTING_ROLES, beforeTheDesk, canHandToDesk, type ModuleState } from "@/lib/ausbildung";
import type { FormState } from "@/lib/form-state";
import { getStudentForUser } from "./queries";
import { currentAusbildungApplication } from "./ausbildung";
import { changeStatus, StatusChangeError, tellDeskAusbildungArrived } from "./applications";
import { stageGate, studentChecklist, studentContext, syncChecklist } from "./documentation";
import { notifyUsers, partnerRecipients } from "./notify";
import { updateTracked } from "./record-history";

const text = (v: FormDataEntryValue | null, max = 120) => {
  const t = String(v ?? "").trim().slice(0, max);
  return t || null;
};
/** A date box's value, or null; anything that is not a real date is refused rather than guessed at. */
const day = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : null;
};

function refresh(studentId: string) {
  revalidatePath(`/students/${studentId}`, "layout");
  revalidatePath("/ausbildung");
}

/**
 * The Ausbildung part of a file: three preferences and the three dates.
 *
 * An empty box clears what was there, because the form shows every field and
 * whatever it sends is what the file should now say.
 */
export async function saveAusbildungAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  await getStudentForUser(user, studentId);

  const interviewRaw = String(fd.get("interviewOn") ?? "").trim();
  const interviewOn = interviewRaw ? fromIstInput(interviewRaw) : null;
  if (interviewRaw && !interviewOn) return { fieldErrors: { interviewOn: ["Give the date and the time"] }, error: "Check the highlighted fields." };

  const values = {
    preference1: text(fd.get("preference1")),
    preference2: text(fd.get("preference2")),
    preference3: text(fd.get("preference3")),
    applicationSubmittedOn: day(fd.get("applicationSubmittedOn")),
    interviewOn,
    interviewWith: text(fd.get("interviewWith")),
    contractReceivedOn: day(fd.get("contractReceivedOn")),
    contractEmployer: text(fd.get("contractEmployer")),
    note: text(fd.get("note"), 600),
    updatedById: user.id,
    updatedAt: new Date(),
  };
  // A contract without the employer on it is half a fact.
  if (values.contractReceivedOn && !values.contractEmployer) {
    return { fieldErrors: { contractEmployer: ["Say which employer the contract is with"] }, error: "Check the highlighted fields." };
  }

  await db
    .insert(schema.ausbildungProfiles)
    .values({ studentId, ...values })
    .onConflictDoUpdate({ target: schema.ausbildungProfiles.studentId, set: values });
  await audit(user.id, "ausbildung.save", "student", studentId, {
    applicationSubmittedOn: values.applicationSubmittedOn,
    interviewOn: values.interviewOn?.toISOString() ?? null,
    contractReceivedOn: values.contractReceivedOn,
  });
  refresh(studentId);
  return { ok: "Saved." };
}

const STATES: ModuleState[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];

/** One German level: where it stands, and the day it was finished. */
export async function saveGermanModuleAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  await getStudentForUser(user, studentId);
  const level = String(fd.get("level") ?? "");
  const state = String(fd.get("state") ?? "") as ModuleState;
  if (!(GERMAN_LEVELS as readonly string[]).includes(level) || !STATES.includes(state)) return { error: "That level could not be saved." };
  // Finished means finished on a day; the day is today unless somebody says.
  const completedOn = state === "COMPLETED" ? (day(fd.get("completedOn")) ?? new Date().toISOString().slice(0, 10)) : null;

  const held = await db.query.germanModules.findFirst({
    where: and(eq(schema.germanModules.studentId, studentId), eq(schema.germanModules.level, level)),
  });
  if (held) {
    await db
      .update(schema.germanModules)
      .set({ state, completedOn, updatedById: user.id, updatedAt: new Date() })
      .where(eq(schema.germanModules.id, held.id));
  } else {
    await db.insert(schema.germanModules).values({ studentId, level, state, completedOn, updatedById: user.id });
  }
  await audit(user.id, "german.module", "student", studentId, { level, state, completedOn });
  refresh(studentId);
  return { ok: `${level} saved.` };
}

/**
 * Whether a destination collects a service charge, and its usual figure.
 * Medcity's decision, so the admins' only.
 */
export async function saveServiceChargeCountryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const countryId = String(fd.get("countryId") ?? "");
  const country = await db.query.countries.findFirst({ where: eq(schema.countries.id, countryId) });
  if (!country) return { error: "That country is gone." };
  const on = fd.get("collects") === "1";
  const raw = String(fd.get("serviceChargeInr") ?? "").replace(/[,\s₹]/g, "");
  let amount: number | null = null;
  if (raw) {
    amount = Number(raw);
    if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) {
      return { fieldErrors: { serviceChargeInr: ["Whole rupees, or leave it empty"] }, error: "Check the highlighted fields." };
    }
  }
  await db.update(schema.countries).set({ collectsServiceCharge: on, serviceChargeInr: amount }).where(eq(schema.countries.id, countryId));
  await audit(user.id, "country.service_charge", "country", countryId, { name: country.name, on, amount });
  revalidatePath("/admin/destinations");
  revalidatePath("/ausbildung");
  return { ok: on ? `${country.name} collects a service charge.` : `${country.name} does not collect a service charge.` };
}

/* ---------------- The hand-over to the documentation desk ---------------- */

/**
 * The branch hands an Ausbildung file to the documentation desk, at the end
 * of document collection (step 3 of the written process).
 *
 * The status stays where it is: the guide's next step, "Mentor assigned", is
 * the desk's to record once it has named one, and the hand-over should not
 * say a mentor exists before anyone does. What changes is that the file is
 * marked handed over, which is what lets a documentation officer open it, and
 * the desk is told it has arrived. Gated on the profile documents the branch
 * collects at step 3, with what is missing named rather than hidden.
 */
export async function handOverToDeskAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...AUSBILDUNG_HANDOVER_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  const note = text(fd.get("note"), 400);
  const student = await getStudentForUser(user, studentId);
  const app = await currentAusbildungApplication(studentId);
  if (!app) return { error: "There is no open Ausbildung application to hand over." };

  // The list is brought into line with the requirements first, so a file
  // whose documentation tab was never opened is gated on the real list rather
  // than let through on an empty one.
  await syncChecklist(studentId);
  const rows = await studentChecklist(studentId);
  const ctx = await studentContext(studentId);
  const gate = rows.length ? stageGate(rows, "PROFILE", ctx.courseStart) : { clear: true, missing: [] as { label: string }[] };
  const verdict = canHandToDesk({ handedOver: !!app.handedOverAt, closed: app.statusGroup === "CLOSED", gateClear: gate.clear, missing: gate.missing.map((m) => m.label) });
  if (!verdict.ready) return { error: verdict.why ?? "This cannot be handed over yet." };

  const now = new Date();
  await updateTracked("application", app.id, { handedOverAt: now, handedOverById: user.id, handoverNote: note, updatedAt: now }, { by: user.id, action: "application.handover" });
  await audit(user.id, "application.handover", "application", app.id, { via: "ausbildung", note });
  await tellDeskAusbildungArrived({
    studentId,
    student: fullName(student),
    branch: student.orgId,
    because: `document collection is done${note ? `. From the branch: ${note}` : ""}`,
  });
  refresh(studentId);
  revalidatePath(`/students/${studentId}/applications`);
  return { ok: "Handed to the documentation desk. They name the mentor next." };
}

/* ---------------- The mentor ---------------- */

/**
 * The documentation desk names the mentor who carries the file from here, the
 * guide's step 4.
 *
 * The mentor is a documentation officer, put on the student's file under the
 * mentor's part: that is what opens the student to them and what the people
 * panel shows. One mentor at a time, so naming another replaces the first.
 * Naming one moves an application still at the branch's steps to "Mentor
 * assigned"; a file further along keeps its status. The counsellor and the
 * branch head are told who it is, which is the guide's email intimation, and
 * the mentor is told with a link to the file.
 */
export async function setMentorAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...MENTOR_SETTING_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  const mentorId = String(fd.get("mentorId") ?? "").trim();
  const student = await getStudentForUser(user, studentId);
  if (!mentorId) return { fieldErrors: { mentorId: ["Pick the mentor"] }, error: "Pick the mentor." };

  const mentor = await db.query.users.findFirst({ where: eq(schema.users.id, mentorId) });
  if (!mentor?.active || !(DOCUMENTATION_ROLES as readonly string[]).includes(mentor.role)) {
    return { fieldErrors: { mentorId: ["The mentor has to be a documentation officer"] }, error: "The mentor has to be a documentation officer." };
  }
  const app = await currentAusbildungApplication(studentId);
  if (!app) return { error: "There is no open Ausbildung application to put a mentor on." };

  const held = await db.query.studentPeople.findMany({ where: and(eq(schema.studentPeople.studentId, studentId), eq(schema.studentPeople.part, MENTOR_PART)) });
  const previous = held.find((h) => h.userId !== mentorId) ?? null;
  if (held.some((h) => h.userId === mentorId) && held.length === 1) return { ok: `${mentor.name} is already the mentor.` };

  await db.transaction(async (tx) => {
    for (const h of held) await tx.delete(schema.studentPeople).where(eq(schema.studentPeople.id, h.id));
    await tx.insert(schema.studentPeople).values({ studentId, userId: mentorId, part: MENTOR_PART, addedById: user.id });
  });
  await audit(user.id, "ausbildung.mentor", "student", studentId, { applicationId: app.id, from: previous?.userId ?? null, to: mentorId });

  // The guide's step 4, recorded by the move. Only a file still at the
  // branch's steps moves: a file at language training or beyond has a mentor
  // already in all but name, and its status says where the work is.
  let moved: string | null = null;
  // A status that would not move says so in the answer; the mentor is set
  // either way, and everybody is still told.
  let stayed: string | null = null;
  if (beforeTheDesk(app.statusCode)) {
    const to = await db.query.statusDefinitions.findFirst({
      where: and(eq(schema.statusDefinitions.pathway, "AUSBILDUNG"), eq(schema.statusDefinitions.code, "MENTOR_ASSIGNED")),
    });
    if (to) {
      try {
        await changeStatus(user, app.id, to.id, undefined, { viaMentor: true });
        moved = to.label;
      } catch (e) {
        if (!(e instanceof StatusChangeError)) throw e;
        stayed = e.message;
      }
    }
  }

  const name = fullName(student);
  // The guide's email intimation: the mentor's name and how to reach them.
  const reach = [mentor.email, mentor.phone].filter(Boolean).join(", ");
  const href = `/students/${studentId}/ausbildung`;
  await notifyUsers(
    await partnerRecipients(student.orgId, student.assignedToId),
    `${name}: ${previous ? "the mentor has changed" : "mentor assigned"}`,
    `${mentor.name}${mentor.deskLabel ? ` (${mentor.deskLabel})` : ""} is the documentation mentor for ${name}'s Ausbildung file.${reach ? ` Reach them at ${reach}.` : ""}${moved ? ` Status moved to ${moved}.` : ""}`,
    href,
  );
  await notifyUsers([mentorId], `You are the mentor for ${name}`, `An Ausbildung file from ${student.org.name}. The checklist and the German record are on the file.`, href);
  if (previous) await notifyUsers([previous.userId], `${name}: ${mentor.name} is the mentor now`, "You are no longer on this file as the mentor.", href);

  refresh(studentId);
  revalidatePath("/students");
  return { ok: `${mentor.name} is the mentor.${moved ? ` Status moved to ${moved}.` : ""}${stayed ? ` The status did not move: ${stayed}` : ""} The counsellor has been told.` };
}
