export const INTERVIEW_KINDS = {
  UK_CREDIBILITY: "UK university credibility interview",
  US_F1: "US F-1 visa interview",
  AU_GS: "Australia Genuine Student questions",
  CA_PERMIT: "Canada study permit questions",
  ADMISSION: "University admission interview",
} as const;
export type InterviewKind = keyof typeof INTERVIEW_KINDS;
