"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ilike } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES } from "@/lib/permissions";
import { bestRankSort, parseRankingsCsv } from "@/lib/rankings";

/** The visa living-cost figure for one destination, with its wording and source. */
export async function saveLivingFundsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("countryId") ?? "");
  const rawAmount = String(fd.get("amount") ?? "").replace(/,/g, "").trim();
  const amount = rawAmount ? Number(rawAmount) : null;
  const note = String(fd.get("note") ?? "").trim() || null;
  const source = String(fd.get("source") ?? "").trim() || null;
  const errors: Record<string, string[]> = {};
  if (amount != null && (!Number.isInteger(amount) || amount <= 0)) errors.amount = ["A whole amount"];
  if (amount != null && !source) errors.source = ["The government page it comes from"];
  if (source && !/^https:\/\//.test(source)) errors.source = ["A full link, starting https://"];
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };
  await db
    .update(schema.countries)
    .set({ visaLivingFunds: amount, visaLivingNote: note, visaLivingSource: source, visaLivingChecked: amount != null ? new Date().toISOString().slice(0, 10) : null })
    .where(eq(schema.countries.id, id));
  await audit(user.id, "country.living_funds", "country", id, { amount, source });
  revalidatePath("/admin/destinations");
  return { ok: "Saved." };
}

/** Rankings from a CSV; a university is found by name (and country when given). */
export async function importRankingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  let text = String(fd.get("csv") ?? "");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) return { error: "Keep the file under 2 MB." };
    text = await file.text();
  }
  if (!text.trim()) return { error: "Upload a CSV file or paste the rows." };
  const { rows, errors } = parseRankingsCsv(text);
  const countries = await db.select().from(schema.countries);
  const byCode = new Map(countries.map((c) => [c.code, c.id]));
  const missing: string[] = [];
  let updated = 0;
  for (const r of rows) {
    const countryId = r.countryCode ? byCode.get(r.countryCode) : undefined;
    const found = await db.query.universities.findMany({
      where: and(ilike(schema.universities.name, r.university), countryId ? eq(schema.universities.countryId, countryId) : undefined),
      columns: { id: true },
    });
    if (found.length !== 1) {
      missing.push(`line ${r.line}: ${r.university}${found.length > 1 ? " (in more than one country, add country_code)" : ""}`);
      continue;
    }
    await db
      .update(schema.universities)
      .set({ qsRank: r.qsRank, qsYear: r.qsYear, theRank: r.theRank, theYear: r.theYear, rankSort: bestRankSort(r.qsRank, r.theRank) })
      .where(eq(schema.universities.id, found[0].id));
    updated++;
  }
  await audit(user.id, "universities.rankings", "university", "*", { updated, skipped: errors.length + missing.length });
  revalidatePath("/admin/destinations");
  const problems = [...errors.map((e) => `line ${e.line}: ${e.message}`), ...missing.map((m) => `${m}: no such university`)];
  if (!updated) return { error: problems.length ? `Nothing saved. ${problems.slice(0, 5).join("; ")}` : "Nothing saved." };
  return { ok: `Rankings saved for ${updated} universit${updated === 1 ? "y" : "ies"}.${problems.length ? ` Skipped ${problems.length}: ${problems.slice(0, 5).join("; ")}` : ""}`, keep: problems.length > 0 };
}
