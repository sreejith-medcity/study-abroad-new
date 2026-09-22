"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ilike, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { EVENT_KINDS, EVENT_KIND_LABEL } from "@/lib/events";
import type { FormState } from "@/lib/form-state";
import { fromIstInput, istDateTime } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { notifyUsers } from "@/server/notify";
import { getStudentForUser } from "@/server/queries";

const eventInput = z
  .object({
    title: z.string().trim().min(3, "Give it a title").max(200),
    kind: z.enum(EVENT_KINDS, { message: "Choose a kind" }),
    startsAt: z.string().transform((v, ctx) => fromIstInput(v) ?? (ctx.addIssue({ code: "custom", message: "When does it start?" }), z.NEVER)),
    endsAt: z.string().transform((v) => (v ? fromIstInput(v) : null)),
    location: z.string().trim().max(200).transform((v) => v || null),
    joinUrl: z.union([z.literal(""), z.string().trim().url("A full link, starting https://").refine((v) => v.startsWith("https://"), "A full link, starting https://")]).transform((v) => v || null),
    university: z.string().trim().transform((v) => v || null),
    description: z.string().trim().max(4000).transform((v) => v || null),
    openToStudents: z.literal("on").optional().transform(Boolean),
    capacity: z.union([z.literal(""), z.coerce.number().int().min(1, "At least 1")]).transform((v) => (v === "" ? null : v)),
  })
  .superRefine((v, ctx) => {
    if (v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Ends before it starts" });
    if (!v.location && !v.joinUrl) ctx.addIssue({ code: "custom", path: ["location"], message: "Give a place, a link, or both" });
  });

export async function createEventAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = eventInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const { university, ...v } = parsed.data;
  let universityId: string | null = null;
  if (university) {
    const found = await db.query.universities.findFirst({ where: ilike(schema.universities.name, university) });
    if (!found) return { fieldErrors: { university: ["No university by that name in the catalogue"] }, error: "Check the highlighted fields." };
    universityId = found.id;
  }
  const [row] = await db.insert(schema.events).values({ ...v, universityId, createdById: user.id }).returning();
  await audit(user.id, "event.create", "event", row.id, { title: row.title });
  const partners = await db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.role, ["PARTNER", "COUNSELLOR"]), eq(schema.users.active, true)));
  await notifyUsers(partners.map((p) => p.id), `${EVENT_KIND_LABEL[row.kind]}: ${row.title}`, istDateTime(row.startsAt), "/events");
  revalidatePath("/admin/events");
  return { ok: "Event published. Partners have been told." };
}

export async function setEventPublishedAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const published = fd.get("published") === "true";
  await db.update(schema.events).set({ published }).where(eq(schema.events.id, id));
  await audit(user.id, published ? "event.publish" : "event.cancel", "event", id);
  revalidatePath("/admin/events");
}

async function seatsLeft(eventId: string, capacity: number | null) {
  if (capacity == null) return Infinity;
  const [{ n }] = await db.select({ n: count() }).from(schema.eventRegistrations).where(eq(schema.eventRegistrations.eventId, eventId));
  return capacity - n;
}

/** A partner's own seat: on, or off again. */
export async function toggleAttendAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES, "DOCUMENTATION", "MANAGEMENT"]);
  const eventId = String(fd.get("eventId") ?? "");
  const event = await db.query.events.findFirst({ where: and(eq(schema.events.id, eventId), eq(schema.events.published, true)) });
  if (!event) return { error: "That event is no longer on." };
  const r = schema.eventRegistrations;
  const mine = await db.query.eventRegistrations.findFirst({ where: and(eq(r.eventId, eventId), eq(r.userId, user.id), isNull(r.studentId)) });
  if (mine) {
    await db.delete(r).where(eq(r.id, mine.id));
    revalidatePath("/events");
    return { ok: "You are off the list." };
  }
  if (event.startsAt < new Date()) return { error: "This event has started." };
  if ((await seatsLeft(eventId, event.capacity)) <= 0) return { error: "It is full." };
  await db.insert(r).values({ eventId, userId: user.id }).onConflictDoNothing();
  revalidatePath("/events");
  return { ok: "You are on the list." };
}

/** A partner registers one of their students for an event open to students. */
export async function registerStudentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const eventId = String(fd.get("eventId") ?? "");
  const studentId = String(fd.get("studentId") ?? "");
  if (!studentId) return { error: "Choose a student." };
  const event = await db.query.events.findFirst({ where: and(eq(schema.events.id, eventId), eq(schema.events.published, true)) });
  if (!event || !event.openToStudents) return { error: "Students cannot be registered for this one." };
  if (event.startsAt < new Date()) return { error: "This event has started." };
  const student = await getStudentForUser(user, studentId);
  if ((await seatsLeft(eventId, event.capacity)) <= 0) return { error: "It is full." };
  const [row] = await db.insert(schema.eventRegistrations).values({ eventId, userId: user.id, studentId: student.id }).onConflictDoNothing().returning();
  if (!row) return { error: `${student.firstName} is already registered.` };
  await audit(user.id, "event.register_student", "event", eventId, { studentId: student.id });
  revalidatePath("/events");
  return { ok: `${student.firstName} is registered.` };
}

export async function removeRegistrationAction(fd: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const r = schema.eventRegistrations;
  const row = await db.query.eventRegistrations.findFirst({ where: eq(r.id, id), with: { user: { columns: { orgId: true } } } });
  if (!row) return;
  const isAdminUser = (ADMIN_ROLES as readonly string[]).includes(user.role);
  if (!isAdminUser && row.user.orgId !== user.orgId) return;
  await db.delete(r).where(eq(r.id, id));
  revalidatePath("/events");
  revalidatePath("/admin/events");
}
