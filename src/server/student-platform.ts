"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { db, schema } from "@/db";
import type { SignupQuestion } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { contrastWithWhite } from "@/lib/color";
import type { FormState } from "@/lib/form-state";
import { MAX_SIGNUP_QUESTIONS } from "@/lib/signup-questions";
import { deleteUpload, saveUpload, UploadError } from "@/server/storage";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX = 1024 * 1024;

/** The branch's name, colour and logo on its student portal and its public form. Owners only. */
export async function saveStudentBrandAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  if (!org) return { error: "This branch could not be loaded." };
  const name = String(fd.get("portalName") ?? "").trim().slice(0, 60) || null;
  const color = String(fd.get("portalColor") ?? "").trim().toLowerCase() || null;
  const useColor = fd.get("useColor") === "on";
  if (useColor && (!color || !/^#[0-9a-f]{6}$/.test(color))) return { fieldErrors: { portalColor: ["Use a hex colour like #0b6e4f"] }, error: "Check the highlighted fields." };
  if (useColor && color && contrastWithWhite(color) < 4.5) {
    return { fieldErrors: { portalColor: ["Too light: white text on it would be hard to read. Pick a darker shade."] }, error: "Check the highlighted fields." };
  }
  const set: Partial<typeof schema.organizations.$inferInsert> = { portalName: name, portalColor: useColor ? color : null };
  let oldKey: string | null = null;
  const file = fd.get("logo");
  if (file instanceof File && file.size > 0) {
    if (!LOGO_TYPES.includes(file.type)) return { fieldErrors: { logo: ["A PNG, JPG or WebP image"] }, error: "Check the highlighted fields." };
    if (file.size > LOGO_MAX) return { fieldErrors: { logo: ["Keep the logo under 1 MB"] }, error: "Check the highlighted fields." };
    try {
      const saved = await saveUpload(file, `org-logos/${org.id}`);
      Object.assign(set, { portalLogoKey: saved.storageKey, portalLogoMimeType: saved.mimeType });
      oldKey = org.portalLogoKey;
    } catch (e) {
      if (e instanceof UploadError) return { fieldErrors: { logo: [e.message] }, error: e.message };
      throw e;
    }
  } else if (fd.get("removeLogo") === "on" && org.portalLogoKey) {
    Object.assign(set, { portalLogoKey: null, portalLogoMimeType: null });
    oldKey = org.portalLogoKey;
  }
  await db.update(schema.organizations).set(set).where(eq(schema.organizations.id, org.id));
  if (oldKey) await deleteUpload(oldKey).catch(() => {});
  await audit(user.id, "org.student_brand", "organization", org.id, { name, color: set.portalColor, logo: set.portalLogoKey !== undefined ? (set.portalLogoKey ? "replaced" : "removed") : "unchanged" });
  revalidatePath("/settings/students");
  return { ok: "Saved. Your students see it next time they open the portal." };
}

export async function saveStudentNotificationsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER"]);
  const milestones = fd.get("milestones") === "on";
  const messages = fd.get("messages") === "on";
  await db.update(schema.organizations).set({ studentWhatsappMilestones: milestones, studentWhatsappMessages: messages }).where(eq(schema.organizations.id, user.orgId));
  await audit(user.id, "org.student_notifications", "organization", user.orgId, { milestones, messages });
  revalidatePath("/settings/students");
  return { ok: "Saved." };
}

/** The branch's own questions on its public enquiry form, sent as numbered rows. */
export async function saveSignupQuestionsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER"]);
  const questions: SignupQuestion[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (let i = 0; i < MAX_SIGNUP_QUESTIONS + 4; i++) {
    const label = String(fd.get(`q${i}_label`) ?? "").trim();
    if (!label) continue;
    const kind = String(fd.get(`q${i}_kind`) ?? "text");
    const options = String(fd.get(`q${i}_options`) ?? "").split(",").map((o) => o.trim()).filter(Boolean).slice(0, 12);
    if (label.length > 140) fieldErrors[`q${i}_label`] = ["Keep the question under 140 characters"];
    if (kind !== "text" && kind !== "choice" && kind !== "yesno") fieldErrors[`q${i}_kind`] = ["Choose a kind"];
    if (kind === "choice" && options.length < 2) fieldErrors[`q${i}_options`] = ["Give at least two options, separated by commas"];
    questions.push({ id: String(fd.get(`q${i}_id`) || createId()), label, kind: kind as SignupQuestion["kind"], options: kind === "choice" ? options : [], required: fd.get(`q${i}_required`) === "on" });
  }
  if (questions.length > MAX_SIGNUP_QUESTIONS) return { error: `Up to ${MAX_SIGNUP_QUESTIONS} questions. Remove one.` };
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Check the highlighted questions." };
  await db.update(schema.organizations).set({ signupQuestions: questions }).where(eq(schema.organizations.id, user.orgId));
  await audit(user.id, "org.signup_questions", "organization", user.orgId, { count: questions.length });
  revalidatePath("/settings/students");
  return { ok: questions.length ? `Saved ${questions.length} question${questions.length === 1 ? "" : "s"}.` : "Saved. The form asks only the standard questions." };
}
