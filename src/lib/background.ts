/**
 * Background questions that institutions and visa forms ask of every
 * applicant. Answered once on the profile so each application does not ask
 * again. A "yes" needs details, since the answer alone helps nobody.
 */
export const BACKGROUND_QUESTIONS = [
  { key: "visaRefused", text: "Has the student ever been refused a visa, or been removed or deported from any country?" },
  { key: "immigrationApplied", text: "Has the student applied for permanent residence or any other immigration to any country?" },
  { key: "medicalCondition", text: "Does the student have a medical condition the institution or visa officer should know about?" },
  { key: "criminalConviction", text: "Does the student have a criminal conviction anywhere?" },
] as const;

export type BackgroundKey = (typeof BACKGROUND_QUESTIONS)[number]["key"];
export type BackgroundAnswers = Partial<Record<string, { answer: boolean; details: string | null }>>;

export const backgroundComplete = (b: BackgroundAnswers | null | undefined) => BACKGROUND_QUESTIONS.every((q) => b?.[q.key] != null);
export const CONTACT_RELATIONS = ["Father", "Mother", "Guardian", "Spouse", "Sibling", "Sponsor", "Other"] as const;
