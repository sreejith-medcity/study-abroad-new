"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/lib/auth";

export type LoginState = { error?: string };

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const ok = await signIn(parsed.data.email, parsed.data.password);
  if (!ok) return { error: "That email and password don't match an active account." };
  redirect("/");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}
