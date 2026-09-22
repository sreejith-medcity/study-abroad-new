/** Eligibility of one student for one program, including what is still missing. */

export type AcademicInput = { level: string; gradingSystem: string | null; score: number | null };

export type EligibilityInput = {
  backlogs: number | null;
  gapYears: number | null;
  tests: { test: string; overall: string; isMock: boolean }[];
  /** Left out, the academic minimum is not checked at all. */
  academics?: AcademicInput[];
};

export type EligibilityProgram = {
  level?: string;
  minIelts: number | null;
  minPte: number | null;
  minToefl?: number | null;
  minDuolingo?: number | null;
  minGre?: number | null;
  minGmat?: number | null;
  minSat?: number | null;
  minAcademicPercent?: number | null;
  minOetGrade: string | null;
  minGermanLevel: string | null;
  maxBacklogs: number | null;
  maxGapYears: number | null;
  moiAccepted: boolean;
};

export type Eligibility = {
  verdict: "eligible" | "on-track" | "blocked" | "unknown";
  met: string[];
  missing: string[];
  onTrack: string[];
};

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const OET = ["E", "D", "C", "C+", "B", "A"];

/** English tests an institution may name, in the order they are listed to people. */
export const ENGLISH_TESTS = [
  { test: "IELTS", key: "minIelts" },
  { test: "PTE", key: "minPte" },
  { test: "TOEFL", key: "minToefl" },
  { test: "DUOLINGO", key: "minDuolingo" },
] as const;
export const ADMISSION_TESTS = [
  { test: "GRE", key: "minGre" },
  { test: "GMAT", key: "minGmat" },
  { test: "SAT", key: "minSat" },
] as const;
export const TEST_LABEL: Record<string, string> = { IELTS: "IELTS", PTE: "PTE", TOEFL: "TOEFL iBT", DUOLINGO: "Duolingo", GRE: "GRE", GMAT: "GMAT", SAT: "SAT", ACT: "ACT", OET: "OET", GERMAN: "German" };

/**
 * Which earlier study the academic minimum is measured on: Std. 12th for a
 * bachelor's, diploma or vocational program, the bachelor's for a master's or
 * PG diploma or a registration route, the master's for a PhD.
 */
export function qualifyingLevel(programLevel: string | undefined): "SCHOOL" | "UG" | "PG" | null {
  if (!programLevel) return null;
  if (["PG", "PG_DIPLOMA", "REGISTRATION"].includes(programLevel)) return "UG";
  if (programLevel === "PHD") return "PG";
  if (programLevel === "SCHOOL") return null;
  return "SCHOOL";
}
export const QUALIFYING_LABEL = { SCHOOL: "Std. 12th", UG: "bachelor's", PG: "master's" } as const;

/** The best percentage recorded at each level. CGPA and GPA are never converted. */
export function bestPercents(academics: AcademicInput[]) {
  const out: Record<"SCHOOL" | "UG" | "PG", number | null> = { SCHOOL: null, UG: null, PG: null };
  for (const a of academics) {
    if (a.gradingSystem !== "percentage" || a.score == null) continue;
    const k = a.level as keyof typeof out;
    if (k in out) out[k] = Math.max(out[k] ?? -Infinity, a.score);
  }
  return out;
}

function best(tests: EligibilityInput["tests"], test: string, official: boolean) {
  return tests.filter((t) => t.test === test && t.isMock === !official).map((t) => t.overall);
}

export function checkEligibility(student: EligibilityInput, program: EligibilityProgram): Eligibility {
  const met: string[] = [];
  const missing: string[] = [];
  const onTrack: string[] = [];

  const numeric = (values: string[]) => values.map(Number).filter((n) => !Number.isNaN(n));
  const named = ENGLISH_TESTS.map((e) => ({ ...e, min: program[e.key] ?? null })).filter((e) => e.min != null);

  if (named.length) {
    const need = named.map((e) => `${TEST_LABEL[e.test]} ${e.min}`).join(" or ");
    const ieltsMock = numeric(best(student.tests, "IELTS", false));
    if (named.some((e) => numeric(best(student.tests, e.test, true)).some((v) => v >= e.min!))) {
      met.push(`English (${need})`);
    } else if (program.minIelts != null && ieltsMock.some((v) => v >= program.minIelts!)) {
      onTrack.push(`Practice IELTS ${Math.max(...ieltsMock)} already meets ${program.minIelts}, official result pending`);
    } else if (program.moiAccepted) {
      onTrack.push("Accepts a Medium of Instruction letter instead of a test");
    } else {
      missing.push(`English: needs ${need}`);
    }
  }

  for (const t of ADMISSION_TESTS) {
    const min = program[t.key];
    if (min == null) continue;
    if (numeric(best(student.tests, t.test, true)).some((v) => v >= min)) met.push(`${t.test} ${min}`);
    else missing.push(`${t.test}: needs ${min}`);
  }

  const level = qualifyingLevel(program.level);
  if (program.minAcademicPercent != null && level && student.academics) {
    const label = QUALIFYING_LABEL[level];
    const pct = bestPercents(student.academics)[level];
    const recorded = student.academics.some((a) => a.level === level && a.score != null);
    if (pct != null) {
      if (pct >= program.minAcademicPercent) met.push(`${label} ${pct}% of ${program.minAcademicPercent}%`);
      else missing.push(`${label} ${pct}%, needs ${program.minAcademicPercent}%`);
    } else if (recorded) {
      onTrack.push(`${label} is graded as CGPA or GPA: check the institution's conversion against ${program.minAcademicPercent}%`);
    } else {
      onTrack.push(`Needs ${program.minAcademicPercent}% in the ${label}: add the student's marks to check`);
    }
  }

  if (program.minOetGrade) {
    const grades = best(student.tests, "OET", true);
    const mock = best(student.tests, "OET", false);
    if (grades.some((g) => OET.indexOf(g) >= OET.indexOf(program.minOetGrade!))) met.push(`OET ${program.minOetGrade}`);
    else if (mock.some((g) => OET.indexOf(g) >= OET.indexOf(program.minOetGrade!))) onTrack.push(`Practice OET already at ${program.minOetGrade}, official result pending`);
    else missing.push(`OET: needs grade ${program.minOetGrade}`);
  }

  if (program.minGermanLevel) {
    const levels = best(student.tests, "GERMAN", true);
    const mock = best(student.tests, "GERMAN", false);
    if (levels.some((l) => CEFR.indexOf(l) >= CEFR.indexOf(program.minGermanLevel!))) met.push(`German ${program.minGermanLevel}`);
    else if (mock.some((l) => CEFR.indexOf(l) >= CEFR.indexOf(program.minGermanLevel!))) onTrack.push(`Practice German already at ${program.minGermanLevel}, certificate pending`);
    else missing.push(`German: needs ${program.minGermanLevel}`);
  }

  if (program.maxBacklogs != null && student.backlogs != null) {
    if (student.backlogs <= program.maxBacklogs) met.push(`Backlogs ${student.backlogs} of ${program.maxBacklogs}`);
    else missing.push(`Backlogs ${student.backlogs}, limit ${program.maxBacklogs}`);
  }

  if (program.maxGapYears != null && student.gapYears != null && student.gapYears > program.maxGapYears) {
    onTrack.push(`${student.gapYears}-year study gap, above the usual ${program.maxGapYears}: explain it in the SOP`);
  }

  const verdict = missing.length ? "blocked" : onTrack.length ? "on-track" : met.length ? "eligible" : "unknown";
  return { verdict, met, missing, onTrack };
}

/**
 * The student's best result per test, as the SQL filter needs them. Official
 * and practice results are kept apart, exactly as checkEligibility reads them.
 */
export function bestScores(tests: EligibilityInput["tests"]) {
  const top = (test: string, official: boolean) => {
    const values = best(tests, test, official).map(Number).filter((n) => !Number.isNaN(n));
    return values.length ? Math.max(...values) : null;
  };
  const rank = (scale: string[], test: string, official: boolean) => {
    const idx = best(tests, test, official).map((g) => scale.indexOf(g)).filter((i) => i >= 0);
    return idx.length ? Math.max(...idx) : null;
  };
  return {
    ielts: top("IELTS", true),
    pte: top("PTE", true),
    toefl: top("TOEFL", true),
    duolingo: top("DUOLINGO", true),
    gre: top("GRE", true),
    gmat: top("GMAT", true),
    sat: top("SAT", true),
    ieltsMock: top("IELTS", false),
    // Practice grades count as on track, so the higher of the two decides.
    oet: Math.max(rank(OET, "OET", true) ?? -1, rank(OET, "OET", false) ?? -1),
    german: Math.max(rank(CEFR, "GERMAN", true) ?? -1, rank(CEFR, "GERMAN", false) ?? -1),
  };
}

export const OET_SCALE = OET;
export const CEFR_SCALE = CEFR;
