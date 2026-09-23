import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

export type ImportLine = { line: number; message: string };
export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: ImportLine[];
  notes: ImportLine[];
  sample: string[];
};
export const emptyResult = (): ImportResult => ({ created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [], notes: [], sample: [] });

/** The first data row is line 2: line 1 holds the column names. */
export const lineOf = (i: number) => i + 2;

export { phoneKey } from "@/lib/phone";

type Org = { id: string; name: string };

/**
 * Which branch a row belongs to. A branch owner always uploads for their own
 * branch; the team names it in a "branch" column, by name or by its public code.
 */
export async function branchResolver(user: SessionUser) {
  if (!isAdmin(user)) {
    const own = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), columns: { id: true, name: true } });
    return (): Org | string => own ?? "Your branch could not be loaded";
  }
  const orgs = await db.select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.publicSlug, type: schema.organizations.type }).from(schema.organizations);
  const branches = orgs.filter((o) => o.type !== "HQ");
  const names = branches.map((o) => o.name).sort();
  const listed = names.slice(0, 8).join(", ") + (names.length > 8 ? `, and ${names.length - 8} more` : "");
  return (v: string | undefined): Org | string => {
    const t = (v ?? "").trim().toLowerCase();
    if (!t) return `branch: name the branch this row belongs to. Branches are: ${listed}`;
    const exact = branches.find((o) => o.name.toLowerCase() === t || o.slug?.toLowerCase() === t);
    if (exact) return { id: exact.id, name: exact.name };
    // "KOCHI" for "Medcity Overseas Kochi": taken only when one branch can mean it.
    const near = branches.filter((o) => o.name.toLowerCase().includes(t));
    if (near.length === 1) return { id: near[0].id, name: near[0].name };
    if (near.length > 1) return `branch: "${v}" could mean ${near.map((o) => o.name).join(" or ")}; write the branch's full name`;
    return `branch: no branch called "${v}". Branches are: ${listed}`;
  };
}

/** Active branch people by email, to assign students and enquiries. */
export async function staffByEmail(orgIds: string[]) {
  if (!orgIds.length) return new Map<string, { id: string; orgId: string }>();
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, orgId: schema.users.orgId })
    .from(schema.users)
    .where(and(inArray(schema.users.orgId, orgIds), eq(schema.users.active, true), inArray(schema.users.role, ["PARTNER", "COUNSELLOR"])));
  return new Map(rows.map((r) => [`${r.orgId}|${r.email.toLowerCase()}`, r]));
}

export async function branchOwner(orgId: string) {
  return db.query.users.findFirst({ where: and(eq(schema.users.orgId, orgId), eq(schema.users.role, "PARTNER"), eq(schema.users.active, true)) });
}

