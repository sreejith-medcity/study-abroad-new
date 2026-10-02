"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isOutboundKind, OUTBOUND_KINDS } from "@/lib/crm-link";
import { seal } from "@/lib/secret-box";
import { SCOPES, SECRET_PURPOSE, hashSecret, newKeyId, newSecret } from "@/server/crm-link";
import { drainOutbound } from "@/server/crm-out";

import type { FormState } from "@/lib/form-state";
export type { FormState };

/**
 * The desk's hand on the link to Medcity's own CRM: the keys, where events go,
 * and what to do about a row that needs a person.
 *
 * All of it a super admin's, because a key handed out here can read and write
 * student records.
 */

const keyShape = z.object({
  name: z.string().trim().min(3, "What this key is for").max(120),
  scopes: z.string().optional(),
  signatureRequired: z.string().optional(),
});

/**
 * A new key.
 *
 * The secret is shown once and never again: it is kept as a bcrypt hash for the
 * bearer way in, and sealed under AUTH_SECRET so a signature can be checked.
 * Nobody here can read it back out of a screen, which is the only way to be able
 * to say that honestly.
 */
export async function createIntegrationKeyAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["SUPER_ADMIN"]);
  const parsed = keyShape.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };

  const scopes = (fd.getAll("scopes") as string[]).filter((s) => (SCOPES as readonly string[]).includes(s));
  const signing = parsed.data.signatureRequired === "on" || parsed.data.signatureRequired === "true";
  const keyId = newKeyId();
  const secret = newSecret();

  const [row] = await db
    .insert(schema.integrationKeys)
    .values({
      name: parsed.data.name,
      keyId,
      secretHash: await hashSecret(secret),
      secretBox: seal(secret, SECRET_PURPOSE),
      signatureRequired: signing,
      scopes,
      createdById: user.id,
    })
    .returning();
  await audit(user.id, "integration.key.create", "integration_key", row.id, { name: parsed.data.name, scopes, signing });
  // Not revalidated on purpose: refreshing the list would take this form away,
  // and with it the only sight of the secret anybody will ever get.
  return {
    keep: true,
    ok: `Key for ${parsed.data.name}. Key id: ${keyId}. Secret: ${secret}. ${
      signing ? "This key must sign every request." : "Send the secret as a bearer token, or switch signing on when the vendor is ready."
    } Copy both now: the secret cannot be shown again.`,
  };
}

export async function revokeIntegrationKeyAction(fd: FormData) {
  const user = await requireUser(["SUPER_ADMIN"]);
  const id = String(fd.get("keyId"));
  const row = await db.query.integrationKeys.findFirst({ where: eq(schema.integrationKeys.id, id) });
  if (!row || row.revokedAt) return;
  await db
    .update(schema.integrationKeys)
    .set({ active: false, revokedAt: new Date(), revokedById: user.id })
    .where(eq(schema.integrationKeys.id, id));
  await audit(user.id, "integration.key.revoke", "integration_key", id, { name: row.name });
  revalidatePath("/admin/integrations");
}

/** Signing on or off for one key, so a vendor can start simple and tighten later. */
export async function setSigningAction(fd: FormData) {
  const user = await requireUser(["SUPER_ADMIN"]);
  const id = String(fd.get("keyId"));
  const required = String(fd.get("required")) === "true";
  const row = await db.query.integrationKeys.findFirst({ where: eq(schema.integrationKeys.id, id) });
  if (!row || row.revokedAt) return;
  if (required && !row.secretBox) return;
  await db.update(schema.integrationKeys).set({ signatureRequired: required }).where(eq(schema.integrationKeys.id, id));
  await audit(user.id, "integration.key.signing", "integration_key", id, { required });
  revalidatePath("/admin/integrations");
}

const targetShape = z.object({
  url: z.string().trim().optional(),
  secret: z.string().trim().optional(),
  enabled: z.string().optional(),
});

/**
 * Where the portal posts what happens, and which kinds go.
 *
 * Settings rather than code, because the CRM's production build is somebody
 * else's work in progress: when the vendor says what shape they want, this is
 * where it changes. A blank secret on a save keeps the one already stored, so
 * editing the URL does not quietly unsign every future send.
 */
export async function saveCrmTargetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["SUPER_ADMIN"]);
  const parsed = targetShape.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Check the highlighted fields." };
  const typed = parsed.data.url?.trim() ?? "";
  if (typed) {
    try {
      const u = new URL(typed);
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
        return { fieldErrors: { url: ["Use https"] }, error: "Student data must not go out over plain http." };
      }
    } catch {
      return { fieldErrors: { url: ["A full URL, starting https://"] }, error: "That is not a URL the portal can post to." };
    }
  }

  const kinds = (fd.getAll("kinds") as string[]).filter(isOutboundKind);
  const enabled = parsed.data.enabled === "on" || parsed.data.enabled === "true";
  if (enabled && !typed) return { fieldErrors: { url: ["Needed before this can be switched on"] }, error: "Give the URL to post to first." };

  const secret = parsed.data.secret?.trim();
  await db
    .update(schema.appSettings)
    .set({
      crmWebhookUrl: typed || null,
      crmWebhookEnabled: enabled,
      crmWebhookKinds: kinds,
      // Left blank keeps what is stored, so editing the URL does not unsign sends.
      ...(secret ? { crmWebhookSecretBox: seal(secret, SECRET_PURPOSE) } : {}),
      updatedById: user.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.appSettings.id, "app"));
  await audit(user.id, "integration.target", "settings", "app", { url: typed || null, enabled, kinds, secretChanged: !!secret });
  revalidatePath("/admin/integrations");
  return {
    ok: enabled
      ? `Saved. ${kinds.length === 0 ? "Nothing is being sent, because no kind is ticked." : `${kinds.length} of ${Object.keys(OUTBOUND_KINDS).length} kinds will be sent.`}`
      : "Saved. Nothing is being sent while this is switched off.",
  };
}

/** A test event, so the vendor can see a real request before anything real happens. */
export async function sendTestEventAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["SUPER_ADMIN"]);
  void fd;
  const settings = await db.query.appSettings.findFirst({ where: eq(schema.appSettings.id, "app") });
  if (!settings?.crmWebhookUrl) return { error: "Give the URL to post to first." };

  // Queued as the real thing is, then drained at once, so what the vendor
  // receives is exactly the shape and the headers a real event carries.
  const [row] = await db
    .insert(schema.integrationEvents)
    .values({
      direction: "OUT",
      kind: "student.stage",
      status: "PENDING",
      entityType: "test",
      entityId: "test",
      payload: {
        kind: "student.stage",
        entityType: "student",
        entityId: "test",
        happenedAt: new Date().toISOString(),
        test: true,
        medcityId: "MC-TEST-26-0001",
        name: "A test, sent by hand from the portal",
        from: "PROFILE",
        to: "SHORTLIST",
      },
    })
    .returning();
  const result = await drainOutbound(5);
  const after = await db.query.integrationEvents.findFirst({ where: eq(schema.integrationEvents.id, row.id) });
  await audit(user.id, "integration.test", "integration_event", row.id, { status: after?.status, responseStatus: after?.responseStatus });
  revalidatePath("/admin/integrations");
  // Kept on the screen rather than raised as a toast: this is a diagnostic
  // somebody is reading while they talk to the vendor on the phone.
  if (after?.status === "SENT") return { keep: true, ok: `Sent, and they answered ${after.responseStatus}.` };
  return { error: `Not sent. ${after?.needsAPersonBecause ?? after?.error ?? `They answered ${after?.responseStatus ?? "nothing"}.`} ${result.retrying > 0 ? "It will be tried again." : ""}` };
}

/** Sends whatever is waiting, now, rather than at the next scheduled run. */
export async function drainNowAction(fd: FormData) {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  void fd;
  const result = await drainOutbound();
  await audit(user.id, "integration.drain", "integration_event", "*", result);
  revalidatePath("/admin/integrations");
}

/** Puts a row that gave up back in the queue, after whatever was wrong is fixed. */
export async function retryEventAction(fd: FormData) {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  const id = String(fd.get("eventId"));
  const row = await db.query.integrationEvents.findFirst({ where: eq(schema.integrationEvents.id, id) });
  if (!row || row.direction !== "OUT") return;
  await db
    .update(schema.integrationEvents)
    .set({ status: "PENDING", attempts: 0, nextAttemptAt: null, error: null, needsAPersonBecause: null })
    .where(eq(schema.integrationEvents.id, id));
  await audit(user.id, "integration.retry", "integration_event", id, { kind: row.kind });
  revalidatePath("/admin/integrations");
}

const resolveShape = z.object({ eventId: z.string().min(1), note: z.string().trim().min(3, "What was done about it").max(400) });

/** Dealt with. The note says what was done, because the next person will ask. */
export async function resolveEventAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  const parsed = resolveShape.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say what was done about it." };
  const row = await db.query.integrationEvents.findFirst({ where: eq(schema.integrationEvents.id, parsed.data.eventId) });
  if (!row) return { error: "That row is no longer there." };
  await db
    .update(schema.integrationEvents)
    .set({ status: "RESOLVED", note: parsed.data.note, resolvedById: user.id, resolvedAt: new Date() })
    .where(eq(schema.integrationEvents.id, row.id));
  await audit(user.id, "integration.resolve", "integration_event", row.id, { kind: row.kind, note: parsed.data.note });
  revalidatePath("/admin/integrations");
  return { ok: "Marked as dealt with." };
}

/** Nothing to do about it. Kept, not deleted, so the record is still the record. */
export async function ignoreEventAction(fd: FormData) {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  const id = String(fd.get("eventId"));
  const row = await db.query.integrationEvents.findFirst({ where: eq(schema.integrationEvents.id, id) });
  if (!row) return;
  await db.update(schema.integrationEvents).set({ status: "IGNORED", resolvedById: user.id, resolvedAt: new Date() }).where(eq(schema.integrationEvents.id, id));
  await audit(user.id, "integration.ignore", "integration_event", id, { kind: row.kind });
  revalidatePath("/admin/integrations");
}
