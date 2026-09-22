import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";

/** A request this user may see: their branch's, or any for the Overseas team. */
export async function optionRequestForUser(user: SessionUser, id: string) {
  if (!id) return null;
  const r = await db.query.optionRequests.findFirst({ where: eq(schema.optionRequests.id, id) });
  if (!r || (!isStaff(user) && r.orgId !== user.orgId)) return null;
  return r;
}
