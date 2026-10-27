/**
 * The processes a fee instalment can wait on, kept generic: an instalment
 * names a pathway and a step key within it, and this list says what the
 * steps are, how each reads in words and when the file has reached one.
 *
 * The journey stages (src/lib/journey.ts), the Ausbildung guide's steps
 * (src/lib/ausbildung.ts), the NCLEX-RN placement steps (src/lib/nclex.ts)
 * and the FSJ / BFD process steps (src/lib/fsj.ts) are here today. Another
 * pathway with its own process is added by adding an entry: the database
 * stores only the pathway and the key, so nothing else changes.
 */

import type { JourneyStage } from "@/db/schema";
import { STAGES, STAGE_ORDER } from "./journey";
import { AUSBILDUNG_STEPS } from "./ausbildung";
import { NCLEX_STEPS, type NclexStepKey } from "./nclex";
import { FSJ_STEPS } from "./fsj";

export type FeeStepOption = { key: string; label: string };

export type FeeStepPathway = {
  /** Stored on the plan item and the instalment, so it never changes once used. */
  key: string;
  /** In the plan editor's "due" list. */
  dueLabel: string;
  /** What one step is called, for the editor's second list: "Instalment 2 stage". */
  stepNoun: string;
  /** The steps an instalment can wait for, in order. */
  steps: FeeStepOption[];
  /** "on offer", "at Ausbildung step 11, training contract". */
  words: (key: string) => string | null;
  /** What is said when the key is not one of the steps. */
  unknownWords: string;
  /**
   * Whether an instalment waiting on `waiting` falls due, given what the file
   * has reached on this pathway: the current stage, the furthest step, or the
   * steps completed, as keys.
   */
  reached: (waiting: string, progress: readonly string[]) => boolean;
};

const STAGE_WORDS: Record<JourneyStage, string> = {
  PROFILE: "profile",
  SHORTLIST: "shortlist",
  APPLICATION: "application",
  OFFER: "offer",
  DEPOSIT: "deposit",
  CONFIRMATION: "confirmation",
  VISA: "visa",
  DEPARTURE: "departure",
  ARRIVED: "arrival",
};

/** Which stage-tied instalments fall due now the file is on this stage: this one and any before it. */
export function stageReached(instalmentStage: JourneyStage, current: JourneyStage, order: readonly JourneyStage[] = STAGE_ORDER): boolean {
  const a = order.indexOf(instalmentStage);
  const b = order.indexOf(current);
  return a >= 0 && b >= 0 && a <= b;
}

/** The Ausbildung steps an instalment can wait for: the ones a status can put a file at. */
export const AUSBILDUNG_TRIGGER_STEPS = AUSBILDUNG_STEPS.filter((s) => s.statusCodes.length > 0);

/** An Ausbildung instalment falls due at its step and at every step after it. */
export const ausbildungStepReached = (instalmentStep: number, currentStep: number) => instalmentStep <= currentStep;

/**
 * Whether an NCLEX-RN instalment falls due now this step is completed: its
 * own step, or any later one, except that a step only taken after a pass
 * (visa screening) or after a fail (re-examination) is reached only by
 * itself, so a re-examination never bills the visa screening.
 */
export function nclexStepReached(instalmentStep: NclexStepKey, completed: NclexStepKey): boolean {
  if (instalmentStep === completed) return true;
  const s = NCLEX_STEPS.findIndex((x) => x.key === instalmentStep);
  const c = NCLEX_STEPS.findIndex((x) => x.key === completed);
  if (s < 0 || c < 0) return false;
  return !NCLEX_STEPS[s].after && s <= c;
}

/**
 * FSJ and BFD follow one written process (src/lib/fsj.ts), so they share one
 * entry: an instalment waits for a step of that process whichever of the two
 * the student is on. Stored on plans and instalments, so it never changes.
 */
export const FSJ_FEE_PATHWAY = "FSJ_BFD";

/** The FSJ / BFD steps an instalment can wait for: the ones a status can put a file at. */
export const FSJ_TRIGGER_STEPS = FSJ_STEPS.filter((s) => s.statusCodes.length > 0);

/** An FSJ / BFD instalment falls due at its step and at every step after it. */
export const fsjStepReached = (instalmentStep: number, currentStep: number) => instalmentStep <= currentStep;

export const FEE_STEP_PATHWAYS: FeeStepPathway[] = [
  {
    key: "JOURNEY",
    dueLabel: "When the file reaches a stage",
    stepNoun: "stage",
    steps: STAGES.map((s) => ({ key: s.value, label: s.label })),
    words: (key) => (key in STAGE_WORDS ? `on ${STAGE_WORDS[key as JourneyStage]}` : null),
    unknownWords: "on a stage not recorded",
    reached: (waiting, progress) => progress.some((p) => stageReached(waiting as JourneyStage, p as JourneyStage)),
  },
  {
    key: "AUSBILDUNG",
    dueLabel: "At an Ausbildung step",
    stepNoun: "Ausbildung step",
    steps: AUSBILDUNG_TRIGGER_STEPS.map((s) => ({ key: String(s.step), label: `${s.step}. ${s.title}` })),
    words: (key) => {
      const s = AUSBILDUNG_TRIGGER_STEPS.find((x) => String(x.step) === key);
      return s ? `at Ausbildung step ${s.step}, ${s.title.toLowerCase()}` : null;
    },
    unknownWords: "at an Ausbildung step not recorded",
    reached: (waiting, progress) => {
      const w = Number(waiting);
      return Number.isInteger(w) && progress.some((p) => Number.isInteger(Number(p)) && ausbildungStepReached(w, Number(p)));
    },
  },
  {
    key: "NCLEX",
    dueLabel: "When an NCLEX-RN step is completed",
    stepNoun: "NCLEX-RN step",
    steps: NCLEX_STEPS.map((s) => ({ key: s.key, label: s.label })),
    words: (key) => {
      const s = NCLEX_STEPS.find((x) => x.key === key);
      return s ? `when "${s.label}" is completed` : null;
    },
    unknownWords: "at an NCLEX-RN step not recorded",
    reached: (waiting, progress) => progress.some((p) => nclexStepReached(waiting as NclexStepKey, p as NclexStepKey)),
  },
  {
    key: FSJ_FEE_PATHWAY,
    dueLabel: "At an FSJ / BFD step",
    stepNoun: "FSJ / BFD step",
    steps: FSJ_TRIGGER_STEPS.map((s) => ({ key: String(s.step), label: `${s.step}. ${s.title}` })),
    words: (key) => {
      const s = FSJ_TRIGGER_STEPS.find((x) => String(x.step) === key);
      return s ? `at FSJ / BFD step ${s.step}, ${s.title.toLowerCase()}` : null;
    },
    unknownWords: "at an FSJ / BFD step not recorded",
    reached: (waiting, progress) => {
      const w = Number(waiting);
      return Number.isInteger(w) && progress.some((p) => Number.isInteger(Number(p)) && fsjStepReached(w, Number(p)));
    },
  },
];

export const feeStepPathway = (key: string | null | undefined): FeeStepPathway | null => FEE_STEP_PATHWAYS.find((p) => p.key === key) ?? null;

/** Whether a pathway and key name a step an instalment can wait for. */
export const isFeeStep = (pathway: string | null | undefined, key: string | null | undefined): boolean =>
  !!key && !!feeStepPathway(pathway)?.steps.some((s) => s.key === key);

/** A step in words, or what is said when it is not recorded. */
export function feeStepWords(pathway: string | null | undefined, key: string | null | undefined): string {
  const p = feeStepPathway(pathway);
  if (!p) return "at a step not recorded";
  return (key ? p.words(key) : null) ?? p.unknownWords;
}

/** Where a file stands on each pathway, as step keys: what `reached` reads. */
export type StepProgress = Record<string, readonly string[]>;

/** Whether an instalment waiting on this pathway and step has been reached by the file as it stands. */
export function feeStepReached(pathway: string | null | undefined, key: string | null | undefined, progress: StepProgress): boolean {
  const p = feeStepPathway(pathway);
  if (!p || !key) return false;
  const at = progress[p.key];
  return !!at && at.length > 0 && p.reached(key, at);
}
