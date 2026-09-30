/**
 * The documentation module's starting content as SQL that is safe to run twice:
 * the document types the nine stages need, the stage requirements themselves,
 * and the team's list of reasons for sending a document back.
 *
 *   npx tsx scripts/documentation-content-sql.ts >> part39.sql
 *
 * Nothing here overwrites what is already in the database. Every row is guarded,
 * so a requirement the team has since edited or paused is left exactly as it is.
 */
import { createId } from "../src/lib/id";
import { DOCUMENTATION_TYPES, REJECTION_REASONS, STAGE_REQUIREMENTS } from "../src/db/documentation-seed";

const q = (v: string | null | undefined) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const out: string[] = [
  "",
  "-- The documentation module's starting content. Safe to run twice; nothing already",
  "-- in the database is changed, so anything the team has edited stays edited.",
  "",
];

for (const t of DOCUMENTATION_TYPES) {
  out.push(
    `INSERT INTO document_types (code, label, label_ml, uploaded_by, sort_order) VALUES (${q(t.code)}, ${q(t.label)}, ${q(t.labelMl)}, ${q(t.uploadedBy)}, ${t.sortOrder}) ON CONFLICT (code) DO NOTHING;`,
  );
}
out.push("");
for (const r of REJECTION_REASONS) {
  out.push(
    `INSERT INTO rejection_reasons (code, label, label_ml, sort_order) VALUES (${q(r.code)}, ${q(r.label)}, ${q(r.labelMl)}, ${(REJECTION_REASONS.indexOf(r) + 1) * 10}) ON CONFLICT (code) DO NOTHING;`,
  );
}
out.push("");

STAGE_REQUIREMENTS.forEach((r, i) => {
  const source = r.country ? "DESTINATION" : "ALWAYS";
  const cols = "id, stage, type_code, source, country_id, required, owed_by, validity_months, guidance, sort_order";
  const values = [
    q(createId()),
    q(r.stage),
    q(r.typeCode),
    q(source),
    r.country ? "c.id" : "NULL",
    r.required === false ? "false" : "true",
    q(r.owedBy ?? "STUDENT"),
    r.validityMonths ?? "NULL",
    q(r.guidance ?? null),
    (i + 1) * 10,
  ].join(", ");
  const guard = `NOT EXISTS (SELECT 1 FROM document_requirements d WHERE d.type_code = ${q(r.typeCode)} AND d.stage = ${q(r.stage)} AND d.source = ${q(source)}${r.country ? " AND d.country_id = c.id" : ""})`;
  const from = r.country ? ` FROM countries c WHERE c.code = ${q(r.country)} AND ${guard}` : ` WHERE ${guard}`;
  out.push(`INSERT INTO document_requirements (${cols}) SELECT ${values}${from};`);
});

out.push("");
console.log(out.join("\n"));
