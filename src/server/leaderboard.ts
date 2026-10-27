import "server-only";
import { asc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONNECTED_OUTCOMES } from "@/lib/crm";
import { istAt, nextDay } from "@/lib/journal";
import { compareLeaders, leaderboardFigures, type LeaderboardFigures, type Period } from "@/lib/leaderboard";
import { ADMIN_ROLES, COUNSELLING_ROLES } from "@/lib/permissions";
import { ENQUIRY_OWNER } from "@/server/calling";

/** Who reads the leaderboard: the head office for every branch, a branch head for their own. */
export const LEADERBOARD_ROLES = [...ADMIN_ROLES, "MANAGEMENT", "PARTNER"] as const;
export const readsLeaderboard = (user: { role: string; orgType: string }) =>
  (LEADERBOARD_ROLES as readonly string[]).includes(user.role) && (user.role !== "PARTNER" || user.orgType === "BRANCH");
/** Who it lists: the people who call and follow up, at the head office desk and the branches. */
const LISTED_ROLES = [...COUNSELLING_ROLES, "PARTNER"];

export type LeaderRow = { id: string; name: string; branch: string; orgId: string; f: LeaderboardFigures };

/** The branches a reader may pick from, and the one they are held to, if any. */
export async function leaderboardBranches(user: { role: string; orgId: string }) {
  const rows = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, type: schema.organizations.type })
    .from(schema.organizations)
    .where(inArray(schema.organizations.type, ["HQ", "BRANCH"]))
    .orderBy(asc(schema.organizations.type), asc(schema.organizations.name));
  if (user.role === "PARTNER") return { options: rows.filter((r) => r.id === user.orgId), locked: user.orgId };
  return { options: rows, locked: null as string | null };
}

/**
 * Each person's recorded work over the period, India days inclusive.
 *
 * Calls and connected calls are read from the contact history (students and
 * enquiries alike), follow-ups from the call and follow-up tasks on their desk
 * that were finished in the period, on time when finished on or before the day they were due,
 * and conversions from enquiries they held whose student was registered in
 * the period. An enquiry merged into another is the same person counted
 * once, on the enquiry that carries on.
 */
export async function leaderboard(period: Period, orgId: string | null): Promise<LeaderRow[]> {
  const from = istAt(period.from, "00:00").toISOString();
  const to = istAt(nextDay(period.to), "00:00").toISOString();
  const connected = sql.join(CONNECTED_OUTCOMES.map((o) => sql`${o}`), sql`, `);
  const roles = sql.join(LISTED_ROLES.map((r) => sql`${r}`), sql`, `);
  const rows = await db.execute<{
    id: string;
    name: string;
    branch: string;
    org_id: string;
    calls: number;
    connected: number;
    on_time: number;
    late: number;
    converted: number;
    held: number;
  }>(sql`
    select u.id, u.name, o.name as branch, o.id as org_id,
      (select count(*) from contact_log c where c.by_id = u.id and c.channel = 'CALL'
         and c.created_at >= ${from}::timestamptz and c.created_at < ${to}::timestamptz)::int as calls,
      (select count(*) from contact_log c where c.by_id = u.id and c.channel = 'CALL' and c.outcome::text in (${connected})
         and c.created_at >= ${from}::timestamptz and c.created_at < ${to}::timestamptz)::int as connected,
      (select count(*) from tasks t where t.assigned_to_id = u.id and t.kind in ('CALL', 'FOLLOW_UP')
         and t.done_at >= ${from}::timestamptz and t.done_at < ${to}::timestamptz
         and (t.done_at at time zone 'Asia/Kolkata')::date <= t.due_on)::int as on_time,
      (select count(*) from tasks t where t.assigned_to_id = u.id and t.kind in ('CALL', 'FOLLOW_UP')
         and t.done_at >= ${from}::timestamptz and t.done_at < ${to}::timestamptz
         and (t.done_at at time zone 'Asia/Kolkata')::date > t.due_on)::int as late,
      (select count(*) from enquiries e join students s on s.id = e.student_id
         where ${ENQUIRY_OWNER} = u.id and e.stage = 'CONVERTED' and s.created_at >= ${from}::timestamptz and s.created_at < ${to}::timestamptz)::int as converted,
      (select count(*) from enquiries e where ${ENQUIRY_OWNER} = u.id and e.stage <> 'MERGED' and e.created_at < ${to}::timestamptz)::int as held
    from users u join organizations o on o.id = u.org_id
    where u.active and o.type in ('HQ', 'BRANCH') and u.role::text in (${roles})
      ${orgId ? sql`and o.id = ${orgId}` : sql``}`);
  const out = rows.map((r) => ({
    id: r.id,
    name: r.name,
    branch: r.branch,
    orgId: r.org_id,
    f: leaderboardFigures({ calls: r.calls, connected: r.connected, onTime: r.on_time, late: r.late, converted: r.converted, enquiriesHeld: r.held }),
  }));
  return out.sort(compareLeaders);
}
