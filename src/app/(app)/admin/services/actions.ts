"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, STAFF_ROLES } from "@/lib/permissions";
import { SERVICE_TYPES, type ServiceType } from "@/lib/services";
import type { FormState } from "@/lib/form-state";

/** Name the person a kind of request lands on, or take the name off again. */
export async function setServiceOwnerAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const type = String(fd.get("type") ?? "");
  if (!(SERVICE_TYPES as readonly string[]).includes(type)) return { error: "That is not a service we handle." };
  const userId = String(fd.get("userId") ?? "").trim();

  if (!userId) {
    await db.delete(schema.serviceOwners).where(eq(schema.serviceOwners.type, type as ServiceType));
    await audit(user.id, "service.owner.clear", "service", type);
    revalidatePath("/admin/services");
    return { ok: "That one goes to the whole desk again." };
  }

  const person = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!person?.active || !(STAFF_ROLES as readonly string[]).includes(person.role)) {
    return { error: "Pick somebody on the Overseas team." };
  }
  const already = await db.query.serviceOwners.findFirst({ where: eq(schema.serviceOwners.type, type as ServiceType) });
  if (already) {
    await db
      .update(schema.serviceOwners)
      .set({ userId, setById: user.id, updatedAt: new Date() })
      .where(eq(schema.serviceOwners.type, type as ServiceType));
  } else {
    await db.insert(schema.serviceOwners).values({ type: type as ServiceType, userId, setById: user.id });
  }
  await audit(user.id, "service.owner.set", "service", type, { userId });
  revalidatePath("/admin/services");
  return { ok: `${person.deskLabel ?? person.name} handles these now.` };
}
