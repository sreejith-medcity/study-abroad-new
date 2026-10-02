import { answerAlreadyGiven, authenticate, findStudent, recordInbound, studentSummary } from "@/server/crm-link";
import { applyIncomingStudent, raiseConflict } from "@/server/crm-inbound";

export const dynamic = "force-dynamic";

/**
 * Registering a student from Medcity's own CRM, or updating one already here.
 *
 *   POST /api/crm/students
 *   x-medcity-key: mck_...
 *   authorization: Bearer mcs_...        (or a signature, where the key wants one)
 *   idempotency-key: anything-of-yours   (optional, and worth sending)
 *
 *   { "crmId": "CRM-4821",
 *     "updatedAt": "2026-10-02T09:15:00Z",
 *     "branch": "KOT",
 *     "firstName": "Meera", "lastName": "Nair", "phone": "+91 9447000000",
 *     "email": "meera@example.com", "dateOfBirth": "2004-03-11" }
 *
 * updatedAt is required, and is the CRM's own last-changed time for that record.
 * The rule is last edit wins, and without their timestamp there is no way to tell
 * which edit is the later one: a stale message would overwrite a correction made
 * here this morning. Where the CRM's copy is the older one, nothing is written
 * and the disagreement is put on the sync screen with both values.
 *
 * Repeating an idempotency-key hands back the first answer rather than doing the
 * work twice, so a retry after a timeout is safe.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const auth = await authenticate(request, raw, "register");
  if (!auth.ok) {
    await recordInbound({ kind: "student.register", keyId: null, idempotencyKey: null, payload: { refused: auth.why }, status: "FAILED", responseStatus: auth.status, error: auth.why });
    return Response.json({ ok: false, error: auth.why }, { status: auth.status });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  const already = await answerAlreadyGiven(idempotencyKey);
  if (already) return Response.json(already.response, { status: already.status, headers: { "x-medcity-replay": "1" } });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    const why = "The body is not JSON the portal can read";
    await recordInbound({ kind: "student.register", keyId: auth.caller.id, idempotencyKey, payload: { raw: raw.slice(0, 500) }, status: "FAILED", responseStatus: 400, error: why });
    return Response.json({ ok: false, error: why }, { status: 400 });
  }

  const { crmId, updatedAt, branch, ...fields } = body as { crmId?: string; updatedAt?: string; branch?: string };
  const result = await applyIncomingStudent(
    { crmId: String(crmId ?? ""), updatedAt: String(updatedAt ?? ""), branch: branch ? String(branch) : undefined, fields: fields as Record<string, unknown> },
    auth.caller.name,
  );

  if (!result.ok) {
    await recordInbound({ kind: "student.register", keyId: auth.caller.id, idempotencyKey, payload: body, status: "FAILED", responseStatus: result.status, error: result.why });
    return Response.json({ ok: false, error: result.why }, { status: result.status });
  }

  const summary = await studentSummary(result.studentId);
  const response = {
    ok: true,
    created: result.created,
    studentId: result.studentId,
    medcityId: result.medcityId,
    changed: result.plan.changed.map((c) => c.field),
    // Said out loud rather than hidden: these are the fields the portal would not
    // overwrite, and why, so the CRM can show its own user the same thing.
    leftAlone: result.plan.conflicts.map((c) => ({ field: c.field, ours: c.mine, yours: c.theirs })),
    ignoredFields: result.plan.ignored,
    staleMessage: result.plan.stale,
    student: summary,
  };

  const event = await recordInbound({
    kind: "student.register",
    keyId: auth.caller.id,
    idempotencyKey,
    payload: body,
    status: result.plan.conflicts.length > 0 ? "NEEDS_A_PERSON" : "RECEIVED",
    response,
    responseStatus: result.created ? 201 : 200,
    entityType: "student",
    entityId: result.studentId,
  });
  if (event && result.plan.conflicts.length > 0) await raiseConflict(event.id, result.studentId, result.plan);

  return Response.json(response, { status: result.created ? 201 : 200 });
}

/**
 * Looking a student up, by whichever identifier the CRM has.
 *
 *   GET /api/crm/students?crmId=... | ?medcityId=... | ?phone=... | ?email=...
 *
 * Answers with where the student is, what their applications are doing and what
 * is still wanted from them. Not their documents, not internal notes, and not
 * commission: a lookup is for answering a parent on the phone.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, "", "lookup");
  if (!auth.ok) return Response.json({ ok: false, error: auth.why }, { status: auth.status });

  const q = new URL(request.url).searchParams;
  const by = {
    crmId: q.get("crmId") ?? undefined,
    medcityId: q.get("medcityId") ?? undefined,
    email: q.get("email") ?? undefined,
    phone: q.get("phone") ?? undefined,
  };
  if (!by.crmId && !by.medcityId && !by.email && !by.phone) {
    return Response.json({ ok: false, error: "Give one of crmId, medcityId, email or phone" }, { status: 400 });
  }

  const student = await findStudent(by);
  if (!student) return Response.json({ ok: false, found: false }, { status: 404 });
  return Response.json({ ok: true, found: true, student: await studentSummary(student.id) });
}
