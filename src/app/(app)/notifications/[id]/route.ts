import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";

/**
 * Where a notification is allowed to send somebody.
 *
 * Inside this portal and nowhere else. A path beginning with two slashes is
 * an address on another site written without its scheme, so "//example.com"
 * reads as a path and lands somewhere else entirely; a backslash is read as
 * a slash by some browsers and does the same thing.
 */
function ownPath(href: string | null | undefined) {
  if (!href) return null;
  if (!href.startsWith("/")) return null;
  if (href.startsWith("//") || href.startsWith("/\\")) return null;
  return href;
}

// NextResponse.redirect insists on an absolute address, which is the very
// thing there is no safe way to know here, so the header is set directly.
// A relative Location is what the HTTP specification asks for and what every
// browser has resolved against the current page for thirty years.
const sendTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

/**
 * Marks a notification read and follows its link.
 *
 * The address is sent back relative, which the browser resolves against the
 * page it asked from. It used to be built from the server's own request URL,
 * and that is the address the server is bound to rather than the one the
 * person is reading: behind a proxy, or on a machine bound to 0.0.0.0, every
 * notification click landed on https://0.0.0.0:3000, which is not an address
 * a browser can go to at all. Relative needs no guess about which name the
 * site is being read under, so there is nothing left to get wrong.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return sendTo("/login");
  const { id } = await params;
  const [n] = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)))
    .returning();
  // 303 rather than 307: this GET has just written something, and the
  // browser should follow with a fresh GET of the page it is sent to.
  return sendTo(ownPath(n?.href) ?? "/notifications");
}
