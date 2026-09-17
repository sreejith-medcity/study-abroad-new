import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type WhatsAppMessage = { to: string; body: string; template?: string };

interface WhatsAppProvider {
  send(msg: WhatsAppMessage): Promise<{ providerId?: string }>;
}

/** Development provider: logs instead of sending. */
const consoleProvider: WhatsAppProvider = {
  async send(msg) {
    console.log(`[whatsapp:console] to=${msg.to} template=${msg.template ?? "-"}\n${msg.body}`);
    return { providerId: `console-${Date.now()}` };
  },
};

/** Meta WhatsApp Cloud API. Free-form text only works inside the 24h customer window; use templates otherwise. */
const metaProvider: WhatsAppProvider = {
  async send(msg) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) throw new Error("WhatsApp Cloud API is not configured");
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to.replace(/[^\d]/g, ""),
        type: "text",
        text: { body: msg.body },
      }),
    });
    const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `WhatsApp send failed (${res.status})`);
    return { providerId: json.messages?.[0]?.id };
  },
};

function provider(): WhatsAppProvider {
  return process.env.WHATSAPP_PROVIDER === "meta" ? metaProvider : consoleProvider;
}

/** Queues, sends and records an outbound WhatsApp message. Never throws to the caller. */
export async function sendWhatsApp(msg: WhatsAppMessage) {
  const [row] = await db
    .insert(schema.outboundMessages)
    .values({ channel: "whatsapp", to: msg.to, body: msg.body, template: msg.template })
    .returning();
  try {
    const { providerId } = await provider().send(msg);
    await db
      .update(schema.outboundMessages)
      .set({ status: "sent", providerId })
      .where(eq(schema.outboundMessages.id, row.id));
    return true;
  } catch (err) {
    await db
      .update(schema.outboundMessages)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.outboundMessages.id, row.id));
    return false;
  }
}
