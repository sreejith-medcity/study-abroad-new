import { sql } from "drizzle-orm";
import { db } from "@/db";
import { financialYear } from "./format";

/**
 * Acknowledgement numbers look like 144472/26-27: a running number plus the
 * Indian financial year. Backed by a Postgres sequence so concurrent inserts never clash.
 */
export async function nextAckNo(): Promise<string> {
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS application_ack_seq START 100001`);
  const rows = await db.execute<{ n: string }>(sql`SELECT nextval('application_ack_seq')::text AS n`);
  return `${rows[0].n}/${financialYear()}`;
}
