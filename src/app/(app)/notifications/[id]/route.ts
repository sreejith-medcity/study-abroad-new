import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";

/** Marks a notification read and follows its link. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { id } = await params;
  const [n] = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)))
    .returning();
  const target = n?.href && n.href.startsWith("/") ? n.href : "/notifications";
  return NextResponse.redirect(new URL(target, req.url));
}
