"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseProgramCsv, type ImportError, type ImportRow } from "@/lib/program-import";
import { ADMIN_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";
import { programFilterWhere, readProgramFilters } from "@/server/program-filters";
import { fetchCricosFiles, syncCricos } from "@/server/cricos-sync";

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
          // The university keeps the first city it was given. Each row's own
          // city is its campus, stored on the program, because a university with
          // several campuses would otherwise take whichever row came last.
          .onConflictDoUpdate({
            target: [schema.universities.name, schema.universities.countryId],
            set: { city: sql`coalesce(${schema.universities.city}, excluded.city)` },
          })
          .returning();
        universityId = uni.id;
        uniCache.set(key, universityId);
      }
      const values = {
        name: r.program, universityId, campus: r.city, pathway: r.pathway, level: r.level, studyArea: r.studyArea, durationMonths: r.durationMonths,
        tuitionPerYear: r.tuitionPerYear, applicationFee: r.applicationFee, initialDeposit: r.initialDeposit, intakeMonths: r.intakeMonths,
        minIelts: r.minIelts, minPte: r.minPte, minOetGrade: r.minOetGrade, minGermanLevel: r.minGermanLevel, maxBacklogs: r.maxBacklogs,
        minToefl: r.minToefl, minDuolingo: r.minDuolingo, minGre: r.minGre, minGmat: r.minGmat, minSat: r.minSat, minAcademicPercent: r.minAcademicPercent, feeWaiver: r.feeWaiver,
        maxGapYears: r.maxGapYears, moiAccepted: r.moiAccepted, workRights: r.workRights, workRightsNote: r.workRightsNote,
        requiredDocs: r.requiredDocs, status: r.status, updatedAt: new Date(),
      };
      const existing = await tx.query.programs.findFirst({ where: and(eq(schema.programs.name, r.program), eq(schema.programs.universityId, universityId)) });
      let programId: string;
      if (existing) {
        await tx.update(schema.programs).set(values).where(eq(schema.programs.id, existing.id));
        programId = existing.id;
        updated++;
      } else {
        [{ id: programId }] = await tx.insert(schema.programs).values(values).returning({ id: schema.programs.id });
        created++;
      }
      // Listed intakes get their deadline set; intakes the file does not list keep theirs.
      for (const d of r.deadlines ?? []) {
        await tx
          .insert(schema.programDeadlines)
          .values({ programId, intakeMonth: d.month, intakeYear: d.year, deadline: d.deadline, createdById: user.id })
          .onConflictDoUpdate({ target: [schema.programDeadlines.programId, schema.programDeadlines.intakeYear, schema.programDeadlines.intakeMonth], set: { deadline: d.deadline } });
      }
    }
  });
  await audit(user.id, "programs.import", "program", "*", { created, updated, skipped: errors.length });
  // The form refreshes the list itself once it has the result. Revalidating the
  // calling page from inside the action is what left imports stuck on "Checking…".
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

/**
 * Publishes, or withdraws, every program matching the filters currently on
 * screen. An import lands 255 rows as drafts on purpose, and approving those one
 * at a time is not a review, it is data entry.
 */
export async function bulkStatusAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const to = String(formData.get("to"));
  if (!["LIVE", "DRAFT", "ARCHIVED"].includes(to)) return;

  const f = readProgramFilters((k) => formData.get(k)?.toString());
  // The old form sent the status filter as "from"; keep reading it.
  if (!f.status && formData.get("from")) f.status = String(formData.get("from"));

  const { programs: p, universities: u, countries: c } = schema;
  // The country lives on the university, so the filter has to reach across two
  // joins. Selecting the ids first and then updating by id worked until the
  // catalogue passed a few hundred rows, at which point the IN list was the
  // slowest part of the request. This keeps it to one statement whose size does
  // not grow with the number of programs being published.
  const scope = db
    .select({ id: p.id })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(programFilterWhere(f));

  const changed = await db
    .update(schema.programs)
    .set({ status: to as "LIVE", updatedAt: new Date() })
    .where(inArray(schema.programs.id, scope))
    .returning({ id: schema.programs.id });
  if (!changed.length) return;

  await audit(user.id, "programs.bulk_status", "program", "*", { to, ...f, count: changed.length });
  revalidatePath("/admin/programs");
  revalidatePath("/search");
}

const LEVELS = ["SCHOOL", "UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG", "PHD", "VOCATIONAL", "REGISTRATION", "CERTIFICATE"] as const;
const PATHWAYS = ["DEGREE", "AUSBILDUNG", "NURSING"] as const;
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** Reads an optional number field. Blank means "not recorded", which is not zero. */
function optionalNumber(fd: FormData, name: string, errors: Record<string, string[]>, opts: { int?: boolean; min?: number; max?: number } = {}) {
  const raw = String(fd.get(name) ?? "").trim().replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n))) {
    errors[name] = [opts.int ? "Enter a whole number, or leave it blank" : "Enter a number, or leave it blank"];
    return null;
  }
  if ((opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
    errors[name] = [`Must be between ${opts.min ?? "-"} and ${opts.max ?? "-"}`];
    return null;
  }
  return n;
}

/**
 * Edits one program. Kept deliberately close to the CSV import rules, so a row
 * that could not be imported cannot be created by hand either.
 */
export async function updateProgramAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("programId") ?? "");
  const current = await db.query.programs.findFirst({ where: eq(schema.programs.id, id) });
  if (!current) return { error: "That program no longer exists." };

  const errors: Record<string, string[]> = {};
  const name = String(fd.get("name") ?? "").trim();
  if (!name) errors.name = ["Enter the program name"];
  const level = String(fd.get("level") ?? "") as (typeof LEVELS)[number];
  if (!LEVELS.includes(level)) errors.level = ["Choose a level"];
  const pathway = String(fd.get("pathway") ?? "") as (typeof PATHWAYS)[number];
  if (!PATHWAYS.includes(pathway)) errors.pathway = ["Choose a pathway"];
  const status = String(fd.get("status") ?? "") as "DRAFT" | "LIVE" | "ARCHIVED";
  if (!["DRAFT", "LIVE", "ARCHIVED"].includes(status)) errors.status = ["Choose a status"];
  const workRights = String(fd.get("workRights") ?? "") as "UNKNOWN" | "ELIGIBLE" | "INELIGIBLE";
  if (!["UNKNOWN", "ELIGIBLE", "INELIGIBLE"].includes(workRights)) errors.workRights = ["Choose an answer"];
  const workRightsNote = String(fd.get("workRightsNote") ?? "").trim() || null;
  // A verdict without its evidence is exactly what this column exists to stop.
  if (workRights !== "UNKNOWN" && !workRightsNote) errors.workRightsNote = ["Say where this comes from, for example the institution's page"];
  const minGermanLevel = String(fd.get("minGermanLevel") ?? "").trim().toUpperCase() || null;
  if (minGermanLevel && !CEFR.includes(minGermanLevel as (typeof CEFR)[number])) errors.minGermanLevel = ["Use A1 to C2"];
  const minOetGrade = String(fd.get("minOetGrade") ?? "").trim().toUpperCase() || null;
  if (minOetGrade && !["A", "B", "C+", "C", "D", "E"].includes(minOetGrade)) errors.minOetGrade = ["Use A, B, C+, C, D or E"];

  const intakeMonths = fd.getAll("intake").map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (status === "LIVE" && !intakeMonths.length) errors.intake = ["A live program needs at least one intake, or nobody can apply"];
  const docCodes = new Set((await db.select({ code: schema.documentTypes.code }).from(schema.documentTypes)).map((d) => d.code));
  const requiredDocs = fd.getAll("doc").map(String).filter((d) => docCodes.has(d));

  const values = {
    name,
    level,
    pathway,
    status,
    studyArea: String(fd.get("studyArea") ?? "").trim() || null,
    campus: String(fd.get("campus") ?? "").trim() || null,
    durationMonths: optionalNumber(fd, "durationMonths", errors, { int: true, min: 1, max: 120 }),
    tuitionPerYear: optionalNumber(fd, "tuitionPerYear", errors, { int: true, min: 0 }),
    applicationFee: optionalNumber(fd, "applicationFee", errors, { int: true, min: 0 }),
    initialDeposit: optionalNumber(fd, "initialDeposit", errors, { int: true, min: 0 }),
    intakeMonths,
    minIelts: optionalNumber(fd, "minIelts", errors, { min: 0, max: 9 }),
    minPte: optionalNumber(fd, "minPte", errors, { int: true, min: 10, max: 90 }),
    minOetGrade,
    minGermanLevel,
    minToefl: optionalNumber(fd, "minToefl", errors, { int: true, min: 0, max: 120 }),
    minDuolingo: optionalNumber(fd, "minDuolingo", errors, { int: true, min: 10, max: 160 }),
    minGre: optionalNumber(fd, "minGre", errors, { int: true, min: 260, max: 340 }),
    minGmat: optionalNumber(fd, "minGmat", errors, { int: true, min: 200, max: 805 }),
    minSat: optionalNumber(fd, "minSat", errors, { int: true, min: 400, max: 1600 }),
    minAcademicPercent: optionalNumber(fd, "minAcademicPercent", errors, { min: 0, max: 100 }),
    maxBacklogs: optionalNumber(fd, "maxBacklogs", errors, { int: true, min: 0 }),
    maxGapYears: optionalNumber(fd, "maxGapYears", errors, { int: true, min: 0 }),
    moiAccepted: fd.get("moiAccepted") === "on",
    feeWaiver: String(fd.get("feeWaiver") ?? "").trim() || null,
    workRights,
    workRightsNote,
    requiredDocs,
  };
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };

  // The import treats name plus university as the identity of a program, so two
  // programs with the same name at one university would merge on the next import.
  const clash = await db.query.programs.findFirst({
    where: and(eq(schema.programs.name, name), eq(schema.programs.universityId, current.universityId)),
  });
  // Register rows are identified by their code instead (CRICOS lists the same
  // degree at several campuses under one name), so the rule only binds rows
  // without one.
  if (clash && clash.id !== current.id && !current.externalCode && !clash.externalCode) return { error: "This university already has a program with that name.", fieldErrors: { name: ["Already used at this university"] } };

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(values)) {
    const before = current[k as keyof typeof current];
    if (JSON.stringify(before) !== JSON.stringify(v)) changed[k] = { from: before, to: v };
  }
  if (!Object.keys(changed).length) return { ok: "Nothing changed." };

  await db.update(schema.programs).set({ ...values, updatedAt: new Date() }).where(eq(schema.programs.id, id));
  await audit(user.id, "program.update", "program", id, { changed });
  revalidatePath("/admin/programs");
  revalidatePath(`/admin/programs/${id}`);
  revalidatePath(`/programs/${id}`);
  revalidatePath("/search");
  return { ok: `Saved ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? "" : "s"}.` };
}

/**
 * Brings Australia's CRICOS register into the catalogue. Fetches the current
 * release from data.gov.au, or takes the three files uploaded by hand when the
 * server cannot reach it.
 */
export async function syncCricosAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const publish = fd.get("publish") === "on";
  const uploads = ["institutions", "courses", "locations"].map((k) => fd.get(k));
  const uploaded = uploads.every((f) => f instanceof File && f.size > 0);
  let files: { institutions: string; courses: string; locations: string };
  try {
    if (uploaded) {
      const [institutions, courses, locations] = await Promise.all(uploads.map((f) => (f as File).text()));
      files = { institutions, courses, locations };
    } else if (uploads.some((f) => f instanceof File && f.size > 0)) {
      return { error: "Upload all three files, or none to fetch them from data.gov.au." };
    } else {
      files = await fetchCricosFiles();
    }
  } catch (e) {
    return { error: `Could not get the register: ${(e as Error).message}. Download the three files from data.gov.au/data/dataset/cricos and upload them here instead.` };
  }
  try {
    const r = await syncCricos(files, { publish });
    await audit(user.id, "programs.cricos_sync", "program", "*", { ...r, publish, via: uploaded ? "upload" : "data.gov.au" });
    // No revalidatePath here: the form refreshes the page itself once it has the report.
    return {
      ok: `CRICOS: ${r.courses.toLocaleString("en-IN")} live courses from ${r.providers.toLocaleString("en-IN")} providers. ${r.created.toLocaleString("en-IN")} new${publish ? " and published" : " as drafts"}, ${r.updated.toLocaleString("en-IN")} refreshed, ${r.archived} archived because they left the register${r.claimed ? `, ${r.claimed} matched to programs already in the catalogue` : ""}. Took ${r.seconds}s.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
