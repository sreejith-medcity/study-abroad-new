import "server-only";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { ENQUIRY_OWNER } from "@/server/calling";
import { updateTracked } from "@/server/record-history";

const { tasks: tk } = schema;

/*
 * An enquiry's next follow-up, held as a task.
 *
 * An enquiry with a follow-up date and still open holds exactly one open task,
 * on its owner's desk (whoever it is assigned to, or whoever entered it while
 * nobody is), due that India day. Moving the date moves the task; giving the
 * enquiry to somebody else moves it to their desk; clearing the date, losing
 * the enquiry or registering it as a student takes the task away. Logging a
 * call or a conversation with an outcome finishes the task, and the next date
 * that call set raises a fresh one, so a follow-up done late is recorded as
 * done late rather than quietly moved.
 *
 * Done in three statements over whichever enquiries are named, so the same
 * code serves one enquiry after a save, a bulk upload, and the catch-up the
 * calling queue and My day run for the person reading them. A partial unique
 * index (one open task per enquiry) makes a double save harmless.
 */

const OWNER = ENQUIRY_OWNER;
const WANTS_TASK = sql`e.stage in ('NEW','CONTACTED','QUALIFIED','COUNSELLING') and e.next_follow_up_at is not null and ${OWNER} is not null`;
const DUE = sql`(e.next_follow_up_at at time zone 'Asia/Kolkata')::date`;

async function syncWhere(which: SQL) {
  // The ones that no longer stand for a follow-up: no date, or closed.
  await db.execute(sql`
    delete from tasks t using enquiries e
    where t.enquiry_id = e.id and t.done_at is null and (${which}) and not (${WANTS_TASK})`);
  // The ones whose date, owner or branch moved.
  await db.execute(sql`
    update tasks t set due_on = ${DUE}, assigned_to_id = ${OWNER}, org_id = e.org_id, title = 'Follow up with ' || e.name, updated_at = now()
    from enquiries e
    where t.enquiry_id = e.id and t.done_at is null and (${which}) and ${WANTS_TASK}
      and (t.due_on <> ${DUE} or t.assigned_to_id <> ${OWNER} or t.org_id <> e.org_id or t.title <> 'Follow up with ' || e.name)`);
  // The ones that should have a task and do not.
  await db.execute(sql`
    insert into tasks (id, org_id, enquiry_id, kind, title, due_on, assigned_to_id, source)
    select replace(gen_random_uuid()::text, '-', ''), e.org_id, e.id, 'CALL', 'Follow up with ' || e.name, ${DUE}, ${OWNER}, 'an enquiry'
    from enquiries e
    where (${which}) and ${WANTS_TASK}
      and not exists (select 1 from tasks t where t.enquiry_id = e.id and t.done_at is null)
    on conflict do nothing`);
}

/** After an enquiry is saved: its one open follow-up task matches it. */
export const syncEnquiryFollowUp = (enquiryId: string) => syncWhere(sql`e.id = ${enquiryId}`);

/** After a bulk change to many enquiries. */
export async function syncEnquiryFollowUps(enquiryIds: string[]) {
  for (let i = 0; i < enquiryIds.length; i += 500) {
    const ids = enquiryIds.slice(i, i + 500);
    await syncWhere(sql`e.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  }
}

/**
 * Every enquiry this person owns, so a follow-up date set before tasks were
 * kept for enquiries, or by a path that did not say so, still reaches their
 * desk the next time they open it.
 */
export function syncFollowUpsOwnedBy(userIds: string[]) {
  if (!userIds.length) return Promise.resolve();
  const ids = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
  // Also the enquiries whose open follow-up still sits on one of these desks,
  // so a task left behind by a path that did not sync (an owner changed, a
  // date restored from the history) leaves the wrong desk too.
  return syncWhere(sql`(${OWNER} in (${ids}) or e.id in (select ot.enquiry_id from tasks ot where ot.enquiry_id is not null and ot.done_at is null and ot.assigned_to_id in (${ids})))`);
}

/**
 * The call or conversation that was the follow-up: the open task is finished,
 * by whoever made it, with what came of it as the note. Returns the task, if
 * there was one.
 */
export async function finishEnquiryFollowUp(enquiryId: string, byId: string, note: string | null): Promise<string | null> {
  const [done] = await db
    .update(tk)
    .set({ doneAt: new Date(), doneById: byId, doneNote: note?.slice(0, 300) ?? null, updatedAt: new Date() })
    .where(and(eq(tk.enquiryId, enquiryId), isNull(tk.doneAt)))
    .returning({ id: tk.id });
  return done?.id ?? null;
}

/**
 * The other way round: an enquiry's follow-up task was changed by hand on a
 * desk (done, pushed, reopened, deleted, re-dated), so the enquiry's date
 * follows it. Without this the next sync would put back what the person just
 * changed: a task ticked off would be raised again for the same day.
 */
export async function followTask(enquiryId: string | null | undefined, byId: string) {
  if (!enquiryId) return;
  const [open] = await db.select({ dueOn: tk.dueOn }).from(tk).where(and(eq(tk.enquiryId, enquiryId), isNull(tk.doneAt))).limit(1);
  const want = open ? new Date(`${open.dueOn}T00:00:00Z`) : null;
  // Through the record history like every other change to an enquiry; a date
  // that already matches the task writes nothing.
  await updateTracked(
    "enquiry",
    enquiryId,
    { nextFollowUpAt: want, updatedAt: new Date() },
    {
      by: byId,
      action: "enquiry.follow_up_task",
      where: and(
        sql`${schema.enquiries.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')`,
        want ? sql`${schema.enquiries.nextFollowUpAt} is distinct from ${want.toISOString()}::timestamptz` : sql`${schema.enquiries.nextFollowUpAt} is not null`,
      ),
    },
  );
  // Then the task matches the enquiry again: one put back on an enquiry that
  // has since been lost or registered goes, and one on the wrong desk moves.
  // This never calls back into followTask, so the two cannot loop.
  await syncEnquiryFollowUp(enquiryId);
}
