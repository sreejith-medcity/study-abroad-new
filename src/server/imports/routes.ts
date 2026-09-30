import "server-only";
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, oneOf, text, yes, type Problems } from "@/lib/import-values";
import { PAYABLE_ON } from "@/lib/vendors";
import { emptyResult, lineOf, type ImportResult } from "./common";

export const ROUTE_COLUMNS = [
  "vendor", "university", "program", "country_code", "basis", "percent_of_tuition", "flat_amount", "currency",
  "payable_on", "days_to_pay", "application_fee", "offer_tat_days", "vendor_course_code", "extra_documents", "interview", "active",
] as const;

export const ROUTE_EXAMPLE = [
  "KC", "University of Dundee", "MSc Computer Science", "GB", "percent", "9", "", "",
  "visa approved", "60", "0", "5", "KC-UK-1182", "Their application form, a counsellor declaration", "no", "yes",
];

type Row = Record<string, string>;

/**
 * A vendor's commission sheet, as a file.
 *
 * One row is one road to one course: the vendor, the university, the course,
 * and what they pay for it. A course is found by its university and its name,
 * the same identity the program import uses. Nothing here creates a course: a
 * row naming a course the catalogue does not hold is reported, not invented.
 */
export async function importRoutes(user: SessionUser, rows: Row[], commit: boolean): Promise<ImportResult> {
  const out = emptyResult();
  const vendors = await db.select({ id: schema.vendors.id, name: schema.vendors.name, code: schema.vendors.code }).from(schema.vendors);
  if (!vendors.length) {
    out.errors.push({ line: 1, message: "No vendors have been added yet. Add them under Vendors and routes first" });
    return out;
  }
  const vendorNames = vendors.map((v) => v.name).slice(0, 8).join(", ");

  type Plan = {
    line: number;
    vendorId: string;
    programId: string;
    label: string;
    values: Record<string, unknown>;
  };
  const plans: Plan[] = [];
  const seen = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const line = lineOf(i);
    const p: Problems = [];
    const vendorText = (r.vendor ?? "").trim();
    const vendor = vendors.find((v) => v.code.toLowerCase() === vendorText.toLowerCase() || v.name.toLowerCase() === vendorText.toLowerCase());
    if (!vendorText) p.push(`vendor: name the vendor. Vendors are: ${vendorNames}`);
    else if (!vendor) p.push(`vendor: no vendor called "${vendorText}". Vendors are: ${vendorNames}`);

    const university = text(r.university, 200);
    const program = text(r.program, 250);
    if (!university) p.push("university is required");
    if (!program) p.push("program is required");

    const basis = oneOf(r.basis, "basis", ["PERCENT_TUITION", "FLAT"] as const, p, { percent: "PERCENT_TUITION", "percentage": "PERCENT_TUITION", "%": "PERCENT_TUITION", flat: "FLAT", fixed: "FLAT" }) ?? "PERCENT_TUITION";
    const percent = num(r.percent_of_tuition, "percent_of_tuition", p, { min: 0, max: 100 });
    const flat = num(r.flat_amount, "flat_amount", p, { int: true, min: 0 });
    const currency = text(r.currency, 3)?.toUpperCase() ?? null;
    if (basis === "PERCENT_TUITION" && percent == null) p.push("percent_of_tuition is needed when the basis is a percentage");
    if (basis === "FLAT" && flat == null) p.push("flat_amount is needed when the basis is a flat fee");
    if (basis === "FLAT" && flat != null && !/^[A-Z]{3}$/.test(currency ?? "")) p.push("currency is needed with a flat fee, such as GBP");

    const payableOn = oneOf(r.payable_on, "payable_on", Object.keys(PAYABLE_ON) as ["OFFER_ACCEPTED", ...string[]], p, {
      "offer accepted": "OFFER_ACCEPTED",
      "fee paid": "FEE_PAID",
      "visa approved": "VISA_APPROVED",
      "enrolment confirmed": "ENROLMENT_CONFIRMED",
      "enrollment confirmed": "ENROLMENT_CONFIRMED",
    });
    const daysToPay = num(r.days_to_pay, "days_to_pay", p, { int: true, min: 0, max: 365 });
    const applicationFee = num(r.application_fee, "application_fee", p, { int: true, min: 0 });
    const offerTatDays = num(r.offer_tat_days, "offer_tat_days", p, { int: true, min: 0, max: 365 });

    if (p.length) {
      out.errors.push({ line, message: p.join("; ") });
      continue;
    }

    const country = text(r.country_code, 2)?.toUpperCase() ?? null;
    const found = await db
      .select({ id: schema.programs.id, name: schema.programs.name, university: schema.universities.name })
      .from(schema.programs)
      .innerJoin(schema.universities, eq(schema.universities.id, schema.programs.universityId))
      .innerJoin(schema.countries, eq(schema.countries.id, schema.universities.countryId))
      .where(and(ilike(schema.universities.name, university!), ilike(schema.programs.name, program!), country ? eq(schema.countries.code, country) : undefined))
      .limit(2);
    if (!found.length) {
      out.errors.push({ line, message: `no course called "${program}" at "${university}" in the catalogue` });
      continue;
    }
    if (found.length > 1) {
      out.errors.push({ line, message: `"${program}" at "${university}" matches more than one course. Add a country_code column to say which` });
      continue;
    }
    const key = `${vendor!.id}|${found[0].id}`;
    if (seen.has(key)) {
      out.errors.push({ line, message: `${vendor!.code} and this course are in the file twice` });
      continue;
    }
    seen.add(key);

    plans.push({
      line,
      vendorId: vendor!.id,
      programId: found[0].id,
      label: `${vendor!.code} · ${found[0].name}, ${found[0].university}`,
      values: {
        basis,
        percentOfTuition: basis === "PERCENT_TUITION" ? percent : null,
        flatAmount: basis === "FLAT" ? flat : null,
        currency: basis === "FLAT" ? currency : null,
        payableOn: payableOn ?? null,
        daysToPay,
        applicationFee,
        offerTatDays,
        vendorCourseCode: text(r.vendor_course_code, 60),
        extraDocuments: text(r.extra_documents, 400),
        interviewRequired: yes(r.interview),
        active: r.active === undefined || r.active.trim() === "" ? true : yes(r.active),
      },
    });
  }

  const existing = plans.length
    ? await db
        .select({ id: schema.programRoutes.id, programId: schema.programRoutes.programId, vendorId: schema.programRoutes.vendorId })
        .from(schema.programRoutes)
        .where(inArray(schema.programRoutes.programId, [...new Set(plans.map((x) => x.programId))]))
    : [];
  const have = new Set(existing.map((e) => `${e.vendorId}|${e.programId}`));

  for (const plan of plans) {
    const known = have.has(`${plan.vendorId}|${plan.programId}`);
    if (known) out.updated++;
    else out.created++;
    if (out.sample.length < 8) out.sample.push(`${known ? "Update" : "New"}: ${plan.label}`);
  }

  if (commit) {
    // In batches, so a vendor's whole sheet stays inside one request.
    for (let i = 0; i < plans.length; i += 250) {
      const chunk = plans.slice(i, i + 250);
      for (const plan of chunk) {
        const values = { ...plan.values, programId: plan.programId, vendorId: plan.vendorId, confirmedAt: new Date(), confirmedById: user.id, updatedAt: new Date() } as typeof schema.programRoutes.$inferInsert;
        await db
          .insert(schema.programRoutes)
          .values(values)
          .onConflictDoUpdate({ target: [schema.programRoutes.programId, schema.programRoutes.vendorId], set: values });
      }
    }
    const vendorIds = [...new Set(plans.map((x) => x.vendorId))];
    if (vendorIds.length) await db.update(schema.vendors).set({ termsConfirmedAt: new Date(), termsConfirmedById: user.id }).where(inArray(schema.vendors.id, vendorIds));
    await audit(user.id, "routes.import", "vendor", vendorIds.join(",") || "*", { created: out.created, updated: out.updated });
  }
  if (!plans.length && !out.errors.length) out.notes.push({ line: 1, message: "Nothing in the file to record" });
  void sql;
  return out;
}
