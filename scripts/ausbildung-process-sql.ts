/**
 * The written Ausbildung process as SQL that is safe to run twice: the statuses
 * the desk needs to record every step of it, the document types and stage
 * requirements the guide names, and the hand-over addresses for the Contacts
 * list.
 *
 *   npx tsx scripts/ausbildung-process-sql.ts > deploy/ausbildung-process.sql
 *
 * Nothing already in the database is changed. Every status is inserted only
 * where its code is not there, so a label or an order the team has edited stays
 * edited; every requirement is guarded the same way the documentation content
 * was. The one update is the guidance on the Ausbildung CV row, and it fires
 * only while that row still carries the wording the seed first gave it.
 */
import { createId } from "../src/lib/id";
import { STATUS_SEED } from "../src/db/statuses";
import { DOCUMENTATION_TYPES, STAGE_REQUIREMENTS } from "../src/db/documentation-seed";
import { AUSBILDUNG_CONTACT_AREA, AUSBILDUNG_TEAM } from "../src/lib/ausbildung";

const q = (v: string | null | undefined) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const out: string[] = [
  "-- Medcity's written Ausbildung process: the statuses, document types, stage",
  "-- requirements and hand-over addresses it names. Run in the Supabase SQL editor",
  "-- (or psql on the VPS) before the code that shows them goes out. Safe to run",
  "-- twice: nothing already in the database is changed.",
  "",
  "-- Statuses. A code already there is left exactly as it is, label and order",
  "-- included. New rows carry the order the seed gives them, which slots them",
  "-- between the rows a database from the first release already has.",
];

const ausbildung = STATUS_SEED.AUSBILDUNG;
ausbildung.forEach((s, i) => {
  const cols = "id, pathway, code, label, student_label, student_label_ml, \"group\", sort_order, requires_reason, is_milestone, active";
  const values = [
    q(createId()),
    "'AUSBILDUNG'",
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

out.push("", "-- Document types.");
for (const t of DOCUMENTATION_TYPES) {
  out.push(
    `INSERT INTO document_types (code, label, label_ml, uploaded_by, sort_order) VALUES (${q(t.code)}, ${q(t.label)}, ${q(t.labelMl)}, ${q(t.uploadedBy)}, ${t.sortOrder}) ON CONFLICT (code) DO NOTHING;`,
  );
}

out.push(
  "",
  "-- Stage requirements for the Ausbildung journey. Guarded by type, source and",
  "-- journey, the way the first Ausbildung rows were: a document is asked for once",
  "-- per journey, and a row the team has since moved to another stage is left there.",
);
STAGE_REQUIREMENTS.forEach((r, i) => {
  if (r.pathway !== "AUSBILDUNG") return;
  const source = r.country ? "DESTINATION" : "ALWAYS";
  const cols = "id, stage, type_code, source, country_id, pathway, required, owed_by, validity_months, guidance, sort_order";
  const values = [
    q(createId()),
    q(r.stage),
    q(r.typeCode),
    q(source),
    r.country ? "c.id" : "NULL",
    q(r.pathway),
    r.required === false ? "false" : "true",
    q(r.owedBy ?? "STUDENT"),
    r.validityMonths ?? "NULL",
    q(r.guidance ?? null),
    (i + 1) * 10,
  ].join(", ");
  const guard = `NOT EXISTS (SELECT 1 FROM document_requirements d WHERE d.type_code = ${q(r.typeCode)} AND d.source = ${q(source)} AND d.pathway = 'AUSBILDUNG'${r.country ? " AND d.country_id = c.id" : ""})`;
  const from = r.country ? ` FROM countries c WHERE c.code = ${q(r.country)} AND ${guard}` : ` WHERE ${guard}`;
  out.push(`INSERT INTO document_requirements (${cols}) SELECT ${values}${from};`);
});

out.push(
  "",
  "-- The Ausbildung CV row used to ask for the German Lebenslauf; that is now its own",
  "-- row, prepared by the mentor, so the CV row asks for the student's own resume.",
  "-- Only a row still carrying the seed's first wording is touched.",
  `UPDATE document_requirements SET guidance = ${q(STAGE_REQUIREMENTS.find((r) => r.typeCode === "CV" && r.pathway === "AUSBILDUNG")?.guidance ?? null)}, updated_at = now()`,
  ` WHERE type_code = 'CV' AND stage = 'PROFILE' AND source = 'ALWAYS' AND pathway = 'AUSBILDUNG'`,
  `   AND guidance = 'In German, in the tabular Lebenslauf form, with a photograph.';`,
);

out.push("", "-- The hand-over addresses the guide names, on the Contacts list. Guarded by address.");
for (const t of AUSBILDUNG_TEAM) {
  out.push(
    `INSERT INTO team_contacts (id, area, name, title, email, level, sort_order) SELECT ${q(createId())}, ${q(AUSBILDUNG_CONTACT_AREA)}, ${q(t.name)}, ${q(t.title)}, ${q(t.email)}, ${t.level}, ${t.sortOrder} WHERE NOT EXISTS (SELECT 1 FROM team_contacts x WHERE lower(x.email) = ${q(t.email.toLowerCase())});`,
  );
}

out.push(
  "",
  "-- What is there now.",
  "SELECT 'Ausbildung statuses ' || count(*) FROM status_definitions WHERE pathway = 'AUSBILDUNG' AND active",
  "UNION ALL SELECT 'Ausbildung requirements ' || count(*) FROM document_requirements WHERE pathway = 'AUSBILDUNG' AND active",
  `UNION ALL SELECT 'Ausbildung contacts ' || count(*) FROM team_contacts WHERE area = ${q(AUSBILDUNG_CONTACT_AREA)};`,
  "",
);
console.log(out.join("\n"));
