import "server-only";
import archiver from "archiver";
import { and, asc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { intakeLabel } from "@/lib/format";
import { stageLabel } from "@/lib/journey";
import { coverSheet, nameInPack, packName, partsOf, DEFAULT_PACK_RULES, withinLimit, type PackContents } from "@/lib/pack";
import { readUpload } from "@/server/storage";
import { rowStanding, stageGate, studentChecklist, studentContext } from "@/server/documentation";

const { checklistItems: ci, documentTypes: dt } = schema;

/**
 * What would go to the university or the vendor for one application, as it stands
 * right now. Nothing is copied or cached: a pack built twice is built from what is
 * accepted at each moment, so it can never be a stale copy of the truth.
 */
export async function packContents(applicationId: string, include: string[] = []): Promise<PackContents | null> {
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, applicationId),
    with: {
      status: { columns: { label: true } },
      student: { columns: { id: true, medcityId: true, firstName: true, lastName: true, passportNumber: true, dateOfBirth: true }, with: { org: { columns: { name: true } } } },
      program: { columns: { name: true, campus: true }, with: { university: { columns: { name: true }, with: { country: { columns: { name: true } } } } } },
      route: {
        columns: { extraDocuments: true, interviewRequired: true },
        with: { vendor: { columns: { name: true, code: true, packShape: true, packNaming: true, packLimitMb: true } } },
      },
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
      bytes: schema.documents.sizeBytes,
      sortOrder: dt.sortOrder,
    })
    .from(ci)
    .innerJoin(dt, eq(dt.code, ci.typeCode))
    .leftJoin(schema.documents, eq(schema.documents.id, ci.documentId))
    // Accepted, plus anything the team deliberately ticked in although it has
    // not been accepted: the cover sheet marks those, so nobody sends a
    // statement that was sent back without knowing they did.
    .where(and(eq(ci.studentId, app.studentId), include.length ? or(eq(ci.state, "ACCEPTED"), inArray(ci.id, include)) : eq(ci.state, "ACCEPTED")))
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
      vendorReference: app.vendorReference,
      vendor: app.route?.vendor
        ? { name: app.route.vendor.name, code: app.route.vendor.code, extraDocuments: app.route.extraDocuments, interviewRequired: app.route.interviewRequired }
        : null,
    },
    student: {
      id: app.student.id,
      medcityId: app.student.medcityId,
      name: `${app.student.firstName} ${app.student.lastName}`,
      branch: app.student.org.name,
      passportNumber: app.student.passportNumber,
      dateOfBirth: app.student.dateOfBirth,
      surname: app.student.lastName,
      given: app.student.firstName,
    },
    // The road's own rules, where a road has been chosen. Without one the
    // portal's own shape stands, because guessing a vendor's rules is how a
    // pack comes back.
    rules: app.route?.vendor
      ? { shape: app.route.vendor.packShape, naming: app.route.vendor.packNaming, limitMb: app.route.vendor.packLimitMb }
      : DEFAULT_PACK_RULES,
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
      bytes: r.bytes,
      notYetAccepted: r.item.state !== "ACCEPTED",
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
 * Rows that have a file on them which the desk has not accepted.
 *
 * These are never in a pack by default: sending an unchecked document is how a
 * file comes back. But a desk that has decided to send one anyway, because the
 * vendor asked for it as it stands, should be able to say so here rather than
 * work around the portal by emailing it separately.
 */
export async function packCandidates(studentId: string) {
  return db
    .select({ itemId: ci.id, label: dt.label, state: ci.state, stage: ci.stage, fileName: schema.documents.fileName, bytes: schema.documents.sizeBytes })
    .from(ci)
    .innerJoin(dt, eq(dt.code, ci.typeCode))
    .innerJoin(schema.documents, eq(schema.documents.id, ci.documentId))
    .where(and(eq(ci.studentId, studentId), isNotNull(ci.documentId), ne(ci.state, "ACCEPTED")))
    .orderBy(asc(ci.stage), asc(dt.sortOrder), asc(dt.label));
}

/**
 * The folder itself, as one file. Built in memory: a pack is small, a dozen PDFs
 * at most, and writing it to storage would only leave a copy to go stale.
 */
/**
 * The pack, in the shape the vendor asked for.
 *
 * A folder of files where they want a folder, one PDF where they want one PDF,
 * and each file named the way they write names. None of this is Medcity's
 * preference: a pack sent in the wrong shape is a pack that comes back, and the
 * rules live beside the vendor so nobody has to remember them.
 */
export async function buildPack(contents: PackContents, builtBy: string): Promise<{ body: Buffer; fileName: string; contentType: string }> {
  const named = (i: number, f: PackContents["files"][number]) => nameInPack(contents.rules, i, partsOf(contents, f), f.fileName);

  if (contents.rules.shape === "ONE_PDF") {
    return { body: await onePdf(contents, builtBy, named), fileName: packName(contents), contentType: "application/pdf" };
  }
  return { body: await zipOf(contents, builtBy, named), fileName: packName(contents), contentType: "application/zip" };
}

async function zipOf(contents: PackContents, builtBy: string, named: (i: number, f: PackContents["files"][number]) => string): Promise<Buffer> {
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
      archive.append(await readUpload(f.storageKey), { name: named(i, f) });
    } catch {
      // A file storage has lost is named in the folder rather than passed over in
      // silence, so whoever sends the pack knows to chase it.
      archive.append(`This file could not be read from storage on ${new Date().toISOString()}.`, { name: `${named(i, f)}.missing.txt` });
    }
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

/**
 * Everything in one PDF, for the vendors whose systems take one upload.
 *
 * PDFs are copied page for page. Photographs, which is what half of what a
 * student sends in actually is, are drawn onto a page of their own rather than
 * dropped: a pack missing the bank statement because somebody photographed it is
 * worse than a pack with a photograph in it. Anything that is neither gets a
 * page saying what it was and that it travels separately, because silence there
 * is how a document goes missing.
 */
async function onePdf(contents: PackContents, builtBy: string, named: (i: number, f: PackContents["files"][number]) => string): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  const textPage = (lines: string[]) => {
    const page = out.addPage();
    const { height } = page.getSize();
    let y = height - 56;
    for (const line of lines) {
      page.drawText(line.slice(0, 95), { x: 48, y, size: line.startsWith("  ") ? 10 : 11, font });
      y -= 16;
      if (y < 48) break;
    }
  };

  textPage(coverSheet(contents, builtBy).split("\n"));

  for (const [i, f] of contents.files.entries()) {
    if (!f.storageKey) continue;
    let bytes: Buffer;
    try {
      bytes = await readUpload(f.storageKey);
    } catch {
      textPage([named(i, f), "", "This file could not be read from storage when the pack was built."]);
      continue;
    }
    const kind = (f.mimeType ?? "").toLowerCase();
    try {
      if (kind.includes("pdf")) {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(source, source.getPageIndices());
        for (const page of pages) out.addPage(page);
      } else if (kind.includes("png") || kind.includes("jpeg") || kind.includes("jpg")) {
        const image = kind.includes("png") ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage();
        const { width, height } = page.getSize();
        const scale = Math.min((width - 72) / image.width, (height - 72) / image.height, 1);
        page.drawImage(image, { x: (width - image.width * scale) / 2, y: (height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
      } else {
        textPage([named(i, f), "", `This is a ${f.mimeType ?? "file"} and cannot go into a PDF. It is sent separately.`]);
      }
    } catch {
      textPage([named(i, f), "", "This file could not be read into the pack. It is sent separately."]);
    }
  }
  return Buffer.from(await out.save());
}

/** Kept for the places that still ask for a zip by name. */
export const buildPackZip = async (contents: PackContents, builtBy: string) => (await buildPack(contents, builtBy)).body;

/** Whether what has been gathered fits what the vendor accepts, before building it. */
export function packFits(contents: PackContents) {
  const bytes = contents.files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
  return withinLimit(contents.rules, bytes);
}

export { coverSheet, nameInPack, packFileName, packName, packShapeText, partsOf } from "@/lib/pack";
export type { PackContents } from "@/lib/pack";
