import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUSBILDUNG_DEPARTMENTS,
  AUSBILDUNG_PAYMENT_MILESTONES,
  AUSBILDUNG_STEPS,
  AUSBILDUNG_TEAM,
  departmentOfStatus,
  milestoneDueAt,
  paymentMilestones,
  percentPaid,
  stepOfStatus,
  tatStanding,
  tatText,
} from "../src/lib/ausbildung";
import { DOCUMENT_TYPES, STATUS_SEED } from "../src/db/statuses";
import { DOCUMENTATION_TYPES, STAGE_REQUIREMENTS } from "../src/db/documentation-seed";

const ausbildung = STATUS_SEED.AUSBILDUNG;
const codes = ausbildung.map((s) => s.code);
const day = 86_400_000;

test("the Ausbildung chain keeps the codes applications already point at", () => {
  for (const code of ["LANGUAGE_PENDING", "PROFILE_CV", "EMPLOYER_MATCHING", "EMPLOYER_INTERVIEW", "CONTRACT_SIGNED", "RECOGNITION", "VISA_FILED", "VISA_RECEIVED", "JOINED"]) {
    assert.ok(codes.includes(code), `${code} is still in the chain`);
  }
  assert.equal(new Set(codes).size, codes.length, "no code is listed twice");
});

test("the Ausbildung chain records every step the written process names", () => {
  for (const code of [
    "DOCUMENT_COLLECTION",
    "MENTOR_ASSIGNED",
    "DOCUMENT_PREPARATION",
    "LANGUAGE_ASSESSMENT",
    "MOCK_INTERVIEW_PASSED",
    "PROFILE_SUBMITTED",
    "EMPLOYER_SHORTLISTED",
    "PRE_VISA_DOCUMENTS",
    "VISA_PROCESSING",
    "PRE_DEPARTURE",
    "HAPPY_CALL",
  ]) {
    assert.ok(codes.includes(code), `${code} is in the chain`);
  }
});

test("the chain is ordered: explicit numbers rise, and the common statuses fall where the seed puts them", () => {
  const explicit = ausbildung.filter((s) => s.sortOrder != null).map((s) => s.sortOrder!);
  for (let i = 1; i < explicit.length; i++) assert.ok(explicit[i] > explicit[i - 1], `${explicit[i]} follows ${explicit[i - 1]}`);
  assert.equal(new Set(explicit).size, explicit.length, "no two statuses share a number");
  // The seed numbers a row without a number by its position, so the common
  // rows must sit where that number keeps the order: pending from partner
  // second (20), on hold and closed after the last numbered row.
  const seeded = ausbildung.map((s, i) => ({ code: s.code, order: s.sortOrder ?? (i + 1) * 10, group: s.group }));
  assert.equal(seeded.find((s) => s.code === "PENDING_PARTNER")?.order, 20);
  const lastNumbered = Math.max(...explicit);
  for (const s of seeded.filter((x) => x.group === "HOLD" || x.group === "CLOSED")) assert.ok(s.order > lastNumbered, `${s.code} comes after the chain`);
  // A new application starts at the first NEW status, which stays the German level.
  const firstNew = seeded.filter((s) => s.group === "NEW").sort((a, b) => a.order - b.order)[0];
  assert.equal(firstNew.code, "LANGUAGE_PENDING");
});

test("every status in the chain has a desk, except hold and closed, and every step's codes exist", () => {
  const placed = new Set(AUSBILDUNG_STEPS.flatMap((s) => s.statusCodes));
  for (const s of ausbildung) {
    if (s.code === "PENDING_PARTNER" || s.group === "HOLD" || s.group === "CLOSED") continue;
    assert.ok(placed.has(s.code), `${s.code} is placed on a step`);
  }
  for (const code of placed) assert.ok(codes.includes(code), `${code} on a step is a real status`);
  // Steps run in the guide's order and each desk's label is known.
  const numbers = AUSBILDUNG_STEPS.map((s) => s.step);
  for (let i = 1; i < numbers.length; i++) assert.ok(numbers[i] > numbers[i - 1]);
  const desks = new Set(AUSBILDUNG_DEPARTMENTS.map((d) => d.key));
  for (const s of AUSBILDUNG_STEPS) assert.ok(desks.has(s.department));
});

test("a status is read back to its step and desk", () => {
  assert.equal(stepOfStatus("MENTOR_ASSIGNED")?.step, 4);
  assert.equal(departmentOfStatus("MENTOR_ASSIGNED"), "DOCUMENTATION");
  assert.equal(departmentOfStatus("MOCK_INTERVIEW_PASSED"), "LANGUAGE");
  assert.equal(departmentOfStatus("EMPLOYER_INTERVIEW"), "PLACEMENT");
  assert.equal(departmentOfStatus("VISA_PROCESSING"), "VISA");
  assert.equal(departmentOfStatus("HAPPY_CALL"), "TRAVEL");
  assert.equal(departmentOfStatus("ON_HOLD_INTAKE"), null);
  assert.equal(departmentOfStatus(null), null);
});

test("the turnaround is measured in days and only a numbered one can be over", () => {
  const now = new Date("2026-10-25T09:00:00Z");
  const nineDaysAgo = new Date(now.getTime() - 9 * day);
  const late = tatStanding("DOCUMENT_PREPARATION", nineDaysAgo, now);
  assert.equal(late.tatDays, 7);
  assert.equal(late.days, 9);
  assert.equal(late.over, true);
  const fine = tatStanding("DOCUMENT_PREPARATION", new Date(now.getTime() - 7 * day), now);
  assert.equal(fine.over, false, "T+7 means seven days are allowed");
  const depends = tatStanding("LANGUAGE_PENDING", new Date(now.getTime() - 400 * day), now);
  assert.equal(depends.tatDays, null);
  assert.equal(depends.over, false, "a turnaround that depends on the level is never late");
  const unknown = tatStanding("DEFERRED", nineDaysAgo, now);
  assert.equal(unknown.step, null);
  assert.equal(unknown.over, false);
  assert.equal(tatStanding("MENTOR_ASSIGNED", null, now).days, null);
});

test("the turnaround reads as the guide writes it", () => {
  assert.equal(tatText(stepOfStatus("DOCUMENT_COLLECTION")), "T+7");
  assert.equal(tatText(stepOfStatus("MENTOR_ASSIGNED")), "Same day");
  assert.equal(tatText(stepOfStatus("EMPLOYER_INTERVIEW")), "T+30 (first interview within 7 days)");
  assert.equal(tatText(stepOfStatus("VISA_FILED")), "Depends on slot availability, roughly 1 to 2 weeks");
  assert.equal(tatText(null), "");
});

test("payment milestones follow the guide: half, then 80 percent, then all of it", () => {
  assert.deepEqual(AUSBILDUNG_PAYMENT_MILESTONES.map((m) => m.percent), [null, 50, 80, 100]);
  const rows = paymentMilestones(50_000, 20_000);
  assert.equal(rows[0].amount, null, "the registration fee has no figure in the guide");
  assert.equal(rows[1].amount, 25_000);
  assert.equal(rows[1].met, false);
  assert.equal(rows[2].amount, 40_000);
  assert.equal(rows[3].amount, 50_000);
  const paid = paymentMilestones(50_000, 40_000);
  assert.equal(paid[1].met, true);
  assert.equal(paid[2].met, true);
  assert.equal(paid[3].met, false);
  // Nothing raised: nothing to measure against, nothing met.
  for (const m of paymentMilestones(0, 0)) {
    assert.equal(m.amount, null);
    assert.equal(m.met, false);
  }
  assert.equal(percentPaid(50_000, 20_000), 40);
  assert.equal(percentPaid(0, 0), null);
  assert.equal(percentPaid(50_000, 60_000), 100);
});

test("the milestone due by a status is the latest one at or before its step", () => {
  assert.equal(milestoneDueAt("LANGUAGE_PENDING"), null);
  assert.equal(milestoneDueAt("DOCUMENT_PREPARATION"), null);
  assert.equal(milestoneDueAt("LANGUAGE_ASSESSMENT")?.percent, 50);
  assert.equal(milestoneDueAt("EMPLOYER_INTERVIEW")?.percent, 50);
  assert.equal(milestoneDueAt("CONTRACT_SIGNED")?.percent, 80);
  assert.equal(milestoneDueAt("PRE_VISA_DOCUMENTS")?.percent, 100);
  assert.equal(milestoneDueAt("HAPPY_CALL")?.percent, 100);
  assert.equal(milestoneDueAt("WITHDRAWN"), null);
});

test("every stage requirement names a document type that exists, and the guide's documents are on the Ausbildung list", () => {
  const types = new Set([...DOCUMENT_TYPES, ...DOCUMENTATION_TYPES].map((t) => t.code));
  assert.equal(types.size, DOCUMENT_TYPES.length + DOCUMENTATION_TYPES.length, "no document type code is defined twice");
  for (const r of STAGE_REQUIREMENTS) assert.ok(types.has(r.typeCode), `${r.typeCode} is a document type`);
  const ausb = STAGE_REQUIREMENTS.filter((r) => r.pathway === "AUSBILDUNG");
  const byType = new Map(ausb.map((r) => [r.typeCode, r]));
  assert.equal(byType.size, ausb.length, "a document is asked for once on the Ausbildung journey");
  const expected: Record<string, string> = {
    CONSULTANCY_AGREEMENT: "PROFILE",
    AADHAAR_PAN: "PROFILE",
    GERMAN_CV: "APPLICATION",
    TRANSLATED_CERTIFICATES: "APPLICATION",
    NOTARISED_CERTIFICATES: "APPLICATION",
    SELF_INTRO_VIDEO: "APPLICATION",
    JOB_CONSENT: "APPLICATION",
    TRAINING_CONTRACT: "OFFER",
    SCHOOL_CONTRACT: "OFFER",
    EZB: "OFFER",
    LANGUAGE_CONFIRMATION: "OFFER",
    VACCINATION_CERTIFICATE: "OFFER",
    POLICE_CLEARANCE: "OFFER",
    ACCOMMODATION: "VISA",
    INSURANCE: "VISA",
    BIOMETRIC_PHOTO: "VISA",
    LEGAL_REPRESENTATION_FORM: "VISA",
    COVER_LETTER: "VISA",
    ANNEX_EMPLOYMENT_DATA: "VISA",
    ZAV: "VISA",
    FAST_TRACK_FORM: "VISA",
    TESTIMONIAL: "DEPARTURE",
  };
  for (const [code, stage] of Object.entries(expected)) assert.equal(byType.get(code)?.stage, stage, `${code} is asked for at ${stage}`);
  // What the employer sends is Medcity's to chase, not the student's.
  for (const code of ["GERMAN_CV", "TRANSLATED_CERTIFICATES", "SCHOOL_CONTRACT", "EZB", "LANGUAGE_CONFIRMATION", "ACCOMMODATION", "ZAV", "ANNEX_EMPLOYMENT_DATA", "COVER_LETTER"]) {
    assert.equal(byType.get(code)?.owedBy, "MEDCITY", `${code} is owed by Medcity`);
  }
  // New types carry no Malayalam rather than an invented one.
  for (const t of DOCUMENTATION_TYPES.filter((x) => x.code in expected && !["TRAINING_CONTRACT", "ACCOMMODATION", "INSURANCE", "POLICE_CLEARANCE"].includes(x.code))) {
    assert.equal(t.labelMl, null, `${t.code} has no Malayalam yet`);
  }
});

test("the deploy SQL carries every status, requirement and address the seed does", () => {
  const sqlText = readFileSync(new URL("../deploy/ausbildung-process.sql", import.meta.url), "utf8");
  for (const code of codes) assert.ok(sqlText.includes(`'AUSBILDUNG', '${code}'`), `status ${code} is in the SQL`);
  for (const r of STAGE_REQUIREMENTS.filter((x) => x.pathway === "AUSBILDUNG")) {
    assert.ok(sqlText.includes(`'${r.stage}', '${r.typeCode}', 'ALWAYS'`), `requirement ${r.typeCode} at ${r.stage} is in the SQL`);
  }
  for (const t of DOCUMENTATION_TYPES) assert.ok(sqlText.includes(`VALUES ('${t.code}'`), `document type ${t.code} is in the SQL`);
  for (const c of AUSBILDUNG_TEAM) assert.ok(sqlText.includes(`'${c.email}'`), `${c.email} is in the SQL`);
  assert.ok(!/ON CONFLICT \(pathway, code\) DO UPDATE/.test(sqlText), "an existing status is never overwritten");
});
