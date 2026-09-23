/**
 * Reading a counsellor's own words into search filters.
 *
 * A counsellor describing a student types the same handful of things every
 * time: a test score, a mark, a destination, a budget in lakhs. This turns
 * that sentence into the filters the finder already understands, and says
 * plainly what it took from the sentence so the counsellor can correct it.
 * Nothing here guesses at a figure: a CGPA stays a CGPA and is never turned
 * into a percentage, and anything unrecognised is left for the person.
 */

import { SEASONS } from "./program-tags";

export type BriefVocab = { countries: { code: string; name: string }[]; fields: string[] };
export type Brief = {
  /** Search parameters, ready to merge into the finder's query string. */
  params: Record<string, string>;
  /** What was understood, in plain words. */
  read: string[];
  /** What was seen but could not be used. */
  notes: string[];
};

/** Words that stand for a destination, beyond the country's own name. */
const COUNTRY_WORDS: Record<string, string[]> = {
  GB: ["uk", "u.k.", "britain", "great britain", "england", "scotland", "wales", "northern ireland", "united kingdom"],
  IE: ["ireland", "republic of ireland", "dublin"],
  US: ["usa", "u.s.", "u.s.a.", "us", "america", "united states", "states"],
  CA: ["canada", "canadian"],
  AU: ["australia", "australian", "aussie", "oz"],
  NZ: ["new zealand", "nz", "kiwi"],
  DE: ["germany", "german", "deutschland"],
  FR: ["france", "french"],
  NL: ["netherlands", "holland", "dutch"],
  SG: ["singapore"],
  AE: ["dubai", "uae", "emirates"],
  PL: ["poland", "polish"],
  IT: ["italy", "italian"],
  ES: ["spain", "spanish"],
  FI: ["finland"],
  SE: ["sweden"],
  MT: ["malta"],
  GE: ["georgia"],
  RU: ["russia"],
  PH: ["philippines"],
  UZ: ["uzbekistan"],
  KZ: ["kazakhstan"],
};

/** Level words, longest first so "pg diploma" wins over "pg". */
const LEVEL_WORDS: [RegExp, string][] = [
  [/\b(pg ?dip(loma)?|post ?graduate diploma|pgdm)\b/, "PG_DIPLOMA"],
  [/\b(ausbildung|apprenticeship|vocational training)\b/, "VOCATIONAL"],
  [/\b(nurse registration|nursing registration|registration route|nmc|osce|nclex)\b/, "REGISTRATION"],
  [/\b(ph\.?d|doctorate|doctoral)\b/, "PHD"],
  [/\b(masters?|master's|m\.?s\.?c?|mba|m\.?tech|pg|post ?graduate|pgt)\b/, "PG"],
  [/\b(bachelors?|bachelor's|under ?grad(uate)?|ug|b\.?tech|b\.?sc|b\.?com|bba|b\.?a\b)\b/, "UG"],
  [/\b(advanced diploma|diploma|certificate course)\b/, "UG_DIPLOMA"],
];

const SEASON_WORDS: [RegExp, keyof typeof SEASONS][] = [
  [/\b(jan(uary)?|feb(ruary)?|march|april|winter intake|spring)\b/, "spring"],
  [/\b(may|june|july|august|summer intake)\b/, "summer"],
  [/\b(sep(t|tember)?|oct(ober)?|nov(ember)?|fall|autumn)\b/, "fall"],
];

/** One-click filters the sentence can ask for. */
const PREF_WORDS: [RegExp, string, string][] = [
  [/\b(no|without|waive[ds]?) (an? )?(ielts|english test|english)\b/, "noEnglish", "no English test needed"],
  [/\b(moi|medium of instruction)\b/, "moi", "MOI accepted"],
  [/\bscholarship/, "scholarship", "scholarship available"],
  [/\b(psw|post ?study work|work permit|work rights|stay back|stay-back)\b/, "workRights", "post-study work"],
  [/\b(no|without) gre\b/, "noGre", "no GRE"],
  [/\b(no|without) gmat\b/, "noGmat", "no GMAT"],
  [/\b(low|small|minimum) deposit\b/, "lowDeposit", "deposit under 1,500"],
  [/\b(no|without|zero) application fee\b/, "noAppFee", "no application fee"],
  [/\b(fee waiver|waiver)\b/, "waiver", "application fee waiver"],
];

const TESTS: { key: string; label: string; words: string; min: number; max: number; decimals: boolean }[] = [
  { key: "ae_ielts", label: "IELTS", words: "ielts", min: 1, max: 9, decimals: true },
  { key: "ae_pte", label: "PTE", words: "pte", min: 10, max: 90, decimals: false },
  { key: "ae_toefl", label: "TOEFL", words: "toefl", min: 20, max: 120, decimals: false },
  { key: "ae_duolingo", label: "Duolingo", words: "duolingo|det", min: 10, max: 160, decimals: false },
  { key: "ae_gre", label: "GRE", words: "gre", min: 260, max: 340, decimals: false },
  { key: "ae_gmat", label: "GMAT", words: "gmat", min: 200, max: 800, decimals: false },
];

const num = (s: string) => Number(s.replace(/,/g, ""));

/** A score written either way round: "IELTS 6.5" or "6.5 in IELTS". */
function findScore(text: string, words: string, decimals: boolean) {
  const n = decimals ? "\\d(?:\\.\\d)?(?!\\d)" : "\\d{2,3}(?!\\d)";
  const after = text.match(new RegExp(`(?:${words})[^0-9]{0,15}(${n})`, "i"));
  if (after) return num(after[1]);
  const before = text.match(new RegExp(`(${n})[^0-9a-z]{0,6}(?:band[s]? )?(?:in |on |at )?(?:${words})\\b`, "i"));
  return before ? num(before[1]) : null;
}

/** Marks written as a percentage, with the study they belong to where it is said. */
function findPercents(text: string) {
  const out: { level: "SCHOOL" | "UG" | null; value: number }[] = [];
  const re = /(\d{2}(?:\.\d{1,2})?)\s*(?:%|per ?cent|percentage)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const value = num(m[1]);
    if (value < 30 || value > 100) continue;
    const around = `${text.slice(Math.max(0, m.index - 40), m.index)} ${text.slice(m.index + m[0].length, m.index + m[0].length + 20)}`;
    // Only words that can describe study already done. "Bachelor's" and
    // "master's" are left out on purpose: they are usually the course being
    // asked for, not the one the marks belong to, so the level decides instead.
    const school = /12th|xii|twelfth|plus ?two|\+2|hsc|higher secondary|school|board/i.test(around);
    const degree = /degree|graduation|graduate|b\.?tech|b\.?sc|b\.?com|bba|b\.?a\b/i.test(around);
    out.push({ level: school ? "SCHOOL" : degree ? "UG" : null, value });
  }
  return out;
}

/**
 * Reads a description into finder filters. Everything it takes is listed in
 * `read`, and everything it had to leave alone in `notes`, because the person
 * corrects the fields afterwards and needs to see what was assumed.
 */
export function parseBrief(input: string, vocab: BriefVocab): Brief {
  const text = ` ${input.toLowerCase().replace(/\s+/g, " ")} `;
  const params: Record<string, string> = {};
  const read: string[] = [];
  const notes: string[] = [];

  for (const t of TESTS) {
    const v = findScore(text, t.words, t.decimals);
    if (v != null && v >= t.min && v <= t.max) {
      params[t.key] = String(v);
      read.push(`${t.label} ${v}`);
    }
  }

  // Level first: it decides which study an unlabelled percentage belongs to.
  for (const [re, level] of LEVEL_WORDS) {
    if (re.test(text)) {
      params.level = level;
      if (level === "VOCATIONAL") params.pathway = "AUSBILDUNG";
      if (level === "REGISTRATION") params.pathway = "NURSING";
      read.push(LEVEL_READ[level]);
      break;
    }
  }

  const percents = findPercents(text);
  const wantsPg = ["PG", "PG_DIPLOMA", "PHD", "REGISTRATION"].includes(params.level ?? "");
  for (const pc of percents) {
    const level = pc.level ?? (wantsPg ? "UG" : "SCHOOL");
    const key = level === "UG" ? "ae_ug" : "ae_12";
    if (params[key]) continue;
    params[key] = String(pc.value);
    const label = level === "UG" ? "bachelor's" : "Std. 12th";
    read.push(pc.level ? `${label} ${pc.value}%` : `${label} ${pc.value}% (taken from the level asked for)`);
  }
  // A CGPA is never turned into a percentage, here or anywhere else.
  if (/\b(cgpa|gpa)\b/i.test(text)) notes.push("A CGPA cannot be turned into a percentage. Type the percentage, or pick the student's file to use the marks on it.");

  const backlogs = text.match(/(\d{1,2})\s*(?:active |current )?backlog/i);
  if (backlogs) {
    params.ae_backlogs = backlogs[1];
    read.push(`${backlogs[1]} backlog${backlogs[1] === "1" ? "" : "s"}`);
  } else if (/\bno backlogs?\b/i.test(text)) {
    params.ae_backlogs = "0";
    read.push("no backlogs");
  }
  const gap = text.match(/(\d{1,2})\s*(?:-|\s)?(?:year|yr)s?\s*(?:study )?gap|gap of (\d{1,2})/i);
  if (gap) {
    const years = gap[1] ?? gap[2];
    params.ae_gap = years;
    read.push(`${years}-year gap`);
  }

  const budget = text.match(/(\d{1,3}(?:\.\d{1,2})?)\s*(lakhs?|lacs?|l\b|crores?|cr\b)/i);
  if (budget) {
    const lakh = /cr/i.test(budget[2]) ? num(budget[1]) * 100 : num(budget[1]);
    if (lakh > 0 && lakh <= 200) {
      params.budget = String(lakh);
      read.push(`tuition up to ₹${lakh} lakh a year`);
    }
  }

  const codes: string[] = [];
  for (const c of vocab.countries) {
    const words = [c.name.toLowerCase(), ...(COUNTRY_WORDS[c.code] ?? [])];
    if (words.some((w) => text.includes(` ${w} `) || text.includes(` ${w},`) || text.includes(` ${w}.`))) codes.push(c.code);
  }
  if (codes.length) {
    params.country = codes.join(",");
    read.push(codes.map((code) => vocab.countries.find((c) => c.code === code)!.name).join(" or "));
  }

  const seasons = SEASON_WORDS.filter(([re]) => re.test(text)).map(([, s]) => s);
  if (seasons.length) {
    params.season = [...new Set(seasons)].join(",");
    read.push(`${[...new Set(seasons)].join(" or ")} intake`);
  }

  // The longest field name that appears, so "computer science" beats "science".
  const field = vocab.fields
    .filter((f) => f && text.includes(` ${f.toLowerCase()}`))
    .sort((a, b) => b.length - a.length)[0];
  if (field) {
    params.field = field;
    read.push(field);
  }

  for (const [re, key, label] of PREF_WORDS) {
    if (re.test(text)) {
      params[key] = "1";
      read.push(label);
    }
  }

  if (!read.length && input.trim()) notes.push("Nothing in that description matched a filter. Fill the fields below instead.");
  return { params, read, notes };
}

const LEVEL_READ: Record<string, string> = {
  PG: "master's",
  PG_DIPLOMA: "PG diploma",
  UG: "bachelor's",
  UG_DIPLOMA: "diploma",
  PHD: "PhD",
  VOCATIONAL: "Ausbildung",
  REGISTRATION: "nurse registration",
};
