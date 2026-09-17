import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Role } from "@/db/schema";

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
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function signIn(email: string, password: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email.trim().toLowerCase()),
  });
  if (!user || !user.active) return false;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return false;
  const token = await new SignJWT({ sub: user.id })
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
  return true;
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
    };
  } catch {
    return null;
  }
});

/** Use in server components and actions. Redirects to login when signed out. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/forbidden");
  return user;
}
