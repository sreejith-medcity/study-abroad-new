import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DATE_FIELDS, conflictSummary, planFieldUpdates, type FieldPlan, type SyncableField } from "@/lib/crm-link";
import { tryMintStudentId } from "@/server/medcity-id";
import { adminIds, notifyUsers } from "@/server/notify";

/**
 * Taking a student or a lead in from Medcity's own CRM.
 *
 * The rule the desk chose is last edit wins, and this is where it is applied.
 * What is added to it is that it is never silent: every field written is recorded
 * with what it replaced, and a message older than the portal's own copy writes
 * nothing and is put in front of a person. A correction a counsellor made this
 * morning is not undone by a record the CRM last touched last week.
 */

export type IncomingStudent = {
  crmId: string;
  /** The CRM's own updatedAt. Required: without it there is no "last" to compare. */
  updatedAt: string;
  /** Which branch the student belongs to, by its ID code or its id. */
  branch?: string;
  fields: Record<string, unknown>;
};

export type ApplyResult =
  | { ok: true; created: boolean; studentId: string; medcityId: string | null; plan: FieldPlan }
  | { ok: false; status: number; why: string };

const branchFor = async (given: string | undefined) => {
  if (!given) return null;
  const code = given.trim().toUpperCase();
  return (
    (await db.query.organizations.findFirst({ where: and(eq(schema.organizations.idCode, code), ne(schema.organizations.type, "HQ")) })) ??
    (await db.query.organizations.findFirst({ where: and(eq(schema.organizations.id, given.trim()), ne(schema.organizations.type, "HQ")) })) ??
    null
  );
};

const PERSON_FIELDS = ["firstName", "lastName", "phone"] as const;

/**
 * The plan's values as the database wants them.
 *
 * The plan normalises a day to "2004-03-11" so both sides compare alike, which
 * is right for deciding whether something changed and wrong for writing: those
 * columns are timestamps and want a Date.
 */
function toDbValues(apply: Partial<Record<SyncableField, string | number | null>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(apply)) {
    out[field] = DATE_FIELDS.includes(field as SyncableField) && typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  }
  return out;
}

/**
 * Registers a student the CRM has, or updates the one already here.
 *
 * A student belongs to a branch, so registering one needs the branch named: the
 * portal will not file somebody against the head office, where every screen that
 * scopes by organisation would lose them.
 */
export async function applyIncomingStudent(incoming: IncomingStudent, actorNote: string): Promise<ApplyResult> {
  if (!incoming.crmId?.trim()) return { ok: false, status: 400, why: "crmId is required" };
  if (!incoming.updatedAt) return { ok: false, status: 400, why: "updatedAt is required: without it there is no way to tell which edit is the later one" };
  const theirUpdatedAt = new Date(incoming.updatedAt);
  if (Number.isNaN(theirUpdatedAt.getTime())) return { ok: false, status: 400, why: "updatedAt must be a date the portal can read, such as 2026-10-02T09:15:00Z" };

  // Matched on their own id first, then on a number, so a student a branch
  // registered last month is linked rather than duplicated.
  const digits = String(incoming.fields.phone ?? "").replace(/\D/g, "").slice(-10);
  let student = await db.query.students.findFirst({ where: eq(schema.students.crmId, incoming.crmId) });
  if (!student && digits.length === 10) {
    student =
      (await db.query.students.findFirst({
        where: sql`right(regexp_replace(${schema.students.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`,
      })) ?? undefined;
  }

  if (!student) {
    for (const f of PERSON_FIELDS) {
      if (!String(incoming.fields[f] ?? "").trim()) return { ok: false, status: 400, why: `${f} is required to register somebody new` };
    }
    const branch = await branchFor(incoming.branch);
    if (!branch) return { ok: false, status: 400, why: "branch is required and must be a branch's ID code, such as KOT. A student cannot be filed against the head office." };

    const plan = planFieldUpdates({ incoming: incoming.fields, current: {}, theirUpdatedAt, myUpdatedAt: null });
    const [made] = await db
      .insert(schema.students)
      .values({
        orgId: branch.id,
        firstName: String(incoming.fields.firstName).trim(),
        lastName: String(incoming.fields.lastName).trim(),
        phone: String(incoming.fields.phone).trim(),
        ...(toDbValues(plan.apply) as Record<string, never>),
        crmId: incoming.crmId,
        crmUpdatedAt: theirUpdatedAt,
        crmLastSyncedAt: new Date(),
        source: "crm",
        medcityId: await tryMintStudentId(branch.id),
        // Consent belongs to whoever took it. The CRM says it has it, and that
        // claim is recorded as the CRM's rather than restated as the portal's.
        consentAt: new Date(),
        consentText: `Consent recorded in Medcity's CRM against ${incoming.crmId}, carried across by the integration.`,
      })
      .returning();
    await db.insert(schema.auditLogs).values({
      actorId: null,
      action: "crm.student.create",
      entityType: "student",
      entityId: made.id,
      meta: { crmId: incoming.crmId, branch: branch.name, by: actorNote, fields: plan.changed.map((c) => c.field) },
    });
    return { ok: true, created: true, studentId: made.id, medcityId: made.medcityId, plan };
  }

  const plan = planFieldUpdates({
    incoming: incoming.fields,
    current: student as unknown as Record<string, unknown>,
    theirUpdatedAt,
    myUpdatedAt: student.updatedAt,
  });

  const set: Record<string, unknown> = { ...toDbValues(plan.apply), crmId: incoming.crmId, crmUpdatedAt: theirUpdatedAt, crmLastSyncedAt: new Date() };
  // A write only touches updatedAt when something actually changed, or every
  // sync would make the portal's copy look newer than it is.
  if (plan.changed.length > 0) set.updatedAt = new Date();
  await db.update(schema.students).set(set).where(eq(schema.students.id, student.id));

  if (plan.changed.length > 0) {
    await db.insert(schema.auditLogs).values({
      actorId: null,
      action: "crm.student.update",
      entityType: "student",
      entityId: student.id,
      // Before and after, so a bad overwrite can be seen and undone.
      meta: { crmId: incoming.crmId, by: actorNote, changed: plan.changed, ignored: plan.ignored },
    });
  }
  return { ok: true, created: false, studentId: student.id, medcityId: student.medcityId, plan };
}

/**
 * Tells the desk when a message was too old to apply.
 *
 * This is the whole point of not doing last-edit-wins silently: somebody is told
 * that the CRM tried to change a passport number and was refused, with both
 * values, and can decide which is right.
 */
export async function raiseConflict(eventId: string, studentId: string, plan: FieldPlan) {
  if (plan.conflicts.length === 0) return;
  await db
    .update(schema.integrationEvents)
    .set({
      status: "NEEDS_A_PERSON",
      needsAPersonBecause: `The CRM's copy is older than ours, so ${plan.conflicts.length} field${plan.conflicts.length === 1 ? "" : "s"} were left alone: ${conflictSummary(plan.conflicts)}`,
      entityType: "student",
      entityId: studentId,
    })
    .where(eq(schema.integrationEvents.id, eventId));
  await notifyUsers(await adminIds(), "The CRM and the portal disagree", conflictSummary(plan.conflicts), "/admin/integrations?tab=attention");
}

// ---------- Leads ----------

export type IncomingEnquiry = {
  crmId: string;
  name: string;
  phone: string;
  email?: string;
  city?: string;
  branch?: string;
  interestCountry?: string;
  notes?: string;
};

/**
 * A lead from the CRM.
 *
 * It lands as an enquiry owned by the branch named, or by the head office when
 * none is, which is the desk's own queue rather than nowhere. The same CRM id
 * twice updates nothing: a lead is a thing somebody is already working, and
 * overwriting what a counsellor wrote on it from outside would be worse than
 * ignoring the repeat.
 */
export async function applyIncomingEnquiry(e: IncomingEnquiry): Promise<{ ok: true; enquiryId: string; created: boolean } | { ok: false; status: number; why: string }> {
  if (!e.crmId?.trim()) return { ok: false, status: 400, why: "crmId is required" };
  if (!e.name?.trim() || !e.phone?.trim()) return { ok: false, status: 400, why: "name and phone are required" };

  const already = await db.query.enquiries.findFirst({ where: eq(schema.enquiries.crmId, e.crmId) });
  if (already) return { ok: true, enquiryId: already.id, created: false };

  const branch = await branchFor(e.branch);
  const owner = branch ?? (await db.query.organizations.findFirst({ where: eq(schema.organizations.type, "HQ") }));
  if (!owner) return { ok: false, status: 500, why: "The head office is not set up in the portal" };

  const anybody = await db.query.users.findFirst({
    where: and(eq(schema.users.orgId, owner.id), eq(schema.users.active, true)),
  });
  if (!anybody) return { ok: false, status: 500, why: `${owner.name} has nobody active to own the lead` };

  const [row] = await db
    .insert(schema.enquiries)
    .values({
      orgId: owner.id,
      createdById: anybody.id,
      crmId: e.crmId,
      name: e.name.trim(),
      phone: e.phone.trim(),
      email: e.email?.trim().toLowerCase() || null,
      city: e.city?.trim() || null,
      source: "OTHER",
      stage: "NEW",
      interestCountry: e.interestCountry?.trim() || null,
      notes: e.notes?.trim() || null,
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60_000),
    })
    .returning();
  await db.insert(schema.enquiryNotes).values({
    enquiryId: row.id,
    authorId: anybody.id,
    body: `Came from Medcity's CRM as ${e.crmId}.`,
    stageAfter: "NEW",
  });
  return { ok: true, enquiryId: row.id, created: true };
}
