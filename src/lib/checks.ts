import { ADMISSION_TESTS, ENGLISH_TESTS, QUALIFYING_LABEL, TEST_LABEL, bestPercents, qualifyingLevel } from "./eligibility";

/**
 * Pre-submission quality check. Pure functions so they can run on the server,
 * in tests, and (later) in the partner UI before the Apply button.
 */

export type CheckSeverity = "blocker" | "warning" | "pass";
export type CheckResult = { code: string; severity: CheckSeverity; message: string; section?: string };

export type CheckStudent = {
  dateOfBirth: Date | null;
  gender: string | null;
  addressLine1: string | null;
  city: string | null;
  passportNumber: string | null;
  passportExpiry: Date | null;
  backlogs: number | null;
  gapYears: number | null;
  academics: { level: string; gradingSystem?: string | null; score?: number | null }[];
  tests: { test: string; overall: string; isMock: boolean }[];
  documentTypeCodes: string[];
};

export type CheckProgram = {
  level?: string;
  durationMonths: number | null;
  minToefl?: number | null;
  minDuolingo?: number | null;
  minGre?: number | null;
  minGmat?: number | null;
  minSat?: number | null;
  minAcademicPercent?: number | null;
  minIelts: number | null;
  minPte: number | null;
  minOetGrade: string | null;
  minGermanLevel: string | null;
  maxBacklogs: number | null;
  maxGapYears: number | null;
  moiAccepted: boolean;
  requiredDocs: string[];
};

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const OET = ["E", "D", "C", "C+", "B", "A"];

function bestScore(tests: CheckStudent["tests"], test: string) {
  return tests.filter((t) => t.test === test && !t.isMock).map((t) => t.overall);
}

export function profileCompleteness(s: CheckStudent) {
  return {
    personal: !!(s.dateOfBirth && s.gender && s.addressLine1 && s.city && s.passportNumber),
    academics: s.academics.length > 0,
    work: true, // optional section
    tests: s.tests.some((t) => !t.isMock),
  };
}

export function runPreSubmissionCheck(
  s: CheckStudent,
  p: CheckProgram,
  intake: { month: number; year: number },
  docLabels: Record<string, string> = {},
): CheckResult[] {
  const out: CheckResult[] = [];
  const done = profileCompleteness(s);

  if (!done.personal) out.push({ code: "profile.personal", severity: "blocker", message: "Personal information, address or passport details are incomplete", section: "profile" });
  if (!done.academics) out.push({ code: "profile.academics", severity: "blocker", message: "No academic qualifications added", section: "profile" });

  // Passport validity must cover the whole course
  if (s.passportExpiry) {
    const courseEnd = new Date(intake.year, intake.month - 1 + (p.durationMonths ?? 12), 1);
    if (s.passportExpiry < courseEnd) {
      out.push({
        code: "passport.expiry",
        severity: "blocker",
        message: `Passport expires ${s.passportExpiry.toLocaleDateString("en-GB")}, before the course ends`,
        section: "profile",
      });
    } else {
      out.push({ code: "passport.expiry", severity: "pass", message: "Passport valid for the full course" });
    }
  }

  // English / language requirements: any one named test at its minimum will do.
  const named = ENGLISH_TESTS.map((e) => ({ ...e, min: (p as Record<string, unknown>)[e.key] as number | null | undefined })).filter((e) => e.min != null);
  if (named.length) {
    const hit = named
      .map((e) => ({ e, scores: bestScore(s.tests, e.test).map(Number).filter((n) => !Number.isNaN(n)) }))
      .find(({ e, scores }) => scores.some((v) => v >= e.min!));
    if (hit) {
      out.push({ code: "english", severity: "pass", message: `${TEST_LABEL[hit.e.test]} ${Math.max(...hit.scores)} meets ${hit.e.min}` });
    } else if (p.moiAccepted) {
      out.push({ code: "english", severity: "warning", message: "No qualifying English test; program accepts Medium of Instruction letter" });
    } else {
      const need = named.map((e) => `${TEST_LABEL[e.test]} ${e.min}`).join(" or ");
      out.push({ code: "english", severity: "blocker", message: `English requirement not met (needs ${need})`, section: "profile" });
    }
  }

  for (const t of ADMISSION_TESTS) {
    const min = p[t.key];
    if (min == null) continue;
    const scores = bestScore(s.tests, t.test).map(Number).filter((n) => !Number.isNaN(n));
    out.push(scores.some((v) => v >= min)
      ? { code: t.test.toLowerCase(), severity: "pass", message: `${t.test} ${Math.max(...scores)} meets ${min}` }
      : { code: t.test.toLowerCase(), severity: "blocker", message: `${t.test} ${min} or above required`, section: "profile" });
  }

  const qLevel = qualifyingLevel(p.level);
  if (p.minAcademicPercent != null && qLevel) {
    const label = QUALIFYING_LABEL[qLevel];
    const pct = bestPercents(s.academics.map((a) => ({ level: a.level, gradingSystem: a.gradingSystem ?? null, score: a.score ?? null })))[qLevel];
    if (pct != null) {
      out.push(pct >= p.minAcademicPercent
        ? { code: "academic", severity: "pass", message: `${label} ${pct}% meets ${p.minAcademicPercent}%` }
        : { code: "academic", severity: "blocker", message: `${label} ${pct}% is below the ${p.minAcademicPercent}% minimum`, section: "profile" });
    } else {
      out.push({ code: "academic", severity: "warning", message: `Needs ${p.minAcademicPercent}% in the ${label}; no percentage recorded (CGPA is not converted here)`, section: "profile" });
    }
  }

  if (p.minOetGrade) {
    const grades = bestScore(s.tests, "OET");
    const ok = grades.some((g) => OET.indexOf(g) >= OET.indexOf(p.minOetGrade!));
    out.push(ok
      ? { code: "oet", severity: "pass", message: `OET grade meets ${p.minOetGrade}` }
      : { code: "oet", severity: "blocker", message: `OET grade ${p.minOetGrade} or above required`, section: "profile" });
  }

  if (p.minGermanLevel) {
    const levels = bestScore(s.tests, "GERMAN");
    const ok = levels.some((l) => CEFR.indexOf(l) >= CEFR.indexOf(p.minGermanLevel!));
    out.push(ok
      ? { code: "german", severity: "pass", message: `German level meets ${p.minGermanLevel}` }
      : { code: "german", severity: "blocker", message: `German ${p.minGermanLevel} certificate required`, section: "profile" });
  }

  if (p.maxBacklogs != null && s.backlogs != null) {
    out.push(s.backlogs <= p.maxBacklogs
      ? { code: "backlogs", severity: "pass", message: `Backlogs ${s.backlogs}, limit ${p.maxBacklogs}` }
      : { code: "backlogs", severity: "blocker", message: `Backlogs ${s.backlogs} exceed the limit of ${p.maxBacklogs}` });
  }

  if (p.maxGapYears != null && s.gapYears != null && s.gapYears > p.maxGapYears) {
    out.push({ code: "gap", severity: "warning", message: `${s.gapYears}-year study gap (program allows ${p.maxGapYears}); explain it in the SOP` });
  }

  for (const code of p.requiredDocs) {
    if (!s.documentTypeCodes.includes(code)) {
      out.push({ code: `doc.${code}`, severity: "blocker", message: `${docLabels[code] ?? code} missing`, section: "documents" });
    }
  }

  const order: Record<CheckSeverity, number> = { blocker: 0, warning: 1, pass: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function summarise(results: CheckResult[]) {
  return {
    blockers: results.filter((r) => r.severity === "blocker").length,
    warnings: results.filter((r) => r.severity === "warning").length,
  };
}
