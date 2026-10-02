/**
 * The Medcity ID: the number a family reads out on the phone.
 *
 * One per student, minted once and never changed, shaped so that the branch and
 * the year are legible without looking anything up: MC-KTM-26-0041 is the
 * forty-first student Kottayam registered in 2026. The serial restarts every
 * January, per branch, so no branch ever waits on another's numbering.
 *
 * Everything here is pure. The counter that decides the serial lives in the
 * database, because two counsellors registering at the same second must not be
 * handed the same number.
 */

/** How many digits the serial is padded to. The fifth digit is allowed to spill. */
export const SERIAL_DIGITS = 4;

/** What every Medcity ID starts with, so one is recognisable out of context. */
export const ID_PREFIX = "MC";

/**
 * A branch's letters, worked out from its name when nobody has set one.
 *
 * Three letters from the first word that carries any, uppercased. It is a
 * starting point, not a decision: a super admin can set the code by hand, and
 * once a single student carries it the code is not changed again.
 */
/** Words that say nothing about which branch this is. */
const SAYS_NOTHING = ["THE", "AND", "OF", "MEDCITY", "OVERSEAS", "EDUCATION", "CONSULTANCY", "CONSULTANTS", "PVT", "LTD", "LLP", "INDIA"];

/** Words that say nothing about anything, kept out even of the fallback. */
const ARTICLES = ["THE", "AND", "OF", "PVT", "LTD", "LLP"];

export function branchCodeFrom(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  // "Medcity Kottayam" is KOT. A name with nothing but the company's own words
  // in it, as the head office has, falls back to the first word that is a word
  // at all, so the head office is MED rather than THE.
  const first = words.find((w) => !SAYS_NOTHING.includes(w)) ?? words.find((w) => !ARTICLES.includes(w)) ?? "";
  const code = first.slice(0, 3);
  return code.length >= 2 ? code : "MED";
}

/** The next candidate when a derived code is already taken: KTM, KTM2, KTM3. */
export function nextCodeCandidate(code: string, attempt: number): string {
  if (attempt <= 0) return code;
  const suffix = String(attempt + 1);
  return code.slice(0, Math.max(2, 3 - suffix.length)) + suffix;
}

/** Two digits for the year a student was registered in: 2026 reads as 26. */
export const yearPart = (year: number) => String(year % 100).padStart(2, "0");

export function formatStudentId(branchCode: string, year: number, serial: number): string {
  return [ID_PREFIX, branchCode.toUpperCase(), yearPart(year), String(serial).padStart(SERIAL_DIGITS, "0")].join("-");
}

export type StudentIdParts = { branchCode: string; year: number; serial: number };

/**
 * Reads an ID back apart, for the search box. The year is returned as the full
 * year on the assumption nobody is registering students in the nineteen
 * hundreds: 26 is 2026.
 */
export function parseStudentId(value: string): StudentIdParts | null {
  // A branch code may carry a digit where its letters were already taken, so
  // the first group is letters-then-anything rather than letters only.
  const m = /^MC[-\s]?([A-Z][A-Z0-9]{1,3})[-\s]?(\d{2})[-\s]?(\d{1,6})$/i.exec(value.trim());
  if (!m) return null;
  const serial = Number(m[3]);
  if (!Number.isFinite(serial) || serial <= 0) return null;
  return { branchCode: m[1].toUpperCase(), year: 2000 + Number(m[2]), serial };
}

/**
 * Whether what somebody typed in the search box is meant as a Medcity ID.
 *
 * Deliberately loose: "MC-KTM" and "ktm-26" are both somebody looking for a
 * student by their number, and the search should try the ID column for them.
 */
export function looksLikeStudentId(value: string): boolean {
  const v = value.trim();
  if (v.length < 3) return false;
  return /^mc[-\s]?[a-z0-9]/i.test(v) || /^[a-z]{2,4}[-\s]?\d{2}[-\s]?\d/i.test(v);
}

/**
 * How a typed fragment is matched against stored IDs: letters and digits only,
 * so a family reading "MC KTM 26 41" off a message still finds their file.
 */
export const idSearchKey = (value: string) => value.replace(/[^a-z0-9]/gi, "").toUpperCase();
