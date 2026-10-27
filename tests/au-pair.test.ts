import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathway } from "../src/db/schema";
import { DOCUMENT_TYPES, STATUS_SEED } from "../src/db/statuses";
import { AU_PAIR_DOCUMENT_TYPES, AU_PAIR_PROVISIONAL_REQUIREMENTS, AU_PAIR_REQUIREMENTS, DOCUMENTATION_TYPES, FSJ_DOCUMENT_TYPES, STAGE_REQUIREMENTS } from "../src/db/documentation-seed";
import {
  AU_PAIR_CHECKLISTS,
  AU_PAIR_HANDOVERS,
  AU_PAIR_PRE_VISA,
  AU_PAIR_PROFILE_DOCUMENTS,
  AU_PAIR_RETIRED,
  AU_PAIR_STAGES,
  AU_PAIR_STEPS,
  AU_PAIR_STUDENT_STEP,
  AU_PAIR_TEAM,
  AU_PAIR_TEAMS,
  afterAuPairChecklist,
  afterOutcome,
  afterVisaDecision,
  auPairChecklistOpen,
  auPairDetailsMissing,
  auPairHandoverCheck,
  auPairPastBranch,
  auPairStepOf,
  auPairTeamOf,
  auPairVisaGate,
  auPairVisaGateText,
  contractCheck,
  crossesAuPairVisaGate,
  familyRefusal,
  listMissing,
  mayDoAuPair,
  mergeAuPairChecklist,
  outcomeCheck,
  pickAuPairApplication,
  platformText,
  profileCheck,
  registrationDraft,
  registrationNoticeText,
} from "../src/lib/au-pair";
import { fsjStepOf } from "../src/lib/fsj";
import { PATHWAYS, PATHWAY_IMPORT_ALIASES, PATHWAY_NAME, PATHWAY_OPTION, isPathway, pathwayName } from "../src/lib/pathways";
import { PATHWAY_LABEL } from "../src/lib/catalogue";
import { AIMS, aimLabel, aimOf, readAim } from "../src/lib/aims";
import { ENUM_FIELDS, normalise } from "../src/lib/crm-link";
import { oneOf } from "../src/lib/import-values";

/**
 * Au pair as a pathway of its own, and the DEGREE pathway read as "Study
 * abroad": registered everywhere a pathway is. Then the written Au pair
 * process (src/lib/au-pair.ts): its 15 steps and teams, the decisions, the
 * gate before the visa appointment, the documents, and the deploy SQL that
 * replaces the provisional list of 1.8.7.
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
  assert.equal(first.code, "ASSESSMENT", "a new application opens at the enquiry");
  assert.equal(first.group, "NEW");
  const chain = rows.filter((s) => !COMMON.includes(s.code));
  assert.deepEqual(chain.map((s) => s.order), [...chain.map((s) => s.order)].sort((a, b) => a - b), "in order");
  // Below 140, where the closing statuses sit on a database that loaded the provisional list.
  for (const s of chain) assert.ok(s.order < 140, `${s.code} sorts before the closing statuses`);
  for (const s of rows) if (s.group === "CLOSED") assert.ok(s.requiresReason, `${s.code} asks for a reason`);
  assert.ok(!/PROVISIONAL\. Au pair/.test(read("../src/db/statuses.ts")), "no longer provisional");
});

test("the 15 steps are the guide's, in its five stages, each with its team, and every status sits on one", () => {
  assert.deepEqual(AU_PAIR_STEPS.map((s) => s.step), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(AU_PAIR_STAGES.length, 5);
  assert.deepEqual(AU_PAIR_TEAMS.map((t) => t.key), ["BRANCH", "DOCUMENTATION", "MENTOR", "PLACEMENT", "VISA", "TRAVEL"]);
  const team = (n: number) => AU_PAIR_STEPS[n - 1].team;
  assert.deepEqual([1, 2, 3].map(team), ["BRANCH", "BRANCH", "BRANCH"]);
  assert.equal(team(4), "DOCUMENTATION");
  assert.deepEqual([5, 6].map(team), ["MENTOR", "MENTOR"]);
  assert.deepEqual([7, 8].map(team), ["PLACEMENT", "PLACEMENT"]);
  assert.deepEqual([9, 10, 11, 12].map(team), ["VISA", "VISA", "VISA", "VISA"]);
  assert.deepEqual([13, 14, 15].map(team), ["TRAVEL", "TRAVEL", "TRAVEL"]);
  assert.deepEqual(AU_PAIR_STEPS.map((s) => s.stage), [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5]);
  const seeded = new Set(STATUS_SEED.AU_PAIR.map((s) => s.code));
  for (const s of AU_PAIR_STEPS) {
    assert.ok(s.statusCodes.length > 0, `step ${s.step} has a status`);
    for (const c of s.statusCodes) assert.ok(seeded.has(c), `${c} (step ${s.step}) is seeded`);
  }
  for (const s of STATUS_SEED.AU_PAIR.filter((x) => !COMMON.includes(x.code))) assert.ok(auPairStepOf(s.code), `${s.code} is on a step`);
  assert.equal(auPairStepOf("VISA_REJECTED"), null, "closing statuses are not steps");
  assert.equal(auPairTeamOf("HOST_FAMILY_FOUND"), "MENTOR");
  // The steps' statuses keep the guide's order.
  const sortOf = new Map(order("AU_PAIR").map((s) => [s.code, s.order]));
  const flat = AU_PAIR_STEPS.flatMap((s) => s.statusCodes.map((c) => sortOf.get(c)!));
  assert.deepEqual(flat, [...flat].sort((a, b) => a - b));
});

test("the student reads a plain line for every step, and the card follows the live Au pair round", () => {
  for (const s of AU_PAIR_STEPS) assert.ok(AU_PAIR_STUDENT_STEP[s.step], `step ${s.step} has a student line`);
  for (const line of Object.values(AU_PAIR_STUDENT_STEP)) assert.ok(!/aupair@|desk|placement team|visa team|travel desk/i.test(line), `"${line}" names nothing internal`);
  for (const s of STATUS_SEED.AU_PAIR) assert.ok(!/mentor to be assigned|placement team/i.test(s.studentLabel), `${s.code}: the student label is plain`);
  const apps = [
    { pathway: "FSJ", statusGroup: "NEW", changedAt: "2026-05-05" },
    { pathway: "AU_PAIR", statusGroup: "CLOSED", changedAt: "2026-05-03" },
    { pathway: "AU_PAIR", statusGroup: "SUCCESS", changedAt: "2026-05-04" },
    { pathway: "AU_PAIR", statusGroup: "IN_PROGRESS", changedAt: "2026-04-01" },
  ];
  assert.equal(pickAuPairApplication(apps), apps[3]);
  assert.equal(pickAuPairApplication(apps.slice(0, 3)), apps[2]);
  assert.equal(pickAuPairApplication(apps.slice(0, 2)), null);
});

test("an Au pair student label reused from another list keeps its Malayalam", () => {
  const known = new Map<string, string>();
  for (const pw of ["DEGREE", "AUSBILDUNG", "NURSING", "FSJ", "BFD", "NCLEX", "WEITERBILDUNG", "CCM"] as const) for (const s of STATUS_SEED[pw]) if (s.studentLabelMl) known.set(s.studentLabel, s.studentLabelMl);
  for (const s of STATUS_SEED.AU_PAIR) if (known.has(s.studentLabel)) assert.equal(s.studentLabelMl, known.get(s.studentLabel), s.code);
  for (const s of STATUS_SEED.AU_PAIR) if (s.studentLabelMl) assert.ok(known.has(s.studentLabel), `${s.code}: no Malayalam guessed`);
});

test("each team records its own steps, and only those", () => {
  const counsellor = "COUNSELLOR";
  const desk = "DOCUMENTATION";
  const travel = "APPLICATION_TEAM_LEADER";
  assert.ok(mayDoAuPair("registration", counsellor));
  assert.ok(!mayDoAuPair("registration", desk));
  assert.ok(mayDoAuPair("mentor", desk) && !mayDoAuPair("mentor", counsellor));
  for (const op of ["mock", "profile", "hostFamily", "interview", "outcome", "contract", "appointment", "visaDecision"] as const) {
    assert.ok(mayDoAuPair(op, desk), `${op}: the desk`);
    assert.ok(!mayDoAuPair(op, counsellor), `${op}: not the branch`);
  }
  assert.ok(mayDoAuPair("payments", counsellor) && !mayDoAuPair("payments", desk), "payments are verified by whoever takes fees");
  assert.ok(mayDoAuPair("departure", travel) && !mayDoAuPair("departure", desk.replace("DOCUMENTATION", "COUNSELLOR")));
  assert.ok(mayDoAuPair("handover", counsellor, { code: "DOCUMENT_COLLECTION" }));
  assert.ok(!mayDoAuPair("handover", desk.replace("DOCUMENTATION", "COUNSELLOR"), { code: "CONTRACT_SIGNED" }));
  assert.ok(mayDoAuPair("handover", desk, { code: "CONTRACT_SIGNED" }));
  assert.ok(!mayDoAuPair("handover", desk, { code: "INTERVIEW_PREPARATION" }), "no hand-over from there");
  assert.ok(mayDoAuPair("checklist", travel, { checklistStep: 15 }));
  assert.ok(!mayDoAuPair("checklist", counsellor, { checklistStep: 13 }));
  for (const op of ["counselling", "mentor", "contract", "departure"] as const) assert.ok(mayDoAuPair(op, "SUPER_ADMIN"), `${op}: the admins`);
});

test("the hand-overs follow the guide, and each waits on what it hands on", () => {
  assert.deepEqual(
    AU_PAIR_HANDOVERS.map((h) => [h.fromCode, h.to, h.toCode]),
    [
      ["DOCUMENT_COLLECTION", "DOCUMENTATION", "MENTOR_ASSIGNMENT"],
      ["HOST_FAMILY_FOUND", "PLACEMENT", "FAMILY_INTERVIEW"],
      ["CONTRACT_SIGNED", "VISA", "PRE_VISA_DOCUMENTS"],
      ["VISA_RECEIVED", "TRAVEL", "PRE_DEPARTURE"],
    ],
  );
  for (const h of AU_PAIR_HANDOVERS) assert.equal(auPairStepOf(h.fromCode)?.handoverTo, h.to, `${h.fromCode} hands to ${h.to}`);
  const none = { hostFamily: null, contractSignedOn: null, joiningOn: null };
  assert.equal(auPairHandoverCheck("DOCUMENT_COLLECTION", none).ok, true, "the documents are checked on the server");
  assert.equal(auPairHandoverCheck("HOST_FAMILY_FOUND", none).ok, false);
  assert.equal(auPairHandoverCheck("HOST_FAMILY_FOUND", { ...none, hostFamily: "Familie Weber" }).ok, true);
  assert.equal(auPairHandoverCheck("CONTRACT_SIGNED", none).ok, false);
  assert.equal(auPairHandoverCheck("CONTRACT_SIGNED", { ...none, contractSignedOn: "2026-07-01" }).ok, true);
  assert.equal(auPairHandoverCheck("VISA_RECEIVED", none).ok, false);
  assert.equal(auPairHandoverCheck("VISA_RECEIVED", { ...none, joiningOn: "2026-09-01" }).ok, true);
  assert.equal(auPairHandoverCheck("FAMILY_INTERVIEW", none).ok, false);
  assert.equal(auPairPastBranch("DOCUMENT_COLLECTION"), false);
  assert.equal(auPairPastBranch("MENTOR_ASSIGNMENT"), true);
  assert.equal(auPairPastBranch("HAPPY_CALL"), true);
  assert.equal(auPairPastBranch("ON_HOLD_INTAKE"), false);
  const all = { medcityId: "MC-1", email: "a@b.c", germanLevel: "A2", counsellor: "u1", registrationFeePaidOn: "2026-01-01", agreementSignedOn: "2026-01-01" };
  assert.deepEqual(auPairDetailsMissing(all), []);
  assert.deepEqual(auPairDetailsMissing({ ...all, germanLevel: null, agreementSignedOn: null }), ["German level (the German record or a German test)", "signed consultancy agreement and declaration"]);
});

test("the profile goes out after a ready mock interview and with consent; a family that declined is not offered again", () => {
  assert.equal(profileCheck({ code: "INTERVIEW_PREPARATION", lastMock: null, consentOn: "2026-05-01" }).ok, false);
  assert.equal(profileCheck({ code: "INTERVIEW_PREPARATION", lastMock: "NEEDS_WORK", consentOn: "2026-05-01" }).ok, false);
  const noConsent = profileCheck({ code: "INTERVIEW_PREPARATION", lastMock: "READY", consentOn: null });
  assert.ok(!noConsent.ok && noConsent.field === "consentOn");
  assert.equal(profileCheck({ code: "INTERVIEW_PREPARATION", lastMock: "READY", consentOn: "2026-05-01" }).ok, true);
  assert.equal(profileCheck({ code: "PROFILE_SUBMITTED", lastMock: "READY", consentOn: "2026-05-01" }).ok, false);
  assert.deepEqual(platformText("AuPair.com", null), { ok: true, text: "AuPair.com" });
  assert.deepEqual(platformText("Au-pair Vermittlung", "x"), { ok: true, text: "Au-pair Vermittlung" });
  assert.deepEqual(platformText("Other", " Facebook group "), { ok: true, text: "Other: Facebook group" });
  assert.equal(platformText("Other", "").ok, false);
  assert.equal(platformText("Somewhere", null).ok, false);
  assert.match(familyRefusal(" familie weber ", ["Familie Weber"]) ?? "", /did not select/);
  assert.equal(familyRefusal("Familie Schmidt", ["Familie Weber"]), null);
});

test("the interview outcome: selected goes to the contract, not selected back to interview preparation", () => {
  assert.equal(afterOutcome("SELECTED"), "OFFER_RECEIVED");
  assert.equal(afterOutcome("NOT_SELECTED"), "INTERVIEW_PREPARATION");
  assert.equal(auPairStepOf(afterOutcome("SELECTED"))?.step, 8);
  assert.equal(auPairStepOf(afterOutcome("NOT_SELECTED"))?.step, 5);
  assert.equal(outcomeCheck({ code: "FAMILY_INTERVIEW", interviewAt: null }).ok, false, "schedule first");
  assert.equal(outcomeCheck({ code: "FAMILY_INTERVIEW", interviewAt: "2026-06-01T10:00:00Z" }).ok, true);
  assert.equal(outcomeCheck({ code: "OFFER_RECEIVED", interviewAt: "2026-06-01T10:00:00Z" }).ok, false);
});

test("the contract records pocket money, hours and duration, and is signed only with them", () => {
  assert.deepEqual(contractCheck({ pocketMoney: 280, weeklyHours: 30, durationMonths: 12, signedOn: null }), { ok: true, code: "OFFER_RECEIVED" });
  assert.deepEqual(contractCheck({ pocketMoney: 280, weeklyHours: 30, durationMonths: 12, signedOn: "2026-07-01" }), { ok: true, code: "CONTRACT_SIGNED" });
  const unsigned = contractCheck({ pocketMoney: 280, weeklyHours: null, durationMonths: 12, signedOn: "2026-07-01" });
  assert.ok(!unsigned.ok && unsigned.field === "weeklyHours");
  const hours = contractCheck({ pocketMoney: 280, weeklyHours: 90, durationMonths: 12, signedOn: null });
  assert.ok(!hours.ok && hours.field === "weeklyHours");
  const money = contractCheck({ pocketMoney: Number.NaN, weeklyHours: 30, durationMonths: 12, signedOn: null });
  assert.ok(!money.ok && money.field === "pocketMoney");
  assert.ok(!contractCheck({ pocketMoney: 280, weeklyHours: 30, durationMonths: 0, signedOn: null }).ok);
});

test("the gate before the visa appointment: payments verified, contract signed, pre-visa documents in", () => {
  const facts = { paymentsVerifiedOn: null, contractSignedOn: null, documentsMissing: ["Cover letter"] };
  assert.deepEqual(auPairVisaGate(facts).missing, ["payment verification", "signed host family contract", "Cover letter"]);
  assert.match(auPairVisaGateText(facts), /as per company policy/);
  assert.equal(auPairVisaGate({ paymentsVerifiedOn: "2026-07-05", contractSignedOn: "2026-07-01", documentsMissing: [] }).clear, true);
  assert.equal(crossesAuPairVisaGate("PRE_VISA_DOCUMENTS", "VISA_APPOINTMENT"), true);
  assert.equal(crossesAuPairVisaGate("CONTRACT_SIGNED", "VISA_RECEIVED"), true);
  assert.equal(crossesAuPairVisaGate("ON_HOLD_INTAKE", "VISA_PROCESSING"), true, "from a held file too");
  assert.equal(crossesAuPairVisaGate("VISA_APPOINTMENT", "VISA_PROCESSING"), false, "not again inside the visa stage");
  assert.equal(crossesAuPairVisaGate("VISA_RECEIVED", "PRE_DEPARTURE"), false);
  assert.equal(crossesAuPairVisaGate("CONTRACT_SIGNED", "PRE_VISA_DOCUMENTS"), false);
  assert.equal(crossesAuPairVisaGate("VISA_PROCESSING", "INTERVIEW_PREPARATION"), false);
});

test("the visa decision: approved to the travel desk's hand-over; refused back to placement, again, or closed", () => {
  assert.deepEqual(afterVisaDecision({ outcome: "APPROVED", reason: null, afterRefusal: null }), { ok: true, code: "VISA_RECEIVED" });
  const noReason = afterVisaDecision({ outcome: "REJECTED", reason: " ", afterRefusal: "CLOSE" });
  assert.ok(!noReason.ok && noReason.field === "reason");
  const noNext = afterVisaDecision({ outcome: "REJECTED", reason: "Funds", afterRefusal: null });
  assert.ok(!noNext.ok && noNext.field === "afterRefusal");
  assert.deepEqual(afterVisaDecision({ outcome: "REJECTED", reason: "Funds", afterRefusal: "ANOTHER_FAMILY" }), { ok: true, code: "INTERVIEW_PREPARATION" });
  assert.deepEqual(afterVisaDecision({ outcome: "REJECTED", reason: "Funds", afterRefusal: "RESUBMIT" }), { ok: true, code: "PRE_VISA_DOCUMENTS" });
  assert.deepEqual(afterVisaDecision({ outcome: "REJECTED", reason: "Funds", afterRefusal: "CLOSE" }), { ok: true, code: "VISA_REJECTED" });
  assert.equal(STATUS_SEED.AU_PAIR.find((s) => s.code === "VISA_REJECTED")?.requiresReason, true);
});

test("the checklists open at their step, keep other steps' ticks, and the happy call starts the follow-up", () => {
  assert.equal(auPairChecklistOpen(13, "VISA_RECEIVED"), false);
  assert.equal(auPairChecklistOpen(13, "PRE_DEPARTURE"), true);
  assert.equal(auPairChecklistOpen(14, "PRE_DEPARTURE"), true, "the departure list is prepared beforehand");
  assert.equal(auPairChecklistOpen(15, "JOINED"), true);
  assert.equal(auPairChecklistOpen(15, "PRE_DEPARTURE"), false);
  assert.equal(auPairChecklistOpen(4, "HAPPY_CALL"), false, "no list for step 4");
  assert.deepEqual(mergeAuPairChecklist(["ap1.refund", "ap13.flight"], 13, ["ap13.orientation", "nonsense"]), ["ap1.refund", "ap13.orientation"]);
  assert.equal(afterAuPairChecklist(15, "JOINED", ["ap15.happyCall"]), "HAPPY_CALL");
  assert.equal(afterAuPairChecklist(15, "JOINED", ["ap15.safe"]), null);
  assert.equal(afterAuPairChecklist(15, "HAPPY_CALL", ["ap15.happyCall"]), null);
  const keys = Object.values(AU_PAIR_CHECKLISTS).flat().map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "no key twice");
  assert.ok(AU_PAIR_CHECKLISTS[15].some((i) => /testimonial/i.test(i.label)) && AU_PAIR_CHECKLISTS[15].some((i) => /references/i.test(i.label)));
});

test("the registration email goes to aupair@miak.in, and the portal only drafts it", () => {
  assert.deepEqual(AU_PAIR_TEAM.map((t) => t.email), ["aupair@miak.in"]);
  const d = registrationDraft(
    { student: "Anu Mathew", medcityId: "MC-KTM-26-0007", email: null, phone: null, germanLevel: "A2", branch: "Medcity Kottayam", counsellor: "Sample", registeredOn: "01-02-2026", registrationFeePaidOn: null, agreementSignedOn: "02-02-2026", intake: "Sep 2026" },
    { to: ["aupair@miak.in"], cc: [] },
  );
  assert.match(d.text, /^To: aupair@miak\.in\nCc: None\nSubject: Au pair registration: Anu Mathew \(MC-KTM-26-0007\)/);
  assert.match(d.body, /Email: Not recorded/);
  assert.match(d.body, /German level: A2/);
  const notice = registrationNoticeText(["aupair@miak.in"], ["head@branch.test"], []);
  assert.match(notice, /counsellor \/ branch team to send/);
  assert.match(notice, /To: aupair@miak\.in/);
  assert.match(notice, /does not send it/);
  assert.match(registrationNoticeText([], [], ["the branch head"]), /No email on record for the branch head/);
});

test("the guide's two document lists name real types, and the requirements ask for them", () => {
  const types = new Set([...DOCUMENT_TYPES, ...DOCUMENTATION_TYPES, ...FSJ_DOCUMENT_TYPES, ...AU_PAIR_DOCUMENT_TYPES].map((t) => t.code));
  assert.equal(types.size, DOCUMENT_TYPES.length + DOCUMENTATION_TYPES.length + FSJ_DOCUMENT_TYPES.length + AU_PAIR_DOCUMENT_TYPES.length, "no type defined twice");
  const asked = new Set([...STAGE_REQUIREMENTS.filter((r) => !r.pathway && !r.country), ...AU_PAIR_REQUIREMENTS].map((r) => r.typeCode));
  for (const list of [AU_PAIR_PROFILE_DOCUMENTS, AU_PAIR_PRE_VISA]) for (const item of list) for (const code of item.typeCodes) {
    assert.ok(types.has(code), `${code} is a document type`);
    assert.ok(asked.has(code), `${item.item} (${code}) is asked of an Au pair file`);
  }
  assert.equal(AU_PAIR_PROFILE_DOCUMENTS.length, 8, "step 3 lists eight");
  assert.equal(AU_PAIR_PRE_VISA.length, 18, "step 9 lists eighteen typed items, the nineteenth is Other");
  for (const r of AU_PAIR_REQUIREMENTS) {
    assert.equal(r.pathway, "AU_PAIR");
    // A requirement on the same stage as a list item agrees with it about being optional.
    const list = r.stage === "PROFILE" ? AU_PAIR_PROFILE_DOCUMENTS : AU_PAIR_PRE_VISA;
    const item = list.find((l) => l.typeCodes.includes(r.typeCode));
    if (item && item.typeCodes.length === 1) assert.equal(r.required !== false, item.required, `${r.typeCode} optional as the guide says`);
  }
  const optional = (code: string) => AU_PAIR_REQUIREMENTS.find((r) => r.typeCode === code)?.required === false;
  for (const code of ["CHILDCARE_EXPERIENCE", "DEGREE_CERTIFICATE", "DIPLOMA_CERTIFICATE", "ANNEX_EMPLOYMENT_DATA", "AADHAAR_PAN"]) assert.ok(optional(code), `${code} is optional`);
  for (const code of ["GERMAN_CERTIFICATE", "CV", "BIRTH_CERTIFICATE", "CONSULTANCY_AGREEMENT", "AU_PAIR_CONTRACT", "HOST_FAMILY_ID"]) assert.ok(!optional(code), `${code} is required`);
  // A type is asked once per pathway, so the deploy SQL's guard is honest.
  const once = AU_PAIR_REQUIREMENTS.map((r) => r.typeCode);
  assert.equal(new Set(once).size, once.length);
  // The lists read the checklist: accepted or not needed is in.
  const rows = [
    { typeCode: "AU_PAIR_CONTRACT", state: "ACCEPTED" },
    { typeCode: "CV", state: "UPLOADED" },
    { typeCode: "MARKSHEET_10", state: "ACCEPTED" },
    { typeCode: "MARKSHEET_12", state: "NOT_NEEDED" },
  ];
  const missing = listMissing(AU_PAIR_PRE_VISA, rows);
  assert.ok(!missing.includes("Au pair contract and questionnaire"));
  assert.ok(!missing.includes("Educational certificates"));
  assert.ok(missing.includes("CV / resume"), "uploaded is not yet accepted");
  assert.ok(!missing.some((m) => /if applicable|if required/.test(m)), "optional items never hold the file");
});

test("the migration adds the event kinds and columns, safely, after 0089", () => {
  const sqlText = read("../drizzle/0090_au_pair_process.sql");
  for (const k of ["MENTOR", "MOCK_INTERVIEW", "PROFILE_SUBMITTED", "HOST_FAMILY", "CONTRACT", "APPOINTMENT", "FOLLOW_UP"]) {
    assert.ok(sqlText.includes(`ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS '${k}'`), k);
  }
  for (const c of ["au_pair_consent_on", "au_pair_platform", "au_pair_pocket_money", "au_pair_weekly_hours", "au_pair_duration_months", "au_pair_appointment_at", "au_pair_appointment_place"]) {
    assert.ok(sqlText.includes(`ADD COLUMN IF NOT EXISTS "${c}"`), c);
  }
  assert.ok(!/INSERT|UPDATE|DELETE|DROP/i.test(sqlText.replace(/^--.*$/gm, "")), "no rows, nothing dropped");
  const journal = JSON.parse(read("../drizzle/meta/_journal.json")) as { entries: { idx: number; when: number; tag: string }[] };
  const mine = journal.entries.find((e) => e.tag === "0090_au_pair_process");
  const before = journal.entries.find((e) => e.tag === "0089_au_pair");
  assert.ok(mine && before && mine.when > before.when && mine.idx === before.idx + 1, "the journal lists it after 0089");
  const old = read("../drizzle/0089_au_pair.sql");
  assert.ok(old.includes(`ADD VALUE IF NOT EXISTS 'AU_PAIR'`), "0089 is unchanged");
});

test("the deploy SQL replaces the provisional list safely: new statuses, files moved, old codes retired, counts printed", () => {
  const sqlText = read("../deploy/au-pair-pathway.sql");
  for (const s of STATUS_SEED.AU_PAIR) assert.ok(sqlText.includes(`'AU_PAIR', '${s.code}'`), `${s.code} is inserted`);
  const lines = sqlText.split("\n");
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO status_definitions")).every((l) => l.endsWith("ON CONFLICT (pathway, code) DO NOTHING;")));
  // The chain gets the guide's words; the closing statuses are never touched.
  for (const s of STATUS_SEED.AU_PAIR) {
    const updated = lines.some((l) => l.startsWith("UPDATE status_definitions SET label") && l.endsWith(`code = '${s.code}';`));
    assert.equal(updated, !COMMON.includes(s.code), `${s.code} ${COMMON.includes(s.code) ? "is left as it is" : "gets the guide's wording"}`);
  }
  // Every retired code moves its files to a step, then is deactivated, never deleted.
  for (const r of AU_PAIR_RETIRED) {
    assert.ok(auPairStepOf(r.to), `${r.code} goes to a step`);
    assert.ok(sqlText.includes(`code = '${r.code}'`), `${r.code} is handled`);
    if (r.retire) {
      assert.equal(auPairStepOf(r.code), null, `${r.code} is no longer a step`);
      assert.ok(lines.some((l) => l.startsWith("UPDATE status_definitions SET active = false") && l.includes(`code = '${r.code}' AND active`)), `${r.code} is retired`);
    }
  }
  assert.equal(fsjStepOf("JOINED")?.step, 17, "JOINED keeps its FSJ / BFD meaning");
  const joined = AU_PAIR_RETIRED.find((r) => r.code === "JOINED")!;
  assert.ok(joined.provisionalLabel && sqlText.includes(`label = '${joined.provisionalLabel}'`), "only the provisional JOINED moves, read by its label");
  assert.ok(sqlText.indexOf("INSERT INTO au_pair_moved") < sqlText.indexOf("UPDATE status_definitions SET label"), "files move before the wording changes, so a second run moves nothing");
  assert.ok(sqlText.indexOf("INSERT INTO status_definitions") < sqlText.indexOf("INSERT INTO au_pair_moved"), "the new statuses exist before files move to them");
  assert.ok(!/^DELETE|DROP /m.test(sqlText), "nothing is removed");
  assert.match(sqlText, /INSERT INTO status_history/);
  // Types and requirements as before: only where missing; the provisional two only while untouched.
  for (const r of AU_PAIR_REQUIREMENTS) assert.ok(sqlText.includes(`'${r.stage}', '${r.typeCode}', 'ALWAYS', '${r.pathway}'`), `${r.typeCode} is in the SQL`);
  for (const t of AU_PAIR_DOCUMENT_TYPES) assert.ok(sqlText.includes(`VALUES ('${t.code}'`), `type ${t.code} is in the SQL`);
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO document_types")).every((l) => l.endsWith("ON CONFLICT (code) DO NOTHING;")));
  assert.ok(lines.filter((l) => l.startsWith("INSERT INTO document_requirements")).every((l) => l.includes("WHERE NOT EXISTS")));
  for (const p of AU_PAIR_PROVISIONAL_REQUIREMENTS) assert.ok(lines.some((l) => l.startsWith("UPDATE document_requirements") && l.includes(`type_code = '${p.typeCode}'`) && l.includes(`guidance = '${p.guidance}'`)), `${p.typeCode} only while untouched`);
  assert.ok(sqlText.includes("'aupair@miak.in'"), "the contact");
  assert.ok(sqlText.indexOf("BEGIN;") < sqlText.indexOf("INSERT") && sqlText.lastIndexOf("SELECT") < sqlText.indexOf("COMMIT;"), "in one transaction, the counts before it ends");
  assert.match(sqlText, /moved off provisional statuses/);
  assert.match(sqlText, /AU_PAIR statuses active/);
});

test("the Au pair tab, tracker and portal card are wired in, and FSJ / BFD keeps its own", () => {
  assert.match(read("../src/app/(app)/students/[id]/layout.tsx"), /showsAuPairTab[\s\S]*label: "Au pair"/);
  assert.match(read("../src/app/portal/page.tsx"), /pickAuPairApplication\(apps\)[\s\S]*<AuPairJourney/);
  assert.match(read("../src/server/applications.ts"), /auPairStatusGate[\s\S]*au_pair\.visa_gate_override/);
  assert.match(read("../src/app/(app)/students/[id]/applications/actions.ts"), /program\.pathway !== "AU_PAIR"/);
  const fsjCard = read("../src/components/fsj-journey.tsx");
  assert.match(fsjCard, /"data-fsj-journey": "true"/, "the FSJ card keeps its marker");
  assert.match(fsjCard, /steps=\{FSJ_STEPS\}/);
});

test("no long dashes in what this change writes", () => {
  for (const f of [
    "../src/lib/pathways.ts",
    "../src/lib/au-pair.ts",
    "../src/server/au-pair.ts",
    "../src/server/au-pair-actions.ts",
    "../src/db/statuses.ts",
    "../src/db/documentation-seed.ts",
    "../scripts/au-pair-sql.ts",
    "../deploy/au-pair-pathway.sql",
    "../drizzle/0089_au_pair.sql",
    "../drizzle/0090_au_pair_process.sql",
    "../src/lib/aims.ts",
    "../src/app/(app)/au-pair/page.tsx",
    "../src/app/(app)/students/[id]/au-pair/page.tsx",
    "../src/app/(app)/students/[id]/au-pair/forms.tsx",
    "../src/components/au-pair-journey.tsx",
    "../src/components/step-journey.tsx",
    "../docs/au-pair-process.md",
  ]) {
    assert.ok(!read(f).includes("\u2014"), `${f} has no em dash`);
  }
});
