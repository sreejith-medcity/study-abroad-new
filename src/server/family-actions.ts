"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { PARTNER_ROLES, PROCESSING_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { isLocale } from "@/lib/i18n";
import { accessSummary, guardianAddedMessage } from "@/lib/family";
import { getStudentForUser } from "@/server/queries";
import { GUARDIAN_LIMIT, liveGuardianCount } from "@/server/family";
import { sendWhatsApp } from "@/server/whatsapp";
import type { FormState } from "@/lib/form-state";

/**
 * Giving a parent a sign-in of their own.
 *
 * The same shape as the student's portal invite: an account, a one-time
 * password read out to the family, and a change forced at first sign in. What
 * is different is that the student is told, because it is their file.
 */

/** A one-time password the guardian changes at first sign in. */
function onePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (const b of randomBytes(10)) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

const guardian = z.object({
  studentId: z.string().min(1),
  name: z.string().trim().min(2, "Give the parent's name."),
  relation: z.string().trim().min(2, "Say how they are related."),
  email: z.string().trim().toLowerCase().email("A working email address is needed for the sign-in."),
  phone: z.string().trim().optional(),
  seesMoney: z.string().optional(),
});

/** Tells the student, in their own language, that somebody can read their file. */
async function tellStudent(
  studentId: string,
  student: { firstName: string; phone: string; whatsappOptIn: boolean; preferredLanguage: string; orgId: string },
  guardianName: string,
  relation: string,
  seesMoney: boolean,
) {
  const branch = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, student.orgId),
    columns: { name: true, studentWhatsappMessages: true },
  });
  const locale = isLocale(student.preferredLanguage) ? student.preferredLanguage : "en";
  const body = guardianAddedMessage(
    { studentFirstName: student.firstName, guardianName, relation, seesMoney, branchName: branch?.name ?? "Medcity Overseas" },
    locale,
  );
  // The branch's switch decides whether it goes out on WhatsApp. Either way the
  // standing list on the student's own portal says who can read the file, so a
  // student whose branch has messages off still finds out.
  const mayMessage = student.whatsappOptIn && branch?.studentWhatsappMessages !== false;
  if (!mayMessage) return false;
  const sent = await sendWhatsApp({ to: student.phone, body });
  if (sent) await db.update(schema.studentGuardians).set({ studentToldAt: new Date() }).where(eq(schema.studentGuardians.studentId, studentId));
  return !!sent;
}

export async function addGuardianAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const parsed = guardian.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const student = await getStudentForUser(user, d.studentId);

  const live = await liveGuardianCount(d.studentId);
  if (live >= GUARDIAN_LIMIT) return { error: `A student can have ${GUARDIAN_LIMIT} family sign-ins at a time. Remove one first.` };

  const clash = await db.query.users.findFirst({ where: eq(schema.users.email, d.email) });
  if (clash) return { error: `${d.email} is already used by another account.` };

  const seesMoney = d.seesMoney === "on" || d.seesMoney === "true";
  const password = onePassword();
  const [account] = await db
    .insert(schema.users)
    .values({
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      passwordHash: await hashPassword(password),
      role: "PARENT",
      orgId: student.orgId,
      // The same column the student portal uses, so one sign-in reads one file
      // whichever kind of family account it is.
      studentId: d.studentId,
      locale: student.preferredLanguage,
      mustChangePassword: true,
    })
    .returning();

  await db.insert(schema.studentGuardians).values({
    studentId: d.studentId,
    userId: account.id,
    relation: d.relation,
    seesMoney,
    addedById: user.id,
  });
  await audit(user.id, "guardian.add", "student", d.studentId, { email: d.email, relation: d.relation, seesMoney });
  const told = await tellStudent(d.studentId, student, d.name, d.relation, seesMoney);

  revalidatePath(`/students/${d.studentId}`, "layout");
  return {
    keep: true,
    ok: `${d.name} can sign in at the family view with ${d.email}. One-time password: ${password}. They must change it at sign in. ${accessSummary(seesMoney)}${
      told ? ` ${student.firstName} has been told on WhatsApp.` : ` ${student.firstName} was not messaged, so tell them yourself.`
    }`,
  };
}

/**
 * Takes access away.
 *
 * The row stays, with the date on it, so the family can be told who could read
 * the file and until when. The account is switched off and its session version
 * raised, which strands the cookie: a parent reading the file at that moment
 * is out on their next click, not at the end of the day.
 */
export async function revokeGuardianAction(formData: FormData) {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const guardianId = String(formData.get("guardianId"));
  const row = await db.query.studentGuardians.findFirst({ where: eq(schema.studentGuardians.id, guardianId) });
  if (!row) return;
  await getStudentForUser(user, row.studentId);
  if (row.revokedAt) return;

  await db.update(schema.studentGuardians).set({ revokedAt: new Date(), revokedById: user.id }).where(eq(schema.studentGuardians.id, guardianId));
  await db
    .update(schema.users)
    .set({ active: false, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, row.userId));
  await audit(user.id, "guardian.revoke", "student", row.studentId, { guardianId });
  revalidatePath(`/students/${row.studentId}`, "layout");
}

/** Switches the fees on or off for one guardian, without touching their sign-in. */
export async function setGuardianMoneyAction(formData: FormData) {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const guardianId = String(formData.get("guardianId"));
  const seesMoney = String(formData.get("seesMoney")) === "true";
  const row = await db.query.studentGuardians.findFirst({ where: and(eq(schema.studentGuardians.id, guardianId), isNull(schema.studentGuardians.revokedAt)) });
  if (!row) return;
  await getStudentForUser(user, row.studentId);
  await db.update(schema.studentGuardians).set({ seesMoney }).where(eq(schema.studentGuardians.id, guardianId));
  await audit(user.id, "guardian.money", "student", row.studentId, { guardianId, seesMoney });
  revalidatePath(`/students/${row.studentId}`, "layout");
}

/** A new one-time password, for a parent who has lost theirs. */
export async function resetGuardianPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const guardianId = String(formData.get("guardianId"));
  const row = await db.query.studentGuardians.findFirst({ where: and(eq(schema.studentGuardians.id, guardianId), isNull(schema.studentGuardians.revokedAt)) });
  if (!row) return { error: "That family sign-in is no longer active." };
  await getStudentForUser(user, row.studentId);
  const account = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
  if (!account) return { error: "That family sign-in is no longer active." };

  const password = onePassword();
  await db
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      active: true,
      passwordUpdatedAt: new Date(),
      sessionVersion: sql`${schema.users.sessionVersion} + 1`,
    })
    .where(eq(schema.users.id, account.id));
  await audit(user.id, "guardian.password", "student", row.studentId, { guardianId });
  revalidatePath(`/students/${row.studentId}`, "layout");
  return { keep: true, ok: `New one-time password for ${account.email}: ${password}. They must change it at sign in.` };
}
