import "server-only";
import { and, asc, desc, eq, inArray, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { walletBalance } from "@/server/commission";
import { getSettings } from "@/server/settings";
import type { AgentRate, WithdrawalFacts } from "@/lib/agents";
import { rateFor } from "@/lib/agents";

/**
 * Reading the sub-agent side: who has applied, what the agreement says, what a
 * referral has earned, and whether money may leave.
 *
 * Writes live in agent-actions.ts. These are read-only so that a page can call
 * them without a "use server" boundary turning a query into something the
 * browser could call.
 */

// ---------- Applications to join ----------

export type ApplicationFilters = { status?: string; q?: string };

export function readApplicationFilters(sp: Record<string, string | string[] | undefined>): ApplicationFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) || undefined;
  return { status: one("status"), q: one("q") };
}

export async function agentApplications(f: ApplicationFilters = {}) {
  const { agentApplications: aa, organizations: o } = schema;
  const where = [
    f.status && (schema.agentApplicationStatus.enumValues as readonly string[]).includes(f.status)
      ? eq(aa.status, f.status as (typeof schema.agentApplicationStatus.enumValues)[number])
      : undefined,
    f.q ? sql`(${aa.contactName} ilike ${`%${f.q}%`} or coalesce(${aa.firmName}, '') ilike ${`%${f.q}%`} or ${aa.phone} ilike ${`%${f.q}%`} or ${aa.email} ilike ${`%${f.q}%`})` : undefined,
  ].filter(Boolean);

  return db
    .select({
      id: aa.id,
      contactName: aa.contactName,
      firmName: aa.firmName,
      email: aa.email,
      phone: aa.phone,
      city: aa.city,
      state: aa.state,
      aboutThem: aa.aboutThem,
      status: aa.status,
      decisionNote: aa.decisionNote,
      reviewedAt: aa.reviewedAt,
      createdAt: aa.createdAt,
      orgId: aa.orgId,
      referredBy: o.name,
    })
    .from(aa)
    .leftJoin(o, eq(o.id, aa.referredByOrgId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(aa.createdAt))
    .limit(200);
}

export async function agentApplicationCounts() {
  const rows = await db
    .select({ status: schema.agentApplications.status, n: sql<number>`count(*)::int` })
    .from(schema.agentApplications)
    .groupBy(schema.agentApplications.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { new: by.NEW ?? 0, reviewing: by.REVIEWING ?? 0, approved: by.APPROVED ?? 0, rejected: by.REJECTED ?? 0 };
}

// ---------- The agreement ----------

export const activeMou = () => db.query.mouVersions.findFirst({ where: eq(schema.mouVersions.active, true) });

export const mouVersions = () =>
  db.query.mouVersions.findMany({ orderBy: [desc(schema.mouVersions.createdAt)], with: { createdBy: { columns: { name: true } } } });

/** How many organisations have accepted each version, for the desk's list. */
export async function mouAcceptanceCounts() {
  const rows = await db
    .select({ versionId: schema.mouAcceptances.mouVersionId, n: sql<number>`count(*)::int` })
    .from(schema.mouAcceptances)
    .groupBy(schema.mouAcceptances.mouVersionId);
  return Object.fromEntries(rows.map((r) => [r.versionId, Number(r.n)])) as Record<string, number>;
}

/**
 * Where one organisation stands on the agreement: the version being asked for,
 * whether they have accepted it, and who accepted it when.
 *
 * A published version with no acceptance is the thing that blocks a withdrawal.
 * No published version at all blocks nothing, because there is nothing to sign.
 */
export async function mouStanding(orgId: string) {
  const version = await activeMou();
  if (!version) return { version: null, accepted: false, acceptance: null };
  const acceptance = await db.query.mouAcceptances.findFirst({
    where: and(eq(schema.mouAcceptances.orgId, orgId), eq(schema.mouAcceptances.mouVersionId, version.id)),
    with: { acceptedBy: { columns: { name: true, email: true } } },
  });
  return { version, accepted: !!acceptance, acceptance: acceptance ?? null };
}

/** Everything this organisation has ever accepted, newest first. */
export const acceptancesFor = (orgId: string) =>
  db.query.mouAcceptances.findMany({
    where: eq(schema.mouAcceptances.orgId, orgId),
    orderBy: [desc(schema.mouAcceptances.createdAt)],
    with: { version: { columns: { version: true, title: true } }, acceptedBy: { columns: { name: true } } },
  });

// ---------- Rates ----------

const asRate = (r: typeof schema.agentRates.$inferSelect): AgentRate => ({
  id: r.id,
  orgId: r.orgId,
  kind: r.kind,
  percent: r.percent,
  flatAmountInr: r.flatAmountInr,
  activeFrom: r.activeFrom,
});

export async function allAgentRates() {
  const rows = await db.query.agentRates.findMany({
    orderBy: [desc(schema.agentRates.activeFrom), desc(schema.agentRates.createdAt)],
    with: { org: { columns: { name: true } }, createdBy: { columns: { name: true } } },
  });
  return rows;
}

/** The rate that applies to one sub-agent today, platform default included. */
export async function effectiveRate(orgId: string, on: Date = new Date()) {
  const rows = await db.query.agentRates.findMany({
    where: sql`${schema.agentRates.orgId} is null or ${schema.agentRates.orgId} = ${orgId}`,
  });
  return rateFor(rows.map(asRate), orgId, on);
}

// ---------- Sub-agents themselves ----------

/** Every sub-agent organisation, with the branch that recruited it. */
export async function subAgents() {
  const { organizations: o } = schema;
  const parent = schema.organizations;
  const rows = await db
    .select({
      id: o.id,
      name: o.name,
      city: o.city,
      active: o.active,
      idCode: o.idCode,
      parentOrgId: o.parentOrgId,
      createdAt: o.createdAt,
      referrals: sql<number>`(select count(*)::int from enquiries e where e.submitted_by_org_id = ${o.id})`,
      registered: sql<number>`(select count(*)::int from students s where s.referred_by_org_id = ${o.id})`,
      earned: sql<number>`(select coalesce(sum(w.amount_inr), 0)::int from wallet_entries w where w.org_id = ${o.id} and w.kind = 'REFERRAL')`,
      balance: sql<number>`(select coalesce(sum(w.amount_inr), 0)::int from wallet_entries w where w.org_id = ${o.id})`,
    })
    .from(o)
    .where(eq(o.type, "SUB_AGENT"))
    .orderBy(asc(o.name));
  void parent;

  const parents = await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations);
  const byId = new Map(parents.map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, parentName: r.parentOrgId ? (byId.get(r.parentOrgId) ?? null) : null }));
}

/** The branches a sub-agent's referral can be handed to. */
export const branchesForAssignment = () =>
  db
    .select({ id: schema.organizations.id, name: schema.organizations.name, city: schema.organizations.city })
    .from(schema.organizations)
    .where(and(ne(schema.organizations.type, "SUB_AGENT"), eq(schema.organizations.active, true)))
    .orderBy(asc(schema.organizations.name));

// ---------- Referrals ----------

/**
 * The leads one sub-agent has sent, as they are allowed to see them: the
 * person's name, the stage, who is holding it and what it has earned. Never the
 * student's file, documents or notes.
 */
export async function referralsFor(orgId: string) {
  const { enquiries: e, organizations: o, students: s, referralEarnings: re } = schema;
  return db
    .select({
      id: e.id,
      name: e.name,
      phone: e.phone,
      city: e.city,
      stage: e.stage,
      interestCountry: e.interestCountry,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      lostReason: e.lostReason,
      heldBy: o.name,
      studentId: e.studentId,
      medcityId: s.medcityId,
      journeyStage: s.journeyStage,
      earningState: re.state,
      earningAmount: re.amountInr,
    })
    .from(e)
    .leftJoin(o, eq(o.id, e.orgId))
    .leftJoin(s, eq(s.id, e.studentId))
    .leftJoin(re, eq(re.studentId, e.studentId))
    .where(eq(e.submittedByOrgId, orgId))
    .orderBy(desc(e.createdAt))
    .limit(300);
}

export async function referralCounts(orgId: string) {
  const rows = await db
    .select({ stage: schema.enquiries.stage, n: sql<number>`count(*)::int` })
    .from(schema.enquiries)
    .where(eq(schema.enquiries.submittedByOrgId, orgId))
    .groupBy(schema.enquiries.stage);
  const by = Object.fromEntries(rows.map((r) => [r.stage, Number(r.n)]));
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return { total, registered: by.CONVERTED ?? 0, lost: by.LOST ?? 0, working: total - (by.CONVERTED ?? 0) - (by.LOST ?? 0) };
}

/**
 * The desk's queue of referrals: everything a sub-agent has sent, with who
 * holds it now, so a lead that nobody has picked up is visible rather than
 * buried in one branch's enquiry list.
 */
export async function referralQueue(onlyUnassigned = false) {
  const { enquiries: e } = schema;
  const agent = schema.organizations;
  const rows = await db
    .select({
      id: e.id,
      name: e.name,
      phone: e.phone,
      city: e.city,
      stage: e.stage,
      interestCountry: e.interestCountry,
      interestPathway: e.interestPathway,
      notes: e.notes,
      createdAt: e.createdAt,
      ownerOrgId: e.orgId,
      agentOrgId: e.submittedByOrgId,
      agentName: agent.name,
      studentId: e.studentId,
    })
    .from(e)
    .innerJoin(agent, eq(agent.id, e.submittedByOrgId))
    .where(isNotNull(e.submittedByOrgId))
    .orderBy(desc(e.createdAt))
    .limit(300);

  const orgs = await db.select({ id: schema.organizations.id, name: schema.organizations.name, type: schema.organizations.type }).from(schema.organizations);
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const withOwner = rows.map((r) => {
    const owner = byId.get(r.ownerOrgId);
    return { ...r, ownerName: owner?.name ?? null, withTheDesk: owner?.type === "HQ" };
  });
  return onlyUnassigned ? withOwner.filter((r) => r.withTheDesk) : withOwner;
}

// ---------- Earnings ----------

export async function earningsFor(orgId: string) {
  const { referralEarnings: re, students: s } = schema;
  return db
    .select({
      id: re.id,
      state: re.state,
      kind: re.kind,
      amountInr: re.amountInr,
      note: re.note,
      cancelledReason: re.cancelledReason,
      payableAt: re.payableAt,
      createdAt: re.createdAt,
      studentId: re.studentId,
      studentName: sql<string>`${s.firstName} || ' ' || ${s.lastName}`,
      medcityId: s.medcityId,
      journeyStage: s.journeyStage,
    })
    .from(re)
    .innerJoin(s, eq(s.id, re.studentId))
    .where(eq(re.orgId, orgId))
    .orderBy(desc(re.createdAt))
    .limit(300);
}

export async function earningTotals(orgId: string) {
  const { referralEarnings: re } = schema;
  const rows = await db
    .select({
      state: re.state,
      n: sql<number>`count(*)::int`,
      /** Null amounts are counted as unpriced rather than added in as nought. */
      known: sql<number>`coalesce(sum(${re.amountInr}), 0)::int`,
      unpriced: sql<number>`count(*) filter (where ${re.amountInr} is null)::int`,
    })
    .from(re)
    .where(eq(re.orgId, orgId))
    .groupBy(re.state);
  const by = Object.fromEntries(rows.map((r) => [r.state, r]));
  const at = (k: string) => ({ n: Number(by[k]?.n ?? 0), known: Number(by[k]?.known ?? 0), unpriced: Number(by[k]?.unpriced ?? 0) });
  return { pending: at("PENDING"), payable: at("PAYABLE"), paid: at("PAID"), cancelled: at("CANCELLED") };
}

/** Earnings the desk still has to put a figure on, across every sub-agent. */
export async function unpricedEarnings() {
  const { referralEarnings: re, students: s, organizations: o } = schema;
  return db
    .select({
      id: re.id,
      state: re.state,
      orgName: o.name,
      orgId: re.orgId,
      studentName: sql<string>`${s.firstName} || ' ' || ${s.lastName}`,
      medcityId: s.medcityId,
      createdAt: re.createdAt,
    })
    .from(re)
    .innerJoin(s, eq(s.id, re.studentId))
    .innerJoin(o, eq(o.id, re.orgId))
    .where(and(isNull(re.amountInr), inArray(re.state, ["PENDING", "PAYABLE"] as const)))
    .orderBy(asc(re.createdAt))
    .limit(200);
}

// ---------- Withdrawal ----------

/**
 * Everything the withdrawal conditions need, read once.
 *
 * Bank details count only when the account number, IFSC and PAN are all there:
 * a company row with a name and nothing else is not somewhere money can be sent.
 */
export async function withdrawalFacts(orgId: string): Promise<WithdrawalFacts> {
  const [{ balance }, settings, mou] = await Promise.all([walletBalance(orgId), getSettings(), mouStanding(orgId)]);
  const companies = await db.query.billingCompanies.findMany({ where: eq(schema.billingCompanies.orgId, orgId) });
  const pending = await db.query.payoutRequests.findFirst({
    where: and(eq(schema.payoutRequests.orgId, orgId), eq(schema.payoutRequests.status, "REQUESTED")),
  });
  return {
    balanceInr: balance,
    minimumInr: settings.minWithdrawalInr,
    mouAccepted: mou.accepted,
    mouPublished: !!mou.version,
    hasBankDetails: companies.some((c) => !!c.bankAccountNumber && !!c.ifsc && !!c.pan),
    pendingRequestInr: pending?.amountInr ?? null,
  };
}

/**
 * Where every sub-agent stands on the version being asked for, so the desk can
 * see at a glance who has not accepted and therefore cannot be paid.
 */
export async function agreementStandings() {
  const version = await activeMou();
  const agents = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, active: schema.organizations.active })
    .from(schema.organizations)
    .where(eq(schema.organizations.type, "SUB_AGENT"))
    .orderBy(asc(schema.organizations.name));
  if (!version) return { version: null, rows: agents.map((a) => ({ ...a, acceptedAt: null, acceptedName: null })) };

  const accepted = await db
    .select({ orgId: schema.mouAcceptances.orgId, createdAt: schema.mouAcceptances.createdAt, acceptedName: schema.mouAcceptances.acceptedName })
    .from(schema.mouAcceptances)
    .where(eq(schema.mouAcceptances.mouVersionId, version.id));
  const by = new Map(accepted.map((a) => [a.orgId, a]));
  return {
    version,
    rows: agents.map((a) => ({ ...a, acceptedAt: by.get(a.id)?.createdAt ?? null, acceptedName: by.get(a.id)?.acceptedName ?? null })),
  };
}
