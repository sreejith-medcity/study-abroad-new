/**
 * The apply picker's country list. A destination with institutions but no
 * courses must still be offered, and marked, rather than vanishing.
 *   DATABASE_URL=... npx tsx --conditions=react-server tests/db/apply-countries.ts
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { applyCountries } from "../../src/server/apply-options";

let failures = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

async function main() {
  const at = await db.query.countries.findFirst({ where: eq(schema.countries.code, "AT") });
  const gb = await db.query.countries.findFirst({ where: eq(schema.countries.code, "GB") });
  if (!at || !gb) throw new Error("AT or GB missing from countries");

  // Austria: a university, no courses at all. This is the real shape of the
  // catalogue after a register load, and it used to disappear from the filter.
  await db.insert(schema.universities).values({ name: "Universitaet Wien", city: "Vienna", countryId: at.id }).onConflictDoNothing();

  const list = await applyCountries();
  const austria = list.find((c) => c.code === "AT");
  check("a destination with institutions and no courses is offered", austria?.name ?? null, "Austria");
  check("and is reported as having none open", austria?.live ?? -1, 0);

  const uk = list.find((c) => c.code === "GB");
  check("a destination with courses is still offered", Boolean(uk), true);
  check("and counts only the open ones", (uk?.live ?? 0) > 0, true);

  // A destination with no institution at all stays out: there is nothing to
  // offer and nothing for the desk to add a course against.
  const kz = list.find((c) => c.code === "KZ");
  check("a destination with no institutions is left out", kz ?? null, null);

  check("the list is in name order", list.map((c) => c.name).join("|"), [...list].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.name).join("|"));

  console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
