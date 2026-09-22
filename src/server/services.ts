"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { SERVICE_LABEL, SERVICE_STATUSES, SERVICE_TYPES, STATUS_LABEL } from "@/lib/services";
import { adminIds, notifyUsers, partnerRecipients } from "@/server/notify";
import { getStudentForUser } from "@/server/queries";

const request = z.object({
  studentId: z.string().min(1),
  type: z.enum(SERVICE_TYPES, { message: "Choose a service" }),
  details: z.string().trim().min(5, "Say what is needed").max(2000),
});

/** A partner, counsellor or the team asks for a service for one student. */
export async function requestServiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const parsed = request.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const student = await getStudentForUser(user, parsed.data.studentId);
  const [row] = await db
    .insert(schema.serviceRequests)
    .values({ studentId: student.id, orgId: student.orgId, type: parsed.data.type, details: parsed.data.details, requestedById: user.id })
    .returning();
  await audit(user.id, "service.request", "student", student.id, { type: row.type, serviceId: row.id });
  await notifyUsers(await adminIds(), `${SERVICE_LABEL[row.type]} requested`, `${student.firstName} ${student.lastName}: ${row.details.slice(0, 100)}`, "/admin/services");
  revalidatePath(`/students/${student.id}/services`);
  return { ok: "Request sent to the Overseas team." };
}

const update = z.object({
  id: z.string().min(1),
  status: z.enum(SERVICE_STATUSES),
  provider: z.string().trim().max(200).transform((v) => v || null),
  teamNote: z.string().trim().max(2000).transform((v) => v || null),
});

/** The team moves a request along, names the provider and leaves a note the partner reads. */
export async function updateServiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = update.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const current = await db.query.serviceRequests.findFirst({ where: eq(schema.serviceRequests.id, parsed.data.id), with: { student: true } });
  if (!current) return { error: "That request no longer exists." };
  const { id, ...values } = parsed.data;
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => (current[k as keyof typeof current] ?? null) !== v));
  if (!Object.keys(changed).length) return { ok: "Nothing changed." };
  await db.update(schema.serviceRequests).set({ ...values, ownerId: current.ownerId ?? user.id, updatedAt: new Date() }).where(eq(schema.serviceRequests.id, id));
  await audit(user.id, "service.update", "student", current.studentId, { serviceId: id, changed });
  if (changed.status || changed.teamNote) {
    await notifyUsers(
      await partnerRecipients(current.orgId, current.student.assignedToId),
      `${SERVICE_LABEL[current.type]} for ${current.student.firstName}: ${STATUS_LABEL[values.status]}`,
      values.teamNote?.slice(0, 120) ?? undefined,
      `/students/${current.studentId}/services`,
    );
  }
  revalidatePath("/admin/services");
  revalidatePath(`/students/${current.studentId}/services`);
  return { ok: "Saved." };
}
