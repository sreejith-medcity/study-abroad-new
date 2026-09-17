"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseProgramCsv, type ImportError, type ImportRow } from "@/lib/program-import";
import { ADMIN_ROLES } from "@/lib/permissions";

export type ImportState = {
  error?: string;
  ok?: string;
  preview?: { valid: number; errors: ImportError[]; sample: Pick<ImportRow, "line" | "program" | "university" | "countryCode" | "level" | "intakeMonths">[]; csv: string };
};

export async function importProgramsAction(prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const mode = String(formData.get("mode"));
  let text = String(formData.get("csv") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) return { error: "CSV files must be 5 MB or smaller." };
    text = await file.text();
  }
  if (mode === "commit" && prev.preview?.csv && !text.trim()) text = prev.preview.csv;
  if (!text.trim()) return { error: "Upload a CSV file or paste CSV text." };

  const docCodes = (await db.select({ code: schema.documentTypes.code }).from(schema.documentTypes)).map((d) => d.code);
  const { rows, errors } = parseProgramCsv(text, docCodes);

  const countries = await db.select().from(schema.countries);
  const byCode = Object.fromEntries(countries.map((c) => [c.code, c]));
  for (const r of rows) if (!byCode[r.countryCode]) errors.push({ line: r.line, message: `Country ${r.countryCode} is not set up yet` });
  const valid = rows.filter((r) => byCode[r.countryCode]);

  if (mode !== "commit") {
    return { preview: { valid: valid.length, errors: errors.sort((a, b) => a.line - b.line), sample: valid.slice(0, 8).map(({ line, program, university, countryCode, level, intakeMonths }) => ({ line, program, university, countryCode, level, intakeMonths })), csv: text } };
  }

  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const uniCache = new Map<string, string>();
    for (const r of valid) {
      const countryId = byCode[r.countryCode].id;
      const key = `${r.university}|${countryId}`;
      let universityId = uniCache.get(key);
      if (!universityId) {
        const [uni] = await tx
          .insert(schema.universities)
          .values({ name: r.university, city: r.city, countryId })
          .onConflictDoUpdate({ target: [schema.universities.name, schema.universities.countryId], set: { city: r.city ?? undefined } })
          .returning();
        universityId = uni.id;
        uniCache.set(key, universityId);
      }
      const values = {
        name: r.program, universityId, pathway: r.pathway, level: r.level, studyArea: r.studyArea, durationMonths: r.durationMonths,
        tuitionPerYear: r.tuitionPerYear, applicationFee: r.applicationFee, initialDeposit: r.initialDeposit, intakeMonths: r.intakeMonths,
        minIelts: r.minIelts, minPte: r.minPte, minOetGrade: r.minOetGrade, minGermanLevel: r.minGermanLevel, maxBacklogs: r.maxBacklogs,
        maxGapYears: r.maxGapYears, moiAccepted: r.moiAccepted, requiredDocs: r.requiredDocs, status: r.status, updatedAt: new Date(),
      };
      const existing = await tx.query.programs.findFirst({ where: and(eq(schema.programs.name, r.program), eq(schema.programs.universityId, universityId)) });
      if (existing) {
        await tx.update(schema.programs).set(values).where(eq(schema.programs.id, existing.id));
        updated++;
      } else {
        await tx.insert(schema.programs).values(values);
        created++;
      }
    }
  });
  await audit(user.id, "programs.import", "program", "*", { created, updated, skipped: errors.length });
  revalidatePath("/admin/programs");
  return { ok: `Imported: ${created} new, ${updated} updated${errors.length ? `, ${errors.length} rows skipped` : ""}.` };
}

export async function setProgramStatusAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("programId"));
  const status = String(formData.get("status")) as "DRAFT" | "LIVE" | "ARCHIVED";
  if (!["DRAFT", "LIVE", "ARCHIVED"].includes(status)) return;
  await db.update(schema.programs).set({ status, updatedAt: new Date() }).where(eq(schema.programs.id, id));
  await audit(user.id, "program.status", "program", id, { status });
  revalidatePath("/admin/programs");
}
