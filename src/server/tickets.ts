"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { ticketForUser } from "@/server/ticket-access";
import { TICKET_CATEGORIES, TICKET_STATUSES, TICKET_STATUS_LABEL } from "@/lib/tickets";
import { adminIds, notifyUsers } from "@/server/notify";

const RAISERS = ["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES] as const;

const open = z.object({
  subject: z.string().trim().min(5, "A short summary").max(200),
  category: z.enum(TICKET_CATEGORIES, { message: "Choose what it is about" }),
  body: z.string().trim().min(10, "Say what happened and what you need").max(5000),
});

export async function openTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...RAISERS]);
  const parsed = open.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const [t] = await db.insert(schema.tickets).values({ orgId: user.orgId, raisedById: user.id, subject: parsed.data.subject, category: parsed.data.category }).returning();
  await db.insert(schema.ticketMessages).values({ ticketId: t.id, authorId: user.id, body: parsed.data.body });
  await audit(user.id, "ticket.open", "ticket", t.id, { category: t.category });
  await notifyUsers(await adminIds(), `Help desk: ${t.subject}`, parsed.data.body.slice(0, 120), `/support/${t.id}`);
  return { redirectTo: `/support/${t.id}` };
}

const reply = z.object({ ticketId: z.string().min(1), body: z.string().trim().min(1, "Write a reply").max(5000) });

/** A reply moves the ticket to whoever has to act next. */
export async function replyTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...RAISERS]);
  const parsed = reply.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const t = await ticketForUser(user, parsed.data.ticketId);
  if (!t) return { error: "That ticket is not available." };
  const staff = isStaff(user);
  await db.insert(schema.ticketMessages).values({ ticketId: t.id, authorId: user.id, body: parsed.data.body });
  const status = staff ? "WAITING_PARTNER" : "OPEN";
  await db
    .update(schema.tickets)
    .set({ status, resolvedAt: null, updatedAt: new Date(), ownerId: staff ? (t.ownerId ?? user.id) : t.ownerId })
    .where(eq(schema.tickets.id, t.id));
  const to = staff ? [t.raisedById] : t.ownerId ? [t.ownerId] : await adminIds();
  await notifyUsers(to, `${staff ? "The Overseas team replied" : "Partner replied"}: ${t.subject}`, parsed.data.body.slice(0, 120), `/support/${t.id}`);
  revalidatePath(`/support/${t.id}`);
  return { ok: "Reply sent." };
}

/** The team resolves a ticket, or reopens it. */
export async function setTicketStatusAction(fd: FormData) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const id = String(fd.get("ticketId") ?? "");
  const status = String(fd.get("status") ?? "") as (typeof TICKET_STATUSES)[number];
  if (!TICKET_STATUSES.includes(status)) return;
  const t = await ticketForUser(user, id);
  if (!t) return;
  await db
    .update(schema.tickets)
    .set({ status, resolvedAt: status === "RESOLVED" ? new Date() : null, updatedAt: new Date(), ownerId: t.ownerId ?? user.id })
    .where(and(eq(schema.tickets.id, id)));
  await audit(user.id, "ticket.status", "ticket", id, { status });
  await notifyUsers([t.raisedById], `${t.subject}: ${TICKET_STATUS_LABEL[status]}`, undefined, `/support/${id}`);
  revalidatePath(`/support/${id}`);
}
