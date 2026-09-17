/**
 * Promote an existing account to SUPER_ADMIN.
 *   npm run db:promote -- someone@example.com
 * Safe to run against production: it only changes the role of an account that
 * already exists, and prints every super admin afterwards.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run db:promote -- someone@example.com");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client, { schema });

async function main() {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) {
    console.error(`No account found for ${email}. Create the user first, then run this again.`);
    process.exit(1);
  }
  if (user.role === "SUPER_ADMIN") {
    console.log(`${email} is already a super admin.`);
  } else {
    await db
      .update(schema.users)
      .set({ role: "SUPER_ADMIN", active: true })
      .where(eq(schema.users.id, user.id));
    await db.insert(schema.auditLogs).values({
      actorId: user.id,
      action: "user.role_change",
      entityType: "user",
      entityId: user.id,
      meta: { email, from: user.role, to: "SUPER_ADMIN", via: "db:promote" },
    });
    console.log(`${email}: ${user.role} -> SUPER_ADMIN`);
  }

  const supers = await db.select({ name: schema.users.name, email: schema.users.email, active: schema.users.active }).from(schema.users).where(eq(schema.users.role, "SUPER_ADMIN"));
  console.log("\nSuper admins:");
  for (const s of supers) console.log(`  ${s.email}  ${s.name}${s.active ? "" : "  (inactive)"}`);
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
