/**
 * Student visa living-cost figures as each government published them when
 * last checked (22 Sep 2026). The team keeps them current from Admin,
 * Destinations and rankings; this list only seeds a new database.
 */
export const LIVING_FUNDS: Record<string, { amount: number; note: string; source: string }> = {
  GB: {
    amount: 10539,
    note: "£1,171 a month for up to 9 months outside London (£1,529 a month, £13,761, in London), held for 28 days",
    source: "https://www.gov.uk/student-visa/money",
  },
  AU: {
    amount: 29710,
    note: "At least AUD 29,710 for living costs; confirm with the Home Affairs document checklist",
    source: "https://www.studyaustralia.gov.au/en/plan-your-move/visa-application-process",
  },
  CA: {
    amount: 23448,
    note: "Single student outside Quebec, applications from 1 Sep 2026, excluding tuition and travel",
    source: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents/financial-support.html",
  },
  NZ: {
    amount: 20000,
    note: "NZD 20,000 for each year of study (NZD 1,667 a month for courses under a year)",
    source: "https://www.immigration.govt.nz/process-to-apply/applying-for-a-visa/providing-evidence-and-documents-to-support-your-visa-application/student-fund-requirements/",
  },
  IE: {
    amount: 10000,
    note: "At least €10,000 for each academic year, on top of fees",
    source: "https://www.irishimmigration.ie/coming-to-study-in-ireland/what-are-my-study-options/a-fee-paying-private-primary-or-secondary-school/information-on-student-finances/",
  },
  DE: {
    amount: 11904,
    note: "Blocked account of at least €11,904 in 2026",
    source: "https://www.make-it-in-germany.com/en/visa-residence/types/studying",
  },
};
