import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { applyOptions } from "@/server/apply-options";

export const dynamic = "force-dynamic";

/**
 * Feeds the course picker on a student's apply tab, one keystroke at a time.
 *
 * Scoped the same way the screen is: the student has to be one this person may
 * open, so the picker can never be used to learn that somebody else's student
 * exists.
 */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user || !(APP_ROLES as readonly string[]).includes(user.role)) return NextResponse.json({ options: [] }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const studentId = sp.get("student") ?? "";
  if (!studentId) return NextResponse.json({ options: [] }, { status: 400 });
  try {
    await getStudentForUser(user, studentId);
  } catch {
    return NextResponse.json({ options: [] }, { status: 403 });
  }

  const programs = await applyOptions(user, {
    studentId,
    q: sp.get("q") ?? "",
    country: sp.get("country") ?? "",
    pathway: sp.get("pathway") ?? "",
    limit: 25,
  });
  return NextResponse.json({
    options: programs.map((x) => ({
      id: x.id,
      label: x.name,
      sub: `${x.university}, ${x.country}${x.tuition ? ` · ${x.tuition}` : ""}`,
      tag: x.shortlisted ? "Shortlisted" : undefined,
      data: x,
    })),
  });
}
