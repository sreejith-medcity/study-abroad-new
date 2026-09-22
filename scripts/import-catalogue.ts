// Imports every catalogue CSV through the real parser and the real upsert, so
// the check exercises the same code the import screen runs.
import { readFileSync, readdirSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { parseProgramCsv } from "../src/lib/program-import";

const dir = "/home/claude/study-abroad-new/catalogue";

async function main() {
  const docCodes = (await db.select({ code: schema.documentTypes.code }).from(schema.documentTypes)).map((d) => d.code);
  const countries = await db.select().from(schema.countries);
  const byCode = Object.fromEntries(countries.map((c) => [c.code, c]));
  let created = 0, updated = 0, rejected = 0;

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
    const { rows, errors } = parseProgramCsv(readFileSync(`${dir}/${file}`, "utf8"), docCodes);
    rejected += errors.length;
    const valid = rows.filter((r) => byCode[r.countryCode]);
    if (valid.length !== rows.length) console.log(`  ${file}: ${rows.length - valid.length} rows have an unknown country`);
    for (const r of valid) {
      const countryId = byCode[r.countryCode].id;
      const [uni] = await db.insert(schema.universities)
        .values({ name: r.university, city: r.city, countryId })
        .onConflictDoUpdate({ target: [schema.universities.name, schema.universities.countryId], set: { city: sql`coalesce(${schema.universities.city}, excluded.city)` } })
        .returning();
      const values = {
        name: r.program, universityId: uni.id, campus: r.city, pathway: r.pathway, level: r.level, studyArea: r.studyArea,
        durationMonths: r.durationMonths, tuitionPerYear: r.tuitionPerYear, applicationFee: r.applicationFee,
        initialDeposit: r.initialDeposit, intakeMonths: r.intakeMonths, minIelts: r.minIelts, minPte: r.minPte,
        minOetGrade: r.minOetGrade, minGermanLevel: r.minGermanLevel, maxBacklogs: r.maxBacklogs,
        minToefl: r.minToefl, minDuolingo: r.minDuolingo, minGre: r.minGre, minGmat: r.minGmat, minSat: r.minSat, minAcademicPercent: r.minAcademicPercent, feeWaiver: r.feeWaiver,
        maxGapYears: r.maxGapYears, moiAccepted: r.moiAccepted, workRights: r.workRights,
        workRightsNote: r.workRightsNote, requiredDocs: r.requiredDocs, status: r.status, updatedAt: new Date(),
      };
      const existing = await db.query.programs.findFirst({ where: and(eq(schema.programs.name, r.program), eq(schema.programs.universityId, uni.id)) });
      if (existing) { await db.update(schema.programs).set(values).where(eq(schema.programs.id, existing.id)); updated++; }
      else { await db.insert(schema.programs).values(values); created++; }
    }
    console.log(`${file.padEnd(20)} ${String(valid.length).padStart(4)} rows, ${errors.length} rejected`);
  }
  console.log(`\ncreated ${created}, updated ${updated}, rejected ${rejected}`);
  process.exit(0);
}
main();
