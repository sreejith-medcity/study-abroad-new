/**
 * Loads Australia's CRICOS register into the catalogue from local files.
 *   npx tsx scripts/sync-cricos.ts <folder with the three CSVs> [--publish]
 * The folder must hold cricos-institutions.csv, cricos-courses.csv and
 * cricos-course-locations.csv as downloaded from data.gov.au. The same sync
 * runs from Admin, Programs, "Australia (CRICOS)", which fetches the files itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { syncCricos } from "../src/server/cricos-sync";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npx tsx scripts/sync-cricos.ts <folder> [--publish]");
  process.exit(1);
}
const find = (part: string) => {
  const name = readdirSync(dir).find((f) => f.toLowerCase().includes(part) && f.endsWith(".csv"));
  if (!name) throw new Error(`No CSV containing "${part}" in ${dir}`);
  return readFileSync(join(dir, name), "utf8");
};
const files = { institutions: find("institutions"), courses: find("courses"), locations: find("locations") };
syncCricos(files, { publish: process.argv.includes("--publish") })
  .then((r) => {
    console.log(r);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
