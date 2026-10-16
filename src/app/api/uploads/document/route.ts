import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { PARTNER_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import { saveStudentDocument } from "@/server/document-upload";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

/**
 * Where a document is posted now.
 *
 * It used to be a server action, and a server action can only read an answer
 * the app itself wrote. A file is the one thing big enough for the proxy in
 * front of the app to refuse on its own, and that refusal is not an answer the
 * app wrote, so the screen died on it: "an unexpected response was received
 * from the server", and the counsellor was left guessing. A route is posted to
 * with an ordinary request, so the browser can read the status, whoever
 * answered, and say something true about it.
 */
export async function POST(request: Request) {
  // A route has none of the origin checking a server action does, so it is
  // done here: a file may only be posted from the portal's own pages.
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host");
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === host;
    } catch {
      sameSite = false;
    }
    if (!sameSite) return NextResponse.json({ error: "That request did not come from the portal." }, { status: 403 });
  }

  const user = await getSession();
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: "Your sign-in has run out. Reload the page, sign in again, and upload it again." }, { status: 401 });
  }
  if (!([...PARTNER_ROLES, ...PROCESSING_ROLES] as readonly string[]).includes(user.role)) {
    return NextResponse.json({ error: "Your account cannot put documents on a student's file." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // The body stopped arriving part way: a dropped connection, or something
    // between here and the laptop cutting it off.
    return NextResponse.json({ error: "The file did not arrive in one piece. Try it again." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `That file is too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  }

  const studentId = String(form.get("studentId") ?? "");
  const outcome = await saveStudentDocument(user, {
    studentId,
    typeCode: String(form.get("typeCode") ?? ""),
    label: form.get("label") == null ? null : String(form.get("label")),
    file,
  });

  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  revalidatePath(`/students/${studentId}`, "layout");
  return NextResponse.json({ ok: outcome.ok });
}
