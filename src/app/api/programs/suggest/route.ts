import { and, asc, count, eq, ilike, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const LIMIT = 8;

/**
 * Course names and study areas that begin with what is being typed, for the
 * finder's course box. Names come from the live catalogue itself, so a
 * counsellor can pick a course the catalogue actually holds rather than
 * guessing at its wording; what they type stands on its own either way.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !(APP_ROLES as readonly string[]).includes(user.role)) return new Response("Not allowed", { status: 403 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ areas: [], courses: [] });
  const { programs: p } = schema;
  const like = `${q.replace(/[%_\\]/g, "\\$&")}%`;

  const [areas, courses] = await Promise.all([
    db
      .select({ value: p.studyArea, n: count() })
      .from(p)
      .where(and(eq(p.status, "LIVE"), sql`${p.studyArea} is not null`, ilike(p.studyArea, like)))
      .groupBy(p.studyArea)
      .orderBy(sql`count(*) desc`)
      .limit(4),
    db
      .select({ value: p.name, n: count() })
      .from(p)
      .where(and(eq(p.status, "LIVE"), ilike(p.name, like)))
      .groupBy(p.name)
      .orderBy(sql`count(*) desc`, asc(p.name))
      .limit(LIMIT),
  ]);
  return Response.json({
    areas: areas.filter((a) => a.value).map((a) => ({ value: a.value as string, n: a.n })),
    courses: courses.map((c) => ({ value: c.value, n: c.n })),
  });
}
