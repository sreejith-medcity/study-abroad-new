import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BulletinKind } from "@/lib/bulletins";

export function publishedBulletins(kind: BulletinKind, opts: { country?: string; limit?: number; offset?: number } = {}) {
  const b = schema.bulletins;
  const conds: (SQL | undefined)[] = [eq(b.kind, kind), eq(b.published, true)];
  if (opts.country === "OTHER") conds.push(sql`not (${b.countries} && array['GB','AU','CA','US']::text[])`);
  else if (opts.country) conds.push(sql`${opts.country} = any(${b.countries})`);
  return db.query.bulletins.findMany({
    where: and(...conds),
    with: { university: { columns: { id: true, name: true } } },
    orderBy: desc(b.createdAt),
    limit: opts.limit ?? 50,
    offset: opts.offset ?? 0,
  });
}
