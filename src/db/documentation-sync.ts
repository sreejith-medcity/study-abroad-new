/**
 * Building one student's documentation list from the requirements.
 *
 * This sits with the database rather than with the app, because the seed and the
 * tests build lists too, and there must be exactly one place that decides what a
 * student owes.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from ".";

const { checklistItems: ci, documentRequirements: dr, documentTypes: dt, applications: ap } = schema;

/**
 * The first day of an intake, which is the date every expiry is weighed
 * against. A university publishes a month, not a day, so the first of the month
 * is the earliest the course can start and the safest date to test against.
 */
export const intakeStart = (month: number, year: number) => new Date(Date.UTC(year, month - 1, 1));

/** The nearest course start among the student's open applications, or null. */
export function courseStartFor(apps: { intakeMonth: number; intakeYear: number; closed: boolean }[]) {
  const open = apps.filter((a) => !a.closed).map((a) => intakeStart(a.intakeMonth, a.intakeYear));
  if (!open.length) return null;
  return open.reduce((first, d) => (d < first ? d : first));
}

export type StudentContext = {
  studentId: string;
  courseStart: Date | null;
  countryIds: string[];
  countryNames: Record<string, string>;
  vendorIds: string[];
  vendorNames: Record<string, string>;
  universityIds: string[];
  universityNames: Record<string, string>;
  programIds: string[];
  /** The application a requirement belongs to, where only one application asks for it. */
  applicationIdByCountry: Record<string, string>;
};

/**
 * Everything about a student that decides what paper they owe: the destinations
 * they are applying to, the routes those applications go down, the universities
 * and the courses.
 */
export async function studentContext(studentId: string): Promise<StudentContext> {
  const apps = await db.query.applications.findMany({
    where: eq(ap.studentId, studentId),
    with: {
      status: { columns: { group: true } },
      program: { columns: { id: true, universityId: true }, with: { university: { columns: { id: true, name: true, countryId: true }, with: { country: { columns: { id: true, name: true } } } } } },
      route: { columns: { vendorId: true }, with: { vendor: { columns: { id: true, name: true } } } },
    },
  });
  const open = apps.filter((a) => a.status.group !== "CLOSED");
  const countryNames: Record<string, string> = {};
  const vendorNames: Record<string, string> = {};
  const universityNames: Record<string, string> = {};
  const applicationIdByCountry: Record<string, string> = {};
  for (const a of open) {
    const country = a.program.university.country;
    countryNames[country.id] = country.name;
    applicationIdByCountry[country.id] ??= a.id;
    universityNames[a.program.university.id] = a.program.university.name;
    if (a.route?.vendor) vendorNames[a.route.vendor.id] = a.route.vendor.name;
  }
  return {
    studentId,
    courseStart: courseStartFor(apps.map((a) => ({ intakeMonth: a.intakeMonth, intakeYear: a.intakeYear, closed: a.status.group === "CLOSED" }))),
    countryIds: Object.keys(countryNames),
    countryNames,
    vendorIds: Object.keys(vendorNames),
    vendorNames,
    universityIds: Object.keys(universityNames),
    universityNames,
    programIds: open.map((a) => a.program.id),
    applicationIdByCountry,
  };
}

export type Requirement = typeof schema.documentRequirements.$inferSelect;

/**
 * The requirements that apply to one student: the stage lists, plus whatever
 * the destinations, the routes and the universities add on top.
 *
 * A document asked for by two of them is returned once, and the row kept is the
 * one whose source is most specific, because that is the row carrying the rule
 * the team wrote for it.
 */
export async function requirementsFor(ctx: StudentContext) {
  const scope = [
    eq(dr.source, "ALWAYS"),
    ctx.countryIds.length ? inArray(dr.countryId, ctx.countryIds) : undefined,
    ctx.vendorIds.length ? inArray(dr.vendorId, ctx.vendorIds) : undefined,
    ctx.universityIds.length ? inArray(dr.universityId, ctx.universityIds) : undefined,
    ctx.programIds.length ? inArray(dr.programId, ctx.programIds) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({ req: dr, label: dt.label, sortOrder: dt.sortOrder })
    .from(dr)
    .innerJoin(dt, eq(dt.code, dr.typeCode))
    .where(and(eq(dr.active, true), or(...scope)))
    .orderBy(asc(dr.stage), asc(dr.sortOrder), asc(dt.sortOrder));

  const RANK: Record<string, number> = { ALWAYS: 0, DESTINATION: 1, ROUTE: 2, UNIVERSITY: 3, STUDENT: 4 };
  const byType = new Map<string, { req: Requirement; label: string; sourceLabel: string | null }>();
  for (const row of rows) {
    const sourceLabel =
      row.req.source === "DESTINATION" ? (ctx.countryNames[row.req.countryId ?? ""] ?? null)
      : row.req.source === "ROUTE" ? (ctx.vendorNames[row.req.vendorId ?? ""] ?? null)
      : row.req.source === "UNIVERSITY" ? (ctx.universityNames[row.req.universityId ?? ""] ?? null)
      : null;
    const held = byType.get(row.req.typeCode);
    if (held && RANK[held.req.source] >= RANK[row.req.source]) continue;
    byType.set(row.req.typeCode, { req: row.req, label: row.label, sourceLabel });
  }
  return [...byType.values()];
}

/**
 * Brings a student's list into line with the requirements as they stand today.
 *
 * Anything new is added as not asked for. Anything already on the list keeps its
 * files, its state and its history: only the facts that belong to the
 * requirement rather than to the student are refreshed. Nothing is ever deleted,
 * because a document sent last month is part of the record even if the rule that
 * asked for it has since gone.
 */
export async function syncChecklist(studentId: string) {
  const ctx = await studentContext(studentId);
  const wanted = await requirementsFor(ctx);
  const existing = await db.select().from(ci).where(eq(ci.studentId, studentId));
  const byType = new Map(existing.map((i) => [i.typeCode, i]));

  const toAdd = wanted
    .filter((w) => !byType.has(w.req.typeCode))
    .map((w) => ({
      studentId,
      applicationId: w.req.source === "DESTINATION" ? (ctx.applicationIdByCountry[w.req.countryId ?? ""] ?? null) : null,
      requirementId: w.req.id,
      stage: w.req.stage,
      typeCode: w.req.typeCode,
      source: w.req.source,
      sourceLabel: w.sourceLabel,
      required: w.req.required,
      neverWaive: w.req.neverWaive,
      owedBy: w.req.owedBy,
      validityMonths: w.req.validityMonths,
    }));
  if (toAdd.length) await db.insert(ci).values(toAdd).onConflictDoNothing();

  for (const w of wanted) {
    const held = byType.get(w.req.typeCode);
    if (!held) continue;
    // A requirement the team edits should read the same on every file. What the
    // student did about it is untouched.
    const same =
      held.requirementId === w.req.id &&
      held.stage === w.req.stage &&
      held.source === w.req.source &&
      held.sourceLabel === w.sourceLabel &&
      held.required === w.req.required &&
      held.neverWaive === w.req.neverWaive &&
      held.validityMonths === w.req.validityMonths;
    if (same) continue;
    await db
      .update(ci)
      .set({
        requirementId: w.req.id,
        stage: w.req.stage,
        source: w.req.source,
        sourceLabel: w.sourceLabel,
        required: w.req.required,
        neverWaive: w.req.neverWaive,
        validityMonths: w.req.validityMonths,
        updatedAt: new Date(),
      })
      .where(eq(ci.id, held.id));
  }
  return { added: toAdd.length, ctx };
}

