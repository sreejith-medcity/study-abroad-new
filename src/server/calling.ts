import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CALLING_LIVE_ON, CALLING_ROLES, FIRST_JOURNEY_STAGE, callReason, orderQueue, queueKey, readsTeamQueue, type CallKind, type CallReason } from "@/lib/calling";
import { CONNECTED_OUTCOMES } from "@/lib/crm";
import { istAt, istDay, nextDay } from "@/lib/journal";
import type { EnquiryStage, JourneyStage } from "@/db/schema";

const { users: us } = schema;

export type QueueItem = {
  key: string;
  kind: CallKind;
  id: string;
  name: string;
  phone: string;
  whatsapp: boolean;
  orgId: string;
  ownerId: string;
  reason: CallReason;
  dueOn: string | null;
  createdAt: Date;
  /** Enquiry stage, or the student's journey stage. */
  stage: string;
  enquiryStage: EnquiryStage | null;
  lastCallAt: Date | null;
};

type Raw = {
  id: string;
  name: string;
  phone: string;
  whatsapp: boolean;
  org_id: string;
  owner_id: string;
  stage: string;
  created_at: Date | string;
  contacted: boolean;
  due_on: string | null;
  last_call_at: Date | string | null;
};

const asDate = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v : new Date(v));
const asDay = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
/**
 * Who an enquiry's follow-up belongs to: whoever it is assigned to, or while
 * nobody is, whoever entered it. A sub-agent's referral is entered by the
 * sub-agent, who does not follow it up, so it belongs to nobody until it is
 * given to somebody.
 */
export const ENQUIRY_OWNER = sql.raw("coalesce(e.assigned_to_id, case when e.submitted_by_org_id is null then e.created_by_id end)");

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * The enquiries and students these people own that need a call today:
 * never contacted, a follow-up gone past, or one due today. Owned means the
 * enquiry or student is assigned to them, or they entered it and nobody else
 * has been given it, which is the same rule the student lists apply.
 *
 * An enquiry's follow-up is its date; a student's is the earliest open call or
 * follow-up task on the owner's desk for them. A student registered from an
 * enquiry counts as contacted, because somebody spoke to them to get there,
 * and so does one registered before calling mode went live who has moved past
 * the first journey stage (studentAwaitsFirstCall says why).
 */
export async function queueFor(ownerIds: string[], today = istDay(), only?: { kind: CallKind; id: string }): Promise<QueueItem[]> {
  if (!ownerIds.length) return [];
  const owners = idList(ownerIds);
  // In the order the queue is worked (not contacted, then the oldest date,
  // then the newest record), so what the cap leaves out is the least urgent;
  // and per person, so a branch head's team queue is not cut at 300 for
  // everybody together.
  const cap = 300 * ownerIds.length;
  const liveFrom = istAt(CALLING_LIVE_ON, "00:00").toISOString();
  const enquiryRows = only?.kind === "STUDENT" ? [] : await db.execute<Raw>(sql`
    select e.id, e.name, e.phone, true as whatsapp, e.org_id, ${ENQUIRY_OWNER} as owner_id,
      e.stage::text as stage, e.created_at,
      (e.last_contacted_at is not null or exists (select 1 from contact_log c where c.enquiry_id = e.id)) as contacted,
      to_char((e.next_follow_up_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as due_on,
      (select max(c.happened_at) from contact_log c where c.enquiry_id = e.id and c.channel = 'CALL') as last_call_at
    from enquiries e
    where e.stage in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')
      and ${ENQUIRY_OWNER} in (${owners})
      ${only ? sql`and e.id = ${only.id}` : sql`and (
        not (e.last_contacted_at is not null or exists (select 1 from contact_log c where c.enquiry_id = e.id))
        or (e.next_follow_up_at at time zone 'Asia/Kolkata')::date <= ${today}::date)`}
    order by contacted, due_on nulls first, created_at desc
    limit ${cap}`);
  const studentRows = only?.kind === "ENQUIRY" ? [] : await db.execute<Raw>(sql`
    select * from (
      select s.id, s.first_name || ' ' || s.last_name as name, s.phone, s.whatsapp_opt_in as whatsapp, s.org_id,
        coalesce(s.assigned_to_id, s.created_by_id) as owner_id, s.journey_stage::text as stage, s.created_at,
        (exists (select 1 from contact_log c where c.student_id = s.id) or exists (select 1 from enquiries q where q.student_id = s.id)
          or not (s.created_at >= ${liveFrom}::timestamptz or s.journey_stage::text = ${FIRST_JOURNEY_STAGE})) as contacted,
        (select to_char(min(t.due_on), 'YYYY-MM-DD') from tasks t
          where t.student_id = s.id and t.done_at is null and t.kind in ('CALL','FOLLOW_UP')
            and t.assigned_to_id = coalesce(s.assigned_to_id, s.created_by_id)) as due_on,
        (select max(c.happened_at) from contact_log c where c.student_id = s.id and c.channel = 'CALL') as last_call_at
      from students s
      where not s.archived and s.journey_stage <> 'ARRIVED'
        and coalesce(s.assigned_to_id, s.created_by_id) in (${owners})
        ${only ? sql`and s.id = ${only.id}` : sql``}
    ) x
    ${only ? sql`` : sql`where not x.contacted or x.due_on <= ${today}`}
    order by x.contacted, x.due_on nulls first, x.created_at desc
    limit ${cap}`);

  const out: QueueItem[] = [];
  const add = (kind: CallKind, r: Raw) => {
    const dueOn = asDay(r.due_on);
    const reason = callReason({ contacted: !!r.contacted, dueOn }, today);
    // A record opened by name is shown whatever its standing, as due today
    // where it is not due at all, so the outcome buttons still work on it.
    if (!reason && !only) return;
    out.push({
      key: queueKey(kind, r.id),
      kind,
      id: r.id,
      name: r.name,
      phone: r.phone,
      whatsapp: !!r.whatsapp,
      orgId: r.org_id,
      ownerId: r.owner_id,
      reason: reason ?? "DUE_TODAY",
      dueOn,
      createdAt: asDate(r.created_at)!,
      stage: r.stage,
      enquiryStage: kind === "ENQUIRY" ? (r.stage as EnquiryStage) : null,
      lastCallAt: asDate(r.last_call_at),
    });
  };
  for (const r of enquiryRows) add("ENQUIRY", r);
  for (const r of studentRows) add("STUDENT", r);
  return orderQueue(out);
}

/** Calls each person logged today, and how many reached somebody: students and enquiries together. */
export async function callCounters(userIds: string[], day = istDay()): Promise<Map<string, { calls: number; connected: number }>> {
  const out = new Map(userIds.map((id) => [id, { calls: 0, connected: 0 }]));
  if (!userIds.length) return out;
  const cl = schema.contactLog;
  const rows = await db
    .select({
      who: cl.byId,
      calls: sql<number>`count(*)::int`,
      connected: sql<number>`(count(*) filter (where ${inArray(cl.outcome, [...CONNECTED_OUTCOMES])}))::int`,
    })
    .from(cl)
    .where(and(inArray(cl.byId, userIds), eq(cl.channel, "CALL"), sql`${cl.createdAt} >= ${istAt(day, "00:00").toISOString()}::timestamptz`, sql`${cl.createdAt} < ${istAt(nextDay(day), "00:00").toISOString()}::timestamptz`))
    .groupBy(cl.byId);
  for (const r of rows) if (r.who) out.set(r.who, { calls: r.calls, connected: r.connected });
  return out;
}

/** The people whose queues a branch head reads: everybody at the branch who works a queue, the head included. */
export async function teamFor(user: { role: string; orgId: string }) {
  if (!readsTeamQueue(user.role)) return [];
  return db
    .select({ id: us.id, name: us.name, deskLabel: us.deskLabel, role: us.role })
    .from(us)
    .where(and(eq(us.orgId, user.orgId), eq(us.active, true), inArray(us.role, [...CALLING_ROLES])))
    .orderBy(asc(us.name));
}

/**
 * Whether this person may log a call on this record from calling mode: their
 * own, or for a branch head anything of their branch.
 */
export function mayCall(user: { id: string; role: string; orgId: string }, item: { ownerId: string; orgId: string }) {
  if (item.ownerId === user.id) return true;
  return readsTeamQueue(user.role) && item.orgId === user.orgId;
}

/** One record by key, for logging an outcome against it, with its owner and branch. */
export async function recordFor(kind: CallKind, id: string): Promise<QueueItem | null> {
  if (kind === "ENQUIRY") {
    const e = await db.query.enquiries.findFirst({ where: eq(schema.enquiries.id, id) });
    if (!e) return null;
    return {
      key: queueKey(kind, id),
      kind,
      id,
      name: e.name,
      phone: e.phone,
      whatsapp: true,
      orgId: e.orgId,
      ownerId: e.assignedToId ?? (e.submittedByOrgId ? "" : e.createdById),
      reason: "DUE_TODAY",
      dueOn: e.nextFollowUpAt ? istDay(e.nextFollowUpAt) : null,
      createdAt: e.createdAt,
      stage: e.stage,
      enquiryStage: e.stage,
      lastCallAt: null,
    };
  }
  const s = await db.query.students.findFirst({ where: eq(schema.students.id, id) });
  if (!s) return null;
  return {
    key: queueKey(kind, id),
    kind,
    id,
    name: `${s.firstName} ${s.lastName}`,
    phone: s.phone,
    whatsapp: s.whatsappOptIn,
    orgId: s.orgId,
    ownerId: s.assignedToId ?? s.createdById ?? "",
    reason: "DUE_TODAY",
    dueOn: null,
    createdAt: s.createdAt,
    stage: s.journeyStage as JourneyStage,
    enquiryStage: null,
    lastCallAt: null,
  };
}

/** The last few conversations on the record, newest first. */
export async function recentContacts(kind: CallKind, id: string, limit = 6) {
  const cl = schema.contactLog;
  return db
    .select({ id: cl.id, at: cl.happenedAt, channel: cl.channel, outcome: cl.outcome, note: cl.note, by: us.name })
    .from(cl)
    .leftJoin(us, eq(us.id, cl.byId))
    .where(kind === "ENQUIRY" ? eq(cl.enquiryId, id) : eq(cl.studentId, id))
    .orderBy(sql`${cl.happenedAt} desc`)
    .limit(limit);
}
