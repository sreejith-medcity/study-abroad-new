import "server-only";
import archiver from "archiver";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { intakeLabel } from "@/lib/format";
import { stageLabel } from "@/lib/journey";
import { coverSheet, packFileName, type PackContents } from "@/lib/pack";
import { readUpload } from "@/server/storage";
import { rowStanding, stageGate, studentChecklist, studentContext } from "@/server/documentation";

const { checklistItems: ci, documentTypes: dt } = schema;

/**
 * What would go to the university or the vendor for one application, as it stands
 * right now. Nothing is copied or cached: a pack built twice is built from what is
 * accepted at each moment, so it can never be a stale copy of the truth.
 */
export async function packContents(applicationId: string): Promise<PackContents | null> {
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, applicationId),
    with: {
      status: { columns: { label: true } },
      student: { columns: { id: true, firstName: true, lastName: true, passportNumber: true, dateOfBirth: true }, with: { org: { columns: { name: true } } } },
      program: { columns: { name: true, campus: true }, with: { university: { columns: { name: true }, with: { country: { columns: { name: true } } } } } },
      route: { columns: { extraDocuments: true, interviewRequired: true }, with: { vendor: { columns: { name: true, code: true } } } },
    },
  });
  if (!app) return null;

  const rows = await db
    .select({
      item: ci,
      label: dt.label,
      fileName: schema.documents.fileName,
      storageKey: schema.documents.storageKey,
      mimeType: schema.documents.mimeType,
      sortOrder: dt.sortOrder,
    })
    .from(ci)
    .innerJoin(dt, eq(dt.code, ci.typeCode))
    .leftJoin(schema.documents, eq(schema.documents.id, ci.documentId))
    .where(and(eq(ci.studentId, app.studentId), eq(ci.state, "ACCEPTED")))
    .orderBy(asc(ci.stage), asc(dt.sortOrder), asc(dt.label));

  const checklist = await studentChecklist(app.studentId);
  const ctx = await studentContext(app.studentId);
  // The gate for the stage the application itself sits at: everything up to and
  // including the application stage has to be in before a file is sent anywhere.
  const gate = stageGate(checklist, "APPLICATION", ctx.courseStart);

  return {
    application: {
      id: app.id,
      ackNo: app.ackNo,
      intake: intakeLabel(app.intakeMonth, app.intakeYear),
      course: app.program.name,
      university: app.program.university.name,
      campus: app.program.campus,
      country: app.program.university.country.name,
      status: app.status.label,
      vendor: app.route?.vendor
        ? { name: app.route.vendor.name, code: app.route.vendor.code, extraDocuments: app.route.extraDocuments, interviewRequired: app.route.interviewRequired }
        : null,
    },
    student: {
      id: app.student.id,
      name: `${app.student.firstName} ${app.student.lastName}`,
      branch: app.student.org.name,
      passportNumber: app.student.passportNumber,
      dateOfBirth: app.student.dateOfBirth,
    },
    files: rows.map((r) => ({
      itemId: r.item.id,
      documentId: r.item.documentId,
      label: r.label,
      stage: stageLabel(r.item.stage),
      version: r.item.version,
      validTo: r.item.validTo,
      acceptedOn: r.item.decidedAt,
      fileName: r.fileName,
      storageKey: r.storageKey,
      mimeType: r.mimeType,
    })),
    missing: gate.missing.map((m) => ({ label: m.label, why: m.why, owedBy: m.owedBy })),
    expiring: checklist
      .filter((r) => {
        const s = rowStanding(r, ctx.courseStart).standing;
        return s === "EXPIRING" || s === "EXPIRED";
      })
      .map((r) => ({ label: r.label, validTo: r.validTo })),
  };
}

/**
 * The folder itself, as one file. Built in memory: a pack is small, a dozen PDFs
 * at most, and writing it to storage would only leave a copy to go stale.
 */
export async function buildPackZip(contents: PackContents, builtBy: string): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });
  archive.append(coverSheet(contents, builtBy), { name: "00 What is in this folder.txt" });
  for (const [i, f] of contents.files.entries()) {
    if (!f.storageKey) continue;
    try {
      archive.append(await readUpload(f.storageKey), { name: packFileName(i, f.label, f.fileName) });
    } catch {
      // A file storage has lost is named in the folder rather than passed over in
      // silence, so whoever sends the pack knows to chase it.
      archive.append(`This file could not be read from storage on ${new Date().toISOString()}.`, { name: `${packFileName(i, f.label, f.fileName)}.missing.txt` });
    }
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

export { coverSheet, packFileName, packName } from "@/lib/pack";
export type { PackContents } from "@/lib/pack";
