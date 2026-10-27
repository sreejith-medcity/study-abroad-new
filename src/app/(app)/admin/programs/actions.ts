"use server";

import { revalidatePath } from "next/cache";
import { TAG_KEYS } from "@/lib/program-tags";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { heldBackSummary, parseProgramCsv, type ImportError, type ImportRow } from "@/lib/program-import";
import { publishProblems, type BulkOutcome, type PublishProblem } from "@/lib/publish-rules";
import { HAS_EVIDENCE, HAS_INTAKES, READY, READY_TARGET } from "@/server/publish-rules";
import { ADMIN_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";
import { programFilterWhere, readProgramFilters } from "@/server/program-filters";
import { fetchCricosFiles, syncCricos } from "@/server/cricos-sync";
import { cricosPublishText } from "@/lib/cricos";
import { fetchRegistry, syncRegistry } from "@/server/registry-sync";
import { REGISTRY_SOURCES } from "@/lib/registry";
import type { MiocCountry, MiocGuide, MiocProfile, MiocProgram, MiocUniversity } from "@/lib/mioc";
import { loadMiocContent, loadMiocPrograms, prepareMioc, type MiocBatchResult, type MiocContentResult, type MiocPrepareResult } from "@/server/mioc-load";
import { changesOf, newBatchId, recordChanges, updateWithHistory, type ChangeInput } from "@/server/catalogue-history";

export type ImportState = {
  error?: string;
  ok?: string;
  preview?: {
    valid: number;
    errors: ImportError[];
    sample: Pick<ImportRow, "line" | "program" | "university" | "countryCode" | "level" | "intakeMonths">[];
    /** Rows the file marked LIVE that will come in as drafts, and why. */
    heldBack: { line: number; program: string; problems: PublishProblem[] }[];
    csv: string;
  };
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
    return {
      preview: {
        valid: valid.length,
        errors: errors.sort((a, b) => a.line - b.line),
        sample: valid.slice(0, 8).map(({ line, program, university, countryCode, level, intakeMonths }) => ({ line, program, university, countryCode, level, intakeMonths })),
        heldBack: valid.filter((r) => r.heldBack?.length).map((r) => ({ line: r.line, program: r.program, problems: r.heldBack! })),
        csv: text,
      },
    };
  }

  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const uniCache = new Map<string, string>();
    // What each updated row said before, so a file with a wrong column can be
    // undone field by field rather than by hand.
    const changes: ChangeInput[] = [];
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
        changes.push(...changesOf("program", existing.id, existing, values));
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
    await recordChanges(tx, changes, { by: user.id, source: "import" });
  });
  const heldBack = valid.filter((r) => r.heldBack?.length).length;
  await audit(user.id, "programs.import", "program", "*", { created, updated, skipped: errors.length, heldBackAsDrafts: heldBack });
  // The form refreshes the list itself once it has the result. Revalidating the
  // calling page from inside the action is what left imports stuck on "Checking…".
  const held = heldBackSummary(valid);
  return { ok: `Imported: ${created} new, ${updated} updated${errors.length ? `, ${errors.length} rows skipped` : ""}.${held ? ` ${held}` : ""}` };
}

/** The answer to one row's Set: nothing when it worked, or why it did not. `at` tells one answer from the next. */
export type RowStatusState = { problems?: PublishProblem[]; error?: string; at?: number };

/**
 * Sets one program's status from its row on the Programs list. Setting it
 * live goes through the same publish rules as the edit screen, and a course
 * that fails them keeps its status and the row says why.
 */
export async function setProgramStatusAction(_: RowStatusState, formData: FormData): Promise<RowStatusState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const at = Date.now();
  const id = String(formData.get("programId"));
  const status = String(formData.get("status")) as "DRAFT" | "LIVE" | "ARCHIVED";
  if (!["DRAFT", "LIVE", "ARCHIVED"].includes(status)) return { error: "Choose a status.", at };
  // Read locked in the same transaction as the write, so the history's old
  // status is the one this write replaced even when two land together, and
  // the publish rules are checked against the row as it is when written.
  const result = await db.transaction(async (tx) => {
    const p = schema.programs;
    const [current] = await tx
      .select({ status: p.status, intakeMonths: p.intakeMonths, workRights: p.workRights, workRightsNote: p.workRightsNote })
      .from(p)
      .where(eq(p.id, id))
      .for("update");
    if (!current) return { gone: true as const };
    // A course already live is left alone rather than refused: nothing would change.
    if (status === "LIVE" && current.status !== "LIVE") {
      const problems = publishProblems(current);
      if (problems.length) return { problems };
    }
    await tx.update(p).set({ status, updatedAt: new Date() }).where(eq(p.id, id));
    await recordChanges(tx, changesOf("program", id, { status: current.status }, { status }), { by: user.id, source: "edit" });
    return {};
  });
  if ("gone" in result) return { error: "That program no longer exists.", at };
  if (result.problems) return { problems: result.problems, at };
  await audit(user.id, "program.status", "program", id, { status });
  revalidatePath("/admin/programs");
  return { at };
}

/** The answer to a bulk status press, as counts; the form words it. `at` tells one answer from the next. */
export type BulkStatusState = { outcome?: BulkOutcome; error?: string; at?: number };

/**
 * Publishes, or withdraws, every program matching the filters currently on
 * screen. An import lands 255 rows as drafts on purpose, and approving those one
 * at a time is not a review, it is data entry.
 *
 * Publishing takes only the courses that meet the publish rules (see
 * src/lib/publish-rules.ts). The rest keep their status, and the answer counts
 * them with their reasons so they can be found and fixed.
 */
export async function bulkStatusAction(_: BulkStatusState, formData: FormData): Promise<BulkStatusState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const at = Date.now();
  const to = String(formData.get("to")) as BulkOutcome["to"];
  if (!["LIVE", "DRAFT", "ARCHIVED"].includes(to)) return { error: "Choose publish or back to draft.", at };

  const f = readProgramFilters((k) => formData.get(k)?.toString());
  // The old form sent the status filter as "from"; keep reading it.
  if (!f.status && formData.get("from")) f.status = String(formData.get("from"));

  const { programs: p, universities: u, countries: c } = schema;
  const publishing = to === "LIVE";
  // The country lives on the university, so the filter reaches across two
  // joins. The update runs in batches: one statement over the whole CRICOS
  // register (about 27,000 rows) could outlast the hosting's request limit or
  // the database's statement timeout, and the page then showed nothing at all.
  //
  // Each batch reads the status it replaced from a second copy of the table in
  // the same statement (Postgres shows that copy as it was before the update),
  // and writes its history in that statement too, so a batch and its history
  // are kept or lost together and no rows travel to the app and back.
  // The MIOC app alone brought about 104,000 courses, more than the old cap
  // of forty batches, so the run goes on until the filter is empty. It stops
  // well inside the page's five minutes, and pressing again carries on: the
  // filter still finds whatever is left.
  //
  // When publishing, a batch only picks courses that meet the publish rules.
  // Picking the others too would fill a batch with rows the update then
  // refuses, and the run would stop early thinking it had reached the end.
  // The update checks the rules again on the row as it is by then.
  const BATCH = 2000;
  const started = Date.now();
  let total = 0;
  let finished = false;
  const batchId = newBatchId();
  for (let i = 0; i < 200 && Date.now() - started < 200_000; i++) {
    const scope = db
      .select({ id: p.id })
      .from(p)
      .innerJoin(u, eq(p.universityId, u.id))
      .innerJoin(c, eq(u.countryId, c.id))
      .where(and(programFilterWhere(f), ne(p.status, to), publishing ? READY : undefined))
      .limit(BATCH);
    const changed = await updateWithHistory(
      db,
      "program",
      sql`
        update programs set status = ${to}::program_status, updated_at = now()
        from programs o
        where o.id = programs.id and ${inArray(p.id, scope)}${publishing ? sql` and ${READY_TARGET}` : sql``}
        returning programs.id as entity_id, 'status'::text as field, to_jsonb(o.status) as before, to_jsonb(programs.status) as after`,
      { by: user.id, source: "bulk", batchId },
    );
    total += changed;
    // A batch that changed nothing means nothing is left to change: a batch
    // short of the limit can also mean a row slipped out between the select
    // and the update, so only an empty one ends the run.
    if (changed === 0) {
      finished = true;
      break;
    }
  }

  // What is left in the filter, counted in one pass: the courses held back
  // and why, and any the time guard stopped the run from reaching.
  const [left] = await db
    .select({
      leftDrafts: publishing ? sql<number>`count(*) filter (where ${p.status} = 'DRAFT' and not (${READY}))`.mapWith(Number) : sql<number>`0`.mapWith(Number),
      leftArchived: publishing ? sql<number>`count(*) filter (where ${p.status} = 'ARCHIVED' and not (${READY}))`.mapWith(Number) : sql<number>`0`.mapWith(Number),
      noIntakes: publishing ? sql<number>`count(*) filter (where ${p.status} <> 'LIVE' and not ${HAS_INTAKES})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
      noEvidence: publishing ? sql<number>`count(*) filter (where ${p.status} <> 'LIVE' and not ${HAS_EVIDENCE})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
      unreached: finished
        ? sql<number>`0`.mapWith(Number)
        : sql<number>`count(*) filter (where ${p.status} <> ${to}::program_status${publishing ? sql` and ${READY}` : sql``})`.mapWith(Number),
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(programFilterWhere(f));
  const outcome: BulkOutcome = {
    to,
    done: total,
    leftDrafts: left?.leftDrafts ?? 0,
    leftArchived: left?.leftArchived ?? 0,
    noIntakes: left?.noIntakes ?? 0,
    noEvidence: left?.noEvidence ?? 0,
    unreached: left?.unreached ?? 0,
  };
  if (!total) return { outcome, at };

  await audit(user.id, "programs.bulk_status", "program", "*", {
    to,
    ...f,
    count: total,
    leftNoIntakes: outcome.noIntakes,
    leftNoEvidence: outcome.noEvidence,
    unreached: outcome.unreached,
  });
  revalidatePath("/admin/programs");
  revalidatePath("/search");
  return { outcome, at };
}

const LEVELS = ["SCHOOL", "UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG", "PHD", "VOCATIONAL", "REGISTRATION", "CERTIFICATE"] as const;
const PATHWAYS = ["DEGREE", "AUSBILDUNG", "NURSING", "FSJ", "BFD"] as const;
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
  const minGermanLevel = String(fd.get("minGermanLevel") ?? "").trim().toUpperCase() || null;
  if (minGermanLevel && !CEFR.includes(minGermanLevel as (typeof CEFR)[number])) errors.minGermanLevel = ["Use A1 to C2"];
  const minOetGrade = String(fd.get("minOetGrade") ?? "").trim().toUpperCase() || null;
  if (minOetGrade && !["A", "B", "C+", "C", "D", "E"].includes(minOetGrade)) errors.minOetGrade = ["Use A, B, C+, C, D or E"];

  const intakeMonths = fd.getAll("intake").map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  // The shared publish rules. A verdict without its evidence is exactly what
  // the note exists to stop, so that one holds whatever the status; the
  // intake one only binds a live program.
  const problems = publishProblems({ intakeMonths, workRights, workRightsNote });
  if (problems.includes("evidence")) errors.workRightsNote = ["Say where this comes from, for example the institution's page"];
  if (status === "LIVE" && problems.includes("intakes")) errors.intake = ["A live program needs at least one intake, or nobody can apply"];
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

  // The same comparison the change history uses, so the count in the message
  // and the rows in the history always agree. It is made against the row read
  // locked inside the transaction that writes it: a save landing at the same
  // moment then waits, and the history records the value this save replaced
  // rather than one read before the other save.
  const diff = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.programs).where(eq(schema.programs.id, id)).for("update");
    if (!locked) return null;
    const d = changesOf("program", id, locked, values);
    if (!d.length) return d;
    await tx.update(schema.programs).set({ ...values, updatedAt: new Date() }).where(eq(schema.programs.id, id));
    await recordChanges(tx, d, { by: user.id, source: "edit" });
    return d;
  });
  if (!diff) return { error: "That program no longer exists." };
  if (!diff.length) return { ok: "Nothing changed." };
  const changed = Object.fromEntries(diff.map((d) => [d.field, { from: d.before, to: d.after }]));
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
    const r = await syncCricos(files, { publish, by: user.id });
    await audit(user.id, "programs.cricos_sync", "program", "*", { ...r, publish, via: uploaded ? "upload" : "data.gov.au" });
    // No revalidatePath here: the form refreshes the page itself once it has the report.
    return {
      ok: `CRICOS: ${r.courses.toLocaleString("en-IN")} live courses from ${r.providers.toLocaleString("en-IN")} providers. ${r.created.toLocaleString("en-IN")} new${publish ? "" : " as drafts"}, ${r.updated.toLocaleString("en-IN")} refreshed, ${r.archived} archived because they left the register${r.claimed ? `, ${r.claimed} matched to programs already in the catalogue` : ""}.${publish ? ` ${cricosPublishText(r)}` : ""} Took ${r.seconds}s.`,
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
  // The second copy of the table (o) still holds each row's figure from before
  // the update, which is what the change history needs, and the history is
  // written by the same statement, so the two cannot part.
  const changed = await updateWithHistory(
    db,
    "program",
    sql`
      update programs set offer_tat_days = ${days}::int, updated_at = now()
      from programs o
      where o.id = programs.id and ${and(inArray(p.id, scope), days == null ? sql`${p.offerTatDays} is not null` : sql`${p.offerTatDays} is distinct from ${days}::int`)}
      returning programs.id as entity_id, 'offerTatDays'::text as field, to_jsonb(o.offer_tat_days) as before, to_jsonb(programs.offer_tat_days) as after`,
    { by: user.id, source: "bulk" },
  );
  await audit(user.id, "programs.bulk_turnaround", "program", "*", { days, count: changed, filters: f });
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
  // As with the turnaround, o is each row before the update, and the history
  // is written by the same statement.
  const changed = await updateWithHistory(
    db,
    "program",
    sql`
      update programs set
        tags = ${op === "add" ? sql`(select array_agg(distinct t order by t) from unnest(array_append(${p.tags}, ${tag})) t)` : sql`array_remove(${p.tags}, ${tag})`},
        updated_at = now()
      from programs o
      where o.id = programs.id and ${and(inArray(p.id, scope), op === "add" ? sql`not (${tag} = any(${p.tags}))` : sql`${tag} = any(${p.tags})`)}
      returning programs.id as entity_id, 'tags'::text as field, to_jsonb(o.tags) as before, to_jsonb(programs.tags) as after`,
    { by: user.id, source: "bulk" },
  );
  await audit(user.id, "programs.bulk_tag", "program", "*", { tag, op, count: changed, filters: f });
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
    const r = await syncRegistry(key, raw, { dryRun, by: user.id });
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

/**
 * The MIOC app's catalogue. The browser reads the export and sends only the
 * catalogue rows, in steps: countries and universities first, then programs a
 * batch at a time, then a closing call that records the run.
 */
export async function miocPrepareAction(input: { countries: MiocCountry[]; universities: MiocUniversity[] }, dryRun: boolean): Promise<{ error?: string; result?: MiocPrepareResult }> {
  const user = await requireUser([...ADMIN_ROLES]);
  try {
    const result = await prepareMioc(input, { dryRun, by: user.id });
    if (!dryRun) await audit(user.id, "programs.mioc_prepare", "university", "*", { countriesNew: result.countriesNew, universitiesNew: result.universitiesNew, universitiesHere: result.universitiesHere });
    return { result };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** University profiles and destination guides, once, between the universities and the courses. */
export async function miocContentAction(
  input: { profiles: MiocProfile[]; guides: MiocGuide[] },
  universityIds: Record<number, string>,
): Promise<{ error?: string; result?: MiocContentResult }> {
  const user = await requireUser([...ADMIN_ROLES]);
  if (!Array.isArray(input?.profiles) || input.profiles.length > 20000 || !Array.isArray(input?.guides) || input.guides.length > 300) return { error: "That is more profiles or guides than one export holds." };
  try {
    const result = await loadMiocContent(input, universityIds ?? {}, user.id);
    await audit(user.id, "programs.mioc_content", "university", "*", { ...result });
    revalidatePath("/admin/destinations");
    return { result };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function miocLoadAction(batch: MiocProgram[], universityIds: Record<number, string>): Promise<{ error?: string; result?: MiocBatchResult }> {
  const user = await requireUser([...ADMIN_ROLES]);
  if (!Array.isArray(batch) || batch.length > 2000) return { error: "A batch holds at most 2,000 programs." };
  try {
    return { result: await loadMiocPrograms(batch, universityIds ?? {}, user.id) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function miocFinishAction(summary: MiocBatchResult & { programs: number; seconds: number }) {
  const user = await requireUser([...ADMIN_ROLES]);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  await audit(user.id, "programs.mioc_load", "program", "*", {
    programs: n(summary.programs),
    created: n(summary.created),
    filled: n(summary.filled),
    unchanged: n(summary.unchanged),
    keptResearched: n(summary.keptResearched),
    noUniversity: n(summary.noUniversity),
    seconds: n(summary.seconds),
  });
  revalidatePath("/admin/programs");
  revalidatePath("/search");
}
