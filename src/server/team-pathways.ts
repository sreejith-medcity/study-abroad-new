import "server-only";
import { and, asc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { mayPlaceOnTeam, pickTeamForPathways, type TeamPathwayLink } from "@/lib/team-pathways";
import { updateTrackedMany } from "@/server/record-history";

const { students: s, applications: a, programs: p, teamPathways: tp, teams: t, auditLogs: al } = schema;

/** The audit action a person choosing a file's team on the profile writes. */
const HAND_SET = "student.team";

/** Every pathway each team carries, with whether the team is still live. */
async function links(): Promise<TeamPathwayLink[]> {
  return db
    .select({ teamId: tp.teamId, pathway: tp.pathway, active: t.active })
    .from(tp)
    .innerJoin(t, eq(t.id, tp.teamId));
}

/**
 * The pathways on each of these files, in the order they arrived: the one
 * chosen at registration, then each application's, oldest first.
 */
async function pathwaysOf(studentIds: string[]) {
  const out = new Map<string, string[]>();
  if (!studentIds.length) return out;
  const own = await db.select({ id: s.id, pathway: s.preferredPathway }).from(s).where(inArray(s.id, studentIds));
  for (const r of own) out.set(r.id, r.pathway ? [r.pathway] : []);
  const apps = await db
    .select({ studentId: a.studentId, pathway: p.pathway })
    .from(a)
    .innerJoin(p, eq(p.id, a.programId))
    .where(inArray(a.studentId, studentIds))
    .orderBy(asc(a.createdAt));
  for (const r of apps) out.get(r.studentId)?.push(r.pathway);
  return out;
}

/** A team somebody chose, or cleared, on the profile at some point. */
const setByHandSql = () =>
  exists(
    db
      .select({ one: sql`1` })
      .from(al)
      .where(and(eq(al.entityType, "student"), eq(al.entityId, s.id), eq(al.action, HAND_SET))),
  );

/**
 * Puts these students on the team that carries their pathway, where the rule
 * in src/lib/team-pathways.ts says there is exactly one, and nobody has chosen
 * a team for them by hand. Called once a pathway reaches a file: at
 * registration, with an application, from a bulk upload or from the CRM. The
 * file's history says the team came from the pathway, and who was working
 * when it did.
 *
 * This is a convenience beside the work that called it, so a failure here is
 * logged and left: a student must not fail to save because a team could not
 * be picked. Returns how many files were put on a team.
 */
export async function placeOnPathwayTeam(studentIds: string | string[], by: string | null): Promise<number> {
  const ids = [...new Set(Array.isArray(studentIds) ? studentIds : [studentIds])];
  if (!ids.length) return 0;
  try {
    const all = await links();
    if (!all.some((l) => l.active)) return 0;
    let placed = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await db
        .select({ id: s.id, teamId: s.teamId, byHand: sql<boolean>`${setByHandSql()}` })
        .from(s)
        .where(inArray(s.id, ids.slice(i, i + 500)));
      const open = rows.filter((r) => mayPlaceOnTeam(r, !!r.byHand)).map((r) => r.id);
      const pathways = await pathwaysOf(open);
      const byTeam = new Map<string, string[]>();
      for (const id of open) {
        const teamId = pickTeamForPathways(pathways.get(id) ?? [], all);
        if (teamId) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), id]);
      }
      for (const [teamId, these] of byTeam) {
        const moved = await updateTrackedMany("student", and(inArray(s.id, these), isNull(s.teamId))!, { teamId }, { by, action: "student.team_from_pathway" });
        placed += moved.length;
      }
    }
    return placed;
  } catch (err) {
    console.error("Could not put students on a pathway team", ids.slice(0, 5), err);
    return 0;
  }
}

/**
 * The same rule, run once over the files already in the portal for one team:
 * the "Apply to existing students" button on the teams screen. Archived files
 * are left alone, and so is every file that has a team or had one chosen or
 * cleared by hand. Returns how many files it put on the team.
 */
export async function applyTeamToExisting(teamId: string, by: string): Promise<number> {
  const all = await links();
  const carried = all.filter((l) => l.teamId === teamId && l.active).map((l) => l.pathway as schema.Pathway);
  if (!carried.length) return 0;
  const candidates = await db
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        isNull(s.teamId),
        eq(s.archived, false),
        or(
          inArray(s.preferredPathway, carried),
          exists(
            db
              .select({ one: sql`1` })
              .from(a)
              .innerJoin(p, eq(p.id, a.programId))
              .where(and(eq(a.studentId, s.id), inArray(p.pathway, carried))),
          ),
        ),
        sql`not ${setByHandSql()}`,
      ),
    );
  let placed = 0;
  for (let i = 0; i < candidates.length; i += 500) {
    const chunk = candidates.slice(i, i + 500).map((c) => c.id);
    const pathways = await pathwaysOf(chunk);
    const ours = chunk.filter((id) => pickTeamForPathways(pathways.get(id) ?? [], all) === teamId);
    if (!ours.length) continue;
    const moved = await updateTrackedMany("student", and(inArray(s.id, ours), isNull(s.teamId))!, { teamId }, { by, action: "student.team_from_pathway" });
    placed += moved.length;
  }
  return placed;
}
