import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, PARTNER_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { unassignedWhere } from "@/server/unassigned-files";

/**
 * The numbers that belong on the menu.
 *
 * A menu that only lists where you can go is a menu you read once and then
 * navigate by memory. The same menu carrying what is waiting behind each
 * entry is the first thing somebody looks at in the morning: the queue says
 * fourteen, the enquiries say two overdue, and nobody has to open a screen to
 * find out there was nothing on it.
 *
 * Cost matters, because this runs on every page for every person. It is one
 * round trip: the counts are scalar subqueries in a single statement, each
 * one over an indexed column, and a person is only charged for the ones their
 * role can actually see. A badge nobody is allowed to act on is not worth a
 * millisecond.
 */
export type NavCounts = Record<string, { count: number; tone?: "stop" | "warn" }>;

export async function navCounts(user: SessionUser): Promise<NavCounts> {
  const staff = isStaff(user);
  const processing = (PROCESSING_ROLES as readonly string[]).includes(user.role);
  const partner = (PARTNER_ROLES as readonly string[]).includes(user.role);

  // Each entry: the menu path it belongs to, and the SQL for its number.
  // Left out entirely when the role has no business with it.
  const wanted: { href: string; tone?: "stop" | "warn"; sql: ReturnType<typeof sql> }[] = [];

  if (processing) {
    // Students with a document waiting, not documents: one student's seven
    // uploads are one file to pick up, and 139 items read as 139 people.
    wanted.push({
      href: "/documentation",
      tone: "warn",
      sql: sql`(select count(distinct student_id) from checklist_items where state in ('UPLOADED','IN_REVIEW'))`,
    });
    wanted.push({
      href: "/program-options",
      tone: "warn",
      sql: sql`(select count(*) from option_requests where status = 'REQUESTED' and archived = false)`,
    });
  }

  // Files the branches have handed over that nobody has been given yet, on
  // the work queue, where they are handed out. Counted under the same
  // conditions as the Unassigned view (server/unassigned-files.ts), so the
  // badge and the view are the same number.
  if (processing && (await can(user, "SEE_UNASSIGNED_FILES"))) {
    wanted.push({
      href: "/admin/queue",
      tone: "warn",
      sql: sql`(select count(*) from applications where ${await unassignedWhere(user)})`,
    });
  }

  if (staff) {
    wanted.push({
      href: "/applications",
      tone: "warn",
      sql: sql`(select count(*) from applications a join status_definitions sd on sd.id = a.status_id where sd."group" = 'PENDING_PARTNER')`,
    });
  } else {
    // A branch sees only its own, which is the whole point of the number.
    wanted.push({
      href: "/applications",
      tone: "warn",
      sql: sql`(select count(*) from applications a join status_definitions sd on sd.id = a.status_id
                where sd."group" = 'PENDING_PARTNER' and a.org_id = ${user.orgId})`,
    });
  }

  // Follow-ups that are already late. Amber would undersell it: a call you
  // said you would make yesterday and did not is the one red thing a
  // counsellor has.
  wanted.push({
    href: "/enquiries",
    tone: "stop",
    sql: staff
      ? sql`(select count(*) from enquiries where stage in ('NEW','CONTACTED','QUALIFIED','COUNSELLING') and next_follow_up_at < now())`
      : sql`(select count(*) from enquiries where stage in ('NEW','CONTACTED','QUALIFIED','COUNSELLING') and next_follow_up_at < now() and org_id = ${user.orgId})`,
  });

  // My day is a list of tasks, and the badge counts the ones that are due:
  // overdue or today. Anything later is not a thing to do this morning, and
  // a number that disagrees with the screen it opens is worse than none.
  if (partner || processing) {
    wanted.push({
      href: "/my-day",
      tone: "stop",
      sql: sql`(select count(*) from tasks
                where done_at is null and assigned_to_id = ${user.id}
                  and due_on is not null and due_on <= current_date)`,
    });
  }

  if (wanted.length === 0) return {};

  // One statement, one trip. The columns are named c0, c1 and so on because
  // a path is not an identifier.
  const columns = sql.join(
    wanted.map((w, i) => sql`${w.sql}::int as c${sql.raw(String(i))}`),
    sql`, `,
  );
  let row: Record<string, number> | undefined;
  try {
    const result = await db.execute(sql`select ${columns}`);
    row = (result as unknown as { rows?: Record<string, number>[] }).rows?.[0] ?? (result as unknown as Record<string, number>[])[0];
  } catch {
    // The menu is not worth a broken page. Without numbers it is still a menu.
    return {};
  }
  if (!row) return {};

  const out: NavCounts = {};
  wanted.forEach((w, i) => {
    const n = Number(row[`c${i}`] ?? 0);
    if (n > 0) out[w.href] = { count: n, tone: w.tone };
  });
  return out;
}
