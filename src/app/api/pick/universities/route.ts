import { NextResponse } from "next/server";
import { and, asc, eq, ilike } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { PROCESSING_ROLES } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Feeds the university box on "Add a course".
 *
 * The desk types the name; if it is already in the catalogue they pick it, and
 * the course joins that university instead of creating a second spelling of
 * it. Two rows for "University of Chester" is how a catalogue rots.
 */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user || !(PROCESSING_ROLES as readonly string[]).includes(user.role)) return NextResponse.json({ options: [] }, { status: 401 });

  const u = schema.universities;
  const c = schema.countries;
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const country = sp.get("country") ?? "";
  const rows = await db
    .select({ id: u.id, name: u.name, city: u.city, country: c.name, code: c.code })
    .from(u)
    .innerJoin(c, eq(u.countryId, c.id))
    .where(and(q ? ilike(u.name, `%${q}%`) : undefined, country ? eq(c.code, country) : undefined))
    .orderBy(asc(u.name))
    .limit(25);

  return NextResponse.json({
    options: rows.map((r) => ({
      id: r.id,
      label: r.name,
      sub: [r.city, r.country].filter(Boolean).join(", "),
      data: { countryCode: r.code },
    })),
  });
}
