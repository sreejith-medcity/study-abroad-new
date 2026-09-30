/**
 * The message that asks a student for what is missing.
 *
 * One message, not five: everything outstanding goes out together with one link,
 * because a student who gets five messages reads none of them. Every reminder
 * afterwards is the same list, shorter.
 *
 * The reason travels with the request. A rejection the student cannot act on is
 * how a file stalls for a fortnight, so the words the team picked are the words
 * the student reads, in their own language.
 */

import type { Locale } from "./i18n";

export type AskItem = {
  /** The document's name in the student's language. */
  label: string;
  /** Why it is being asked for again, or what a good one looks like. */
  reason?: string | null;
};

export type AskInput = {
  firstName: string;
  branchName: string;
  items: AskItem[];
  dueOn?: Date | string | null;
  link: string;
  /** True when this is a reminder rather than the first ask. */
  reminder?: boolean;
};

const WORDS = {
  en: {
    hello: (name: string) => `Hello ${name},`,
    intro: "We still need these documents to move your application on:",
    introReminder: "A reminder about the documents we are still waiting for:",
    by: (date: string) => `Please send them by ${date}.`,
    upload: "You can upload them here:",
    sign: (branch: string) => `${branch}, Medcity Overseas`,
    help: "If anything is unclear, reply to this message and we will explain.",
  },
  ml: {
    hello: (name: string) => `നമസ്കാരം ${name},`,
    intro: "നിങ്ങളുടെ അപേക്ഷ മുന്നോട്ട് കൊണ്ടുപോകാൻ ഈ രേഖകൾ കൂടി വേണം:",
    introReminder: "ഞങ്ങൾ കാത്തിരിക്കുന്ന രേഖകളെക്കുറിച്ച് ഒരു ഓർമ്മപ്പെടുത്തൽ:",
    by: (date: string) => `${date} നുള്ളിൽ അയച്ചുതരണം.`,
    upload: "ഇവിടെ അപ്‌ലോഡ് ചെയ്യാം:",
    sign: (branch: string) => `${branch}, മെഡ്സിറ്റി ഓവർസീസ്`,
    help: "എന്തെങ്കിലും വ്യക്തമല്ലെങ്കിൽ ഈ സന്ദേശത്തിന് മറുപടി അയച്ചാൽ ഞങ്ങൾ വിശദീകരിക്കും.",
  },
} as const;

/** The date in words a family reads the same way in both languages. */
export function askDate(value: Date | string, locale: Locale) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const months = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    ml: ["ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ", "ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ"],
  }[locale];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Builds the message. The counsellor reads it and may change any of it before it
 * is sent: nothing goes out that a person has not looked at.
 */
export function buildAskMessage(input: AskInput, locale: Locale): string {
  const w = WORDS[locale] ?? WORDS.en;
  const lines: string[] = [w.hello(input.firstName), "", input.reminder ? w.introReminder : w.intro, ""];
  for (const item of input.items) {
    lines.push(item.reason ? `- ${item.label}: ${item.reason}` : `- ${item.label}`);
  }
  lines.push("");
  if (input.dueOn) {
    const date = askDate(input.dueOn, locale);
    if (date) lines.push(w.by(date), "");
  }
  lines.push(w.upload, input.link, "", w.help, "", w.sign(input.branchName));
  return lines.join("\n");
}

/** A one-line summary for the file, so the list reads without opening the message. */
export function askSummary(items: AskItem[]) {
  if (items.length === 0) return "Nothing outstanding";
  if (items.length === 1) return items[0].label;
  if (items.length === 2) return `${items[0].label} and ${items[1].label}`;
  return `${items[0].label}, ${items[1].label} and ${items.length - 2} more`;
}

/**
 * When the portal chases by itself, and when it stops and tells a person instead.
 *
 * The days come from the wireframe the Overseas team signed off: a nudge after
 * three days of silence, the counsellor's desk after seven, a rejection repeated
 * after two, and a flag when something runs out inside sixty days of the course.
 */
export const NUDGE_AFTER_DAYS = 3;
export const REJECTED_NUDGE_AFTER_DAYS = 2;
export const ESCALATE_AFTER_DAYS = 7;

export type ReminderItem = {
  id: string;
  state: "NOT_NEEDED" | "NOT_ASKED" | "ASKED" | "UPLOADED" | "IN_REVIEW" | "ACCEPTED" | "REJECTED";
  askedAt: Date | null;
  decidedAt: Date | null;
  lastChasedAt: Date | null;
  escalatedAt: Date | null;
};

export type ReminderVerdict = "NUDGE" | "ESCALATE" | "NOTHING";

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 86_400_000;

/**
 * What one item is owed at this moment: a nudge to the student, a task on the
 * counsellor's desk, or nothing at all.
 *
 * Silence is measured from the last time anybody spoke to the student about it,
 * not from the first ask, so a student who was chased yesterday is left alone
 * today. The counsellor is told once.
 */
export function reminderFor(item: ReminderItem, today = new Date()): ReminderVerdict {
  if (item.state === "REJECTED") {
    const since = item.lastChasedAt ?? item.decidedAt;
    if (!since) return "NOTHING";
    return daysBetween(since, today) >= REJECTED_NUDGE_AFTER_DAYS ? "NUDGE" : "NOTHING";
  }
  if (item.state !== "ASKED" || !item.askedAt) return "NOTHING";
  if (!item.escalatedAt && daysBetween(item.askedAt, today) >= ESCALATE_AFTER_DAYS) return "ESCALATE";
  const since = item.lastChasedAt ?? item.askedAt;
  return daysBetween(since, today) >= NUDGE_AFTER_DAYS ? "NUDGE" : "NOTHING";
}
