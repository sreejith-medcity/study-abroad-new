/**
 * Checks every CSV in catalogue/ against the importer the app actually uses, so a
 * bad row is found here rather than halfway through an import.
 *
 *   DOC_CODES="$(psql "$DATABASE_URL" -tAc "select string_agg(code, ',') from document_types")" \
 *     npx tsx scripts/validate-catalogue.ts
 */
import fs from "node:fs";
import { parseProgramCsv } from "../src/lib/program-import";

const CODES = (process.env.DOC_CODES ?? "").split(",").filter(Boolean);

let total = 0;
let bad = 0;
for (const file of fs.readdirSync("catalogue").filter((f) => f.endsWith(".csv"))) {
  const { rows, errors } = parseProgramCsv(fs.readFileSync(`catalogue/${file}`, "utf8"), CODES);
  total += rows.length;
  bad += errors.length;
  console.log(`\n${file}: ${rows.length} accepted, ${errors.length} rejected`);
  for (const e of errors.slice(0, 8)) console.log(`   line ${e.line}: ${e.message}`);
  if (errors.length > 8) console.log(`   ... and ${errors.length - 8} more`);
  // How complete is what we accepted?
  const filled = (pick: (r: (typeof rows)[number]) => unknown) => rows.filter((r) => pick(r) !== null && pick(r) !== undefined && pick(r) !== "").length;
  if (rows.length) {
    console.log(
      `   tuition ${filled((r) => r.tuitionPerYear)}/${rows.length}` +
      `  ielts ${filled((r) => r.minIelts)}/${rows.length}` +
      `  duration ${filled((r) => r.durationMonths)}/${rows.length}` +
      `  docs ${rows.filter((r) => r.requiredDocs.length).length}/${rows.length}`,
    );
  }
}
console.log(`\nTOTAL: ${total} importable, ${bad} rejected`);
