/**
 * The search filter "hide programs the student cannot meet yet" is SQL, and the
 * verdict on each row is checkEligibility in TypeScript. This runs both over
 * every program in the database for a spread of students and fails on any
 * program where they disagree.
 *   DATABASE_URL=... npx tsx tests/db/eligibility-sql.ts
 */
import { db, schema } from "../../src/db";
import { checkEligibility, type EligibilityInput } from "../../src/lib/eligibility";
import { notBlockedWhere } from "../../src/server/eligibility-sql";

const t = (test: string, overall: string, isMock = false) => ({ test, overall, isMock });
const students: (EligibilityInput & { label: string })[] = [
  { label: "no tests", backlogs: null, gapYears: null, tests: [] },
  { label: "IELTS 6.0, 2 backlogs", backlogs: 2, gapYears: 1, tests: [t("IELTS", "6")] },
  { label: "IELTS 7.5", backlogs: 0, gapYears: 0, tests: [t("IELTS", "7.5")] },
  { label: "practice IELTS 6.5", backlogs: 0, gapYears: 3, tests: [t("IELTS", "6.5", true)] },
  { label: "PTE 58, 8 backlogs", backlogs: 8, gapYears: 0, tests: [t("PTE", "58")] },
  { label: "OET B", backlogs: 0, gapYears: 0, tests: [t("OET", "B")] },
  { label: "practice OET C+ and IELTS 6.5", backlogs: 1, gapYears: 0, tests: [t("OET", "C+", true), t("IELTS", "6.5")] },
  { label: "German B1", backlogs: 0, gapYears: 0, tests: [t("GERMAN", "B1")] },
  { label: "practice German B2", backlogs: 0, gapYears: 0, tests: [t("GERMAN", "B2", true)] },
];

async function main() {
  const p = schema.programs;
  const all = await db.select().from(p);
  let mismatches = 0;
  for (const s of students) {
    const kept = new Set((await db.select({ id: p.id }).from(p).where(notBlockedWhere(s))).map((r) => r.id));
    let blocked = 0;
    for (const row of all) {
      const verdict = checkEligibility(s, row).verdict;
      if (verdict === "blocked") blocked++;
      if ((verdict !== "blocked") !== kept.has(row.id)) {
        mismatches++;
        if (mismatches <= 10) console.log(`FAIL  ${s.label}: ${row.name} is ${verdict} but SQL ${kept.has(row.id) ? "keeps" : "hides"} it`);
      }
    }
    console.log(`  ok  ${s.label}: ${all.length - blocked} of ${all.length} kept`);
  }
  if (mismatches) { console.log(`\n${mismatches} disagreements`); process.exit(1); }
  console.log("\nSQL and checkEligibility agree on every program");
  process.exit(0);
}
main();
