/**
 * The Ausbildung journey as a student reads it in the portal.
 *
 * The written process in ausbildung.ts is for the people who work here: step
 * titles like "Assigning a mentor to the candidate", turnarounds, hand-over
 * addresses. A student on a phone wants one plain line about what is happening
 * to them and one about what comes next, so each step carries a phrase from the
 * portal dictionary, and the pure rules that pick the application, place the
 * desks and name the next payment live here where a test can reach them. Only
 * what the student may see is in this file: no turnaround days and no desk
 * emails.
 */
import { AUSBILDUNG_DEPARTMENTS, AUSBILDUNG_PAYMENT_MILESTONES, AUSBILDUNG_STEPS, paymentMilestones, stepOfStatus, type AusbildungDepartment, type AusbildungStep, type PaymentMilestone } from "./ausbildung";
import { translator, type Locale, type Phrase } from "./i18n";

/** The portal phrase that says, in the student's words, what each step of the guide means for them. */
export const STUDENT_STEP_PHRASE: Record<number, Phrase> = {
  1: "ausbildungStep1",
  2: "ausbildungStep2",
  3: "ausbildungStep3",
  4: "ausbildungStep4",
  5: "ausbildungStep5",
  6: "ausbildungStep6",
  7: "ausbildungStep7",
  8: "ausbildungStep8",
  9: "ausbildungStep9",
  10: "ausbildungStep10",
  11: "ausbildungStep11",
  12: "ausbildungStep12",
  13: "ausbildungStep13",
  14: "ausbildungStep14",
  15: "ausbildungStep15",
  16: "ausbildungStep16",
  18: "ausbildungStep18",
  19: "ausbildungStep19",
};

/** What a step means for the student, in their language; null for a step the guide does not have. */
export function studentStepLine(step: number | null | undefined, locale: Locale = "en"): string | null {
  if (step == null) return null;
  const phrase = STUDENT_STEP_PHRASE[step];
  return phrase ? translator(locale)(phrase) : null;
}

/** The step the guide puts after this one, or null at the end of the journey. */
export function nextStep(step: AusbildungStep | null | undefined): AusbildungStep | null {
  if (!step) return null;
  const i = AUSBILDUNG_STEPS.findIndex((s) => s.step === step.step);
  return i >= 0 && i + 1 < AUSBILDUNG_STEPS.length ? AUSBILDUNG_STEPS[i + 1] : null;
}

/** The desk names a student reads, which are shorter than the staff ones. */
export const STUDENT_DESK_PHRASE: Record<AusbildungDepartment, Phrase> = {
  COUNSELLING: "deskCounselling",
  DOCUMENTATION: "deskDocumentation",
  LANGUAGE: "deskLanguage",
  PLACEMENT: "deskPlacement",
  VISA: "deskVisa",
  TRAVEL: "deskTravel",
};

export type DeskPosition = "DONE" | "NOW" | "AHEAD";

/**
 * Where each desk stands against the current step. The desks' steps interleave
 * (documentation has steps 4, 6 and 9 around the language steps), so a desk is
 * done only once every step of its own is behind the file, is "now" when the
 * current step is its, and is ahead otherwise. With no step placed, every desk
 * is ahead and none is highlighted.
 */
export function deskStanding(current: AusbildungStep | null | undefined): { key: AusbildungDepartment; position: DeskPosition }[] {
  return AUSBILDUNG_DEPARTMENTS.map((d) => {
    if (!current) return { key: d.key, position: "AHEAD" as DeskPosition };
    if (d.key === current.department) return { key: d.key, position: "NOW" as DeskPosition };
    const steps = AUSBILDUNG_STEPS.filter((s) => s.department === d.key).map((s) => s.step);
    const done = steps.length > 0 && steps.every((n) => n < current.step);
    return { key: d.key, position: done ? "DONE" : "AHEAD" };
  });
}

/**
 * The Ausbildung application the portal shows, out of all the student has: the
 * same rule the staff tab uses, so the student and the counsellor read the same
 * file. Closed rounds are left out, a finished one (joined, visa received) gives
 * way to one still being worked, and among those the one that moved most
 * recently is the live one. Null where there is no open Ausbildung application.
 */
export function pickAusbildungApplication<T extends { pathway: string; statusGroup: string; changedAt: Date | string | null }>(apps: T[]): T | null {
  const open = apps.filter((a) => a.pathway === "AUSBILDUNG" && a.statusGroup !== "CLOSED");
  if (!open.length) return null;
  const at = (a: T) => (a.changedAt ? new Date(a.changedAt).getTime() : 0);
  return [...open].sort((a, b) => {
    const aDone = a.statusGroup === "SUCCESS" ? 1 : 0;
    const bDone = b.statusGroup === "SUCCESS" ? 1 : 0;
    return aDone - bDone || at(b) - at(a);
  })[0];
}

/** The portal phrases for each payment milestone: its name and when it falls due, in the student's words. */
export const MILESTONE_PHRASE: Record<number, { label: Phrase; when: Phrase }> = {
  2: { label: "milestoneRegistration", when: "milestoneRegistrationWhen" },
  7: { label: "milestoneHalf", when: "milestoneHalfWhen" },
  11: { label: "milestoneEighty", when: "milestoneEightyWhen" },
  12: { label: "milestoneFull", when: "milestoneFullWhen" },
};

export type StudentMilestone = PaymentMilestone & {
  /** The amount this milestone needs; null while no charge is raised, which reads "Not recorded". */
  amount: number | null;
  met: boolean;
  next: boolean;
};

/**
 * The milestones against what has come in, with the next one marked.
 *
 * Where a charge is raised, the next milestone is the first percentage not yet
 * covered by what was received, so a student who paid half early is told the
 * 80 percent step is next whatever status they sit at. Where nothing is raised
 * there is no figure to measure, so nothing is marked met and the next one is
 * read off the process instead: the first milestone at or after the current
 * step, or the first of all with no step placed. The registration fee has no
 * figure in the guide and is never marked met or next by money.
 */
export function studentMilestones(owed: number, received: number, statusCode: string | null | undefined): StudentMilestone[] {
  const rows = paymentMilestones(owed, received);
  const byMoney = owed > 0;
  let nextStepNo: number | null = null;
  if (byMoney) {
    nextStepNo = rows.find((m) => m.percent != null && !m.met)?.step ?? null;
  } else {
    const current = stepOfStatus(statusCode)?.step ?? 0;
    nextStepNo = AUSBILDUNG_PAYMENT_MILESTONES.find((m) => m.step >= current)?.step ?? null;
  }
  return rows.map((m) => ({ ...m, next: m.step === nextStepNo }));
}

/** The next milestone alone, for the one line the card leads with; null when every one is met. */
export function nextMilestone(owed: number, received: number, statusCode: string | null | undefined): StudentMilestone | null {
  return studentMilestones(owed, received, statusCode).find((m) => m.next) ?? null;
}
