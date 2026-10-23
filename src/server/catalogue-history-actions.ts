"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES } from "@/lib/permissions";
import { restoreChanges } from "./catalogue-history";

/**
 * The Restore button on a change history card: one field when it sends a
 * change id, the whole save when it sends a batch id with the entity it is for.
 * Admins only, the same people who may edit the catalogue in the first place.
 */
export async function restoreCatalogueChangeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const changeId = String(fd.get("changeId") ?? "").trim();
  const batchId = String(fd.get("batchId") ?? "").trim();
  const entity = String(fd.get("entity") ?? "");
  const entityId = String(fd.get("entityId") ?? "").trim();

  let result;
  if (changeId) result = await restoreChanges({ changeId }, user.id);
  else if (batchId && entityId && (entity === "program" || entity === "university")) result = await restoreChanges({ batchId, entity, entityId }, user.id);
  else return { error: "Nothing to restore." };

  if (result.entity === "program" && result.entityId) {
    revalidatePath(`/admin/programs/${result.entityId}`);
    revalidatePath(`/programs/${result.entityId}`);
    revalidatePath("/admin/programs");
    revalidatePath("/search");
  } else if (result.entity === "university" && result.entityId) {
    revalidatePath(`/universities/${result.entityId}`);
    revalidatePath(`/admin/universities/${result.entityId}`);
  }
  return result.error ? { error: result.error } : { ok: result.ok, keep: result.keep };
}
