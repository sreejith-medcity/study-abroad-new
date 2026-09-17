import { createHmac, timingSafeEqual } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { notifyUsers, partnerRecipients } from "@/server/notify";

/** Meta webhook verification handshake. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type InboundMessage = { from: string; id: string; type: string; text?: { body: string }; image?: { id: string; caption?: string }; document?: { id: string; filename?: string; caption?: string } };

/**
 * Inbound WhatsApp messages land in the student's most recently active application,
 * on the Student channel. Media is recorded as a note for now; downloading media
 * through the Graph API is the next step once the business account is live.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return new Response("Bad signature", { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return new Response("Webhook secret not configured", { status: 503 });
  }

  let payload: { entry?: { changes?: { value?: { messages?: InboundMessage[]; contacts?: { profile?: { name?: string } }[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const msg of value?.messages ?? []) {
        const digits = msg.from.replace(/\D/g, "").slice(-10);
        const student = await db.query.students.findFirst({
          where: sql`right(regexp_replace(${schema.students.phone}, '\\D', '', 'g'), 10) = ${digits}`,
        });
        if (!student) continue;
        const app = await db.query.applications.findFirst({ where: eq(schema.applications.studentId, student.id), orderBy: desc(schema.applications.updatedAt) });
        if (!app) continue;

        const body =
          msg.type === "text" ? msg.text?.body ?? "" :
          msg.type === "image" ? `[Photo received${msg.image?.caption ? `: ${msg.image.caption}` : ""}]` :
          msg.type === "document" ? `[Document received: ${msg.document?.filename ?? "file"}]` :
          `[${msg.type} message received]`;

        const dup = await db.query.comments.findFirst({ where: and(eq(schema.comments.applicationId, app.id), eq(schema.comments.body, body), sql`${schema.comments.createdAt} > now() - interval '1 minute'`) });
        if (dup) continue;

        await db.insert(schema.comments).values({
          applicationId: app.id,
          channel: "STUDENT",
          source: "WHATSAPP",
          body,
          authorLabel: `${student.firstName} ${student.lastName}`,
        });
        await notifyUsers(
          [...(await partnerRecipients(app.orgId, student.assignedToId)), app.officerId],
          `WhatsApp reply from ${student.firstName}`,
          body.slice(0, 120),
          `/students/${student.id}/applications?app=${app.id}&ch=STUDENT`,
        );
        await audit(null, "whatsapp.inbound", "application", app.id, { messageId: msg.id, type: msg.type });
      }
    }
  }
  return new Response("OK");
}
