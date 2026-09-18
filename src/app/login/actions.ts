"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/lib/auth";

export type LoginState = { error?: string };

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };

  const head = await headers();
  const clientKey = (head.get("x-forwarded-for") ?? head.get("x-real-ip") ?? "unknown").split(",")[0].trim();

  const result = await signIn(parsed.data.email, parsed.data.password, clientKey);
  if (!result.ok) {
    if (result.reason === "throttled") {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
      return { error: `Too many attempts. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}.` };
    }
    return { error: "That email and password don't match an active account." };
  }
  redirect("/");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}
