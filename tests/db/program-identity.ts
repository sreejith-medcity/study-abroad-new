/**
 * A university runs a bachelor's and a master's under one name often enough
 * (Leoben's Circular Engineering, JKU's Artificial Intelligence) that the
 * import must keep both. It used to key on name plus university alone, so the
 * second row silently overwrote the first and the course vanished.
 *   DATABASE_URL=... npx tsx --conditions=react-server tests/db/program-identity.ts
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../src/db";

let failures = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

async function main() {
  const at = await db.query.countries.findFirst({ where: eq(schema.countries.code, "AT") });
  if (!at) throw new Error("AT missing from countries");
  const [uni] = await db
    .insert(schema.universities)
    .values({ name: "Identity Test University", city: "Graz", countryId: at.id })
    .onConflictDoUpdate({ target: [schema.universities.name, schema.universities.countryId], set: { city: "Graz" } })
    .returning();

  const made = await db
    .insert(schema.programs)
    .values([
      { name: "Circular Engineering", universityId: uni.id, level: "UG" as const, durationMonths: 42, status: "DRAFT" as const },
      { name: "Circular Engineering", universityId: uni.id, level: "PG" as const, durationMonths: 24, status: "DRAFT" as const },
    ])
    .returning({ id: schema.programs.id });
  check("a bachelor's and a master's of one name both exist", made.length, 2);

  // What the import looks up. With level in the key each row finds its own.
  const ug = await db.query.programs.findFirst({
    where: and(eq(schema.programs.name, "Circular Engineering"), eq(schema.programs.universityId, uni.id), eq(schema.programs.level, "UG")),
  });
  const pg = await db.query.programs.findFirst({
    where: and(eq(schema.programs.name, "Circular Engineering"), eq(schema.programs.universityId, uni.id), eq(schema.programs.level, "PG")),
  });
  check("the bachelor's is found by name plus university plus level", ug?.durationMonths ?? null, 42);
  check("the master's is found separately", pg?.durationMonths ?? null, 24);
  check("they are two different rows", ug?.id !== pg?.id, true);

  await db.delete(schema.programs).where(eq(schema.programs.universityId, uni.id));
  await db.delete(schema.universities).where(eq(schema.universities.id, uni.id));

  console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
