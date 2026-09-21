/** Eligibility of one student for one program, including what is still missing. */

export type EligibilityInput = {
  backlogs: number | null;
  gapYears: number | null;
  tests: { test: string; overall: string; isMock: boolean }[];
};

export type EligibilityProgram = {
  minIelts: number | null;
  minPte: number | null;
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

function best(tests: EligibilityInput["tests"], test: string, official: boolean) {
  return tests.filter((t) => t.test === test && t.isMock === !official).map((t) => t.overall);
}

export function checkEligibility(student: EligibilityInput, program: EligibilityProgram): Eligibility {
  const met: string[] = [];
  const missing: string[] = [];
  const onTrack: string[] = [];

  const numeric = (values: string[]) => values.map(Number).filter((n) => !Number.isNaN(n));

  if (program.minIelts != null || program.minPte != null) {
    const ielts = numeric(best(student.tests, "IELTS", true));
    const pte = numeric(best(student.tests, "PTE", true));
    const ieltsMock = numeric(best(student.tests, "IELTS", false));
    const need = [program.minIelts != null && `IELTS ${program.minIelts}`, program.minPte != null && `PTE ${program.minPte}`].filter(Boolean).join(" or ");

    if ((program.minIelts != null && ielts.some((v) => v >= program.minIelts!)) || (program.minPte != null && pte.some((v) => v >= program.minPte!))) {
      met.push(`English (${need})`);
    } else if (program.minIelts != null && ieltsMock.some((v) => v >= program.minIelts!)) {
      onTrack.push(`Practice IELTS ${Math.max(...ieltsMock)} already meets ${program.minIelts}, official result pending`);
    } else if (program.moiAccepted) {
      onTrack.push("Accepts a Medium of Instruction letter instead of a test");
    } else {
      missing.push(`English: needs ${need}`);
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
 * The student's best result per test, as the SQL filter below needs them.
 * Official and practice results are kept apart, exactly as checkEligibility
 * reads them.
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
    ieltsMock: top("IELTS", false),
    // Practice grades count as on track, so the higher of the two decides.
    oet: Math.max(rank(OET, "OET", true) ?? -1, rank(OET, "OET", false) ?? -1),
    german: Math.max(rank(CEFR, "GERMAN", true) ?? -1, rank(CEFR, "GERMAN", false) ?? -1),
  };
}

export const OET_SCALE = OET;
export const CEFR_SCALE = CEFR;
