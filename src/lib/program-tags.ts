/** Labels the Overseas team puts on programs from what it knows of each institution. */
export const PROGRAM_TAGS = {
  FAST_OFFER: "Faster offer",
  HIGH_ACCEPTANCE: "High offer acceptance",
  NO_INTERVIEW: "No interview",
  STEM: "STEM",
  MAJOR_CITY: "Major city",
  HIGH_JOB_DEMAND: "High job demand",
  AFFORDABLE: "Affordable",
  NON_COLLATERAL_LOAN: "Non-collateral loan",
  FIFTEEN_YEARS: "Takes 15 years of education",
  ESL_AVAILABLE: "English course available",
} as const;
export type ProgramTag = keyof typeof PROGRAM_TAGS;
export const TAG_KEYS = Object.keys(PROGRAM_TAGS) as ProgramTag[];

/** Intake seasons as the months they cover. */
export const SEASONS = { spring: [1, 2, 3, 4], summer: [5, 6, 7, 8], fall: [9, 10, 11, 12] } as const;
export const SEASON_LABEL = { spring: "Spring (Jan to Apr)", summer: "Summer (May to Aug)", fall: "Fall (Sep to Dec)" } as const;
