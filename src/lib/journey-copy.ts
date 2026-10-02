/**
 * The nine stages in the words a student and a parent read.
 *
 * The staff labels in journey.ts are for people who work here: "Confirmation",
 * "Deposit". A family wants to know what is happening to them this month, so
 * each stage carries a short title and one line saying what is going on now.
 *
 * Kept apart from i18n.ts because that file is a flat dictionary of phrases and
 * this is one entry per stage, and apart from journey.ts because the gate rules
 * there have no business knowing Malayalam.
 */

import type { JourneyStage } from "@/db/schema";
import type { Locale } from "./i18n";
import { STAGE_ORDER } from "./journey";

export type StageCopy = { title: string; now: string };

const en: Record<JourneyStage, StageCopy> = {
  PROFILE: {
    title: "Your details",
    now: "We are putting your file together: who you are, what you have studied, and your test scores.",
  },
  SHORTLIST: {
    title: "Choosing courses",
    now: "Your counsellor is picking the courses that fit you. Nothing new is needed from you yet.",
  },
  APPLICATION: {
    title: "Applying",
    now: "Your application is being prepared and sent. This is when your documents are wanted.",
  },
  OFFER: {
    title: "Offer",
    now: "The university has replied, or is about to. Read the offer and its conditions carefully.",
  },
  DEPOSIT: {
    title: "Paying the deposit",
    now: "The university wants the tuition deposit, and proof of where the money came from.",
  },
  CONFIRMATION: {
    title: "Confirmation letter",
    now: "The university is issuing the letter the visa office asks for.",
  },
  VISA: {
    title: "Visa",
    now: "Your visa file is being put together: funds, tests and the forms.",
  },
  DEPARTURE: {
    title: "Getting ready to go",
    now: "Ticket, insurance, where you will live, forex and a SIM card.",
  },
  ARRIVED: {
    title: "Arrived",
    now: "You are there. Enrolment, the residence permit and a local bank account.",
  },
};

const ml: Record<JourneyStage, StageCopy> = {
  PROFILE: {
    title: "നിങ്ങളുടെ വിവരങ്ങൾ",
    now: "നിങ്ങളുടെ ഫയൽ തയ്യാറാക്കുന്നു: വ്യക്തിവിവരങ്ങൾ, പഠിച്ച കോഴ്സുകൾ, ടെസ്റ്റ് സ്കോറുകൾ.",
  },
  SHORTLIST: {
    title: "കോഴ്സ് തിരഞ്ഞെടുക്കൽ",
    now: "നിങ്ങൾക്ക് ചേരുന്ന കോഴ്സുകൾ കൗൺസലർ തിരഞ്ഞെടുക്കുന്നു. ഇപ്പോൾ നിങ്ങളിൽ നിന്ന് പുതുതായി ഒന്നും വേണ്ട.",
  },
  APPLICATION: {
    title: "അപേക്ഷ",
    now: "അപേക്ഷ തയ്യാറാക്കി അയയ്ക്കുന്നു. രേഖകൾ വേണ്ട സമയമാണിത്.",
  },
  OFFER: {
    title: "ഓഫർ",
    now: "യൂണിവേഴ്സിറ്റി മറുപടി നൽകി, അല്ലെങ്കിൽ ഉടൻ നൽകും. ഓഫറും അതിന്റെ നിബന്ധനകളും ശ്രദ്ധിച്ച് വായിക്കുക.",
  },
  DEPOSIT: {
    title: "ഡെപ്പോസിറ്റ് അടയ്ക്കൽ",
    now: "ട്യൂഷൻ ഡെപ്പോസിറ്റും പണം എവിടെ നിന്ന് വന്നു എന്നതിന്റെ തെളിവും യൂണിവേഴ്സിറ്റി ചോദിക്കുന്നു.",
  },
  CONFIRMATION: {
    title: "സ്ഥിരീകരണ കത്ത്",
    now: "വിസ ഓഫീസ് ചോദിക്കുന്ന കത്ത് യൂണിവേഴ്സിറ്റി നൽകുന്നു.",
  },
  VISA: {
    title: "വിസ",
    now: "വിസ ഫയൽ തയ്യാറാക്കുന്നു: ഫണ്ട്, ടെസ്റ്റുകൾ, ഫോമുകൾ.",
  },
  DEPARTURE: {
    title: "യാത്രയ്ക്കുള്ള തയ്യാറെടുപ്പ്",
    now: "ടിക്കറ്റ്, ഇൻഷുറൻസ്, താമസം, ഫോറെക്സ്, സിം കാർഡ്.",
  },
  ARRIVED: {
    title: "എത്തിച്ചേർന്നു",
    now: "നിങ്ങൾ എത്തി. എൻറോൾമെന്റ്, റെസിഡൻസ് പെർമിറ്റ്, പ്രാദേശിക ബാങ്ക് അക്കൗണ്ട്.",
  },
};

const BY_LOCALE: Record<Locale, Record<JourneyStage, StageCopy>> = { en, ml };

export const stageCopy = (stage: JourneyStage, locale: Locale): StageCopy => (BY_LOCALE[locale] ?? en)[stage] ?? en[stage];

/** Where a stage sits relative to the one the student is on. */
export type StagePosition = "DONE" | "NOW" | "AHEAD";

export type StageStep = { stage: JourneyStage; number: number; position: StagePosition } & StageCopy;

/**
 * The whole rail, in order, each step told where it stands.
 *
 * The stage a student is on is "now" even when its documents are outstanding:
 * the rail says where the file has reached, and the list underneath says what
 * is holding it there.
 */
export function stageRail(current: JourneyStage, locale: Locale): StageStep[] {
  const at = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER.map((stage, i) => ({
    stage,
    number: i + 1,
    position: i < at ? "DONE" : i === at ? "NOW" : "AHEAD",
    ...stageCopy(stage, locale),
  }));
}
