import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAX_ATTEMPTS, SIGNATURE_HEADER, TIMESTAMP_HEADER, isOutboundKind, nextAttemptAt, shouldSend, worthRetrying } from "@/lib/crm-link";
import { sign } from "@/lib/crm-signing";
import { open as openSecret } from "@/lib/secret-box";
import { SECRET_PURPOSE, dueOutbound } from "@/server/crm-link";
import { getSettings } from "@/server/settings";
import { adminIds, notifyUsers } from "@/server/notify";

/**
 * Telling Medcity's CRM what happened here.
 *
 * Queued rather than posted on the spot, for one reason: a counsellor moving a
 * student to the next stage must not wait on somebody else's server, and must
 * not fail because that server is down. The row is written, the screen carries
 * on, and the queue is drained on a schedule with retries.
 *
 * Where it goes and what it looks like are settings. The CRM's production build
 * is somebody else's work in progress, so when the vendor says what shape they
 * want, that is a change on the sync screen rather than a deploy here.
 */

export type OutboundPayload = Record<string, unknown>;

/**
 * Puts one event on the queue, if the desk has switched that kind on.
 *
 * Never throws. An integration that can break the thing it reports on is worse
 * than no integration: the worst this can do is fail to record an event, and
 * failing loudly inside somebody's status change would be worse than that.
 */
export async function queueOutbound(kind: string, entityType: string, entityId: string, payload: OutboundPayload) {
  try {
    if (!isOutboundKind(kind)) return null;
    const settings = await getSettings();
    if (!settings.crmWebhookEnabled || !settings.crmWebhookUrl) return null;
    if (!shouldSend(kind, settings.crmWebhookKinds)) return null;

    const [row] = await db
      .insert(schema.integrationEvents)
      .values({
        direction: "OUT",
        kind,
        status: "PENDING",
        entityType,
        entityId,
        payload: { kind, entityType, entityId, happenedAt: new Date().toISOString(), ...payload },
      })
      .returning();
    return row;
  } catch {
    return null;
  }
}

export type DrainResult = { tried: number; sent: number; retrying: number; gaveUp: number };

/**
 * Sends what is waiting.
 *
 * A refusal the CRM meant (a 400, a 422) is not retried: trying the same bad
 * payload six times is noise, and somebody has to look at it. A timeout, a 429
 * or a 500 is retried with a growing wait. After six goes it stops and is put in
 * front of a person, because an integration that retries forever is one nobody
 * ever notices has been broken for a month.
 */
export async function drainOutbound(limit = 50): Promise<DrainResult> {
  const settings = await getSettings();
  const out: DrainResult = { tried: 0, sent: 0, retrying: 0, gaveUp: 0 };
  if (!settings.crmWebhookEnabled || !settings.crmWebhookUrl) return out;

  const secret = settings.crmWebhookSecretBox ? openSecret(settings.crmWebhookSecretBox, SECRET_PURPOSE) : null;
  const rows = await dueOutbound(limit);

  for (const row of rows) {
    out.tried += 1;
    const attempt = row.attempts + 1;
    const body = JSON.stringify({ id: row.id, ...row.payload });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { "content-type": "application/json" };
    // The secret never goes out in the open: it signs the body instead, so what
    // crosses the wire proves itself without being reusable.
    if (secret) {
      headers[TIMESTAMP_HEADER] = timestamp;
      headers[SIGNATURE_HEADER] = sign(secret, "POST", new URL(settings.crmWebhookUrl).pathname, timestamp, body);
    }

    let status: number | null = null;
    let answer: string = "";
    let error: string | null = null;
    try {
      const res = await fetch(settings.crmWebhookUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
      status = res.status;
      answer = (await res.text()).slice(0, 2000);
    } catch (e) {
      error = (e as Error).message;
    }

    const worked = status != null && status >= 200 && status < 300;
    if (worked) {
      await db
        .update(schema.integrationEvents)
        .set({ status: "SENT", attempts: attempt, lastAttemptAt: new Date(), nextAttemptAt: null, responseStatus: status, response: { body: answer }, error: null })
        .where(eq(schema.integrationEvents.id, row.id));
      out.sent += 1;
      continue;
    }

    const again = worthRetrying(status) ? nextAttemptAt(attempt) : null;
    if (again) {
      await db
        .update(schema.integrationEvents)
        .set({ status: "PENDING", attempts: attempt, lastAttemptAt: new Date(), nextAttemptAt: again, responseStatus: status, response: { body: answer }, error })
        .where(eq(schema.integrationEvents.id, row.id));
      out.retrying += 1;
      continue;
    }

    const why = worthRetrying(status)
      ? `Gave up after ${MAX_ATTEMPTS} attempts. Last answer: ${status ?? "no reply"}${error ? ` (${error})` : ""}`
      : `The CRM refused it: ${status}. Retrying the same payload will not help, so somebody has to look.`;
    await db
      .update(schema.integrationEvents)
      .set({ status: "NEEDS_A_PERSON", attempts: attempt, lastAttemptAt: new Date(), nextAttemptAt: null, responseStatus: status, response: { body: answer }, error, needsAPersonBecause: why })
      .where(eq(schema.integrationEvents.id, row.id));
    out.gaveUp += 1;
  }

  if (out.gaveUp > 0) {
    await notifyUsers(await adminIds(), "The CRM link needs somebody", `${out.gaveUp} event${out.gaveUp === 1 ? "" : "s"} could not be sent.`, "/admin/integrations?tab=attention");
  }
  return out;
}

// ---------- What each hook sends ----------

/** A student has moved along the nine stages. */
export const sendStageChange = (studentId: string, payload: OutboundPayload) => queueOutbound("student.stage", "student", studentId, payload);

/** An application's status has changed. */
export const sendStatusChange = (applicationId: string, payload: OutboundPayload) => queueOutbound("application.status", "application", applicationId, payload);

/** Money has moved: a commission, an invoice payment, a referral fee. */
export const sendMoneyEvent = (entityId: string, payload: OutboundPayload) => queueOutbound("money.event", "money", entityId, payload);

/** A document has been accepted or sent back. */
export const sendDocumentDecision = (studentId: string, payload: OutboundPayload) => queueOutbound("document.decision", "student", studentId, payload);
