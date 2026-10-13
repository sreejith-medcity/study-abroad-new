/**
 * The register loader against a real database. It must add what is missing,
 * fill only what is empty, never touch a verified value, never invent a
 * destination, and give the same answer when run twice.
 *   DATABASE_URL=... npx tsx tests/db/registry-sync.ts
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { syncRegistry } from "../../src/server/registry-sync";

let failures = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const header = "deqar_id,name_primary,country,city,website_link,closure_date";
const pad = Array.from({ length: 250 }, (_, i) => `9${i},Filler Institute ${i},GB,Leeds,https://filler${i}.ac.uk,`).join("\n");

async function main() {
  const gb = await db.query.countries.findFirst({ where: eq(schema.countries.code, "GB") });
  if (!gb) throw new Error("GB missing from countries");

  // A university already here, with a city somebody verified and no website.
  const [mine] = await db
    .insert(schema.universities)
    .values({ name: "Teesside University", city: "Middlesbrough", countryId: gb.id })
    .onConflictDoUpdate({ target: [schema.universities.name, schema.universities.countryId], set: { city: "Middlesbrough", website: null } })
    .returning();

  const csv = [
    header,
    // Same institution, different punctuation and a WRONG city: must not move it.
    "1,Teesside  University,United Kingdom,Darlington,https://tees.ac.uk,",
    "2,A Brand New Institute,GB,Hull,https://brandnew.ac.uk,",
    // A destination that is not on the countries list.
    "3,Somewhere Else College,ZW,Harare,https://elsewhere.ac.zw,",
    // The register qualifies the country, which an exact match would miss.
    "5,Durham Qualified College,United Kingdom (England),Durham,https://dqc.ac.uk,",
    "6,Liege Institute,Belgium (French Community),Liege,https://liege.be,",
    "7,Valletta Institute,Malta,Valletta,https://valletta.mt,",
    "4,Closed Place,GB,Leeds,https://closed.ac.uk,2020-01-01",
    pad,
  ].join("\n");

  const dry = await syncRegistry("deqar", csv, { dryRun: true });
  check("dry run plans the new ones", dry.created, 254);
  check("a qualified country name still resolves", dry.unknownCountries.map(([c]) => c).includes("United Kingdom (England)"), false);
  check("a destination the register does not cover is named", dry.destinationsWithNothing.includes("Japan"), true);
  check("a destination it does cover is not named", dry.destinationsWithNothing.includes("Malta"), false);
  check("dry run plans one fill", dry.filled, 1);
  check("dry run reports the country it cannot place", dry.unknownCountries, [["ZW", 1]]);
  const afterDry = await db.query.universities.findFirst({ where: and(eq(schema.universities.name, "A Brand New Institute"), eq(schema.universities.countryId, gb.id)) });
  check("dry run wrote nothing", afterDry ?? null, null);

  const run = await syncRegistry("deqar", csv, { dryRun: false });
  check("the run creates what it planned", run.created, 254);

  const fresh = await db.query.universities.findFirst({ where: and(eq(schema.universities.name, "A Brand New Institute"), eq(schema.universities.countryId, gb.id)) });
  check("a missing university is added", fresh?.city ?? null, "Hull");

  const kept = await db.query.universities.findFirst({ where: eq(schema.universities.id, mine.id) });
  check("a verified city is not overwritten", kept?.city ?? null, "Middlesbrough");
  check("an empty website is filled", kept?.website ?? null, "https://tees.ac.uk");
  check("the name is left exactly as it was", kept?.name ?? null, "Teesside University");

  const qualified = await db.query.universities.findFirst({ where: and(eq(schema.universities.name, "Durham Qualified College"), eq(schema.universities.countryId, gb.id)) });
  check("United Kingdom (England) lands in the United Kingdom", qualified?.city ?? null, "Durham");
  const mt = await db.query.universities.findFirst({ where: eq(schema.universities.name, "Valletta Institute") });
  check("Malta is reachable", mt?.city ?? null, "Valletta");

  const stray = await db.query.universities.findFirst({ where: eq(schema.universities.name, "Somewhere Else College") });
  check("a country not on the list creates nothing", stray ?? null, null);
  const closed = await db.query.universities.findFirst({ where: eq(schema.universities.name, "Closed Place") });
  check("a closed institution is not added", closed ?? null, null);

  const again = await syncRegistry("deqar", csv, { dryRun: false });
  check("running it twice adds nothing", again.created, 0);
  check("running it twice fills nothing", again.filled, 0);

  // A truncated file must be refused outright rather than half-imported.
  let refused = "";
  try {
    await syncRegistry("deqar", [header, "1,Only One,GB,Leeds,,"].join("\n"), { dryRun: false });
  } catch (e) {
    refused = (e as Error).message;
  }
  check("a short file is refused", /looks incomplete/.test(refused), true);

  let moved = "";
  try {
    await syncRegistry("deqar", ["a,b,c", "1,2,3"].join("\n"), { dryRun: false });
  } catch (e) {
    moved = (e as Error).message;
  }
  check("a file with the wrong columns names the headers it found", /a, b, c/.test(moved), true);

  console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
