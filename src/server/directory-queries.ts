import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export async function activeTeamContacts() {
  const t = schema.teamContacts;
  return db.select().from(t).where(eq(t.active, true)).orderBy(asc(t.area), asc(t.level), asc(t.sortOrder), asc(t.name));
}

export async function quickLinkList() {
  return db.select().from(schema.quickLinks).orderBy(asc(schema.quickLinks.sortOrder), asc(schema.quickLinks.label));
}

/** Schemes running today, then those about to start. */
export async function currentPromotions() {
  const p = schema.promotions;
  return db.select().from(p).where(and(eq(p.published, true), gte(p.endsOn, sql`current_date`))).orderBy(asc(p.startsOn), asc(p.endsOn));
}

export async function pastPromotions() {
  const p = schema.promotions;
  return db
    .select()
    .from(p)
    .where(and(eq(p.published, true), lte(p.endsOn, sql`current_date - 1`), gte(p.endsOn, sql`current_date - 365`)))
    .orderBy(desc(p.endsOn))
    .limit(30);
}
