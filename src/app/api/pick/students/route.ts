import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { fullName } from "@/lib/format";
import { studentWhere } from "@/server/scope";

export const dynamic = "force-dynamic";

/**
 * Feeds the "check eligibility for…" picker on the search screen.
 *
 * It replaced a select holding the first three hundred students by first name.
 * Past that, a student could not be picked at all, and worse: arriving from
 * their own file, their name was not among the options, so the browser fell
 * back to the first one and the next filter quietly dropped them.
 */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user || !(APP_ROLES as readonly string[]).includes(user.role)) return NextResponse.json({ options: [] }, { status: 401 });

  const s = schema.students;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const like = `%${q}%`;
  // The same question the students list asks about whose students, so a
  // counsellor who sees only their own cannot pick another counsellor's here
  // and read their scores through the eligibility check.
  const rows = await db
    .select({ id: s.id, firstName: s.firstName, lastName: s.lastName, medcityId: s.medcityId, phone: s.phone })
    .from(s)
    .where(
      and(
        eq(s.archived, false),
        await studentWhere(user),
        q ? or(ilike(s.firstName, like), ilike(s.lastName, like), ilike(s.medcityId, like), ilike(s.phone, like)) : undefined,
      ),
    )
    .orderBy(asc(s.firstName))
    .limit(25);

  return NextResponse.json({
    options: rows.map((r) => ({
      id: r.id,
      label: fullName(r),
      sub: [r.medcityId, r.phone].filter(Boolean).join(" · "),
    })),
  });
}
