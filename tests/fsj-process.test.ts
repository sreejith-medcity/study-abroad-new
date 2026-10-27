import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FSJ_CHECKLISTS,
  FSJ_DEPARTMENTS,
  FSJ_EMAILS,
  FSJ_HANDOVERS,
  FSJ_PROGRAMMES,
  FSJ_STEPS,
  FSJ_STUDENT_STEP,
  FSJ_TEAM,
  afterAssessment,
  afterChecklist,
  afterFeeCheck,
  afterFeedback,
  afterOffer,
  afterVisaDecision,
  checklistOpen,
  crossesVisaGate,
  emailDraft,
  feeGate,
  fsjDepartmentOf,
  fsjDetailsMissing,
  fsjPastBranch,
  fsjStepOf,
  handoverCheck,
  interviewCheck,
  mayDo,
  mergeChecklist,
  needsFees,
  pickFsjApplication,
  resolveRecipients,
  senderNoticeText,
  stuckAtLeast,
  visaGate,
  visaReadyCheck,
  type DraftFacts,
  type VisaFacts,
} from "../src/lib/fsj";
import { DOCUMENT_TYPES, STATUS_SEED } from "../src/db/statuses";
import { DOCUMENTATION_TYPES, FSJ_DOCUMENT_TYPES, FSJ_REQUIREMENTS, FSJ_SECTION_2, STAGE_REQUIREMENTS } from "../src/db/documentation-seed";

const COMMON = ["PENDING_PARTNER", "ON_HOLD_INTAKE", "DEFERRED", "CLOSED_NOT_QUALIFIED", "VISA_REJECTED", "WITHDRAWN", "CASE_CLOSED"];
const paid = { registrationFeePaidOn: "2026-01-01", applicationFeePaidOn: "2026-01-05" };

test("FSJ and BFD carry the same chain, every status placed on one of the 18 steps", () => {
  for (const pw of ["FSJ", "BFD"] as const) {
    const codes = STATUS_SEED[pw].map((s) => s.code);
    assert.equal(new Set(codes).size, codes.length, `${pw}: no code twice`);
    for (const code of codes.filter((c) => !COMMON.includes(c))) assert.ok(fsjStepOf(code), `${pw}: ${code} is on a step`);
    for (const c of COMMON) assert.ok(codes.includes(c), `${pw}: ${c} is offered`);
  }
  assert.deepEqual(
    STATUS_SEED.FSJ.map((s) => s.code),
    STATUS_SEED.BFD.map((s) => s.code),
    "one process for both",
  );
  // Only the volunteer start names the programme.
  assert.match(STATUS_SEED.FSJ.find((s) => s.code === "JOINED")!.label, /FSJ volunteer/);
  assert.match(STATUS_SEED.BFD.find((s) => s.code === "JOINED")!.label, /BFD volunteer/);
});

test("the steps are the guide's 18, in order, across five departments, and every status the steps name exists", () => {
  assert.deepEqual(
    FSJ_STEPS.map((s) => s.step),
    Array.from({ length: 18 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    FSJ_DEPARTMENTS.map((d) => d.key),
    ["COUNSELLOR", "DOCUMENTATION", "INTERVIEW", "VISA", "TRAVEL"],
  );
  const codes = new Set(STATUS_SEED.FSJ.map((s) => s.code));
  for (const s of FSJ_STEPS) for (const c of s.statusCodes) assert.ok(codes.has(c), `${c} (step ${s.step}) is seeded`);
  for (const s of FSJ_STEPS.slice(1)) assert.ok(s.statusCodes.length > 0, `step ${s.step} has a status`);
  assert.equal(FSJ_STEPS[0].statusCodes.length, 0, "the enquiry happens before any application");
  // The departments in the order the guide lays them out.
  const byStep = (n: number) => FSJ_STEPS[n - 1].department;
  assert.deepEqual([1, 2, 3].map(byStep), ["COUNSELLOR", "COUNSELLOR", "COUNSELLOR"]);
  assert.deepEqual([4, 5, 6, 7].map(byStep), ["DOCUMENTATION", "DOCUMENTATION", "DOCUMENTATION", "DOCUMENTATION"]);
  assert.deepEqual([8, 9, 10].map(byStep), ["INTERVIEW", "INTERVIEW", "INTERVIEW"]);
  assert.deepEqual([11, 12, 13, 14, 15].map(byStep), ["VISA", "VISA", "VISA", "VISA", "VISA"]);
  assert.deepEqual([16, 17, 18].map(byStep), ["TRAVEL", "TRAVEL", "TRAVEL"]);
  // The guide's owners where they are shared.
  assert.deepEqual(FSJ_STEPS[6].owners, ["DOCUMENTATION", "LANGUAGE_TRAINERS"]);
  assert.deepEqual(FSJ_STEPS[8].owners, ["DOCUMENTATION", "EMPLOYER"]);
  assert.deepEqual(FSJ_STEPS[9].owners, ["DOCUMENTATION", "COUNSELLOR"]);
  assert.deepEqual(FSJ_STEPS[11].owners, ["DOCUMENTATION", "VISA"]);
  assert.deepEqual(FSJ_STEPS[17].owners, ["TRAVEL", "COUNSELLOR"]);
  assert.equal(fsjDepartmentOf("VISA_RESUBMISSION"), "VISA");
  assert.equal(fsjStepOf("ON_HOLD_INTAKE"), null);
});

test("statuses sort in step order, and a new application starts at registration", () => {
  const chain = STATUS_SEED.FSJ.filter((s) => !COMMON.includes(s.code));
  const steps = chain.map((s) => fsjStepOf(s.code)!.step);
  const orders = chain.map((s) => s.sortOrder!);
  for (let i = 1; i < chain.length; i++) assert.ok(orders[i] > orders[i - 1], `${chain[i].code} sorts after ${chain[i - 1].code}`);
  // The re-assessment loop and the resubmission sit inside their step range.
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1] - 1, `${chain[i].code} does not jump back`);
  const firstNew = [...STATUS_SEED.FSJ].map((s, i) => ({ ...s, order: s.sortOrder ?? (i + 1) * 10 })).filter((s) => s.group === "NEW").sort((a, b) => a.order - b.order)[0];
  assert.equal(firstNew.code, "REGISTRATION");
  assert.equal(STATUS_SEED.FSJ.find((s) => s.code === "APPLICATION_ON_HOLD")!.group, "HOLD", "the guide's 'application on hold'");
});

test("the hand-overs are the guide's three arrows", () => {
  assert.deepEqual(
    FSJ_HANDOVERS.map((h) => [fsjStepOf(h.fromCode)!.step, h.to]),
    [
      [3, "DOCUMENTATION"],
      [10, "VISA"],
      [15, "TRAVEL"],
    ],
  );
  for (const h of FSJ_HANDOVERS) {
    assert.equal(fsjStepOf(h.fromCode)!.handoverTo, h.to, `${h.fromCode} step marks the hand-over`);
    assert.equal(fsjDepartmentOf(h.toCode), h.to, `${h.toCode} is with the receiving department`);
  }
  assert.ok(!fsjPastBranch("DOCUMENT_COLLECTION") && fsjPastBranch("DOCUMENT_CROSS_CHECK") && fsjPastBranch("HAPPY_CALL"));
  assert.deepEqual(handoverCheck("CONTRACT_SIGNED", { contractSignedOn: null, joiningOn: null }), { ok: false, why: "Record the signed contract before handing the file to the visa team." });
  assert.equal(handoverCheck("CONTRACT_SIGNED", { contractSignedOn: "2026-03-01", joiningOn: null }).ok, true);
  assert.equal(handoverCheck("VISA_RECEIVED", { contractSignedOn: "2026-03-01", joiningOn: null }).ok, false);
  assert.equal(handoverCheck("VISA_RECEIVED", { contractSignedOn: "2026-03-01", joiningOn: "2026-09-01" }).ok, true);
  assert.equal(handoverCheck("INTERVIEW_SCHEDULED", { contractSignedOn: null, joiningOn: null }).ok, false);
});

test("the branch hands over only with every detail the guide lists", () => {
  const all = { medcityId: "MC-KTM-26-0001", email: "a@b.c", parentPhone: "+91 1", germanLevel: "B1", gapRecorded: true, registeredOn: new Date(), counsellor: "u1", registrationFeePaidOn: "2026-01-01" };
  assert.deepEqual(fsjDetailsMissing(all), []);
  assert.deepEqual(fsjDetailsMissing({ ...all, parentPhone: null, gapRecorded: false, registrationFeePaidOn: null }), ["parent's contact number", "education / employment gap", "amount paid (registration fee)"]);
});

test("decision 1: the language assessment loops through improvement until the team records it sufficient", () => {
  assert.equal(afterAssessment("NOT_SUFFICIENT", false), "LANGUAGE_IMPROVEMENT");
  assert.equal(afterAssessment("NOT_SUFFICIENT", true), "LANGUAGE_IMPROVEMENT");
  assert.equal(afterAssessment("SUFFICIENT", false), "PAYMENT_CHECK", "first time: on to the payment check");
  assert.equal(afterAssessment("SUFFICIENT", true), "INTERVIEW_PREPARATION", "after the application has started: back to preparation");
  // No pass mark: the result is the team's, whatever level they typed.
  assert.equal(afterAssessment.length, 2, "the level is not an input to the decision");
});

test("decision 2: the fee gate holds the application until both fees are marked paid", () => {
  assert.deepEqual(feeGate({ registrationFeePaidOn: null, applicationFeePaidOn: null }), { clear: false, missing: ["registration fee", "application fee"] });
  assert.deepEqual(feeGate({ registrationFeePaidOn: "2026-01-01", applicationFeePaidOn: null }), { clear: false, missing: ["application fee"] });
  assert.deepEqual(feeGate(paid), { clear: true, missing: [] });
  assert.equal(afterFeeCheck({ registrationFeePaidOn: "2026-01-01", applicationFeePaidOn: null }), "APPLICATION_ON_HOLD");
  assert.equal(afterFeeCheck(paid), "INTERVIEW_PREPARATION");
  // What counts as the application having started.
  for (const c of ["INTERVIEW_PREPARATION", "INTERVIEW_SCHEDULED", "CONTRACT_SIGNED", "VISA_FILED", "VISA_RECEIVED", "HAPPY_CALL"]) assert.ok(needsFees(c), `${c} needs the fees`);
  for (const c of ["REGISTRATION", "DOCUMENT_COLLECTION", "LANGUAGE_ASSESSMENT", "PAYMENT_CHECK", "APPLICATION_ON_HOLD", "LANGUAGE_IMPROVEMENT", "WITHDRAWN", "ON_HOLD_INTAKE"]) assert.ok(!needsFees(c), `${c} does not`);
});

test("scheduling an interview needs the application started and the language confirmed", () => {
  const base = { code: "INTERVIEW_PREPARATION", fees: paid, applicationStarted: true, languageResult: "SUFFICIENT" as const, employer: "Caritas Köln", currentEmployer: null, notSelectedBy: [] as string[] };
  assert.deepEqual(interviewCheck(base), { ok: true });
  assert.equal(interviewCheck({ ...base, code: "PAYMENT_CHECK" }).ok, false);
  const unpaid = interviewCheck({ ...base, fees: { registrationFeePaidOn: "2026-01-01", applicationFeePaidOn: null } });
  assert.ok(!unpaid.ok && /application fee is not marked paid/.test(unpaid.why));
  assert.equal(interviewCheck({ ...base, applicationStarted: false }).ok, false);
  const notReady = interviewCheck({ ...base, languageResult: "NOT_SUFFICIENT" });
  assert.ok(!notReady.ok && /not recorded as sufficient/.test(notReady.why));
  assert.equal(interviewCheck({ ...base, employer: "  " }).ok, false);
});

test("decision 3: employer feedback, with not selected going back to preparation and another employer", () => {
  assert.equal(afterFeedback("POSITIVE"), "EMPLOYER_CONFIRMED");
  assert.equal(afterFeedback("SECOND_ROUND"), "SECOND_ROUND");
  assert.equal(afterFeedback("NOT_SELECTED"), "INTERVIEW_PREPARATION");
  const base = { code: "INTERVIEW_PREPARATION", fees: paid, applicationStarted: true, languageResult: "SUFFICIENT" as const, currentEmployer: null, notSelectedBy: ["Caritas Köln"] };
  const again = interviewCheck({ ...base, employer: "  caritas köln " });
  assert.ok(!again.ok && /did not select the candidate/.test(again.why), "the employer that said no is not asked again");
  assert.deepEqual(interviewCheck({ ...base, employer: "Diakonie Bremen" }), { ok: true }, "another employer is");
  // A second round is with the employer that shortlisted.
  const second = { ...base, code: "SECOND_ROUND", currentEmployer: "Diakonie Bremen", notSelectedBy: [] };
  assert.deepEqual(interviewCheck({ ...second, employer: "Diakonie Bremen" }), { ok: true });
  assert.equal(interviewCheck({ ...second, employer: "AWO Berlin" }).ok, false);
});

test("the offer comes before the contract", () => {
  assert.deepEqual(afterOffer({ offerOn: null, contractSignedOn: null }), { ok: true, code: null });
  assert.deepEqual(afterOffer({ offerOn: "2026-04-01", contractSignedOn: null }), { ok: true, code: "OFFER_RECEIVED" });
  assert.deepEqual(afterOffer({ offerOn: "2026-04-01", contractSignedOn: "2026-04-03" }), { ok: true, code: "CONTRACT_SIGNED" });
  assert.equal(afterOffer({ offerOn: null, contractSignedOn: "2026-04-03" }).ok, false);
  assert.equal(afterOffer({ offerOn: "2026-04-05", contractSignedOn: "2026-04-03" }).ok, false);
});

test("decision 4: the visa, with a refusal corrected and resubmitted while the employer still wants the candidate", () => {
  const ready: VisaFacts = { preVisaPaymentOn: "2026-05-01", contractSignedOn: "2026-04-03", profileMissing: [] };
  assert.deepEqual(visaReadyCheck("PRE_VISA_DOCUMENTS", { ...ready, preVisaPaymentOn: null }), { ok: false, why: "The pre-visa payment is not marked received. It is verified before submission." });
  assert.deepEqual(visaReadyCheck("PRE_VISA_DOCUMENTS", ready), { ok: true });
  assert.deepEqual(visaReadyCheck("VISA_RESUBMISSION", ready), { ok: true });
  assert.deepEqual(visaReadyCheck("PRE_VISA_DOCUMENTS", { ...ready, preVisaPaymentOn: null, preVisaSettled: true }), { ok: true }, "a waived pre-visa payment is settled");
  assert.equal(visaReadyCheck("VFS_SLOT_BOOKING", ready).ok, false);
  assert.deepEqual(afterVisaDecision({ outcome: "APPROVED", reason: null, afterRefusal: null }), { ok: true, code: "VISA_RECEIVED" });
  assert.equal(afterVisaDecision({ outcome: "REJECTED", reason: " ", afterRefusal: "RESUBMIT" }).ok, false, "a refusal needs its reason");
  const unsaid = afterVisaDecision({ outcome: "REJECTED", reason: "Funds unclear", afterRefusal: null });
  assert.ok(!unsaid.ok && unsaid.field === "afterRefusal", "a refusal needs what happens next");
  assert.deepEqual(afterVisaDecision({ outcome: "REJECTED", reason: "Funds unclear", afterRefusal: "RESUBMIT" }), { ok: true, code: "VISA_RESUBMISSION" });
  assert.deepEqual(afterVisaDecision({ outcome: "REJECTED", reason: "Funds unclear", afterRefusal: "CLOSE" }), { ok: true, code: "VISA_REJECTED" });
  assert.equal(fsjStepOf("VISA_RESUBMISSION")!.step, 12, "the correction is visa document preparation again");
});

test("a refusal where the employer has withdrawn can go back to interview preparation for another employer, as the not-selected loop does", () => {
  const next = afterVisaDecision({ outcome: "REJECTED", reason: "Employer withdrew the place", afterRefusal: "ANOTHER_EMPLOYER" });
  assert.deepEqual(next, { ok: true, code: "INTERVIEW_PREPARATION" });
  assert.equal(next.ok && next.code, afterFeedback("NOT_SELECTED"), "the same place the not-selected loop sends the file");
  // Back at preparation the application has started and the language is kept, so another employer can be scheduled at once.
  const base = { code: "INTERVIEW_PREPARATION", fees: paid, applicationStarted: true, languageResult: "SUFFICIENT" as const, currentEmployer: null, notSelectedBy: ["AWO Berlin"] };
  assert.deepEqual(interviewCheck({ ...base, employer: "Caritas Köln" }), { ok: true });
  assert.equal(interviewCheck({ ...base, employer: "AWO Berlin" }).ok, false, "the employer that withdrew is not offered again");
});

test("the visa gate needs the pre-visa payment, the signed contract and the profile documents, and holds every route onto the VFS submission", () => {
  const facts: VisaFacts = { preVisaPaymentOn: null, contractSignedOn: null, profileMissing: ["Birth certificate", "Police clearance certificate"] };
  assert.deepEqual(visaGate(facts), { clear: false, missing: ["pre-visa payment", "signed contract", "Birth certificate", "Police clearance certificate"] });
  const why = visaReadyCheck("PRE_VISA_DOCUMENTS", facts);
  assert.ok(!why.ok && /pre-visa payment is not marked received/.test(why.why) && /signed employer contract/.test(why.why) && /Birth certificate, Police clearance certificate/.test(why.why));
  assert.deepEqual(visaGate({ preVisaPaymentOn: "2026-05-01", contractSignedOn: "2026-04-03", profileMissing: [] }), { clear: true, missing: [] });
  // Crossing onto step 13 or later from before it is checked, from any screen.
  for (const from of ["PRE_VISA_DOCUMENTS", "VISA_RESUBMISSION", "VFS_SLOT_BOOKING", "INTERVIEW_PREPARATION", "ON_HOLD_INTAKE", "VISA_REJECTED", null]) {
    assert.ok(crossesVisaGate(from, "VISA_FILED"), `${from} to VISA_FILED`);
    assert.ok(crossesVisaGate(from, "PRE_DEPARTURE"), `${from} to PRE_DEPARTURE`);
  }
  // Moves within the visa stage and after it are not checked again.
  assert.ok(!crossesVisaGate("VISA_FILED", "VISA_PROCESSING") && !crossesVisaGate("VISA_PROCESSING", "VISA_RECEIVED") && !crossesVisaGate("PRE_DEPARTURE", "JOINED"));
  assert.ok(!crossesVisaGate("VISA_PROCESSING", "VISA_RESUBMISSION") && !crossesVisaGate("PAYMENT_CHECK", "INTERVIEW_PREPARATION") && !crossesVisaGate("VISA_PROCESSING", "VISA_REJECTED"));
});

test("a fee stage settled with no day of payment (waived, or let through by the head office) opens the fee gate", () => {
  assert.deepEqual(feeGate({ registrationFeePaidOn: null, applicationFeePaidOn: "2026-01-05", settled: { registration: true } }), { clear: true, missing: [] });
  assert.deepEqual(feeGate({ registrationFeePaidOn: null, applicationFeePaidOn: null, settled: { registration: true, application: false } }), { clear: false, missing: ["application fee"] });
});

test("the travel desk's checklists keep each step's ticks apart, and the happy call starts the follow-up", () => {
  assert.equal(FSJ_CHECKLISTS[16].length, 8);
  assert.equal(FSJ_CHECKLISTS[17].length, 4);
  assert.equal(FSJ_CHECKLISTS[18].length, 4);
  const held = ["s15.passport", "s16.flight", "s16.sim"];
  assert.deepEqual(mergeChecklist(held, 16, ["s16.sim", "s16.pickup", "s18.happyCall", "bogus"]), ["s15.passport", "s16.sim", "s16.pickup"]);
  assert.equal(afterChecklist(18, "JOINED", ["s18.happyCall"]), "HAPPY_CALL");
  assert.equal(afterChecklist(18, "JOINED", ["s18.reference"]), null);
  assert.equal(afterChecklist(16, "PRE_DEPARTURE", ["s18.happyCall"]), null);
  assert.ok(checklistOpen(16, "PRE_DEPARTURE") && !checklistOpen(16, "VISA_RECEIVED") && checklistOpen(17, "PRE_DEPARTURE") && checklistOpen(18, "JOINED") && !checklistOpen(18, "PRE_DEPARTURE"));
});

test("each department records its own steps and nobody else's", () => {
  assert.ok(mayDo("registration", "COUNSELLOR") && mayDo("payments", "PARTNER") && !mayDo("registration", "DOCUMENTATION"));
  assert.ok(mayDo("assessment", "DOCUMENTATION") && !mayDo("assessment", "COUNSELLOR") && mayDo("assessment", "ADMIN"));
  assert.ok(mayDo("feecheck", "APPLICATION_TEAM_LEADER") && !mayDo("feecheck", "PARTNER"));
  assert.ok(mayDo("handover", "COUNSELLOR", { code: "DOCUMENT_COLLECTION" }) && !mayDo("handover", "DOCUMENTATION", { code: "DOCUMENT_COLLECTION" }));
  assert.ok(mayDo("handover", "DOCUMENTATION", { code: "CONTRACT_SIGNED" }) && !mayDo("handover", "COUNSELLOR", { code: "CONTRACT_SIGNED" }));
  assert.ok(!mayDo("handover", "ADMIN", { code: "LANGUAGE_ASSESSMENT" }), "no hand-over from a step without one");
  assert.ok(mayDo("departure", "APPLICATION_TEAM_LEADER") && !mayDo("departure", "DOCUMENTATION") && !mayDo("departure", "COUNSELLOR"));
  assert.ok(mayDo("checklist", "COUNSELLOR", { checklistStep: 18 }) && !mayDo("checklist", "COUNSELLOR", { checklistStep: 16 }));
  assert.ok(!mayDo("visaDecision", "COUNSELLOR") && !mayDo("interview", "FINANCE") && !mayDo("registration", "STUDENT"));
  // A written-off fee: only the head office lets the file go on.
  assert.ok(mayDo("settle", "ADMIN") && mayDo("settle", "SUPER_ADMIN") && !mayDo("settle", "PARTNER") && !mayDo("settle", "DOCUMENTATION") && !mayDo("settle", "FINANCE") && !mayDo("settle", "DESK_COUNSELLOR"));
});

test("the assessment, fee-pending and visa-approved notices tell the team that sends the email that it is theirs, with the addresses", () => {
  const told = (Object.keys(FSJ_EMAILS) as (keyof typeof FSJ_EMAILS)[]).filter((t) => FSJ_EMAILS[t].tellSender);
  assert.deepEqual(told, ["ASSESSMENT_DONE", "FEE_PENDING", "VISA_APPROVED"]);
  assert.equal(FSJ_EMAILS.ASSESSMENT_DONE.sender, "DOCUMENTATION");
  assert.equal(FSJ_EMAILS.FEE_PENDING.sender, "DOCUMENTATION");
  assert.equal(FSJ_EMAILS.VISA_APPROVED.sender, "VISA");
  assert.equal(FSJ_EMAILS.REGISTERED.sender, "BRANCH");
  const people = { candidate: "anu@example.com", counsellor: "c@branch.test", branchHeads: [] };
  const text = senderNoticeText("VISA_APPROVED", resolveRecipients(FSJ_EMAILS.VISA_APPROVED.to, people), resolveRecipients(FSJ_EMAILS.VISA_APPROVED.cc, people));
  assert.match(text, /for the visa team to send/);
  assert.match(text, /To: anu@example\.com\./);
  assert.match(text, /Cc: c@branch\.test\./);
  assert.match(text, /No email on record for the branch head\./);
  assert.match(text, /step 15 of the FSJ \/ BFD tab/);
  const fee = senderNoticeText("FEE_PENDING", resolveRecipients(FSJ_EMAILS.FEE_PENDING.to, people), resolveRecipients(FSJ_EMAILS.FEE_PENDING.cc, people));
  assert.match(fee, /for the documentation team to send\. To: c@branch\.test\./);
  for (const t of Object.keys(FSJ_EMAILS) as (keyof typeof FSJ_EMAILS)[]) assert.ok(!senderNoticeText(t, { emails: [], unknown: [] }, { emails: [], unknown: [] }).includes("\u2014"));
});

test("the email matrix is the guide's Section 3, and its drafts invent nothing", () => {
  assert.deepEqual(
    Object.entries(FSJ_EMAILS).map(([k, m]) => [k, m.step]),
    [
      ["REGISTERED", 2],
      ["DOCUMENTS_MISSING", 4],
      ["ASSESSMENT_DONE", 5],
      ["FEE_PENDING", 6],
      ["INTERVIEW_SCHEDULED", 8],
      ["VISA_APPROVED", 15],
    ],
  );
  assert.deepEqual(
    FSJ_TEAM.map((t) => t.email),
    ["fsj.bfd@miak.in", "nsg.ast@miak.in"],
  );
  const people = { candidate: "anu@example.com", counsellor: null, branchHeads: ["head@branch.test"] };
  assert.deepEqual(resolveRecipients(FSJ_EMAILS.REGISTERED.to, people), { emails: ["fsj.bfd@miak.in", "nsg.ast@miak.in"], unknown: [] });
  assert.deepEqual(resolveRecipients(FSJ_EMAILS.REGISTERED.to, people, ["edited@miak.in"]), { emails: ["edited@miak.in"], unknown: [] }, "the Contacts list stands in for the guide's addresses");
  assert.deepEqual(resolveRecipients(FSJ_EMAILS.ASSESSMENT_DONE.cc, people), { emails: ["head@branch.test"], unknown: ["the counsellor"] });
  assert.deepEqual(resolveRecipients(FSJ_EMAILS.FEE_PENDING.cc, { ...people, branchHeads: [] }), { emails: [], unknown: ["the branch head"] });

  const facts: DraftFacts = {
    pathway: "BFD",
    student: "Anu Mathew",
    medcityId: "MC-KTM-26-0007",
    email: "anu@example.com",
    phone: null,
    parentPhone: null,
    germanLevel: "B1",
    gap: null,
    registeredOn: "01/02/2026",
    branch: "Medcity Kottayam",
    counsellor: "Sample Counsellor",
    registrationFeePaidOn: null,
  };
  const reg = emailDraft("REGISTERED", facts, { to: ["fsj.bfd@miak.in", "nsg.ast@miak.in"], cc: ["head@branch.test"] });
  assert.match(reg.text, /^To: fsj\.bfd@miak\.in; nsg\.ast@miak\.in\nCc: head@branch\.test\nSubject: BFD registration: Anu Mathew \(MC-KTM-26-0007\)/);
  assert.match(reg.body, /Parent's contact number: Not recorded/);
  assert.match(reg.body, /Registration fee paid on: Not recorded/);
  const iv = emailDraft("INTERVIEW_SCHEDULED", { ...facts, employer: "AWO Berlin", interviewAt: "12/03/2026, 3:30 pm", link: null }, { to: ["anu@example.com"], cc: [] });
  assert.match(iv.body, /Organisation \/ employer: AWO Berlin/);
  assert.match(iv.body, /Interview link: Not recorded/);
  assert.match(iv.text, /Cc: None/);
  for (const t of Object.keys(FSJ_EMAILS) as (keyof typeof FSJ_EMAILS)[]) assert.ok(!emailDraft(t, facts, { to: [], cc: [] }).text.includes("\u2014"), `${t} has no long dash`);
});

test("the programme facts are shown as the programme sheet states them", () => {
  const fact = (p: "FSJ" | "BFD", label: string) => FSJ_PROGRAMMES[p].facts.find((f) => f.label === label)?.value;
  assert.equal(fact("FSJ", "Age"), "18 to 26 years");
  assert.equal(fact("FSJ", "Duration"), "6 to 12 months");
  assert.equal(fact("BFD", "Age"), "18 and over, no upper limit");
  assert.equal(fact("BFD", "Duration"), "6 to 12 (18) months");
  assert.equal(fact("FSJ", "Language"), fact("BFD", "Language"));
  assert.match(fact("BFD", "Language")!, /B1.*B2/);
});

test("Section 2's thirteen documents are all asked of an FSJ and a BFD file", () => {
  assert.equal(FSJ_SECTION_2.length, 13);
  const types = new Set([...DOCUMENT_TYPES, ...DOCUMENTATION_TYPES, ...FSJ_DOCUMENT_TYPES].map((t) => t.code));
  assert.equal(types.size, DOCUMENT_TYPES.length + DOCUMENTATION_TYPES.length + FSJ_DOCUMENT_TYPES.length, "no type defined twice");
  for (const pw of ["FSJ", "BFD"] as const) {
    const asked = new Set([...STAGE_REQUIREMENTS.filter((r) => !r.pathway && !r.country), ...FSJ_REQUIREMENTS.filter((r) => r.pathway === pw)].map((r) => r.typeCode));
    for (const item of FSJ_SECTION_2) for (const code of item.typeCodes) {
      assert.ok(types.has(code), `${code} is a document type`);
      assert.ok(asked.has(code), `${pw}: item ${item.n} (${code}) is asked for`);
    }
  }
  // Only the guide's own conditional items are optional.
  const optional = FSJ_REQUIREMENTS.filter((r) => r.pathway === "FSJ" && r.required === false).map((r) => r.typeCode).sort();
  assert.deepEqual(optional, ["DEGREE_CERTIFICATE", "DRIVING_LICENCE", "WORK_EXPERIENCE_LETTER"]);
  // What the documentation team prepares is owed by Medcity, at the application stage.
  for (const code of ["EUROPASS_CV", "MOTIVATION_LETTER", "TRANSLATED_CERTIFICATES"]) {
    const r = FSJ_REQUIREMENTS.find((x) => x.pathway === "BFD" && x.typeCode === code)!;
    assert.equal(r.stage, "APPLICATION");
    assert.equal(r.owedBy, "MEDCITY");
  }
});

test("the portal card has a plain line for every step, and follows the live FSJ / BFD round", () => {
  for (const s of FSJ_STEPS) assert.ok(FSJ_STUDENT_STEP[s.step], `step ${s.step} has a student line`);
  const apps = [
    { pathway: "AUSBILDUNG", statusGroup: "NEW", changedAt: "2026-05-01" },
    { pathway: "FSJ", statusGroup: "CLOSED", changedAt: "2026-05-03" },
    { pathway: "BFD", statusGroup: "SUCCESS", changedAt: "2026-05-04" },
    { pathway: "FSJ", statusGroup: "IN_PROGRESS", changedAt: "2026-04-01" },
  ];
  assert.equal(pickFsjApplication(apps), apps[3]);
  assert.equal(pickFsjApplication(apps.slice(0, 3)), apps[2]);
  assert.equal(pickFsjApplication(apps.slice(0, 2)), null);
});

test("stuck time is the reader's own number", () => {
  const now = new Date("2026-06-30T00:00:00Z");
  assert.equal(stuckAtLeast(new Date("2026-06-20T00:00:00Z"), 10, now), true);
  assert.equal(stuckAtLeast(new Date("2026-06-21T00:00:00Z"), 10, now), false);
  assert.equal(stuckAtLeast(null, 1, now), false);
  assert.equal(stuckAtLeast(null, null, now), true);
});

test("the deploy SQL carries every FSJ and BFD status, requirement and address, and changes nothing already there", () => {
  const sqlText = readFileSync(new URL("../deploy/fsj-bfd-process.sql", import.meta.url), "utf8");
  for (const pw of ["FSJ", "BFD"] as const) for (const s of STATUS_SEED[pw]) assert.ok(sqlText.includes(`'${pw}', '${s.code}'`), `${pw} ${s.code} is in the SQL`);
  for (const r of FSJ_REQUIREMENTS) assert.ok(sqlText.includes(`'${r.stage}', '${r.typeCode}', 'ALWAYS', '${r.pathway}'`), `${r.pathway} ${r.typeCode} is in the SQL`);
  for (const t of FSJ_DOCUMENT_TYPES) assert.ok(sqlText.includes(`VALUES ('${t.code}'`), `type ${t.code} is in the SQL`);
  // Every type a requirement names is inserted where missing, before the requirements, so the file does not wait on the Ausbildung file.
  for (const code of new Set(FSJ_REQUIREMENTS.map((r) => r.typeCode))) {
    const at = sqlText.indexOf(`INSERT INTO document_types (code, label, label_ml, uploaded_by, sort_order) VALUES ('${code}'`);
    assert.ok(at > 0, `type ${code} is inserted`);
    assert.ok(at < sqlText.indexOf("INSERT INTO document_requirements"), `type ${code} comes before the requirements`);
  }
  for (const code of ["BIRTH_CERTIFICATE", "VACCINATION_CERTIFICATE", "POLICE_CLEARANCE", "TRANSLATED_CERTIFICATES", "MOTIVATION_LETTER", "WORK_EXPERIENCE_LETTER"]) assert.ok(sqlText.includes(`VALUES ('${code}'`), `${code} is in the SQL`);
  assert.ok(sqlText.split("\n").filter((l) => l.startsWith("INSERT INTO document_types")).every((l) => l.endsWith("ON CONFLICT (code) DO NOTHING;")), "a type already there is left as it is");
  for (const c of FSJ_TEAM) assert.ok(sqlText.includes(`'${c.email}'`), `${c.email} is in the SQL`);
  assert.ok(!/DO UPDATE|^UPDATE|^DELETE/m.test(sqlText), "nothing is overwritten or removed");
});

test("no long dashes in what this change writes", () => {
  for (const f of ["../src/lib/fsj.ts", "../src/lib/fsj-fees.ts", "../src/server/fsj.ts", "../src/server/fsj-actions.ts", "../src/server/fsj-fees.ts", "../scripts/fsj-bfd-process-sql.ts", "../deploy/fsj-bfd-process.sql", "../src/app/(app)/fsj/page.tsx", "../src/app/(app)/students/[id]/fsj/page.tsx", "../src/components/fsj-journey.tsx", "../docs/fsj-bfd-process.md"]) {
    assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes("\u2014"), `${f} has no em dash`);
  }
});
