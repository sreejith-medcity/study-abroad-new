/**
 * Australia's CRICOS register (data.gov.au, CC BY 2.5 AU) turned into
 * universities and programs for the catalogue.
 *
 * Pure functions only: the sync that fetches and saves lives in
 * src/server/cricos-sync.ts, so this can be tested against the real files.
 *
 * What the register gives and what it does not:
 * - It gives the provider, the course, its level, field, duration in weeks,
 *   the campuses, and the international tuition for the WHOLE course.
 * - It does not give entry requirements, intakes or an application fee. Those
 *   stay empty rather than guessed, and the program lands as a draft.
 */
import Papa from "papaparse";

export const CRICOS_SOURCE = "CRICOS";

type Level = "SCHOOL" | "UG_DIPLOMA" | "UG" | "PG_DIPLOMA" | "PG" | "PHD" | "CERTIFICATE";

const LEVELS: Record<string, Level> = {
  "Bachelor Degree": "UG",
  "Bachelor Honours Degree": "UG",
  // A level below a bachelor's (AQF 6), so it sits with the diplomas.
  "Associate Degree": "UG_DIPLOMA",
  "Masters Degree (Coursework)": "PG",
  "Masters Degree (Extended)": "PG",
  "Masters Degree (Research)": "PG",
  "Graduate Diploma": "PG_DIPLOMA",
  "Graduate Certificate": "PG_DIPLOMA",
  "Doctoral Degree": "PHD",
  Diploma: "UG_DIPLOMA",
  "Advanced Diploma": "UG_DIPLOMA",
  "Certificate I": "CERTIFICATE",
  "Certificate II": "CERTIFICATE",
  "Certificate III": "CERTIFICATE",
  "Certificate IV": "CERTIFICATE",
  "Vocational Short Course": "CERTIFICATE",
  "Non AQF Award": "CERTIFICATE",
  "Senior Secondary Certificate of Education": "SCHOOL",
  "Junior Secondary Studies": "SCHOOL",
  "Primary School Studies": "SCHOOL",
};

export function mapLevel(courseLevel: string): Level {
  return LEVELS[courseLevel.trim()] ?? "CERTIFICATE";
}

/** The degree levels Home Affairs lists as eligible for the 485 Post-Higher Education Work stream. */
const DEGREE_485 = new Set([
  "Bachelor Degree",
  "Bachelor Honours Degree",
  "Masters Degree (Coursework)",
  "Masters Degree (Extended)",
  "Masters Degree (Research)",
  "Doctoral Degree",
]);
const VET = new Set(["Certificate III", "Certificate IV", "Diploma", "Advanced Diploma"]);

/**
 * The course side of the subclass 485 rule, from Home Affairs: an eligible
 * degree, and 92 weeks of study as registered on CRICOS. Anything the student
 * brings (age, English, other Australian study) is theirs to meet, so a short
 * degree is "not confirmed" rather than "no".
 */
export function workRights485(courseLevel: string, weeks: number | null): { workRights: "ELIGIBLE" | "UNKNOWN"; note: string | null } {
  const level = courseLevel.trim();
  if (DEGREE_485.has(level)) {
    if (weeks != null && weeks >= 92) {
      return { workRights: "ELIGIBLE", note: "485 Post-Higher Education Work: a CRICOS degree of 92+ weeks meets the study requirement (Home Affairs)" };
    }
    return { workRights: "UNKNOWN", note: "Degree under 92 weeks: meets the 485 study requirement only together with other Australian study (Home Affairs)" };
  }
  if (VET.has(level)) {
    return { workRights: "UNKNOWN", note: "Not a degree, so no 485 Post-Higher Education stream; the Post-Vocational stream may apply for skilled-list trades" };
  }
  return { workRights: "UNKNOWN", note: null };
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);

/** "$13,300.00" to 13300. Blank or unreadable stays null: an unknown fee is never zero. */
export function parseMoney(value: string | undefined): number | null {
  const v = (value ?? "").replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseWeeks(value: string | undefined): number | null {
  const n = Number((value ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 104 weeks is 24 months; the register counts weeks, the catalogue months. */
export function weeksToMonths(weeks: number | null): number | null {
  return weeks == null ? null : Math.max(1, Math.round((weeks * 12) / 52));
}

/** "0905 - Human Welfare Studies and Services" to "Human Welfare Studies and Services". */
export function stripFieldCode(field: string | undefined): string | null {
  const v = (field ?? "").replace(/^\s*\d+\s*-\s*/, "").trim();
  return v || null;
}


/** Up to three campus towns, then a count, so the row stays readable. */
export function campusText(cities: string[]): string | null {
  const unique = [...new Set(cities.map((c) => titleCase(c.trim())).filter(Boolean))];
  if (!unique.length) return null;
  return unique.length <= 3 ? unique.join(", ") : `${unique.slice(0, 3).join(", ")} and ${unique.length - 3} more`;
}

/**
 * A readable name for a provider. Private providers register under their
 * company name ("... Pty Ltd") and trade under the name students know, so the
 * trading name wins when there is one. A trailing "(RMIT)" style acronym goes.
 */
export function providerName(institutionName: string, tradingName: string): string {
  const clean = (s: string) => s.split(";")[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
  const trading = clean(tradingName ?? "");
  const legal = clean(institutionName);
  const chosen = trading && (/\b(pty|ltd|limited|incorporated|inc)\b/i.test(legal) || trading.length <= legal.length) ? trading : legal || trading;
  // "MONASH POLYTECHNIC COLLEGE PTY LTD" reads as "Monash Polytechnic College".
  const bare = chosen.replace(/[\s,]+(pty\.?\s*)?(ltd\.?|limited)$/i, "").replace(/[\s,]+(pty\.?)$/i, "").trim();
  return bare === bare.toUpperCase() && /[A-Z]{4}/.test(bare) ? titleCase(bare).replace(/\b(Of|And|For|The|In)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase()) : bare;
}

/**
 * Providers already in the catalogue under the name counsellors know. Matched
 * by CRICOS provider code so the import attaches to them instead of creating a
 * second "Deakin University (Deakin)" beside "Deakin University".
 */
export const KNOWN_PROVIDERS: Record<string, string> = {
  "00004G": "Australian Catholic University",
  "00219C": "CQUniversity",
  "00005F": "Charles Sturt University",
  "00301J": "Curtin University",
  "00113B": "Deakin University",
  "00103D": "Federation University Australia",
  "00114A": "Flinders University",
  "00117J": "James Cook University",
  "00002J": "Macquarie University",
  "00008C": "Monash University",
  "00125J": "Murdoch University",
  "00213J": "Queensland University of Technology",
  "00122A": "RMIT University",
  "00111D": "Swinburne University of Technology",
  "00591E": "TAFE NSW",
  "03020E": "TAFE Queensland",
  "00099F": "University of Technology Sydney",
  "00102E": "University of Wollongong",
  "00124K": "Victoria University",
  "02475D": "Victoria University",
  "00917K": "Western Sydney University",
};

export type CricosProvider = { code: string; name: string; city: string | null; isPublic: boolean; website: string | null };
export type CricosCourse = {
  code: string;
  providerCode: string;
  name: string;
  courseLevel: string;
  level: Level;
  studyArea: string | null;
  durationWeeks: number | null;
  durationMonths: number | null;
  tuitionTotal: number | null;
  campus: string | null;
  workRights: "ELIGIBLE" | "UNKNOWN";
  workRightsNote: string | null;
};

const read = (text: string) =>
  Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true }).data;

/**
 * Turns the three register files into providers and live courses. Expired
 * courses are left out. Provider names that collide get their code appended,
 * because the catalogue keys universities by name within a country.
 */
export function buildCricos(files: { institutions: string; courses: string; locations: string }) {
  const institutions = read(files.institutions);
  const courses = read(files.courses).filter((r) => (r["Expired"] ?? "").trim() !== "Yes" && r["CRICOS Course Code"]);
  const locations = read(files.locations);

  const citiesByCourse = new Map<string, string[]>();
  for (const l of locations) {
    const code = l["CRICOS Course Code"];
    if (!code) continue;
    const list = citiesByCourse.get(code) ?? [];
    list.push(l["Location City"] ?? "");
    citiesByCourse.set(code, list);
  }

  const providers = new Map<string, CricosProvider>();
  const taken = new Map<string, string>();
  for (const i of institutions) {
    const code = (i["CRICOS Provider Code"] ?? "").trim();
    if (!code) continue;
    let name = KNOWN_PROVIDERS[code] ?? providerName(i["Institution Name"] ?? "", i["Trading Name"] ?? "");
    const owner = taken.get(name.toLowerCase());
    // Two providers, one name: the second keeps its code so neither swallows
    // the other. Known aliases (Victoria University's two codes) share by design.
    if (owner && owner !== code && !(KNOWN_PROVIDERS[code] && KNOWN_PROVIDERS[owner] === KNOWN_PROVIDERS[code])) name = `${name} (${code})`;
    taken.set(name.toLowerCase(), code);
    providers.set(code, {
      code,
      name,
      city: i["Postal Address City"] ? titleCase(i["Postal Address City"]) : null,
      isPublic: (i["Institution Type"] ?? "").trim() === "Government",
      website: (i["Website"] ?? "").trim() || null,
    });
  }

  const out: CricosCourse[] = [];
  for (const c of courses) {
    const providerCode = (c["CRICOS Provider Code"] ?? "").trim();
    if (!providers.has(providerCode)) continue;
    const weeks = parseWeeks(c["Duration (Weeks)"]);
    const courseLevel = (c["Course Level"] ?? "").trim();
    const wr = workRights485(courseLevel, weeks);
    out.push({
      code: c["CRICOS Course Code"].trim(),
      providerCode,
      name: (c["Course Name"] ?? "").trim(),
      courseLevel,
      level: mapLevel(courseLevel),
      studyArea: stripFieldCode(c["Field of Education 1 Narrow Field"]),
      durationWeeks: weeks,
      durationMonths: weeksToMonths(weeks),
      tuitionTotal: parseMoney(c["Tuition Fee"]),
      campus: campusText(citiesByCourse.get(c["CRICOS Course Code"].trim()) ?? []),
      workRights: wr.workRights,
      workRightsNote: wr.note,
    });
  }
  const used = new Set(out.map((c) => c.providerCode));
  return { providers: [...providers.values()].filter((p) => used.has(p.code)), courses: out };
}
