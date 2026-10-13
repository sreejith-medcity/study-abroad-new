"use server";

import { revalidatePath } from "next/cache";
import { TAG_KEYS } from "@/lib/program-tags";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseProgramCsv, type ImportError, type ImportRow } from "@/lib/program-import";
import { ADMIN_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";
import { programFilterWhere, readProgramFilters } from "@/server/program-filters";
import { fetchCricosFiles, syncCricos } from "@/server/cricos-sync";
import { fetchRegistry, syncRegistry } from "@/server/registry-sync";
import { REGISTRY_SOURCES } from "@/lib/registry";

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
        programUrl: r.programUrl, minIeltsBand: r.minIeltsBand, entryRequirements: r.entryRequirements, balanceDeposit: r.balanceDeposit, typicalScholarship: r.typicalScholarship, tags: r.tags, offerTatDays: r.offerTatDays,
        maxGapYears: r.maxGapYears, moiAccepted: r.moiAccepted, workRights: r.workRights, workRightsNote: r.workRightsNote,
        requiredDocs: r.requiredDocs, status: r.status, updatedAt: new Date(),
      };
      // Level is part of the key: a university runs a bachelor's and a master's
      // under one name often enough (Leoben's Circular Engineering, JKU's
      // Artificial Intelligence) that matching on name alone silently
      // overwrote one with the other.
      const existing = await tx.query.programs.findFirst({
        where: and(eq(schema.programs.name, r.program), eq(schema.programs.universityId, universityId), eq(schema.programs.level, r.level)),
      });
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
  // The country lives on the university, so the filter reaches across two
  // joins. The update runs in batches: one statement over the whole CRICOS
  // register (about 27,000 rows) could outlast the hosting's request limit or
  // the database's statement timeout, and the page then showed nothing at all.
  const BATCH = 2000;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const scope = db
      .select({ id: p.id })
      .from(p)
      .innerJoin(u, eq(p.universityId, u.id))
      .innerJoin(c, eq(u.countryId, c.id))
      .where(and(programFilterWhere(f), ne(p.status, to as "LIVE")))
      .limit(BATCH);
    const changed = await db
      .update(schema.programs)
      .set({ status: to as "LIVE", updatedAt: new Date() })
      .where(inArray(schema.programs.id, scope))
      .returning({ id: schema.programs.id });
    total += changed.length;
    if (changed.length < BATCH) break;
  }
  if (!total) return;

  await audit(user.id, "programs.bulk_status", "program", "*", { to, ...f, count: total });
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
    programUrl: (() => {
      const u = String(fd.get("programUrl") ?? "").trim();
      if (u && !/^https?:\/\//.test(u)) errors.programUrl = ["A full link, starting https://"];
      return u || null;
    })(),
    minIeltsBand: optionalNumber(fd, "minIeltsBand", errors, { min: 0, max: 9 }),
    entryRequirements: String(fd.get("entryRequirements") ?? "").trim() || null,
    balanceDeposit: optionalNumber(fd, "balanceDeposit", errors, { int: true, min: 0 }),
    typicalScholarship: String(fd.get("typicalScholarship") ?? "").trim() || null,
    offerTatDays: optionalNumber(fd, "offerTatDays", errors, { int: true, min: 0, max: 365 }),
    tags: fd.getAll("tag").map(String).filter((t) => (TAG_KEYS as string[]).includes(t)).sort(),
    workRights,
    workRightsNote,
    requiredDocs,
  };
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };

  // The import treats name plus university plus level as the identity of a
  // program, so two of those would merge on the next import. A bachelor's and
  // a master's under one name are fine and common.
  const clash = await db.query.programs.findFirst({
    where: and(eq(schema.programs.name, name), eq(schema.programs.universityId, current.universityId), eq(schema.programs.level, level)),
  });
  // Register rows are identified by their code instead (CRICOS lists the same
  // degree at several campuses under one name), so the rule only binds rows
  // without one.
  if (clash && clash.id !== current.id && !current.externalCode && !clash.externalCode) return { error: "This university already has a program with that name at that level.", fieldErrors: { name: ["Already used at this university"] } };

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

/** Adds or removes one label on every program matching the filters on screen. */
/**
 * The offer turnaround for every program a filter matches. The team knows this
 * per institution rather than per course, so setting it one course at a time
 * would mean nobody ever sets it. A blank figure clears what was recorded.
 */
export async function bulkTurnaroundAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const raw = String(formData.get("bulkTat") ?? "").trim();
  const days = raw === "" ? null : Number(raw);
  if (days != null && (!Number.isInteger(days) || days < 0 || days > 365)) return;
  const f = readProgramFilters((k) => formData.get(k)?.toString());
  const { programs: p, universities: u, countries: c } = schema;
  const scope = db.select({ id: p.id }).from(p).innerJoin(u, eq(p.universityId, u.id)).innerJoin(c, eq(u.countryId, c.id)).where(programFilterWhere(f));
  const changed = await db
    .update(p)
    .set({ offerTatDays: days, updatedAt: new Date() })
    .where(and(inArray(p.id, scope), days == null ? sql`${p.offerTatDays} is not null` : sql`${p.offerTatDays} is distinct from ${days}::int`))
    .returning({ id: p.id });
  await audit(user.id, "programs.bulk_turnaround", "program", "*", { days, count: changed.length, filters: f });
  revalidatePath("/admin/programs");
}

export async function bulkTagAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const tag = String(formData.get("bulkTag") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!(TAG_KEYS as string[]).includes(tag) || !["add", "remove"].includes(op)) return;
  const f = readProgramFilters((k) => formData.get(k)?.toString());
  const { programs: p, universities: u, countries: c } = schema;
  const scope = db.select({ id: p.id }).from(p).innerJoin(u, eq(p.universityId, u.id)).innerJoin(c, eq(u.countryId, c.id)).where(programFilterWhere(f));
  const changed = await db
    .update(p)
    .set({
      tags: op === "add" ? sql`(select array_agg(distinct t order by t) from unnest(array_append(${p.tags}, ${tag})) t)` : sql`array_remove(${p.tags}, ${tag})`,
      updatedAt: new Date(),
    })
    .where(and(inArray(p.id, scope), op === "add" ? sql`not (${tag} = any(${p.tags}))` : sql`${tag} = any(${p.tags})`))
    .returning({ id: p.id });
  await audit(user.id, "programs.bulk_tag", "program", "*", { tag, op, count: changed.length, filters: f });
  revalidatePath("/admin/programs");
}

/**
 * Adds one course the catalogue does not have.
 *
 * Until this existed there were two ways in: a CSV import, and editing a
 * course that already existed. So a counsellor with a student set on Teesside,
 * or on anything in aviation, was simply stuck, and Phase 2 stopped there.
 *
 * It asks for the little that identifies a course and nothing else. Everything
 * else is filled in on the course's own screen afterwards, which already knows
 * how to validate fees, intakes and English requirements, and the row starts as
 * DRAFT so nothing reaches a counsellor's search until somebody has looked at
 * it.
 */
export async function createProgramAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const errors: Record<string, string[]> = {};

  const name = String(fd.get("name") ?? "").trim();
  if (!name) errors.name = ["Enter the course name, as the institution writes it"];
  const level = String(fd.get("level") ?? "") as (typeof LEVELS)[number];
  if (!LEVELS.includes(level)) errors.level = ["Choose a level"];
  const pathway = String(fd.get("pathway") ?? "") as (typeof PATHWAYS)[number];
  if (!PATHWAYS.includes(pathway)) errors.pathway = ["Choose a pathway"];

  // Either an existing university, or a new one with a country to put it in.
  const universityId = String(fd.get("universityId") ?? "").trim();
  const newUniversity = String(fd.get("newUniversity") ?? "").trim();
  const countryCode = String(fd.get("countryCode") ?? "").trim();
  const city = String(fd.get("city") ?? "").trim() || null;
  if (!universityId && !newUniversity) errors.newUniversity = ["Pick the university, or type a new one"];
  if (!universityId && newUniversity && !countryCode) errors.countryCode = ["Which country is it in?"];

  const programUrl = (() => {
    const u = String(fd.get("programUrl") ?? "").trim();
    if (u && !/^https?:\/\//.test(u)) errors.programUrl = ["A full link, starting https://"];
    return u || null;
  })();
  const durationMonths = optionalNumber(fd, "durationMonths", errors, { int: true, min: 1, max: 120 });
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };

  let uniId = universityId;
  if (!uniId) {
    const country = await db.query.countries.findFirst({ where: eq(schema.countries.code, countryCode) });
    if (!country) return { error: "That country is not on the list.", fieldErrors: { countryCode: ["Unknown country"] } };
    // Same name in the same country is the same university, so a second
    // spelling of one already there joins it rather than forking it.
    const existing = await db.query.universities.findFirst({
      where: and(sql`lower(${schema.universities.name}) = ${newUniversity.toLowerCase()}`, eq(schema.universities.countryId, country.id)),
    });
    if (existing) {
      uniId = existing.id;
    } else {
      const [made] = await db.insert(schema.universities).values({ name: newUniversity, city, countryId: country.id }).returning({ id: schema.universities.id });
      uniId = made.id;
      await audit(user.id, "university.create", "university", made.id, { name: newUniversity, country: country.name });
    }
  }

  const clash = await db.query.programs.findFirst({ where: and(eq(schema.programs.name, name), eq(schema.programs.universityId, uniId), eq(schema.programs.level, level)) });
  if (clash) {
    return {
      error: "That university already has a course with this name at this level. Open it rather than adding a second one.",
      fieldErrors: { name: ["Already in the catalogue"] },
      redirectTo: `/admin/programs/${clash.id}`,
    };
  }

  const [program] = await db
    .insert(schema.programs)
    .values({
      name,
      universityId: uniId,
      level,
      pathway,
      status: "DRAFT",
      studyArea: String(fd.get("studyArea") ?? "").trim() || null,
      campus: city,
      durationMonths,
      programUrl,
      intakeMonths: [],
      requiredDocs: [],
      tags: [],
    })
    .returning({ id: schema.programs.id });
  await audit(user.id, "program.create", "program", program.id, { name, level, pathway });
  revalidatePath("/admin/programs");
  revalidatePath("/search");
  return { ok: `${name} added as a draft. Fill in the fees, intakes and requirements, then set it live.`, redirectTo: `/admin/programs/${program.id}` };
}

/**
 * Loads a public institution register.
 *
 * "Check" reports what a real run would change and writes nothing, which is
 * how a register whose columns have moved is caught before it touches the
 * catalogue rather than after.
 */
export async function syncRegistryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const key = String(fd.get("source") ?? "");
  const src = REGISTRY_SOURCES[key];
  if (!src) return { error: "Pick a register." };
  const dryRun = fd.get("apply") !== "on";
  const upload = fd.get("file");
  const uploaded = upload instanceof File && upload.size > 0;

  let raw: string;
  try {
    raw = uploaded ? await (upload as File).text() : await fetchRegistry(key);
  } catch (e) {
    return { error: `Could not get the register: ${(e as Error).message}. Download it from ${src.url} and upload it here instead.` };
  }

  try {
    const r = await syncRegistry(key, raw, { dryRun });
    if (!dryRun) await audit(user.id, "programs.registry_sync", "university", "*", { source: key, created: r.created, filled: r.filled, via: uploaded ? "upload" : "fetch" });
    const n = (v: number) => v.toLocaleString("en-IN");
    const skipped = r.unknownCountryRows
      ? ` ${n(r.unknownCountryRows)} are in countries not on your destinations list and were left out${r.unknownCountries.length ? ` (${r.unknownCountries.slice(0, 6).map(([c, k]) => `${c} ${k}`).join(", ")}${r.unknownCountries.length > 6 ? ", and more" : ""})` : ""}.`
      : "";
    const none = r.destinationsWithNothing.length
      ? ` This register has nothing for ${r.destinationsWithNothing.length} of your destinations: ${r.destinationsWithNothing.slice(0, 10).join(", ")}${r.destinationsWithNothing.length > 10 ? ", and more" : ""}. Those need a different source.`
      : "";
    const head = dryRun ? "Checked, nothing written." : "Loaded.";
    const verb = dryRun ? "would be added" : "added";
    const fill = dryRun ? "would gain a city or website" : "gained a city or website";
    return {
      ok: `${head} ${n(r.parsed)} institutions read from ${r.source}. ${n(r.created)} ${verb}, ${n(r.filled)} already here ${fill}, ${n(r.alreadyThere - r.filled)} already complete.${skipped}${none} Took ${r.seconds}s.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
