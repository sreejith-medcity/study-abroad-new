import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { EMAIL, PHONE, day, num, oneOf, text, type Problems } from "@/lib/import-values";
import { branchOwner, branchResolver, emptyResult, lineOf, staffByEmail, type ImportResult } from "./common";

export const ENQUIRY_COLUMNS = ["branch", "name", "phone", "email", "city", "source", "interest_country", "interest_pathway", "intake_month", "intake_year", "budget_lakhs", "next_follow_up", "counsellor_email", "notes"] as const;
export const ENQUIRY_EXAMPLE = ["", "Rahul Nair", "+91 94460 11223", "rahul.nair@example.com", "Pala", "WALK_IN", "Germany", "AUSBILDUNG", "9", "2027", "8", "2026-10-05", "", "Plus two science, 78%. Wants nursing Ausbildung."];

const SOURCE_ALIASES: Record<string, (typeof schema.enquirySource.enumValues)[number]> = {
  "walk in": "WALK_IN", walkin: "WALK_IN", call: "PHONE", phone: "PHONE", whatsapp: "WHATSAPP", website: "WEBSITE", web: "WEBSITE",
  referral: "REFERRAL", reference: "REFERRAL", event: "EVENT", seminar: "EVENT", fair: "EVENT", social: "SOCIAL", facebook: "SOCIAL", instagram: "SOCIAL",
};

/**
 * Leads from a sheet or another CRM. A phone number already open as an
 * enquiry in the branch only has its blank fields filled in; anything else
 * becomes a new enquiry with its follow-up date.
 */
export async function importEnquiries(user: SessionUser, rows: Record<string, string>[], commit: boolean): Promise<ImportResult> {
  const out = emptyResult();
  const resolve = await branchResolver(user);
  const seen = new Set<string>();
  type Plan = { line: number; orgId: string; orgName: string; phone: string; fields: Record<string, unknown>; counsellor: string | null };
  const plans: Plan[] = [];

  rows.forEach((r, i) => {
    const line = lineOf(i);
    const p: Problems = [];
    const org = resolve(r.branch);
    if (typeof org === "string") p.push(org);
    const name = text(r.name, 120);
    const phone = text(r.phone, 20);
    const email = text(r.email, 160)?.toLowerCase() ?? null;
    if (!name) p.push("name is required");
    if (!phone || !PHONE.test(phone)) p.push("phone: a mobile number with country code is required");
    if (email && !EMAIL.test(email)) p.push("email is not an email");
    const key = `${typeof org === "string" ? "" : org.id}|${(phone ?? "").replace(/\D/g, "")}`;
    if (phone && seen.has(key)) p.push(`${phone} is in the file twice`);
    seen.add(key);
    const followUp = day(r.next_follow_up, "next_follow_up", p);
    const fields = {
      name,
      email,
      city: text(r.city, 80),
      source: oneOf(r.source, "source", schema.enquirySource.enumValues, p, SOURCE_ALIASES),
      interestCountry: text(r.interest_country, 80),
      interestPathway: oneOf(r.interest_pathway, "interest_pathway", schema.pathway.enumValues, p, { degree: "DEGREE", ausbildung: "AUSBILDUNG", nursing: "NURSING" }),
      intakeMonth: num(r.intake_month, "intake_month", p, { int: true, min: 1, max: 12 }),
      intakeYear: num(r.intake_year, "intake_year", p, { int: true, min: 2020, max: 2100 }),
      budgetLakhs: num(r.budget_lakhs, "budget_lakhs", p, { min: 0, max: 1000 }),
      notes: text(r.notes, 2000),
      nextFollowUpAt: followUp ? new Date(`${followUp}T10:00:00+05:30`) : null,
    };
    if (p.length) return void out.errors.push({ line, message: p.join("; ") });
    const o = org as { id: string; name: string };
    plans.push({ line, orgId: o.id, orgName: o.name, phone: phone!, fields, counsellor: text(r.counsellor_email)?.toLowerCase() ?? null });
  });

  const orgIds = [...new Set(plans.map((x) => x.orgId))];
  const staff = await staffByEmail(orgIds);
  const open = orgIds.length
    ? await db.select().from(schema.enquiries).where(and(inArray(schema.enquiries.orgId, orgIds), ne(schema.enquiries.stage, "CONVERTED"), ne(schema.enquiries.stage, "LOST")))
    : [];
  const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
  const byPhone = new Map(open.map((e) => [`${e.orgId}|${digits(e.phone)}`, e]));
  const owners = new Map<string, string | null>();
  for (const id of orgIds) owners.set(id, (await branchOwner(id))?.id ?? null);

  const toCreate: (typeof schema.enquiries.$inferInsert)[] = [];
  for (const plan of plans) {
    let assignedToId: string | null = null;
    if (plan.counsellor) {
      const hit = staff.get(`${plan.orgId}|${plan.counsellor}`);
      if (!hit) {
        out.errors.push({ line: plan.line, message: `counsellor_email: ${plan.counsellor} is not an active person in this branch` });
        continue;
      }
      assignedToId = hit.id;
    }
    const current = byPhone.get(`${plan.orgId}|${digits(plan.phone)}`);
    if (!current) {
      out.created++;
      if (out.sample.length < 8) out.sample.push(`New: ${plan.fields.name} · ${plan.phone} · ${plan.orgName}`);
      if (!commit) continue;
      const createdById = user.orgId === plan.orgId ? user.id : owners.get(plan.orgId);
      if (!createdById) {
        out.created--;
        out.errors.push({ line: plan.line, message: "the branch has no active owner to hold the enquiry" });
        continue;
      }
      const f = plan.fields;
      toCreate.push({
        orgId: plan.orgId,
        createdById,
        assignedToId: assignedToId ?? (user.role === "COUNSELLOR" ? user.id : null),
        name: f.name as string,
        phone: plan.phone,
        email: f.email as string | null,
        city: f.city as string | null,
        source: (f.source as (typeof schema.enquirySource.enumValues)[number] | null) ?? "OTHER",
        interestCountry: f.interestCountry as string | null,
        interestPathway: f.interestPathway as (typeof schema.pathway.enumValues)[number] | null,
        intakeMonth: f.intakeMonth as number | null,
        intakeYear: f.intakeYear as number | null,
        budgetLakhs: f.budgetLakhs as number | null,
        notes: f.notes as string | null,
        nextFollowUpAt: (f.nextFollowUpAt as Date | null) ?? new Date(Date.now() + 86400000),
      });
      continue;
    }
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(plan.fields)) {
      if (v == null || k === "source") continue;
      const have = current[k as keyof typeof current];
      if (have == null || have === "") set[k] = v;
    }
    if (assignedToId && !current.assignedToId) set.assignedToId = assignedToId;
    if (!Object.keys(set).length) {
      out.unchanged++;
      continue;
    }
    out.updated++;
    if (out.sample.length < 8) out.sample.push(`Fill in: ${current.name} · ${plan.phone} (${Object.keys(set).join(", ")})`);
    if (!commit) continue;
    await db.update(schema.enquiries).set({ ...set, updatedAt: new Date() }).where(eq(schema.enquiries.id, current.id));
    await audit(user.id, "enquiry.update", "enquiry", current.id, { source: "bulk upload", fields: Object.keys(set) });
  }
  for (let i = 0; i < toCreate.length; i += 250) {
    const made = await db.insert(schema.enquiries).values(toCreate.slice(i, i + 250)).returning({ id: schema.enquiries.id });
    await db.insert(schema.enquiryNotes).values(made.map((m) => ({ enquiryId: m.id, authorId: user.id, body: "Added from a bulk upload." })));
    await db.insert(schema.auditLogs).values(made.map((m) => ({ actorId: user.id, action: "enquiry.create", entityType: "enquiry", entityId: m.id, meta: { source: "bulk upload" } })));
  }
  return out;
}
