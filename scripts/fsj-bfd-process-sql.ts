/**
 * The FSJ / BFD written process as SQL that is safe to run twice: the statuses
 * both pathways need to record every step and decision, the document types and
 * requirements from the guide's Section 2, and the registration addresses for
 * the Contacts list.
 *
 *   npx tsx scripts/fsj-bfd-process-sql.ts > deploy/fsj-bfd-process.sql
 *
 * Nothing already in the database is changed. A status is inserted only where
 * its code is not there for that pathway, so a label or an order the team has
 * edited stays edited; a requirement only where the pathway has no row for that
 * document; a contact only where the address is not on the list.
 */
import { createId } from "../src/lib/id";
import { STATUS_SEED } from "../src/db/statuses";
import { FSJ_DOCUMENT_TYPES, FSJ_REQUIREMENTS } from "../src/db/documentation-seed";
import { FSJ_CONTACT_AREA, FSJ_PATHWAYS, FSJ_TEAM } from "../src/lib/fsj";

const q = (v: string | null | undefined) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const out: string[] = [
  "-- Medcity's written FSJ / BFD process: the statuses, document types,",
  "-- requirements and registration addresses it names. Run in the SQL editor (or",
  "-- psql on the VPS) after the migration that adds the FSJ and BFD pathways and",
  "-- before the code that shows them goes out. Safe to run twice: nothing already",
  "-- in the database is changed.",
  "",
  "-- Statuses, for FSJ and for BFD. A code already there is left exactly as it is,",
  "-- label and order included.",
];

for (const pathway of FSJ_PATHWAYS) {
  STATUS_SEED[pathway].forEach((s, i) => {
    const cols = 'id, pathway, code, label, student_label, student_label_ml, "group", sort_order, requires_reason, is_milestone, active';
    const values = [
      q(createId()),
      q(pathway),
      q(s.code),
      q(s.label),
      q(s.studentLabel),
      q(s.studentLabelMl ?? null),
      q(s.group),
      s.sortOrder ?? (i + 1) * 10,
      s.requiresReason ? "true" : "false",
      s.isMilestone ? "true" : "false",
      "true",
    ].join(", ");
    out.push(`INSERT INTO status_definitions (${cols}) VALUES (${values}) ON CONFLICT (pathway, code) DO NOTHING;`);
  });
}

out.push("", "-- Document types the guide names that no other journey asked for.");
for (const t of FSJ_DOCUMENT_TYPES) {
  out.push(
    `INSERT INTO document_types (code, label, label_ml, uploaded_by, sort_order) VALUES (${q(t.code)}, ${q(t.label)}, ${q(t.labelMl)}, ${q(t.uploadedBy)}, ${t.sortOrder}) ON CONFLICT (code) DO NOTHING;`,
  );
}

out.push(
  "",
  "-- Requirements for both pathways, from the guide's Section 2. Guarded by type,",
  "-- source and pathway: a document is asked for once per pathway, and a row the",
  "-- team has since moved to another stage or edited is left as it is. Also",
  "-- guarded on the type existing, so a database missing one base type skips that",
  "-- row instead of failing the whole file.",
);
FSJ_REQUIREMENTS.forEach((r, i) => {
  const cols = "id, stage, type_code, source, pathway, required, owed_by, validity_months, guidance, sort_order";
  const values = [
    q(createId()),
    q(r.stage),
    q(r.typeCode),
    "'ALWAYS'",
    q(r.pathway),
    r.required === false ? "false" : "true",
    q(r.owedBy ?? "STUDENT"),
    r.validityMonths ?? "NULL",
    q(r.guidance ?? null),
    5000 + (i + 1) * 10,
  ].join(", ");
  const guard = `NOT EXISTS (SELECT 1 FROM document_requirements d WHERE d.type_code = ${q(r.typeCode)} AND d.source = 'ALWAYS' AND d.pathway = ${q(r.pathway)}) AND EXISTS (SELECT 1 FROM document_types t WHERE t.code = ${q(r.typeCode)})`;
  out.push(`INSERT INTO document_requirements (${cols}) SELECT ${values} WHERE ${guard};`);
});

out.push("", "-- The registration addresses from the guide's email matrix, on the Contacts list. Guarded by address.");
for (const t of FSJ_TEAM) {
  out.push(
    `INSERT INTO team_contacts (id, area, name, title, email, level, sort_order) SELECT ${q(createId())}, ${q(FSJ_CONTACT_AREA)}, ${q(t.name)}, ${q(t.title)}, ${q(t.email)}, ${t.level}, ${t.sortOrder} WHERE NOT EXISTS (SELECT 1 FROM team_contacts x WHERE lower(x.email) = ${q(t.email.toLowerCase())});`,
  );
}

out.push(
  "",
  "-- What is there now.",
  "SELECT 'FSJ statuses ' || count(*) FROM status_definitions WHERE pathway = 'FSJ' AND active",
  "UNION ALL SELECT 'BFD statuses ' || count(*) FROM status_definitions WHERE pathway = 'BFD' AND active",
  "UNION ALL SELECT 'FSJ requirements ' || count(*) FROM document_requirements WHERE pathway = 'FSJ' AND active",
  "UNION ALL SELECT 'BFD requirements ' || count(*) FROM document_requirements WHERE pathway = 'BFD' AND active",
  `UNION ALL SELECT 'FSJ / BFD contacts ' || count(*) FROM team_contacts WHERE area = ${q(FSJ_CONTACT_AREA)};`,
  "",
);
console.log(out.join("\n"));
