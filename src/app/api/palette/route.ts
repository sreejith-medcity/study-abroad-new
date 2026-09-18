import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export type PaletteHit = { kind: "student" | "application" | "partner"; label: string; hint: string; href: string };

/**
 * Feeds the command palette. Deliberately small: a few students, applications by
 * acknowledgement number, and partner organisations for the Medcity Overseas team.
 * Everything is scoped the same way the screens are, so the palette can never show
 * a partner a record they could not open.
 */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user || user.role === "STUDENT") return NextResponse.json({ hits: [] }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const like = `%${q}%`;
  const { students: s, applications: a, organizations: og, statusDefinitions: sd } = schema;

  const [students, applications, partners] = await Promise.all([
    db
      .select({ id: s.id, firstName: s.firstName, lastName: s.lastName, phone: s.phone, city: s.city })
      .from(s)
      .where(
        and(
          orgScope(user, s.orgId),
          or(ilike(sql`${s.firstName} || ' ' || ${s.lastName}`, like), ilike(s.phone, like), ilike(s.email, like)),
        ),
      )
      .orderBy(asc(s.firstName))
      .limit(6),
    db
      .select({ id: a.id, ackNo: a.ackNo, studentId: a.studentId, label: sd.label })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(orgScope(user, a.orgId), ilike(a.ackNo, like)))
      .limit(5),
    isStaff(user)
      ? db.select({ id: og.id, name: og.name, city: og.city }).from(og).where(ilike(og.name, like)).limit(4)
      : Promise.resolve([]),
  ]);

  const hits: PaletteHit[] = [
    ...students.map((r) => ({
      kind: "student" as const,
      label: `${r.firstName} ${r.lastName}`,
      hint: [r.city, r.phone].filter(Boolean).join(" · "),
      href: `/students/${r.id}/profile`,
    })),
    ...applications.map((r) => ({
      kind: "application" as const,
      label: r.ackNo,
      hint: r.label,
      href: `/students/${r.studentId}/applications?app=${r.id}`,
    })),
    ...partners.map((r) => ({
      kind: "partner" as const,
      label: r.name,
      hint: r.city ?? "Partner",
      href: `/admin/partners#org-${r.id}`,
    })),
  ];

  return NextResponse.json({ hits });
}
