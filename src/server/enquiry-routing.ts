import "server-only";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { BRANCH_COUNSELLOR_ROLES, PARTNER_ROLES, isStaff } from "@/lib/permissions";
import { matchKey } from "@/lib/phone";
import {
  matchingRules,
  pickRoundRobin,
  planRepeat,
  type Candidate,
  type RepeatPlan,
  type RoutingContext,
  type RoutingPathway,
  type RoutingRule,
  type RoutingSource,
} from "@/lib/enquiry-routing";
import { lostReasonText } from "@/lib/lost-reasons";
import { notifyUsers } from "@/server/notify";
import { updateTracked } from "@/server/record-history";
import { SOURCE_LABEL, STAGE_LABEL } from "@/server/enquiries";

const e = schema.enquiries;
const u = schema.users;

/** The ten digits two spellings of one number share, worked out in the database. */
const phoneKeySql = sql`right(regexp_replace(${e.phone}, '[^0-9]', '', 'g'), 10)`;


// ---------- Routing ----------

/**
 * Kept across the rows of one bulk upload, so the rules are read once and
 * round robin sees the enquiries it has just given out.
 */
export type RouteMemo = { rules?: RoutingRule[]; pools: Map<string, Candidate[]>; dryRun?: boolean };
export const newRouteMemo = (dryRun = false): RouteMemo => ({ pools: new Map(), dryRun });

async function activeRules(orgId: string): Promise<RoutingRule[]> {
  const rows = await db
    .select()
    .from(schema.enquiryRoutingRules)
    .where(and(eq(schema.enquiryRoutingRules.active, true), or(isNull(schema.enquiryRoutingRules.orgId), eq(schema.enquiryRoutingRules.orgId, orgId))));
  return rows as RoutingRule[];
}

/** The branch's active counsellors, with the open enquiries each holds and when each was last given one. */
async function counsellorPool(orgId: string): Promise<Candidate[]> {
  // A join rather than a correlated subquery: drizzle writes a lone table's
  // columns unqualified, and "id" inside a subquery on enquiries is the
  // enquiry's own id.
  const rows = await db
    .select({
      id: u.id,
      name: u.name,
      open: sql<number>`(count(${e.id}) filter (where ${e.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')))::int`,
      last: sql<string | null>`max(${e.createdAt})`,
    })
    .from(u)
    .leftJoin(e, eq(e.assignedToId, u.id))
    .where(and(eq(u.orgId, orgId), eq(u.active, true), inArray(u.role, [...BRANCH_COUNSELLOR_ROLES])))
    .groupBy(u.id, u.name);
  return rows.map((r) => ({ id: r.id, name: r.name, open: Number(r.open), lastAssignedAt: r.last ? new Date(r.last) : null }));
}

export type RouteResult = { userId: string; userName: string; ruleId: string; ruleName: string };

/**
 * Who a new enquiry without an owner goes to, by the first rule that matches
 * and can give it to somebody. A rule naming a person who has left, or a
 * round robin over a branch with no active counsellor, is passed over for the
 * next rule. Null when no rule takes it: the enquiry stays unassigned, as
 * enquiries always have, for the branch head to hand out.
 */
export async function routeEnquiry(ctx: RoutingContext, memo: RouteMemo = newRouteMemo()): Promise<RouteResult | null> {
  memo.rules ??= await activeRules(ctx.orgId);
  for (const rule of matchingRules(memo.rules, ctx)) {
    let pick: { id: string; name: string } | null = null;
    if (rule.method === "PERSON") {
      if (!rule.assignToId) continue;
      const person = await db.query.users.findFirst({
        where: and(eq(u.id, rule.assignToId), eq(u.active, true), eq(u.orgId, ctx.orgId), inArray(u.role, [...PARTNER_ROLES])),
        columns: { id: true, name: true },
      });
      pick = person ?? null;
    } else {
      let pool = memo.pools.get(ctx.orgId);
      if (!pool) {
        pool = await counsellorPool(ctx.orgId);
        memo.pools.set(ctx.orgId, pool);
      }
      pick = pickRoundRobin(pool);
    }
    if (!pick) continue;
    const inPool = memo.pools.get(ctx.orgId)?.find((c) => c.id === pick!.id);
    if (inPool) {
      inPool.open += 1;
      inPool.lastAssignedAt = new Date();
    }
    if (!memo.dryRun) {
      await db
        .update(schema.enquiryRoutingRules)
        .set({ assignedCount: sql`${schema.enquiryRoutingRules.assignedCount} + 1` })
        .where(eq(schema.enquiryRoutingRules.id, rule.id));
    }
    return { userId: pick.id, userName: pick.name, ruleId: rule.id, ruleName: rule.name };
  }
  return null;
}

type NewEnquiry = { id: string; orgId: string; name: string; phone: string; source: RoutingSource; interestPathway: RoutingPathway | null };

/**
 * Gives a just-saved enquiry that has no owner to whoever the rules pick, with
 * a line on its history saying which rule did it, the audit entry, and the
 * notice the person always gets for an enquiry given to them.
 */
export async function routeNewEnquiry(row: NewEnquiry, actorId: string | null, opts: { memo?: RouteMemo; notify?: boolean } = {}): Promise<RouteResult | null> {
  const picked = await routeEnquiry({ orgId: row.orgId, source: row.source, pathway: row.interestPathway }, opts.memo);
  if (!picked) return null;
  // Versioned, and on the ownership ledger as an assignment naming the rule.
  // Somebody who took it in the meantime keeps it: the rule then changes nothing.
  const done = await updateTracked(
    "enquiry",
    row.id,
    { assignedToId: picked.userId, updatedAt: new Date() },
    { by: actorId, action: "enquiry.route", where: isNull(e.assignedToId), ledgerDetail: `By the routing rule "${picked.ruleName}"` },
  );
  if (!done) return null;
  await db.insert(schema.enquiryNotes).values({ enquiryId: row.id, body: `Given to ${picked.userName} by the routing rule "${picked.ruleName}".` });
  await audit(actorId, "enquiry.route", "enquiry", row.id, { to: picked.userId, rule: picked.ruleId });
  if (opts.notify !== false && picked.userId !== actorId) {
    await notifyUsers([picked.userId], "New enquiry assigned to you", `${row.name} · ${row.phone}`, `/enquiries/${row.id}`);
  }
  return picked;
}

// ---------- Repeat enquiries ----------

/** The enquiries a branch already has for this number, and what an arrival for it should do. */
export async function findRepeat(orgId: string, phone: string): Promise<RepeatPlan> {
  const key = matchKey(phone);
  if (!key) return { kind: "create" };
  const rows = await db
    .select({ id: e.id, stage: e.stage, createdAt: e.createdAt, lastContactedAt: e.lastContactedAt, mergedIntoId: e.mergedIntoId })
    .from(e)
    .where(and(eq(e.orgId, orgId), sql`${phoneKeySql} = ${key}`));
  return planRepeat(rows);
}

export type RepeatOutcome = { kind: "note" | "reopen"; enquiryId: string; name: string };

/**
 * An enquiry arriving for a number the branch already has, applied.
 *
 * An open one takes a note saying the person came again and through what, and
 * its owner is told. A lost one is reopened: the stage goes back to New or
 * Contacted, the note says it came back and from where and what it had been
 * lost for, the owner stays if still active at the branch (or the rules pick
 * somebody), and a follow-up is set for the next day.
 */
export async function applyRepeat(
  plan: Exclude<RepeatPlan, { kind: "create" }>,
  arrival: { source: RoutingSource; actorId: string | null; via: string; message?: string | null; name?: string | null; email?: string | null },
): Promise<RepeatOutcome> {
  const current = await db.query.enquiries.findFirst({ where: eq(e.id, plan.target.id), with: { lostReasonPicked: true } });
  if (!current) throw new Error("The enquiry to repeat on has gone");
  const when = fmtDate(new Date());
  const said = arrival.message?.trim() ? `\n\n"${arrival.message.trim()}"` : "";
  // A number a family shares: what the arrival gave as the name and email is
  // kept on the note when it differs, rather than lost with the second enquiry
  // that was not made.
  const otherName = arrival.name?.trim() && arrival.name.trim().toLowerCase() !== current.name.trim().toLowerCase() ? arrival.name.trim() : null;
  const otherEmail = arrival.email?.trim() && arrival.email.trim().toLowerCase() !== (current.email ?? "").trim().toLowerCase() ? arrival.email.trim() : null;
  const gave = otherName || otherEmail ? `\n\nThis time gave ${[otherName ? `the name ${otherName}` : null, otherEmail ? `the email ${otherEmail}` : null].filter(Boolean).join(" and ")}.` : "";
  const sourceLabel = SOURCE_LABEL[arrival.source];

  if (plan.kind === "note") {
    await db.insert(schema.enquiryNotes).values({
      enquiryId: current.id,
      authorId: arrival.actorId,
      body: `Enquired again on ${when}, ${arrival.via} (${sourceLabel}). No second enquiry was made.${said}${gave}`,
    });
    await updateTracked("enquiry", current.id, { repeatCount: sql`${e.repeatCount} + 1`, updatedAt: new Date() }, { by: arrival.actorId, action: "enquiry.repeat" });
    await audit(arrival.actorId, "enquiry.repeat", "enquiry", current.id, { source: arrival.source, via: arrival.via });
    if (current.assignedToId && current.assignedToId !== arrival.actorId) {
      await notifyUsers([current.assignedToId], "An enquiry of yours came in again", `${current.name} · ${current.phone} · ${sourceLabel}`, `/enquiries/${current.id}`);
    }
    return { kind: "note", enquiryId: current.id, name: current.name };
  }

  // Reopening: the owner stays only while they are still active at the branch.
  let ownerId = current.assignedToId;
  if (ownerId) {
    const owner = await db.query.users.findFirst({ where: and(eq(u.id, ownerId), eq(u.active, true), eq(u.orgId, current.orgId)), columns: { id: true } });
    if (!owner) ownerId = null;
  }
  const was = lostReasonText(current.lostReasonPicked?.label, current.lostReason);
  // Versioned; an owner who has left is cleared, which the ownership ledger
  // records as the reopening, before the rules pick somebody new. Only while
  // it is still lost: one merged or converted since it was looked up (a bulk
  // upload reads the lost ones once, at the start) is left as it is.
  const reopened = await updateTracked(
    "enquiry",
    current.id,
    {
      stage: plan.stageAfter,
      assignedToId: ownerId,
      lostReasonId: null,
      lostReason: null,
      lostAt: null,
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      repeatCount: sql`${e.repeatCount} + 1`,
      updatedAt: new Date(),
    },
    { by: arrival.actorId, action: "enquiry.reopen", where: eq(e.stage, "LOST"), ledgerDetail: `Reopened from lost, ${arrival.via}; the owner had left` },
  );
  if (!reopened) {
    await db.insert(schema.enquiryNotes).values({
      enquiryId: current.id,
      authorId: arrival.actorId,
      body: `Enquired again on ${when}, ${arrival.via} (${sourceLabel}). It was no longer lost, so it was not reopened.${said}${gave}`,
    });
    return { kind: "note", enquiryId: current.id, name: current.name };
  }
  await db.insert(schema.enquiryNotes).values({
    enquiryId: current.id,
    authorId: arrival.actorId,
    body: `Came back on ${when}, ${arrival.via} (${sourceLabel}). Reopened from lost (it had been lost for: ${was}); stage is now ${STAGE_LABEL[plan.stageAfter]}.${said}${gave}`,
    stageAfter: plan.stageAfter,
  });
  await audit(arrival.actorId, "enquiry.reopen", "enquiry", current.id, { source: arrival.source, via: arrival.via, stage: plan.stageAfter, ownerKept: !!ownerId, wasLostFor: was });
  if (ownerId) {
    if (ownerId !== arrival.actorId) await notifyUsers([ownerId], "A lost enquiry came back", `${current.name} · ${current.phone} · ${sourceLabel}`, `/enquiries/${current.id}`);
  } else {
    await routeNewEnquiry(
      { id: current.id, orgId: current.orgId, name: current.name, phone: current.phone, source: arrival.source, interestPathway: current.interestPathway },
      arrival.actorId,
    );
  }
  return { kind: "reopen", enquiryId: current.id, name: current.name };
}

// ---------- Duplicates ----------

export type DuplicateRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: schema.EnquiryStage;
  orgId: string;
  orgName: string;
  ownerName: string | null;
  createdAt: Date;
  matchedOn: string;
};

/**
 * Other enquiries that may be the same person: the same number (by its last
 * ten digits) or the same email, at any branch. Merged ones are left out. What
 * the viewer may open is listed; a branch is told only how many more there are
 * at other branches, not whose they are or where.
 */
export async function possibleDuplicates(user: SessionUser, enquiry: { id: string; phone: string; email: string | null }) {
  const key = matchKey(enquiry.phone);
  const email = enquiry.email?.trim().toLowerCase() || null;
  if (!key && !email) return { visible: [] as DuplicateRow[], elsewhere: 0 };
  const match = or(key ? sql`${phoneKeySql} = ${key}` : undefined, email ? sql`lower(${e.email}) = ${email}` : undefined);
  const rows = await db
    .select({
      id: e.id,
      name: e.name,
      phone: e.phone,
      email: e.email,
      stage: e.stage,
      orgId: e.orgId,
      orgName: schema.organizations.name,
      ownerName: u.name,
      createdAt: e.createdAt,
      samePhone: key ? sql<boolean>`${phoneKeySql} = ${key}` : sql<boolean>`false`,
    })
    .from(e)
    .innerJoin(schema.organizations, eq(schema.organizations.id, e.orgId))
    .leftJoin(u, eq(u.id, e.assignedToId))
    .where(and(ne(e.id, enquiry.id), isNull(e.mergedIntoId), ne(e.stage, "MERGED"), match))
    .orderBy(asc(e.createdAt))
    .limit(50);
  const seeAll = isStaff(user);
  const visible: DuplicateRow[] = [];
  let elsewhere = 0;
  for (const r of rows) {
    if (!seeAll && r.orgId !== user.orgId) {
      elsewhere++;
      continue;
    }
    const sameEmail = !!email && r.email?.toLowerCase() === email;
    visible.push({ ...r, matchedOn: r.samePhone && sameEmail ? "number and email" : r.samePhone ? "number" : "email" });
  }
  return { visible, elsewhere };
}
