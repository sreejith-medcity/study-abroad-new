import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { KEY_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/crm-link";
import { verifySignature } from "@/lib/crm-signing";
import { open as openSecret } from "@/lib/secret-box";
import type { IntegrationStatus } from "@/db/schema";

/**
 * The portal's side of the link to Medcity's own CRM.
 *
 * Reading and checking live here; the desk's buttons live in crm-actions.ts and
 * the sending in crm-out.ts. Nothing in this file assumes anything about the
 * CRM's own shape: it states what the portal accepts and answers, and the
 * vendor's build meets it.
 */

export const SECRET_PURPOSE = "crm-webhook";

/** What a key may be allowed to do. An empty list on a key means all of them. */
export const SCOPES = ["register", "lookup", "enquiry"] as const;
export type Scope = (typeof SCOPES)[number];

// ---------- Making a key ----------

export const newKeyId = () => `mck_${randomBytes(9).toString("hex")}`;
export const newSecret = () => `mcs_${randomBytes(24).toString("hex")}`;
export const hashSecret = (secret: string) => bcrypt.hash(secret, 10);

// ---------- Checking a caller ----------

export type Caller = { keyId: string; name: string; id: string };
export type AuthResult = { ok: true; caller: Caller } | { ok: false; status: number; why: string };

/**
 * Whether a request may do what it is asking to do.
 *
 * Two ways in, chosen per key. With signing off, the secret itself is sent as a
 * bearer token, which is simple for a vendor getting started. With signing on,
 * the secret never leaves their server: they send a signature over the body and
 * a timestamp instead, so a request copied off the wire is no use later. Switching
 * a key from one to the other is a toggle on the sync screen, not a deploy.
 */
export async function authenticate(request: Request, rawBody: string, scope: Scope): Promise<AuthResult> {
  const keyId = request.headers.get(KEY_HEADER);
  if (!keyId) return { ok: false, status: 401, why: `No ${KEY_HEADER} on the request` };

  const key = await db.query.integrationKeys.findFirst({ where: eq(schema.integrationKeys.keyId, keyId) });
  if (!key || !key.active || key.revokedAt) return { ok: false, status: 401, why: "That key is not in use" };
  if (key.scopes.length > 0 && !key.scopes.includes(scope)) return { ok: false, status: 403, why: `That key may not ${scope}` };

  const url = new URL(request.url);
  if (key.signatureRequired) {
    // A signature is an HMAC of the body under the shared secret, so verifying
    // one means holding that secret. The sealed copy is what it is for.
    const secret = key.secretBox ? openSecret(key.secretBox, SECRET_PURPOSE) : null;
    if (!secret) return { ok: false, status: 500, why: "This key has no readable secret, so a signature cannot be checked. Make a new key." };
    const check = verifySignature(secret, request.headers.get(SIGNATURE_HEADER), request.method, url.pathname, request.headers.get(TIMESTAMP_HEADER), rawBody);
    if (!check.ok) return { ok: false, status: 401, why: check.why };
  } else {
    const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!given) return { ok: false, status: 401, why: "No bearer token on the request" };
    if (!(await bcrypt.compare(given, key.secretHash))) return { ok: false, status: 401, why: "That token does not match the key" };
  }

  await db.update(schema.integrationKeys).set({ lastUsedAt: new Date() }).where(eq(schema.integrationKeys.id, key.id));
  return { ok: true, caller: { id: key.id, keyId: key.keyId, name: key.name } };
}

// ---------- Recording what happened ----------

export type RecordInbound = {
  kind: string;
  keyId: string | null;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
  status: IntegrationStatus;
  response?: Record<string, unknown>;
  responseStatus?: number;
  entityType?: string | null;
  entityId?: string | null;
  needsAPersonBecause?: string | null;
  error?: string | null;
};

/**
 * One row per call, kept whether it worked or not, because the first question
 * about any sync problem is what exactly was sent.
 */
export async function recordInbound(e: RecordInbound) {
  const [row] = await db
    .insert(schema.integrationEvents)
    .values({
      direction: "IN",
      kind: e.kind,
      status: e.status,
      integrationKeyId: e.keyId,
      idempotencyKey: e.idempotencyKey,
      payload: e.payload,
      response: e.response ?? null,
      responseStatus: e.responseStatus ?? null,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      needsAPersonBecause: e.needsAPersonBecause ?? null,
      error: e.error ?? null,
      attempts: 1,
      lastAttemptAt: new Date(),
    })
    .onConflictDoNothing({ target: schema.integrationEvents.idempotencyKey })
    .returning();
  return row ?? null;
}

/**
 * The answer a caller already had, where they are repeating themselves.
 *
 * A retry after a timeout must not register the same student twice, and the
 * honest way to manage that is to hand back what was said the first time rather
 * than to do the work again and hope it is idempotent by luck.
 */
export async function answerAlreadyGiven(idempotencyKey: string | null) {
  if (!idempotencyKey) return null;
  const row = await db.query.integrationEvents.findFirst({ where: eq(schema.integrationEvents.idempotencyKey, idempotencyKey) });
  if (!row) return null;
  return { response: row.response ?? {}, status: row.responseStatus ?? 200 };
}

// ---------- Finding a student the CRM is asking about ----------

const tenDigits = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/**
 * The student one of the CRM's own identifiers points at.
 *
 * Tried in order of how certain each one is: their CRM id, then the Medcity ID,
 * then an email, then the last ten digits of a number, which is how the same
 * mobile written four ways still finds one person.
 */
export async function findStudent(by: { crmId?: string; medcityId?: string; email?: string; phone?: string }) {
  const { students: s } = schema;
  if (by.crmId) {
    const row = await db.query.students.findFirst({ where: eq(s.crmId, by.crmId) });
    if (row) return row;
  }
  if (by.medcityId) {
    const row = await db.query.students.findFirst({ where: eq(s.medcityId, by.medcityId.toUpperCase()) });
    if (row) return row;
  }
  if (by.email) {
    const row = await db.query.students.findFirst({ where: eq(s.email, by.email.trim().toLowerCase()) });
    if (row) return row;
  }
  if (by.phone) {
    const digits = tenDigits(by.phone);
    if (digits.length === 10) {
      const row = await db.query.students.findFirst({
        where: sql`right(regexp_replace(${s.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`,
      });
      if (row) return row;
    }
  }
  return null;
}

/**
 * What the portal tells the CRM about a student: where they are, what is
 * outstanding and what their applications are doing. Enough for a CRM-side
 * counsellor to answer a parent without opening the portal, and no more: no
 * documents, no internal notes, no commission.
 */
export async function studentSummary(studentId: string) {
  const student = await db.query.students.findFirst({
    where: eq(schema.students.id, studentId),
    with: { org: { columns: { name: true, idCode: true } }, assignedTo: { columns: { name: true } } },
  });
  if (!student) return null;

  const { applications: a, statusDefinitions: sd, programs: p, universities: u, countries: c } = schema;
  const applications = await db
    .select({
      ackNo: a.ackNo,
      status: sd.label,
      statusGroup: sd.group,
      university: u.name,
      program: p.name,
      country: c.name,
      intakeMonth: a.intakeMonth,
      intakeYear: a.intakeYear,
      offerType: a.offerType,
      visaDecision: a.visaDecision,
      changedAt: a.statusChangedAt,
    })
    .from(a)
    .innerJoin(sd, eq(sd.id, a.statusId))
    .innerJoin(p, eq(p.id, a.programId))
    .innerJoin(u, eq(u.id, p.universityId))
    .innerJoin(c, eq(c.id, u.countryId))
    .where(eq(a.studentId, studentId));

  const { checklistItems: ci, documentTypes: dt } = schema;
  const outstanding = await db
    .select({ code: ci.typeCode, label: dt.label, state: ci.state, dueOn: ci.dueOn })
    .from(ci)
    .innerJoin(dt, eq(dt.code, ci.typeCode))
    .where(and(eq(ci.studentId, studentId), eq(ci.required, true), eq(ci.owedBy, "STUDENT"), inArray(ci.state, ["NOT_ASKED", "ASKED", "REJECTED"] as const)))
    .orderBy(asc(dt.sortOrder));

  return {
    id: student.id,
    crmId: student.crmId,
    medcityId: student.medcityId,
    name: `${student.firstName} ${student.lastName}`,
    email: student.email,
    phone: student.phone,
    branch: student.org.name,
    counsellor: student.assignedTo?.name ?? null,
    journeyStage: student.journeyStage,
    stageEnteredAt: student.stageEnteredAt,
    updatedAt: student.updatedAt,
    applications,
    outstandingDocuments: outstanding,
  };
}

// ---------- The desk's view of the link ----------

export type EventFilters = { direction?: string; status?: string; kind?: string };

export function readEventFilters(sp: Record<string, string | string[] | undefined>): EventFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) || undefined;
  return { direction: one("direction"), status: one("status"), kind: one("kind") };
}

export async function integrationEvents(f: EventFilters = {}, limit = 120) {
  const { integrationEvents: e, integrationKeys: k } = schema;
  const where = [
    f.direction === "IN" || f.direction === "OUT" ? eq(e.direction, f.direction) : undefined,
    f.status && (schema.integrationStatus.enumValues as readonly string[]).includes(f.status) ? eq(e.status, f.status as IntegrationStatus) : undefined,
    f.kind ? eq(e.kind, f.kind) : undefined,
  ].filter(Boolean);

  return db
    .select({
      id: e.id,
      direction: e.direction,
      kind: e.kind,
      status: e.status,
      entityType: e.entityType,
      entityId: e.entityId,
      payload: e.payload,
      response: e.response,
      responseStatus: e.responseStatus,
      attempts: e.attempts,
      lastAttemptAt: e.lastAttemptAt,
      nextAttemptAt: e.nextAttemptAt,
      error: e.error,
      needsAPersonBecause: e.needsAPersonBecause,
      note: e.note,
      createdAt: e.createdAt,
      resolvedAt: e.resolvedAt,
      keyName: k.name,
    })
    .from(e)
    .leftJoin(k, eq(k.id, e.integrationKeyId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(e.createdAt))
    .limit(limit);
}

/** Everything a person has to look at: a conflict, or a send that gave up. */
export const needsAPerson = () => integrationEvents({ status: "NEEDS_A_PERSON" }, 200);

export async function integrationCounts() {
  const rows = await db
    .select({ status: schema.integrationEvents.status, direction: schema.integrationEvents.direction, n: sql<number>`count(*)::int` })
    .from(schema.integrationEvents)
    .groupBy(schema.integrationEvents.status, schema.integrationEvents.direction);
  const total = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, r) => a + Number(r.n), 0);
  return {
    inbound: total((r) => r.direction === "IN"),
    outbound: total((r) => r.direction === "OUT"),
    waiting: total((r) => r.status === "PENDING"),
    failed: total((r) => r.status === "FAILED"),
    needsAPerson: total((r) => r.status === "NEEDS_A_PERSON"),
  };
}

export const integrationKeyList = () =>
  db.query.integrationKeys.findMany({ orderBy: [desc(schema.integrationKeys.createdAt)], with: { createdBy: { columns: { name: true } } } });

/** Outbound rows due to be tried, oldest first. */
export const dueOutbound = (limit = 50) =>
  db
    .select()
    .from(schema.integrationEvents)
    .where(
      and(
        eq(schema.integrationEvents.direction, "OUT"),
        eq(schema.integrationEvents.status, "PENDING"),
        or(isNull(schema.integrationEvents.nextAttemptAt), lte(schema.integrationEvents.nextAttemptAt, new Date())),
      ),
    )
    .orderBy(asc(schema.integrationEvents.createdAt))
    .limit(limit);
