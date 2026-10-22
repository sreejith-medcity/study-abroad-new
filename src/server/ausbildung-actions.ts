"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { fromIstInput } from "@/lib/format";
import { GERMAN_LEVELS, type ModuleState } from "@/lib/ausbildung";
import type { FormState } from "@/lib/form-state";
import { getStudentForUser } from "./queries";

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
