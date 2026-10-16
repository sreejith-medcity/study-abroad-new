"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { SCOPE_PATH } from "@/server/views";
import type { ViewScope } from "@/db/schema";
import type { FormState } from "@/lib/form-state";

const SCOPES = ["STUDENTS", "APPLICATIONS", "DOCUMENTATION", "ENQUIRIES"] as const;
const SHARING = ["PRIVATE", "ORG", "EVERYONE"] as const;

/** Keeps a view to the filters a list actually reads, and to a sane size. */
function cleanQuery(raw: string) {
  const params = new URLSearchParams(raw.replace(/^\?/, ""));
  params.delete("page");
  params.delete("view_id");
  const out = params.toString();
  return out.length > 600 ? "" : out;
}

export async function saveViewAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...APP_ROLES]);
  const scope = String(fd.get("scope") ?? "") as ViewScope;
  if (!(SCOPES as readonly string[]).includes(scope)) return { error: "That list cannot hold a view." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 40);
  if (!name) return { error: "Give the view a name: what question does it answer?" };

  const sharedWanted = String(fd.get("shared") ?? "PRIVATE");
  // Only the desk puts a view in front of everybody; a branch may share with
  // its own people.
  const shared = (SHARING as readonly string[]).includes(sharedWanted)
    ? sharedWanted === "EVERYONE" && !isStaff(user)
      ? "ORG"
      : (sharedWanted as (typeof SHARING)[number])
    : "PRIVATE";

  const already = await db.query.views.findFirst({
    where: and(eq(schema.views.scope, scope), eq(schema.views.ownerId, user.id), eq(schema.views.name, name)),
  });
  if (already) return { error: `You already have a view called ${name}.` };

  const [row] = await db
    .insert(schema.views)
    .values({ scope, name, query: cleanQuery(String(fd.get("query") ?? "")), shared, ownerId: user.id, orgId: user.orgId })
    .returning();
  await audit(user.id, "view.save", "view", row.id, { scope, name, shared });
  revalidatePath(SCOPE_PATH[scope]);
  return { ok: `${name} saved.` };
}

export async function deleteViewAction(fd: FormData) {
  const user = await requireUser([...APP_ROLES]);
  const id = String(fd.get("viewId") ?? "");
  const row = await db.query.views.findFirst({ where: eq(schema.views.id, id) });
  // Only the person who made it, so one counsellor cannot tidy away the
  // branch's own questions.
  if (!row || row.ownerId !== user.id) return;
  await db.delete(schema.views).where(eq(schema.views.id, id));
  await audit(user.id, "view.delete", "view", id, { name: row.name });
  revalidatePath(SCOPE_PATH[row.scope]);
}

export async function shareViewAction(fd: FormData) {
  const user = await requireUser([...APP_ROLES]);
  const id = String(fd.get("viewId") ?? "");
  const row = await db.query.views.findFirst({ where: eq(schema.views.id, id) });
  if (!row || row.ownerId !== user.id) return;
  const next = row.shared === "PRIVATE" ? "ORG" : row.shared === "ORG" && isStaff(user) ? "EVERYONE" : "PRIVATE";
  await db.update(schema.views).set({ shared: next, updatedAt: new Date() }).where(eq(schema.views.id, id));
  await audit(user.id, "view.share", "view", id, { name: row.name, shared: next });
  revalidatePath(SCOPE_PATH[row.scope]);
}

/** Keep somebody else's view on your own tab row, or take it off again. */
export async function pinViewAction(fd: FormData) {
  const user = await requireUser([...APP_ROLES]);
  const id = String(fd.get("viewId") ?? "");
  const row = await db.query.views.findFirst({ where: eq(schema.views.id, id) });
  if (!row) return;
  const pin = await db.query.viewPins.findFirst({
    where: and(eq(schema.viewPins.viewId, id), eq(schema.viewPins.userId, user.id)),
  });
  if (pin) await db.delete(schema.viewPins).where(eq(schema.viewPins.id, pin.id));
  else await db.insert(schema.viewPins).values({ viewId: id, userId: user.id });
  revalidatePath(SCOPE_PATH[row.scope]);
}
