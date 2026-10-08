import type { Pathway, StudyLevel } from "@/db/schema";

/**
 * What a counsellor picks on a student's file, in one list.
 *
 * Two things are being recorded at once and they are not the same. The pathway
 * is the journey the file follows: a degree, an Ausbildung, a nurse
 * registration, each with its own status steps and its own documents. The
 * level is what they are aiming for inside it, which decides only which
 * courses are worth showing them.
 *
 * Asking for both in two boxes is honest and nobody fills it in. So the form
 * asks once, in the words a counsellor uses, and the pair is worked out here.
 */
export type Aim = { value: string; label: string; pathway: Pathway; level: StudyLevel | null };

export const AIMS: Aim[] = [
  { value: "DEGREE", label: "University degree (level not decided)", pathway: "DEGREE", level: null },
  { value: "DEGREE:UG", label: "Bachelor's degree", pathway: "DEGREE", level: "UG" },
  { value: "DEGREE:PG", label: "Master's", pathway: "DEGREE", level: "PG" },
  { value: "DEGREE:PHD", label: "PhD", pathway: "DEGREE", level: "PHD" },
  { value: "DEGREE:TOP_UP", label: "Top-up degree (post-basic BSc nursing and the like)", pathway: "DEGREE", level: "TOP_UP" },
  { value: "DEGREE:UG_DIPLOMA", label: "Diploma", pathway: "DEGREE", level: "UG_DIPLOMA" },
  { value: "DEGREE:PG_DIPLOMA", label: "PG diploma", pathway: "DEGREE", level: "PG_DIPLOMA" },
  { value: "AUSBILDUNG", label: "Ausbildung (Germany)", pathway: "AUSBILDUNG", level: "VOCATIONAL" },
  { value: "NURSING", label: "Nurse registration", pathway: "NURSING", level: null },
];

/** The pair behind one choice, or nulls for "not decided". */
export function readAim(value: string | null | undefined): { pathway: Pathway | null; level: StudyLevel | null } {
  const hit = AIMS.find((a) => a.value === value);
  return hit ? { pathway: hit.pathway, level: hit.level } : { pathway: null, level: null };
}

/** The choice that matches what is already on a student, for the form's default. */
export function aimOf(pathway: string | null | undefined, level: string | null | undefined): string {
  if (!pathway) return "";
  const exact = AIMS.find((a) => a.pathway === pathway && a.level === (level ?? null));
  if (exact) return exact.value;
  // A pathway recorded before the levels existed, or one carrying a level this
  // list does not offer: keep the journey and say the level is open.
  return AIMS.find((a) => a.pathway === pathway && a.level === null)?.value ?? AIMS.find((a) => a.pathway === pathway)?.value ?? "";
}

/** How it reads on the student's own file. */
export function aimLabel(pathway: string | null | undefined, level: string | null | undefined): string | null {
  const value = aimOf(pathway, level);
  return AIMS.find((a) => a.value === value)?.label ?? null;
}

/** The levels a course can be at, for a filter beside the course picker. */
export const PICK_LEVELS: [StudyLevel, string][] = [
  ["UG", "Bachelor's"],
  ["PG", "Master's"],
  ["PHD", "PhD"],
  ["TOP_UP", "Top-up degree"],
  ["UG_DIPLOMA", "Diploma"],
  ["PG_DIPLOMA", "PG diploma"],
  ["VOCATIONAL", "Ausbildung"],
  ["REGISTRATION", "Registration route"],
  ["CERTIFICATE", "Certificate"],
];
