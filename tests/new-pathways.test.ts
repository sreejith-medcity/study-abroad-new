import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathway } from "../src/db/schema";
import { DOCUMENT_TYPES, STATUS_SEED } from "../src/db/statuses";
import { DOCUMENTATION_TYPES, FSJ_DOCUMENT_TYPES, NEW_PATHWAY_REQUIREMENTS, STAGE_REQUIREMENTS } from "../src/db/documentation-seed";
import { NEW_PATHWAYS, PATHWAYS, PATHWAY_IMPORT_ALIASES, PATHWAY_NAME, PATHWAY_OPTION, isPathway, pathwayName } from "../src/lib/pathways";
import { PATHWAY_LABEL } from "../src/lib/catalogue";
import { AIMS, aimOf, readAim } from "../src/lib/aims";
import { ENUM_FIELDS } from "../src/lib/crm-link";
import { NCLEX_STEPS } from "../src/lib/nclex";

/**
 * NCLEX-RN, Weiterbildung and CCM as pathways: registered everywhere a
 * pathway is, each with a status list, the requirements that are plainly
 * common, the deploy SQL that seeds them, and the hand-run SQL that moves the
 * NCLEX-RN files recorded on NURSING.
 */

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const COMMON = ["PENDING_PARTNER", "ON_HOLD_INTAKE", "DEFERRED", "CLOSED_NOT_QUALIFIED", "VISA_REJECTED", "WITHDRAWN", "CASE_CLOSED"];
const order = (pw: keyof typeof STATUS_SEED) => STATUS_SEED[pw].map((s, i) => ({ ...s, order: s.sortOrder ?? (i + 1) * 10 }));

test("the browser's list of pathways is the database enum, and every one has its words", () => {
  assert.deepEqual([...PATHWAYS].sort(), [...pathway.enumValues].sort());
  for (const pw of ["NCLEX", "WEITERBILDUNG", "CCM"] as const) assert.ok((pathway.enumValues as readonly string[]).includes(pw), `${pw} is in the enum`);
  for (const pw of PATHWAYS) {
    assert.ok(PATHWAY_NAME[pw], `${pw} has a short name`);
    assert.ok(PATHWAY_OPTION[pw], `${pw} has an option label`);
    assert.ok(PATHWAY_LABEL[pw], `${pw} has a catalogue label`);
    assert.ok(STATUS_SEED[pw]?.length, `${pw} has statuses`);
    assert.ok(AIMS.some((a) => a.pathway === pw), `${pw} can be picked on a student`);
    assert.ok(ENUM_FIELDS.preferredPathway?.includes(pw), `${pw} is accepted from the CRM`);
  }
  assert.equal(PATHWAY_NAME.NCLEX, "NCLEX-RN");
  assert.equal(PATHWAY_NAME.WEITERBILDUNG, "Weiterbildung");
  assert.equal(PATHWAY_NAME.CCM, "CCM");
  assert.equal(pathwayName("NCLEX"), "NCLEX-RN");
  assert.equal(pathwayName("SOMETHING_ELSE"), "SOMETHING_ELSE", "a value the list does not know is shown as stored");
  assert.equal(isPathway("CCM"), true);
  assert.equal(isPathway("ccm"), false);
});

test("the new pathways are picked and read back on a student", () => {
  for (const pw of NEW_PATHWAYS) {
    assert.deepEqual(readAim(pw), { pathway: pw, level: null });
    assert.equal(aimOf(pw, null), pw);
  }
});

test("a spreadsheet can name the new pathways in words", () => {
  assert.equal(PATHWAY_IMPORT_ALIASES["nclex-rn"], "NCLEX");
  assert.equal(PATHWAY_IMPORT_ALIASES.weiterbildung, "WEITERBILDUNG");
  assert.equal(PATHWAY_IMPORT_ALIASES.ccm, "CCM");
  for (const v of Object.values(PATHWAY_IMPORT_ALIASES)) assert.ok(isPathway(v));
});

test("NCLEX keeps every NURSING code, so a NURSING file moves across code for code", () => {
  const nclex = new Set(STATUS_SEED.NCLEX.map((s) => s.code));
  for (const s of STATUS_SEED.NURSING) assert.ok(nclex.has(s.code), `${s.code} is on NCLEX`);
  for (const s of STATUS_SEED.NURSING) {
    const n = STATUS_SEED.NCLEX.find((x) => x.code === s.code)!;
    assert.equal(n.group, s.group, `${s.code} stays in the same group, so lists and dashboards count it the same`);
  }
});

test("the NCLEX statuses speak of the USA only", () => {
  for (const s of STATUS_SEED.NCLEX) {
    assert.doesNotMatch(`${s.label} ${s.studentLabel}`, /\b(NMC|CBT|Anerkennung|Kenntnispr|OSCE)\b/, `${s.code} names no other country's route`);
  }
  // The waiting points the NCLEX-RN steps make plain have a status.
  for (const code of ["CGFNS_EVALUATION", "ATT_AWAITED", "REEXAMINATION", "VISA_SCREENING"]) assert.ok(STATUS_SEED.NCLEX.some((s) => s.code === code), code);
  assert.ok(NCLEX_STEPS.some((s) => s.key === "WAITING_ATT") && NCLEX_STEPS.some((s) => s.key === "VISA_SCREENING"), "and the steps they come from are still there");
});

test("each new chain starts new, runs in order and ends with the closing statuses", () => {
  for (const pw of NEW_PATHWAYS) {
    const rows = order(pw);
    const codes = rows.map((s) => s.code);
    assert.equal(new Set(codes).size, codes.length, `${pw} has no code twice`);
    assert.equal(new Set(rows.map((r) => r.order)).size, rows.length, `${pw} has no sort order twice`);
    for (const c of COMMON) assert.ok(codes.includes(c), `${pw} has ${c}`);
    const first = [...rows].sort((a, b) => a.order - b.order)[0];
    assert.equal(first.group, "NEW", `${pw} starts in a NEW status, which a new application opens at`);
    const chain = rows.filter((s) => !COMMON.includes(s.code));
    assert.deepEqual(chain.map((s) => s.order), [...chain.map((s) => s.order)].sort((a, b) => a - b), `${pw} is in order`);
    for (const code of ["VISA_FILED", "VISA_RECEIVED"]) assert.ok(codes.includes(code), `${pw} reuses ${code}, which the dashboards count`);
    for (const s of rows) {
      if (s.group === "CLOSED") assert.ok(s.requiresReason, `${pw} ${s.code} asks for a reason`);
    }
  }
});

test("Weiterbildung and CCM share the provisional chain, written as provisional", () => {
  assert.deepEqual(STATUS_SEED.WEITERBILDUNG.map((s) => s.code), STATUS_SEED.CCM.map((s) => s.code));
  for (const code of ["ASSESSMENT", "DOCUMENT_COLLECTION", "APPLICATION_SUBMITTED", "OFFER_RECEIVED", "CONTRACT_SIGNED", "VISA_FILED", "PRE_DEPARTURE", "JOINED"]) {
    assert.ok(STATUS_SEED.CCM.some((s) => s.code === code), code);
  }
  assert.match(read("../src/db/statuses.ts"), /PROVISIONAL/);
});

test("a student label reused from another list keeps its Malayalam", () => {
  const known = new Map<string, string>();
  for (const pw of ["DEGREE", "AUSBILDUNG", "NURSING", "FSJ", "BFD"] as const) for (const s of STATUS_SEED[pw]) if (s.studentLabelMl) known.set(s.studentLabel, s.studentLabelMl);
  for (const pw of NEW_PATHWAYS) {
    for (const s of STATUS_SEED[pw]) if (known.has(s.studentLabel)) assert.equal(s.studentLabelMl, known.get(s.studentLabel), `${pw} ${s.code}`);
  }
});

test("the new requirements name real types on the new pathways", () => {
  const types = new Set([...DOCUMENT_TYPES, ...DOCUMENTATION_TYPES, ...FSJ_DOCUMENT_TYPES].map((t) => t.code));
  for (const r of NEW_PATHWAY_REQUIREMENTS) {
    assert.ok(types.has(r.typeCode), `${r.typeCode} is a document type`);
    assert.ok(r.pathway && (NEW_PATHWAYS as readonly string[]).includes(r.pathway), `${r.typeCode} belongs to a new pathway`);
  }
  // NCLEX owes what NURSING owes.
  const nursing = STAGE_REQUIREMENTS.filter((r) => r.pathway === "NURSING").map((r) => `${r.stage} ${r.typeCode}`).sort();
  const nclex = NEW_PATHWAY_REQUIREMENTS.filter((r) => r.pathway === "NCLEX").map((r) => `${r.stage} ${r.typeCode}`).sort();
  assert.deepEqual(nclex, nursing);
  for (const pw of ["WEITERBILDUNG", "CCM"] as const) assert.ok(NEW_PATHWAY_REQUIREMENTS.some((r) => r.pathway === pw && r.typeCode === "CV"), `${pw} asks for a CV`);
});

test("the migration only adds the enum values, safely", () => {
  const sqlText = read("../drizzle/0088_new_pathways.sql");
  for (const pw of NEW_PATHWAYS) assert.ok(sqlText.includes(`ALTER TYPE "public"."pathway" ADD VALUE IF NOT EXISTS '${pw}'`), pw);
  assert.ok(!/INSERT|UPDATE|DELETE/i.test(sqlText.replace(/^--.*$/gm, "")), "no row uses a value in the transaction that adds it");
  const journal = JSON.parse(read("../drizzle/meta/_journal.json")) as { entries: { tag: string }[] };
  assert.ok(journal.entries.some((e) => e.tag === "0088_new_pathways"), "the journal lists it");
});

test("the deploy SQL seeds every new status and requirement and changes nothing already there", () => {
  const sqlText = read("../deploy/new-pathways.sql");
  for (const pw of NEW_PATHWAYS) for (const s of STATUS_SEED[pw]) assert.ok(sqlText.includes(`'${pw}', '${s.code}'`), `${pw} ${s.code} is in the SQL`);
  for (const r of NEW_PATHWAY_REQUIREMENTS) assert.ok(sqlText.includes(`'${r.stage}', '${r.typeCode}', 'ALWAYS', '${r.pathway}'`), `${r.pathway} ${r.typeCode} is in the SQL`);
  const lines = sqlText.split("\n");
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO status_definitions")).every((l) => l.endsWith("ON CONFLICT (pathway, code) DO NOTHING;")));
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO document_types")).every((l) => l.endsWith("ON CONFLICT (code) DO NOTHING;")));
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO document_requirements")).every((l) => l.includes("WHERE NOT EXISTS")));
  assert.ok(!/DO UPDATE|^UPDATE|^DELETE/m.test(sqlText), "nothing is overwritten or removed");
  assert.ok(sqlText.indexOf("BEGIN;") < sqlText.indexOf("INSERT") && sqlText.lastIndexOf("INSERT") < sqlText.indexOf("COMMIT;"), "in one transaction");
});

test("the NCLEX move SQL is one transaction, moves only USA programmes, and never deletes", () => {
  const sqlText = read("../deploy/nclex-pathway.sql");
  const body = sqlText.replace(/^--.*$/gm, "");
  assert.ok(body.indexOf("BEGIN;") > 0 && body.indexOf("COMMIT;") > body.indexOf("UPDATE applications"), "the changes sit inside BEGIN and COMMIT");
  assert.ok(body.indexOf("UPDATE applications") > body.indexOf("BEGIN;"));
  assert.match(body, /c\.code = 'US'/, "only USA programmes move");
  assert.match(body, /nclex_cases/, "only files with an NCLEX-RN case");
  assert.match(body, /t\.pathway = 'NCLEX' AND t\.code = s\.code/, "statuses map by code");
  assert.match(body, /RAISE EXCEPTION/, "stops when the NCLEX statuses are not there yet");
  assert.ok(!/\bDELETE\b|\bDROP TABLE\b(?! IF)|TRUNCATE/i.test(body), "nothing is deleted");
});

test("no long dashes in what this change writes", () => {
  for (const f of ["../src/lib/pathways.ts", "../src/db/statuses.ts", "../src/db/documentation-seed.ts", "../scripts/new-pathways-sql.ts", "../deploy/new-pathways.sql", "../deploy/nclex-pathway.sql", "../drizzle/0088_new_pathways.sql"]) {
    assert.ok(!read(f).includes("\u2014"), `${f} has no em dash`);
  }
});
