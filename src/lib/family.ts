/**
 * The family side: who may read a student's file, and which dates are coming.
 *
 * Pure on purpose. The same two rules decide what a parent sees on their phone
 * and what a counsellor is told the parent sees, so there is one answer to the
 * question rather than two that drift apart.
 */

/**
 * The relations the form offers. A sponsor uncle is as common here as a father,
 * so the list is wider than "parent". The action stores whatever string it is
 * given, so another screen or an import may pass something not on this list.
 */
export const GUARDIAN_RELATIONS = ["Father", "Mother", "Guardian", "Brother", "Sister", "Spouse", "Sponsor", "Uncle", "Aunt"] as const;

/** What a dated thing on the family view is. The wording comes from the dictionary. */
export type DateKind = "DOCUMENT_DUE" | "OFFER_ACCEPT" | "COURSE_START" | "VISA_DECISION";

export type DateAhead = {
  kind: DateKind;
  on: Date;
  /** The document's name, for a document that is due. Null for the rest. */
  about: string | null;
  /** Days from today. Negative where the date has already gone past. */
  inDays: number;
};

export type DateSources = {
  documents: { label: string; dueOn: Date | string | null }[];
  applications: { offerAcceptBy: Date | string | null; intakeMonth: number | null; intakeYear: number | null; visaLodgedOn: Date | string | null; visaDecision: string | null }[];
};

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000);

/** A date inside this many days is the one a family should be looking at. */
export const SOON_DAYS = 21;

/**
 * Every date worth putting in front of a family, nearest first.
 *
 * A course start is kept as the first of the intake month, which is all the
 * catalogue knows: the family is told the month, not a day that was invented
 * for them. A visa already decided is not a date that is coming, so it drops
 * out, and dates that have gone past are kept, because a missed one is the
 * most useful thing on the screen.
 */
export function datesAhead(src: DateSources, today: Date = new Date(), limit = 6): DateAhead[] {
  const out: DateAhead[] = [];
  const push = (kind: DateKind, on: Date | null, about: string | null = null) => {
    if (!on) return;
    out.push({ kind, on, about, inDays: daysBetween(today, on) });
  };

  for (const d of src.documents) push("DOCUMENT_DUE", asDate(d.dueOn), d.label);
  for (const a of src.applications) {
    push("OFFER_ACCEPT", asDate(a.offerAcceptBy));
    if (a.intakeYear && a.intakeMonth) push("COURSE_START", new Date(a.intakeYear, a.intakeMonth - 1, 1));
    // Lodged and still waiting: the family is watching for a decision. Once it
    // is decided there is nothing ahead, so the row goes.
    if (a.visaLodgedOn && !a.visaDecision) push("VISA_DECISION", asDate(a.visaLodgedOn));
  }

  return out
    .sort((x, y) => x.on.getTime() - y.on.getTime())
    .filter((d, i, all) => all.findIndex((o) => o.kind === d.kind && o.about === d.about && o.on.getTime() === d.on.getTime()) === i)
    .slice(0, limit);
}

/** Whether a date deserves to be highlighted rather than just listed. */
export const isSoon = (d: DateAhead) => d.inDays <= SOON_DAYS;

/**
 * One line saying what a guardian can see, for the counsellor's screen and for
 * the student's own list of who is watching.
 */
export function accessSummary(seesMoney: boolean): string {
  return seesMoney
    ? "Reads the journey, the outstanding documents and the fees. Cannot change anything or send messages."
    : "Reads the journey and the outstanding documents. No fees, no messages, and cannot change anything.";
}

/**
 * What the student is told when somebody is given access to their file.
 *
 * Said plainly, in their language, naming the person and what that person can
 * see, with the reminder that they can have it taken away. A family member is
 * added by the branch at the family's request, but the student is the one
 * whose file it is, so the student hears about it without having to ask.
 */
export function guardianAddedMessage(
  input: { studentFirstName: string; guardianName: string; relation: string; seesMoney: boolean; branchName: string },
  locale: "en" | "ml",
): string {
  const { studentFirstName, guardianName, relation, seesMoney, branchName } = input;
  if (locale === "ml") {
    return [
      `${studentFirstName}, ${branchName}-ൽ നിന്ന് ഒരു അറിയിപ്പ്.`,
      `${guardianName} (${relation}) എന്ന വ്യക്തിക്ക് ഇനി നിങ്ങളുടെ ഫയൽ വായിക്കാൻ കഴിയും: നിങ്ങൾ ഏത് ഘട്ടത്തിലാണ് എന്നതും ഇനി വേണ്ട രേഖകളും${seesMoney ? ", ഫീസ് വിവരങ്ങളും" : ""}.`,
      "അവർക്ക് ഒന്നും മാറ്റാനോ സന്ദേശം അയയ്ക്കാനോ കഴിയില്ല.",
      "ഇത് വേണ്ടെങ്കിൽ നിങ്ങളുടെ കൗൺസലറോട് പറഞ്ഞാൽ മതി.",
    ].join("\n");
  }
  return [
    `${studentFirstName}, a note from ${branchName}.`,
    `${guardianName} (${relation}) can now read your file: which step you are on and what documents are still wanted${seesMoney ? ", and the fees" : ""}.`,
    "They cannot change anything and cannot send messages.",
    "If you would rather they did not have this, tell your counsellor and it will be removed.",
  ].join("\n");
}
