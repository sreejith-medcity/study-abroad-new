import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getStudentForUser } from "@/server/queries";
import { saveUpload, UploadError } from "@/server/storage";
import { attachUploadToChecklist } from "@/server/documentation";
import { issuesTeamDocuments } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";

export type UploadOutcome = { ok: string; documentId: string } | { error: string; status: number };

/**
 * Putting one document on a student's file.
 *
 * Lives apart from the screen that calls it because the browser no longer
 * sends it as a server action: a file is the one thing big enough for the
 * proxy in front of the app to refuse on its own, and a server action cannot
 * read that refusal. It is posted to a route instead, which can.
 */
export async function saveStudentDocument(
  user: SessionUser,
  input: { studentId: string; typeCode: string; label: string | null; file: File },
): Promise<UploadOutcome> {
  const { studentId, typeCode, file } = input;
  await getStudentForUser(user, studentId);

  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, typeCode) });
  if (!type) return { error: "Choose a document type.", status: 400 };
  if (type.uploadedBy === "team" && !issuesTeamDocuments(user)) {
    return { error: `${type.label} is put up by the Medcity Overseas desk.`, status: 403 };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload.", status: 400 };

  // "Something else" with no name is a file nobody can identify later.
  const label = (input.label ?? "").trim().slice(0, 120) || null;
  if (typeCode === "OTHER" && !label) {
    return { error: "Say what this document is, so the next person knows what they are looking at.", status: 400 };
  }

  try {
    const saved = await saveUpload(file, `students/${studentId}`);
    const [doc] = await db
      .insert(schema.documents)
      .values({ studentId, typeCode, label, fileName: file.name, uploadedById: user.id, ...saved })
      .returning();
    await audit(user.id, "document.upload", "document", doc.id, { typeCode });
    // A file that answers something on the documentation list joins the team's
    // queue. Nobody, least of all the student, marks their own document good.
    await attachUploadToChecklist(studentId, typeCode, doc.id, user.id);
    return { ok: `${label ?? type.label} uploaded.`, documentId: doc.id };
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message, status: 400 };
    console.error("The upload failed", { studentId, typeCode, fileName: file.name, size: file.size }, e);
    return {
      error: "The upload did not go through and nothing was saved. Try again, and if it keeps happening tell the Overseas desk what you were uploading.",
      status: 500,
    };
  }
}
