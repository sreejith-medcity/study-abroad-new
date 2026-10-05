"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canManageSettings } from "@/lib/permissions";
import { CAPABILITIES, DEFAULTS, SETTABLE_ROLES, type Capability } from "@/lib/capabilities";
import type { FormState } from "@/lib/form-state";

/**
 * Setting what a role may do.
 *
 * Only the differences from the portal's own defaults are kept: ticking a box
 * back to where it started removes the row rather than storing it, so the table
 * holds the decisions somebody made and nothing else, and a default that
 * changes in the code still reaches a portal that never overrode it.
 */
export async function setCapabilityAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only a super admin can change who may do what." };

  const role = String(formData.get("role") ?? "");
  const capability = String(formData.get("capability") ?? "") as Capability;
  const allowed = String(formData.get("allowed") ?? "") === "1";

  if (!(SETTABLE_ROLES as readonly string[]).includes(role)) {
    // A super admin keeps everything, by a rule rather than by a row, so that
    // nobody can lock the last person out of the screen that would undo it.
    return { error: "That role cannot be changed here." };
  }
  if (!(CAPABILITIES as readonly string[]).includes(capability)) return { error: "No such thing to allow." };

  const isDefault = (DEFAULTS[capability] as readonly string[]).includes(role) === allowed;
  if (isDefault) {
    await db
      .delete(schema.rolePermissions)
      .where(and(eq(schema.rolePermissions.role, role), eq(schema.rolePermissions.capability, capability)));
  } else {
    await db
      .insert(schema.rolePermissions)
      .values({ role, capability, allowed, setById: user.id, setAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.rolePermissions.role, schema.rolePermissions.capability],
        set: { allowed, setById: user.id, setAt: new Date() },
      });
  }
  await audit(user.id, allowed ? "access.allow" : "access.refuse", "settings", `${role}:${capability}`, { role, capability, allowed, backToDefault: isDefault });
  revalidatePath("/", "layout");
  return { ok: allowed ? "Allowed." : "Refused." };
}
