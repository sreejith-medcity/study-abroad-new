import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { gate, standing, stageRank, validUntil, type Gate, type GateItem } from "@/lib/journey";
import { courseStartFor, intakeStart, requirementsFor, studentContext, syncChecklist, type Requirement, type StudentContext } from "@/db/documentation-sync";
import type { ChecklistState, JourneyStage, RequirementSource } from "@/db/schema";

const { checklistItems: ci, checklistFiles: cf, documentRequirements: dr, documentTypes: dt, students: st, applications: ap, programs: pg, universities: un, programRoutes: pr, vendors: vn, organizations: og } = schema;

// One place decides what a student owes; the app reads it through here.
export { courseStartFor, intakeStart, requirementsFor, studentContext, syncChecklist };
export type { Requirement, StudentContext };

export type ChecklistRow = typeof schema.checklistItems.$inferSelect & {
  label: string;
  labelMl: string | null;
  guidance: string | null;
  requirementGuidance: string | null;
  reasonLabel: string | null;
  claimedByName: string | null;
  decidedByName: string | null;
  fileName: string | null;
  storageKey: string | null;
};

/** One student's list, in stage order, with the labels and the current file. */
export async function studentChecklist(studentId: string): Promise<ChecklistRow[]> {
  const claimant = schema.users;
  const rows = await db
    .select({
      item: ci,
      label: dt.label,
      labelMl: dt.labelMl,
      guidance: dt.guidance,
      requirementGuidance: dr.guidance,
      reasonLabel: schema.rejectionReasons.label,
      claimedByName: claimant.name,
      fileName: schema.documents.fileName,
      storageKey: schema.documents.storageKey,
      sortOrder: dt.sortOrder,
    })
    .from(ci)
    .innerJoin(dt, eq(dt.code, ci.typeCode))
    .leftJoin(dr, eq(dr.id, ci.requirementId))
    .leftJoin(schema.rejectionReasons, eq(schema.rejectionReasons.code, ci.reasonCode))
    .leftJoin(claimant, eq(claimant.id, ci.claimedById))
    .leftJoin(schema.documents, eq(schema.documents.id, ci.documentId))
    .where(eq(ci.studentId, studentId))
    .orderBy(asc(ci.stage), asc(dt.sortOrder), asc(dt.label));
  return rows
    .map((r) => ({
      ...r.item,
      label: r.label,
      labelMl: r.labelMl,
      guidance: r.guidance,
      requirementGuidance: r.requirementGuidance,
      reasonLabel: r.reasonLabel,
      claimedByName: r.claimedByName,
      decidedByName: null,
      fileName: r.fileName,
      storageKey: r.storageKey,
    }))
    .sort((a, b) => stageRank(a.stage) - stageRank(b.stage));
}

/** The gate for one stage, and the gate for everything up to and including it. */
export function stageGate(rows: ChecklistRow[], stage: JourneyStage, courseStart: Date | null, today = new Date()): Gate {
  const items: GateItem[] = rows
    .filter((r) => stageRank(r.stage) <= stageRank(stage))
    .map((r) => ({ typeCode: r.typeCode, label: r.label, required: r.required, owedBy: r.owedBy, state: r.state, validTo: r.validTo }));
  return gate(items, courseStart, today);
}

/** Everything outstanding on one file, whatever the stage. Used for the gate count. */
export function wholeGate(rows: ChecklistRow[], courseStart: Date | null, today = new Date()): Gate {
  return gate(
    rows.map((r) => ({ typeCode: r.typeCode, label: r.label, required: r.required, owedBy: r.owedBy, state: r.state, validTo: r.validTo })),
    courseStart,
    today,
  );
}

/** How a row reads once its dates are weighed against the course start. */
export const rowStanding = (row: ChecklistRow, courseStart: Date | null, today = new Date()) => standing(row, courseStart, today);

/** The date a document runs out, for saving alongside the file. */
export const itemValidTo = validUntil;

export type QueueRow = {
  id: string;
  studentId: string;
  studentName: string;
  branch: string;
  label: string;
  stage: JourneyStage;
  state: ChecklistState;
  vendorCode: string | null;
  vendorColour: string | null;
  claimedById: string | null;
  claimedAt: Date | null;
  claimedByName: string | null;
  uploadedAt: Date | null;
  dueOn: string | null;
  /** Enough to check the document without leaving the queue. */
  typeCode: string;
  source: RequirementSource;
  version: number;
  validityMonths: number | null;
  issuedOn: string | null;
  guidance: string | null;
  fileName: string | null;
  documentId: string | null;
};

export type QueueFilters = { branch?: string; stage?: JourneyStage; vendor?: string; sort?: "OLDEST" | "VISA_FIRST"; mine?: string };

/**
 * The documentation team's queue: everything a file has been sent for and
 * nobody has decided. Oldest first, because the file that has waited longest is
 * the one somebody is chasing.
 */
export async function documentationQueue(filters: QueueFilters, userId: string) {
  const claimant = schema.users;
  const where = [
    inArray(ci.state, ["UPLOADED", "IN_REVIEW"] as const),
    filters.branch ? eq(st.orgId, filters.branch) : undefined,
    filters.stage ? eq(ci.stage, filters.stage) : undefined,
    filters.vendor ? eq(pr.vendorId, filters.vendor) : undefined,
    filters.mine === "1" ? eq(ci.claimedById, userId) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({
      id: ci.id,
      studentId: ci.studentId,
      firstName: st.firstName,
      lastName: st.lastName,
      branch: og.name,
      label: dt.label,
      stage: ci.stage,
      state: ci.state,
      vendorCode: vn.code,
      vendorColour: vn.colour,
      claimedById: ci.claimedById,
      claimedAt: ci.claimedAt,
      claimedByName: claimant.name,
      uploadedAt: ci.updatedAt,
      dueOn: ci.dueOn,
      typeCode: ci.typeCode,
      source: ci.source,
      version: ci.version,
      validityMonths: ci.validityMonths,
      issuedOn: ci.issuedOn,
      guidance: sql<string | null>`coalesce(${dr.guidance}, ${dt.guidance})`,
      fileName: schema.documents.fileName,
      documentId: ci.documentId,
    })
    .from(ci)
    .innerJoin(st, eq(st.id, ci.studentId))
    .innerJoin(og, eq(og.id, st.orgId))
    .innerJoin(dt, eq(dt.code, ci.typeCode))
    .leftJoin(ap, eq(ap.id, ci.applicationId))
    .leftJoin(pr, eq(pr.id, ap.routeId))
    .leftJoin(vn, eq(vn.id, pr.vendorId))
    .leftJoin(claimant, eq(claimant.id, ci.claimedById))
    .leftJoin(dr, eq(dr.id, ci.requirementId))
    .leftJoin(schema.documents, eq(schema.documents.id, ci.documentId))
    .where(and(...where))
    .orderBy(filters.sort === "VISA_FIRST" ? desc(ci.stage) : asc(ci.updatedAt))
    .limit(200);
  const mapped: QueueRow[] = rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: `${r.firstName} ${r.lastName}`,
    branch: r.branch,
    label: r.label,
    stage: r.stage,
    state: r.state,
    vendorCode: r.vendorCode,
    vendorColour: r.vendorColour,
    claimedById: r.claimedById,
    claimedAt: r.claimedAt,
    claimedByName: r.claimedByName,
    uploadedAt: r.uploadedAt,
    dueOn: r.dueOn,
    typeCode: r.typeCode,
    source: r.source,
    version: r.version,
    validityMonths: r.validityMonths,
    issuedOn: r.issuedOn,
    guidance: r.guidance,
    fileName: r.fileName,
    documentId: r.documentId,
  }));
  if (filters.sort === "VISA_FIRST") {
    // The sort the team lives on: the visa stage first, and inside a stage the
    // file that has waited longest.
    mapped.sort((a, b) => stageRank(b.stage) - stageRank(a.stage) || (a.uploadedAt?.getTime() ?? 0) - (b.uploadedAt?.getTime() ?? 0));
  }
  return mapped;
}

/** How many are waiting, and how many this person has claimed. */
export async function queueCounts(userId: string) {
  const [row] = await db
    .select({
      waiting: sql<number>`count(*)`.mapWith(Number),
      mine: sql<number>`count(*) filter (where ${ci.claimedById} = ${userId})`.mapWith(Number),
    })
    .from(ci)
    .where(inArray(ci.state, ["UPLOADED", "IN_REVIEW"] as const));
  return row ?? { waiting: 0, mine: 0 };
}

/** The reasons the team may pick from, newest additions last. */
export const activeRejectionReasons = () =>
  db.select().from(schema.rejectionReasons).where(eq(schema.rejectionReasons.active, true)).orderBy(asc(schema.rejectionReasons.sortOrder), asc(schema.rejectionReasons.label));

/** Document types that are not yet on a student's list, for adding one by hand. */
export async function typesNotOnList(studentId: string) {
  const on = db.select({ code: ci.typeCode }).from(ci).where(eq(ci.studentId, studentId));
  return db.select({ code: dt.code, label: dt.label }).from(dt).where(sql`${dt.code} not in ${on}`).orderBy(asc(dt.sortOrder), asc(dt.label));
}

/** Overrides recorded on one student, newest first, shown on the file. */
export const overridesFor = (studentId: string) =>
  db.query.gateOverrides.findMany({ where: eq(schema.gateOverrides.studentId, studentId), with: { actor: { columns: { name: true } } }, orderBy: desc(schema.gateOverrides.createdAt) });

/** Requirements the team keeps, with the labels the screens read. */
export async function listRequirements() {
  return db
    .select({
      req: dr,
      label: dt.label,
      country: schema.countries.name,
      vendor: vn.name,
      university: un.name,
      program: pg.name,
    })
    .from(dr)
    .innerJoin(dt, eq(dt.code, dr.typeCode))
    .leftJoin(schema.countries, eq(schema.countries.id, dr.countryId))
    .leftJoin(vn, eq(vn.id, dr.vendorId))
    .leftJoin(un, eq(un.id, dr.universityId))
    .leftJoin(pg, eq(pg.id, dr.programId))
    .orderBy(asc(dr.stage), asc(dr.sortOrder), asc(dt.label));
}

/** Items with nothing on them yet, so a fresh file is not reported as complete. */
export const untouchedCount = (studentId: string) =>
  db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(ci)
    .where(and(eq(ci.studentId, studentId), eq(ci.state, "NOT_ASKED"), isNull(ci.documentId)))
    .then((r) => r[0]?.n ?? 0);

/**
 * Attaches an uploaded file to whatever asks for it, and puts the item in front
 * of the documentation team. A student never marks their own document good.
 */
export async function attachUploadToChecklist(studentId: string, typeCode: string, documentId: string, uploaderId: string) {
  const item = await db.query.checklistItems.findFirst({ where: and(eq(ci.studentId, studentId), eq(ci.typeCode, typeCode)) });
  if (!item) return null;
  const version = item.version + 1;
  await db.insert(cf).values({ itemId: item.id, documentId, version, uploadedById: uploaderId });
  await db
    .update(ci)
    .set({ state: "UPLOADED", documentId, version, reasonCode: null, reason: null, decidedAt: null, decidedById: null, claimedById: null, claimedAt: null, updatedAt: new Date() })
    .where(eq(ci.id, item.id));
  return item;
}
