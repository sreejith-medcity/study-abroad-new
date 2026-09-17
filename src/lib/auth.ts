import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Role } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";

const COOKIE = "sa_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return new TextEncoder().encode(s);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
  orgName: string;
  orgType: "HQ" | "BRANCH" | "SUB_AGENT";
  mustChangePassword: boolean;
};

export type SignInResult = { ok: true } | { ok: false; reason: "invalid" } | { ok: false; reason: "throttled"; retryAfterSeconds: number };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function signIn(email: string, password: string, clientKey = "unknown"): Promise<SignInResult> {
  const address = email.trim().toLowerCase();
  // Two limits: one per account, one per caller, so neither a single target nor a single source can be hammered.
  for (const key of [`login:email:${address}`, `login:client:${clientKey}`]) {
    const check = rateLimit(key, { limit: 8, windowMs: 10 * 60_000, blockMs: 10 * 60_000 });
    if (!check.allowed) return { ok: false, reason: "throttled", retryAfterSeconds: check.retryAfterSeconds };
  }

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, address) });
  if (!user || !user.active) return { ok: false, reason: "invalid" };
  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return { ok: false, reason: "invalid" };

  await issueSession(user.id);
  await db.update(schema.users).set({ lastSignInAt: new Date() }).where(eq(schema.users.id, user.id));
  return { ok: true };
}

export async function issueSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, payload.sub),
      with: { org: true },
    });
    if (!user || !user.active) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      orgName: user.org.name,
      orgType: user.org.type,
      mustChangePassword: user.mustChangePassword,
    };
  } catch {
    return null;
  }
});

/**
 * Use in server components and actions. Redirects to login when signed out, and to
 * the password change page while a temporary password is still in place.
 */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (roles && !roles.includes(user.role)) redirect("/forbidden");
  return user;
}

/** Like requireUser but allowed while the password still needs changing. */
export async function requireUserAllowingPasswordChange(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}
