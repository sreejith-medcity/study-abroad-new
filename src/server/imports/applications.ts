import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { day, num, oneOf, text, type Problems } from "@/lib/import-values";
import { changeStatus, StatusChangeError } from "@/server/applications";
import { offerVisa, saveOfferVisa, type OfferVisaValues } from "@/server/offer-visa";
import { emptyResult, lineOf, type ImportResult } from "./common";

export const APPLICATION_COLUMNS = [
  "ack_no", "status", "status_reason", "priority",
  "offer_type", "offer_date", "offer_conditions", "offer_accept_by", "deposit_amount", "deposit_paid_on",
  "confirmation_number", "confirmation_issued_on", "visa_lodged_on", "visa_decision", "visa_decision_on",
] as const;
export const APPLICATION_EXAMPLE = ["144408/26-27", "Offer received", "", "HIGH", "CONDITIONAL", "2026-09-20", "IELTS 6.5 with no band below 6.0", "2026-10-15", "", "", "", "", "", "", ""];

const OFFER_FIELDS = ["offerType", "offerDate", "offerConditions", "offerAcceptBy", "depositAmount", "depositPaidOn", "confirmationNumber", "confirmationIssuedOn", "visaLodgedOn", "visaDecision", "visaDecisionOn"] as const;

/**
 * The team's bulk update of applications, found by acknowledgement number. A
 * blank cell leaves that value as it is. Status moves go through the same
 * rules as the screen: the pathway's own statuses, a reason where one is
 * required, the partner told, commission accrued at a paying milestone.
 */
export async function importApplicationUpdates(user: SessionUser, rows: Record<string, string>[], commit: boolean): Promise<ImportResult> {
  const out = emptyResult();
  const acks = rows.map((r) => (r.ack_no ?? "").trim()).filter(Boolean);
  const apps = acks.length ? await db.query.applications.findMany({ where: inArray(schema.applications.ackNo, acks), with: { status: true } }) : [];
  const byAck = new Map(apps.map((a) => [a.ackNo, a]));
  const statuses = await db.select().from(schema.statusDefinitions);
  const seen = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const line = lineOf(i);
    const p: Problems = [];
    const ack = (r.ack_no ?? "").trim();
    const app = byAck.get(ack);
    if (!ack) p.push("ack_no is required");
    else if (!app) p.push(`no application with acknowledgement number ${ack}`);
    if (ack && seen.has(ack)) p.push(`${ack} is in the file twice`);
    seen.add(ack);

    const wanted = text(r.status, 80);
    const to = wanted && app ? statuses.find((s) => s.pathway === app.status.pathway && (s.code.toLowerCase() === wanted.toLowerCase() || s.label.toLowerCase() === wanted.toLowerCase())) : null;
    if (wanted && app && !to) p.push(`status: "${wanted}" is not a ${app.status.pathway.toLowerCase()} status`);
    const reason = text(r.status_reason, 500);
    if (to?.requiresReason && to.id !== app?.statusId && !reason) p.push(`status_reason is required for "${to.label}"`);
    const priority = oneOf(r.priority, "priority", schema.applicationPriority.enumValues, p);

    const given: Record<string, unknown> = {
      offerType: oneOf(r.offer_type, "offer_type", ["CONDITIONAL", "UNCONDITIONAL"] as const, p),
      offerDate: day(r.offer_date, "offer_date", p),
      offerConditions: text(r.offer_conditions, 2000),
      offerAcceptBy: day(r.offer_accept_by, "offer_accept_by", p),
      depositAmount: num(r.deposit_amount, "deposit_amount", p, { int: true, min: 0 }),
      depositPaidOn: day(r.deposit_paid_on, "deposit_paid_on", p),
      confirmationNumber: text(r.confirmation_number, 60),
      confirmationIssuedOn: day(r.confirmation_issued_on, "confirmation_issued_on", p),
      visaLodgedOn: day(r.visa_lodged_on, "visa_lodged_on", p),
      visaDecision: oneOf(r.visa_decision, "visa_decision", ["GRANTED", "REFUSED"] as const, p, { approved: "GRANTED", rejected: "REFUSED" }),
      visaDecisionOn: day(r.visa_decision_on, "visa_decision_on", p),
    };
    let merged: Record<string, unknown> | null = null;
    if (app && Object.values(given).some((v) => v != null)) {
      // Blank cells keep what is on file; the result must still follow the offer and visa rules.
      merged = Object.fromEntries(OFFER_FIELDS.map((k) => [k, given[k] ?? app[k] ?? null]));
      const asForm = Object.fromEntries(Object.entries({ applicationId: app.id, ...merged }).map(([k, v]) => [k, v == null ? "" : String(v)]));
      const check = offerVisa.safeParse(asForm);
      if (!check.success) for (const [k, msgs] of Object.entries(check.error.flatten().fieldErrors)) p.push(`${k}: ${(msgs ?? []).join(", ")}`);
    }
    if (p.length || !app) {
      out.errors.push({ line, message: p.join("; ") });
      continue;
    }
    const changes: string[] = [];
    if (to && to.id !== app.statusId) changes.push(`status to ${to.label}`);
    if (priority && priority !== app.priority) changes.push(`priority ${priority.toLowerCase()}`);
    const offerChanged = merged ? OFFER_FIELDS.filter((k) => String(merged![k] ?? "") !== String(app[k] ?? "")) : [];
    if (offerChanged.length) changes.push(offerChanged.join(", "));
    if (!changes.length) {
      out.unchanged++;
      continue;
    }
    out.updated++;
    if (out.sample.length < 8) out.sample.push(`${ack}: ${changes.join("; ")}`);
    if (!commit) continue;
    try {
      if (priority && priority !== app.priority) {
        await db.update(schema.applications).set({ priority }).where(eq(schema.applications.id, app.id));
        await audit(user.id, "application.priority", "application", app.id, { from: app.priority, to: priority, source: "bulk upload" });
      }
      if (offerChanged.length) {
        const fresh = await db.query.applications.findFirst({ where: eq(schema.applications.id, app.id) });
        const parsed = offerVisa.parse(Object.fromEntries(Object.entries({ applicationId: app.id, ...merged }).map(([k, v]) => [k, v == null ? "" : String(v)])));
        await saveOfferVisa(user, fresh!, Object.fromEntries(OFFER_FIELDS.map((k) => [k, parsed[k]])) as OfferVisaValues);
      }
      if (to && to.id !== app.statusId) await changeStatus(user, app.id, to.id, reason ?? undefined);
    } catch (e) {
      out.updated--;
      out.errors.push({ line, message: e instanceof StatusChangeError ? e.message : `could not save: ${(e as Error).message}` });
    }
  }
  return out;
}
