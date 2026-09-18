"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUserAllowingPasswordChange } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const schemaShape = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "The two new passwords don't match", path: ["confirmPassword"] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "Choose a different password", path: ["newPassword"] });

export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await requireUserAllowingPasswordChange();
  const parsed = schemaShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };

  const problem = passwordProblem(parsed.data.newPassword, [session.email, session.name]);
  if (problem) return { error: problem, fieldErrors: { newPassword: [problem] } };

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.id) });
  if (!user) return { error: "Account not found." };
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return { error: "Your current password is not right.", fieldErrors: { currentPassword: ["Incorrect"] } };
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false, passwordUpdatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await audit(user.id, "user.password_change", "user", user.id);
  redirect("/");
}
