/**
 * Switches off every sample account (anything on a .test address) and clears
 * their passwords. Run it once the real people have their own logins.
 *   npm run db:demo-off
 * Add --delete-enquiries to also remove the sample enquiries.
 */
import "dotenv/config";
import { eq, like, sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client, { schema });

async function main() {
  const demo = await db.select().from(schema.users).where(like(schema.users.email, "%.test"));
  if (demo.length === 0) {
    console.log("No sample accounts found. Nothing to do.");
    return;
  }

  for (const user of demo) {
    // A random hash nobody holds: the account cannot be signed into again.
    const hash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
    await db
      .update(schema.users)
      .set({ active: false, passwordHash: hash, mustChangePassword: true })
      .where(eq(schema.users.id, user.id));
    console.log(`  off  ${user.email}`);
  }

  if (process.argv.includes("--delete-enquiries")) {
    const removed = await db
      .delete(schema.enquiries)
      .where(sql`${schema.enquiries.phone} like '+91 98470 110%'`)
      .returning({ id: schema.enquiries.id });
    console.log(`\nRemoved ${removed.length} sample enquiries.`);
  }

  console.log(`\n${demo.length} sample account${demo.length === 1 ? "" : "s"} switched off. Real accounts are untouched.`);
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
