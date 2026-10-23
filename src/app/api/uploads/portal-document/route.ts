import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { notifyUsers } from "@/server/notify";
import { attachUploadToChecklist } from "@/server/documentation";
import { getPortalStudent } from "@/server/portal";
import { saveUpload, UploadError } from "@/server/storage";
import { VersionConflict, putUpReplacement } from "@/server/document-versions";
import { isCurrent } from "@/lib/document-versions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploads";

/**
 * A student putting up one of their own documents.
 *
 * Posted to a route rather than sent as a server action, for the reason the
 * staff upload moved: the answer to a file can come from something in front of
 * the app, and a server action cannot read one of those. A student on a phone
 * photographing a passport on a patchy line is the likeliest person in the
 * whole portal to meet one.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === request.headers.get("host");
    } catch {
      sameSite = false;
    }
    if (!sameSite) return NextResponse.json({ error: "That request did not come from the portal." }, { status: 403 });
  }

  const who = await getPortalStudent();
  if (!who) {
    return NextResponse.json({ error: "Your sign-in has run out. Reload the page, sign in again, and upload it again." }, { status: 401 });
  }
  const { session, student } = who;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The file did not arrive in one piece. Try it again." }, { status: 400 });
  }

  const file = form.get("file");
  // A student replaces only a file they can see on their own record: one they
  // sent, or one the branch shared. The replacement keeps the old one's type.
  const replacesId = form.get("replacesId") ? String(form.get("replacesId")) : null;
  const old = replacesId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, replacesId) }) : null;
  if (replacesId) {
    if (!old || old.studentId !== student.id || !(old.uploadedById === session.id || old.sharedWithStudent)) {
      return NextResponse.json({ error: "That file is not on your record." }, { status: 404 });
    }
    if (!isCurrent(old)) return NextResponse.json({ error: "That file has already been replaced. Reload the page and look again." }, { status: 409 });
  }
  const typeCode = old ? (old.typeCode ?? "") : String(form.get("typeCode") ?? "");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file first." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `That file is too large. The limit is ${MAX_UPLOAD_MB} MB.` }, { status: 413 });
  }

  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, typeCode) });
  if (!type) return NextResponse.json({ error: "Pick what this document is." }, { status: 400 });
  if (type.uploadedBy === "team") return NextResponse.json({ error: "Medcity Overseas adds this one for you." }, { status: 403 });

  try {
    if (old) {
      // Checked and queued for the documentation team the same way as a first
      // upload; the earlier file stays on record as an earlier version.
      await putUpReplacement({ old, file, actorId: session.id, via: "portal" });
    } else {
      const saved = await saveUpload(file, `students/${student.id}`);
      const [doc] = await db
        .insert(schema.documents)
        .values({ studentId: student.id, typeCode, fileName: file.name, uploadedById: session.id, ...saved })
        .returning();
      await audit(session.id, "document.upload", "document", doc.id, { typeCode, via: "portal" });
      // A student cannot mark their own document good: it joins the documentation
      // team's queue, where somebody checks it against the rule.
      await attachUploadToChecklist(student.id, typeCode, doc.id, session.id);
    }
    await notifyUsers(
      [student.assignedToId, student.createdById],
      `${student.firstName} ${old ? "replaced" : "uploaded"} ${type.label}`,
      "Sent from the student portal",
      `/students/${student.id}/documentation`,
    );
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof VersionConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("A portal upload failed", { studentId: student.id, typeCode, fileName: file.name, size: file.size }, e);
    return NextResponse.json({ error: "The upload did not go through and nothing was saved. Try it again." }, { status: 500 });
  }

  revalidatePath("/portal", "layout");
  return NextResponse.json({ ok: `${type.label} uploaded.`, goTo: `/portal/documents?uploaded=${encodeURIComponent(type.code)}` });
}
