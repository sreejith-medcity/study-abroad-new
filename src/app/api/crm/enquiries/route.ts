import { answerAlreadyGiven, authenticate, recordInbound } from "@/server/crm-link";
import { applyIncomingEnquiry } from "@/server/crm-inbound";

export const dynamic = "force-dynamic";

/**
 * A lead from Medcity's own CRM, before anybody has decided it is a student.
 *
 *   POST /api/crm/enquiries
 *   x-medcity-key: mck_...
 *   authorization: Bearer mcs_...
 *
 *   { "crmId": "LEAD-9912", "name": "Devika Nair", "phone": "+91 9447033333",
 *     "branch": "KOT", "interestCountry": "Germany", "notes": "Std. 12 science" }
 *
 * It lands as an enquiry owned by the branch named, or by the head office when
 * none is, with a follow-up due the next day. Sending the same crmId again does
 * nothing: a lead is something a counsellor is already working, and overwriting
 * their notes from outside would be worse than ignoring the repeat.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const auth = await authenticate(request, raw, "enquiry");
  if (!auth.ok) return Response.json({ ok: false, error: auth.why }, { status: auth.status });

  const idempotencyKey = request.headers.get("idempotency-key");
  const already = await answerAlreadyGiven(idempotencyKey);
  if (already) return Response.json(already.response, { status: already.status, headers: { "x-medcity-replay": "1" } });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "The body is not JSON the portal can read" }, { status: 400 });
  }

  const result = await applyIncomingEnquiry({
    crmId: String(body.crmId ?? ""),
    name: String(body.name ?? ""),
    phone: String(body.phone ?? ""),
    email: body.email ? String(body.email) : undefined,
    city: body.city ? String(body.city) : undefined,
    branch: body.branch ? String(body.branch) : undefined,
    interestCountry: body.interestCountry ? String(body.interestCountry) : undefined,
    notes: body.notes ? String(body.notes) : undefined,
  });

  if (!result.ok) {
    await recordInbound({ kind: "enquiry.create", keyId: auth.caller.id, idempotencyKey, payload: body, status: "FAILED", responseStatus: result.status, error: result.why });
    return Response.json({ ok: false, error: result.why }, { status: result.status });
  }

  const response = { ok: true, created: result.created, enquiryId: result.enquiryId };
  await recordInbound({
    kind: "enquiry.create",
    keyId: auth.caller.id,
    idempotencyKey,
    payload: body,
    status: "RECEIVED",
    response,
    responseStatus: result.created ? 201 : 200,
    entityType: "enquiry",
    entityId: result.enquiryId,
  });
  return Response.json(response, { status: result.created ? 201 : 200 });
}
