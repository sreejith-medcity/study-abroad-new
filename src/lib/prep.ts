export const PREP_TESTS = ["IELTS", "PTE", "TOEFL", "DUOLINGO", "OET", "GERMAN", "GRE", "GMAT"] as const;
export const PREP_TEST_LABEL: Record<(typeof PREP_TESTS)[number], string> = {
  IELTS: "IELTS", PTE: "PTE Academic", TOEFL: "TOEFL iBT", DUOLINGO: "Duolingo English Test", OET: "OET", GERMAN: "German (A1 to B2)", GRE: "GRE", GMAT: "GMAT",
};
