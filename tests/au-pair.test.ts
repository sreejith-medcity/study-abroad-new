import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathway } from "../src/db/schema";
import { DOCUMENT_TYPES, STATUS_SEED } from "../src/db/statuses";
import { AU_PAIR_REQUIREMENTS, DOCUMENTATION_TYPES, FSJ_DOCUMENT_TYPES } from "../src/db/documentation-seed";
import { AU_PAIR_PATHWAYS, PATHWAYS, PATHWAY_IMPORT_ALIASES, PATHWAY_NAME, PATHWAY_OPTION, isPathway, pathwayName } from "../src/lib/pathways";
import { PATHWAY_LABEL } from "../src/lib/catalogue";
import { AIMS, aimLabel, aimOf, readAim } from "../src/lib/aims";
import { ENUM_FIELDS, normalise } from "../src/lib/crm-link";
import { oneOf } from "../src/lib/import-values";

/**
 * Au pair as a pathway of its own, and the DEGREE pathway read as "Study
 * abroad": registered everywhere a pathway is, with a provisional status list,
 * the requirements that are plainly common, and the deploy SQL that seeds them.
 */

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const COMMON = ["PENDING_PARTNER", "ON_HOLD_INTAKE", "DEFERRED", "CLOSED_NOT_QUALIFIED", "VISA_REJECTED", "WITHDRAWN", "CASE_CLOSED"];
const order = (pw: keyof typeof STATUS_SEED) => STATUS_SEED[pw].map((s, i) => ({ ...s, order: s.sortOrder ?? (i + 1) * 10 }));

test("Au pair is in the enum and the browser's list, with its words everywhere", () => {
  assert.ok((pathway.enumValues as readonly string[]).includes("AU_PAIR"));
  assert.ok((PATHWAYS as readonly string[]).includes("AU_PAIR"));
  assert.equal(PATHWAY_NAME.AU_PAIR, "Au pair");
  assert.equal(PATHWAY_LABEL.AU_PAIR, "Au pair");
  assert.match(PATHWAY_OPTION.AU_PAIR, /^Au pair/);
  assert.equal(pathwayName("AU_PAIR"), "Au pair");
  assert.ok(AIMS.some((a) => a.pathway === "AU_PAIR"), "it can be picked on a student");
  assert.ok(ENUM_FIELDS.preferredPathway?.includes("AU_PAIR"), "and is accepted from the CRM");
  assert.deepEqual(readAim("AU_PAIR"), { pathway: "AU_PAIR", level: null });
  assert.equal(aimOf("AU_PAIR", null), "AU_PAIR");
});

test("DEGREE reads Study abroad wherever people read it, and stays DEGREE underneath", () => {
  assert.equal(PATHWAY_NAME.DEGREE, "Study abroad");
  assert.equal(PATHWAY_LABEL.DEGREE, "Study abroad");
  assert.match(PATHWAY_OPTION.DEGREE, /^Study abroad/);
  assert.equal(pathwayName("DEGREE"), "Study abroad");
  assert.match(aimLabel("DEGREE", null) ?? "", /^Study abroad/);
  assert.match(aimLabel("DEGREE", "PG") ?? "", /^Study abroad: Master's/);
  for (const a of AIMS.filter((x) => x.pathway === "DEGREE")) assert.match(a.label, /^Study abroad/, `${a.value} says Study abroad`);
  assert.ok(isPathway("DEGREE"), "the stored value is unchanged");
});

test("a spreadsheet can name the pathways in words, old and new", () => {
  assert.equal(PATHWAY_IMPORT_ALIASES.degree, "DEGREE", "degree still works");
  assert.equal(PATHWAY_IMPORT_ALIASES["study abroad"], "DEGREE");
  for (const w of ["au pair", "aupair", "au-pair"]) assert.equal(PATHWAY_IMPORT_ALIASES[w], "AU_PAIR", w);
  for (const v of Object.values(PATHWAY_IMPORT_ALIASES)) assert.ok(isPathway(v));
  // Through the import's own reader, in any case.
  for (const typed of ["Au pair", "AUPAIR", "au-pair", "AU_PAIR", "Study abroad", "Degree"]) {
    const p: string[] = [];
    const hit = oneOf(typed, "preferred_pathway", pathway.enumValues, p, PATHWAY_IMPORT_ALIASES);
    assert.equal(hit, /pair/i.test(typed) ? "AU_PAIR" : "DEGREE", typed);
    assert.equal(p.length, 0, typed);
  }
  assert.equal(normalise("preferredPathway", "Au pair"), "AU_PAIR", "the CRM link reads it too");
});

test("the Au pair chain starts new, runs in order and ends with the closing statuses", () => {
  const rows = order("AU_PAIR");
  const codes = rows.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length, "no code twice");
  assert.equal(new Set(rows.map((r) => r.order)).size, rows.length, "no sort order twice");
  for (const c of COMMON) assert.ok(codes.includes(c), c);
  const first = [...rows].sort((a, b) => a.order - b.order)[0];
  assert.equal(first.group, "NEW", "a new application opens at a NEW status");
  const chain = rows.filter((s) => !COMMON.includes(s.code));
  assert.deepEqual(chain.map((s) => s.order), [...chain.map((s) => s.order)].sort((a, b) => a - b), "in order");
  for (const code of ["DOCUMENT_COLLECTION", "AGENCY_PROFILE", "FAMILY_MATCHING", "FAMILY_INTERVIEW", "OFFER_RECEIVED", "CONTRACT_SIGNED", "VISA_FILED", "VISA_RECEIVED", "PRE_DEPARTURE", "JOINED"]) {
    assert.ok(codes.includes(code), code);
  }
  for (const s of rows) if (s.group === "CLOSED") assert.ok(s.requiresReason, `${s.code} asks for a reason`);
  assert.match(read("../src/db/statuses.ts"), /PROVISIONAL\. Au pair/);
});

test("an Au pair student label reused from another list keeps its Malayalam", () => {
  const known = new Map<string, string>();
  for (const pw of ["DEGREE", "AUSBILDUNG", "NURSING", "FSJ", "BFD", "NCLEX", "WEITERBILDUNG", "CCM"] as const) for (const s of STATUS_SEED[pw]) if (s.studentLabelMl) known.set(s.studentLabel, s.studentLabelMl);
  for (const s of STATUS_SEED.AU_PAIR) if (known.has(s.studentLabel)) assert.equal(s.studentLabelMl, known.get(s.studentLabel), s.code);
});

test("the Au pair requirements name real types, and only the plain ones", () => {
  const types = new Set([...DOCUMENT_TYPES, ...DOCUMENTATION_TYPES, ...FSJ_DOCUMENT_TYPES].map((t) => t.code));
  for (const r of AU_PAIR_REQUIREMENTS) {
    assert.ok(types.has(r.typeCode), `${r.typeCode} is a document type`);
    assert.equal(r.pathway, "AU_PAIR");
  }
  assert.ok(AU_PAIR_REQUIREMENTS.some((r) => r.typeCode === "CV" && r.required !== false), "a CV is asked for");
  assert.ok(AU_PAIR_REQUIREMENTS.some((r) => r.typeCode === "GERMAN_CERTIFICATE" && r.required === false), "a language certificate is optional");
});

test("the migration only adds the enum value, safely", () => {
  const sqlText = read("../drizzle/0089_au_pair.sql");
  assert.ok(sqlText.includes(`ALTER TYPE "public"."pathway" ADD VALUE IF NOT EXISTS 'AU_PAIR'`));
  assert.ok(!/INSERT|UPDATE|DELETE/i.test(sqlText.replace(/^--.*$/gm, "")), "no row uses the value in the transaction that adds it");
  const journal = JSON.parse(read("../drizzle/meta/_journal.json")) as { entries: { idx: number; when: number; tag: string }[] };
  const mine = journal.entries.find((e) => e.tag === "0089_au_pair");
  const before = journal.entries.find((e) => e.tag === "0088_new_pathways");
  assert.ok(mine && before && mine.when > before.when && mine.idx === before.idx + 1, "the journal lists it after 0088");
});

test("the deploy SQL seeds every Au pair status and requirement and changes nothing already there", () => {
  const sqlText = read("../deploy/au-pair-pathway.sql");
  for (const pw of AU_PAIR_PATHWAYS) for (const s of STATUS_SEED[pw]) assert.ok(sqlText.includes(`'${pw}', '${s.code}'`), `${pw} ${s.code} is in the SQL`);
  for (const r of AU_PAIR_REQUIREMENTS) assert.ok(sqlText.includes(`'${r.stage}', '${r.typeCode}', 'ALWAYS', '${r.pathway}'`), `${r.typeCode} is in the SQL`);
  const lines = sqlText.split("\n");
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO status_definitions")).every((l) => l.endsWith("ON CONFLICT (pathway, code) DO NOTHING;")));
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO document_types")).every((l) => l.endsWith("ON CONFLICT (code) DO NOTHING;")));
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO document_requirements")).every((l) => l.includes("WHERE NOT EXISTS")));
  assert.ok(!/DO UPDATE|^UPDATE|^DELETE/m.test(sqlText), "nothing is overwritten or removed");
  assert.ok(sqlText.indexOf("BEGIN;") < sqlText.indexOf("INSERT") && sqlText.lastIndexOf("INSERT") < sqlText.indexOf("COMMIT;"), "in one transaction");
  assert.match(sqlText, /AU_PAIR statuses/, "and says what is there afterwards");
});

test("no long dashes in what this change writes", () => {
  for (const f of ["../src/lib/pathways.ts", "../src/db/statuses.ts", "../src/db/documentation-seed.ts", "../scripts/au-pair-sql.ts", "../deploy/au-pair-pathway.sql", "../drizzle/0089_au_pair.sql", "../src/lib/aims.ts"]) {
    assert.ok(!read(f).includes("\u2014"), `${f} has no em dash`);
  }
});
