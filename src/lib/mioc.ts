/**
 * The catalogue kept in Medcity's older MIOC app (the mobile app's MySQL
 * database), turned into countries, universities and programs for this portal.
 *
 * It reads a phpMyAdmin SQL export. Only four tables are used:
 * tb_destinations (countries), tb_universities, tb_courses and tb_main_course
 * (the study areas). Every other table in the file is stepped over without
 * being kept, so a full export with students in it can be given and nothing
 * about a student leaves the browser it was opened in.
 *
 * Pure functions only, so it runs in the browser and in the suites alike.
 * The writing lives in src/server/mioc-load.ts.
 *
 * What is taken and what is not:
 * - The tuition fee is taken as a yearly figure, because that is what the app
 *   recorded: checked against programs researched by hand, it matched the
 *   yearly fee and never the whole-course fee. It is taken only when it is a
 *   plain figure in the country's own currency. A figure for a semester, for
 *   "9 months" or in another currency is kept in words in the notes instead.
 * - A nought for a fee or a test score is read as "not recorded": the app put
 *   nought in every box of rows nobody had filled in.
 * - Ranges ("7-10 months") and weeks are not turned into a number of months.
 * - The app's own university rank is not taken: it does not say whose ranking.
 */

export const MIOC_SOURCE = "MIOC";
export const miocCode = (courseId: number | string) => `MIOC:${courseId}`;

/** Names compare without case, punctuation or "&" versus "and". Same rule as the CRICOS sync. */
export const nameKey = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");

type Value = string | number | null;
export type DumpTables = Record<string, Record<string, Value>[]>;

/** The tables this import reads. */
export const MIOC_TABLES = ["tb_destinations", "tb_universities", "tb_courses", "tb_main_course"] as const;

/**
 * Reads the INSERT statements of a phpMyAdmin (MySQL or MariaDB) export.
 * Rows of the tables asked for come back as objects keyed by column name;
 * every other table is parsed past and dropped.
 */
export function parseDump(text: string, tables: readonly string[] = MIOC_TABLES): DumpTables {
  const want = new Set(tables);
  const out: DumpTables = Object.fromEntries(tables.map((t) => [t, []]));
  const marker = "INSERT INTO `";
  let i = text.indexOf(marker);
  let lastEnd = i;
  while (i !== -1) {
    i += marker.length;
    const nameEnd = text.indexOf("`", i);
    const table = text.slice(i, nameEnd);
    i = nameEnd + 1;
    // Column list, when the export has one (phpMyAdmin always writes it).
    let columns: string[] | null = null;
    while (text[i] === " ") i++;
    if (text[i] === "(") {
      const close = text.indexOf(")", i);
      columns = text
        .slice(i + 1, close)
        .split(",")
        .map((c) => c.trim().replace(/^`|`$/g, ""));
      i = close + 1;
    }
    const values = text.indexOf("VALUES", i);
    // An INSERT ... SELECT (inside an exported trigger, say) has no VALUES to read.
    if (values === -1) throw new Error(`Could not read the rows of ${table}. Is this a phpMyAdmin SQL export?`);
    i = values + 6;
    const keep = want.has(table);
    // Tuples until the statement's closing semicolon.
    for (;;) {
      while (i < text.length && text[i] !== "(" && text[i] !== ";") i++;
      if (i >= text.length) throw new Error(`The file ends in the middle of ${table}. It looks cut short; export it again.`);
      if (text[i] === ";") break;
      i++; // past "("
      const row: Value[] = [];
      for (;;) {
        while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") i++;
        const ch = text[i];
        if (ch === "'") {
          // A quoted string: backslash escapes, and '' for a quote.
          i++;
          let s = "";
          let start = i;
          for (;;) {
            const c = text[i];
            if (c === "\\") {
              s += text.slice(start, i);
              const n = text[i + 1];
              s += n === "n" ? "\n" : n === "r" ? "\r" : n === "t" ? "\t" : n === "0" ? "\0" : n === "Z" ? "\x1a" : n === "b" ? "\b" : n;
              i += 2;
              start = i;
            } else if (c === "'") {
              if (text[i + 1] === "'") {
                s += text.slice(start, i) + "'";
                i += 2;
                start = i;
              } else {
                s += text.slice(start, i);
                i++;
                break;
              }
            } else if (c === undefined) {
              throw new Error(`The file ends inside a value of ${table}. It looks cut short.`);
            } else i++;
          }
          if (keep) row.push(s);
        } else {
          let j = i;
          while (j < text.length && text[j] !== "," && text[j] !== ")") j++;
          const raw = text.slice(i, j).trim();
          if (keep) row.push(raw.toUpperCase() === "NULL" ? null : raw);
          i = j;
        }
        while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") i++;
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === ")") {
          i++;
          break;
        }
        throw new Error(`Could not read a row of ${table}. Is this a phpMyAdmin SQL export?`);
      }
      if (keep) {
        if (!columns) throw new Error(`The export of ${table} has no column names. Export again with "Include column names" ticked.`);
        const obj: Record<string, Value> = {};
        columns.forEach((c, k) => (obj[c] = row[k] ?? null));
        out[table].push(obj);
      }
    }
    i = text.indexOf(marker, i);
    lastEnd = i === -1 ? lastEnd : i;
  }
  // phpMyAdmin closes the export with COMMIT. A file cut between two
  // statements reads cleanly up to the cut, so its absence is the only sign.
  if (lastEnd !== -1 && !/COMMIT;/.test(text.slice(lastEnd))) {
    throw new Error('The file has no COMMIT at the end, so it may be cut short. Export again from phpMyAdmin with "Enclose export in a transaction" ticked (it is on by default).');
  }
  return out;
}

// ---------------------------------------------------------------- mapping

/** The app's destination names, as ISO codes with the currency each country uses. */
export const MIOC_COUNTRIES: Record<string, { code: string; name: string; currency: string }> = {
  australia: { code: "AU", name: "Australia", currency: "AUD" },
  uk: { code: "GB", name: "United Kingdom", currency: "GBP" },
  usa: { code: "US", name: "United States", currency: "USD" },
  canada: { code: "CA", name: "Canada", currency: "CAD" },
  newzealand: { code: "NZ", name: "New Zealand", currency: "NZD" },
  germany: { code: "DE", name: "Germany", currency: "EUR" },
  ireland: { code: "IE", name: "Ireland", currency: "EUR" },
  singapore: { code: "SG", name: "Singapore", currency: "SGD" },
  malaysia: { code: "MY", name: "Malaysia", currency: "MYR" },
  sweden: { code: "SE", name: "Sweden", currency: "SEK" },
  spain: { code: "ES", name: "Spain", currency: "EUR" },
  switzerland: { code: "CH", name: "Switzerland", currency: "CHF" },
  france: { code: "FR", name: "France", currency: "EUR" },
  italy: { code: "IT", name: "Italy", currency: "EUR" },
  poland: { code: "PL", name: "Poland", currency: "PLN" },
  malta: { code: "MT", name: "Malta", currency: "EUR" },
  finland: { code: "FI", name: "Finland", currency: "EUR" },
  lithuania: { code: "LT", name: "Lithuania", currency: "EUR" },
  netherlands: { code: "NL", name: "Netherlands", currency: "EUR" },
  hungary: { code: "HU", name: "Hungary", currency: "HUF" },
  denmark: { code: "DK", name: "Denmark", currency: "DKK" },
  austria: { code: "AT", name: "Austria", currency: "EUR" },
  japan: { code: "JP", name: "Japan", currency: "JPY" },
  dubaiuae: { code: "AE", name: "United Arab Emirates", currency: "AED" },
  uae: { code: "AE", name: "United Arab Emirates", currency: "AED" },
  cyprus: { code: "CY", name: "Cyprus", currency: "EUR" },
  vietnam: { code: "VN", name: "Vietnam", currency: "VND" },
  mauritius: { code: "MU", name: "Mauritius", currency: "MUR" },
  china: { code: "CN", name: "China", currency: "CNY" },
  belgium: { code: "BE", name: "Belgium", currency: "EUR" },
  russia: { code: "RU", name: "Russia", currency: "RUB" },
  southkorea: { code: "KR", name: "South Korea", currency: "KRW" },
  slovenia: { code: "SI", name: "Slovenia", currency: "EUR" },
  georgia: { code: "GE", name: "Georgia", currency: "GEL" },
  uzbekistan: { code: "UZ", name: "Uzbekistan", currency: "UZS" },
  armenia: { code: "AM", name: "Armenia", currency: "AMD" },
  egypt: { code: "EG", name: "Egypt", currency: "EGP" },
  kazakhstan: { code: "KZ", name: "Kazakhstan", currency: "KZT" },
  kyrgyzstan: { code: "KG", name: "Kyrgyzstan", currency: "KGS" },
  azerbaijan: { code: "AZ", name: "Azerbaijan", currency: "AZN" },
  moldova: { code: "MD", name: "Moldova", currency: "MDL" },
  portugal: { code: "PT", name: "Portugal", currency: "EUR" },
  latvia: { code: "LV", name: "Latvia", currency: "EUR" },
  albania: { code: "AL", name: "Albania", currency: "ALL" },
};

/**
 * What each currency mark the app used can stand for. A fee is kept only when
 * the country's own currency is among them: "$" at a New Zealand university is
 * New Zealand dollars, but "USD" at a Vietnamese one cannot become dong.
 * "Lt" is the mark the app gave Lithuania, whose currency is the euro.
 */
const CURRENCY_MARKS: Record<string, string[]> = {
  "£": ["GBP"],
  gbp: ["GBP"],
  $: ["USD", "NZD", "AUD", "CAD", "SGD"],
  usd: ["USD"],
  us$: ["USD"],
  "can$": ["CAD"],
  "ca$": ["CAD"],
  "cad$": ["CAD"],
  cad: ["CAD"],
  "au$": ["AUD"],
  aud: ["AUD"],
  "nz$": ["NZD"],
  "s$": ["SGD"],
  "€": ["EUR"],
  eur: ["EUR"],
  euro: ["EUR"],
  lt: ["EUR"],
  rm: ["MYR"],
  dhs: ["AED"],
  aed: ["AED"],
  chf: ["CHF"],
  kr: ["SEK", "DKK", "NOK"],
  zl: ["PLN"],
  jpy: ["JPY"],
  mur: ["MUR"],
  "₹": ["INR"],
};

export type MiocLevel = "SCHOOL" | "UG_DIPLOMA" | "UG" | "PG_DIPLOMA" | "PG" | "PHD" | "CERTIFICATE";

/**
 * The app's program levels. Those that do not fit one of the portal's levels
 * exactly keep the app's wording in the notes (see LOSSY_LEVELS).
 */
const LEVELS: Record<string, MiocLevel> = {
  undergraduate: "UG",
  postgraduate: "PG",
  ugdiplomacertificateassociatedegree: "UG_DIPLOMA",
  pgdiplomacertificate: "PG_DIPLOMA",
  phd: "PHD",
  foundation: "CERTIFICATE",
  highschool11th12th: "SCHOOL",
  // An integrated master's is applied to from Std. 12th, like a bachelor's,
  // which is what the eligibility search needs to know.
  ugpgaccelerateddegree: "UG",
  twinningprogrammespg: "PG",
  twinningprogrammesug: "UG",
  englishlanguageprogram: "CERTIFICATE",
  shorttermprograms: "CERTIFICATE",
  pathwayprograms: "CERTIFICATE",
  onlineprogrammesdistancelearning: "CERTIFICATE",
};
const LOSSY_LEVELS = new Set([
  "foundation",
  "ugpgaccelerateddegree",
  "twinningprogrammespg",
  "twinningprogrammesug",
  "englishlanguageprogram",
  "shorttermprograms",
  "pathwayprograms",
  "onlineprogrammesdistancelearning",
]);

export type MiocCountry = { code: string; name: string; currency: string };
export type MiocUniversity = { miocId: number; name: string; city: string | null; countryCode: string };
export type MiocProgram = {
  miocId: number;
  universityMiocId: number;
  name: string;
  level: MiocLevel;
  studyArea: string | null;
  durationMonths: number | null;
  tuitionPerYear: number | null;
  applicationFee: number | null;
  feeWaiver: string | null;
  intakeMonths: number[];
  minIelts: number | null;
  minIeltsBand: number | null;
  minPte: number | null;
  minToefl: number | null;
  minDuolingo: number | null;
  minGre: number | null;
  minGmat: number | null;
  minSat: number | null;
  entryRequirements: string | null;
};

export type MiocBuild = {
  countries: MiocCountry[];
  universities: MiocUniversity[];
  programs: MiocProgram[];
  skipped: {
    /** Destinations the app has switched off, and everything under them. */
    hiddenCountries: string[];
    /** Destination names this import does not know. */
    unknownCountries: string[];
    hiddenUniversities: number;
    /** Courses whose university is missing from the app or switched off there. */
    orphanCourses: number;
    hiddenCourses: number;
    /** Rows identical to another row of the same university in every field taken but the study area. */
    duplicateCourses: number;
    unnamedCourses: number;
  };
  /** How much of what was recorded could be taken as a figure. */
  figures: { tuition: number; tuitionInWords: number; applicationFee: number; intakes: number; ielts: number; duration: number };
};

const str = (v: Value) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const tidy = (v: Value) => {
  const s = (v == null ? "" : String(v))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return s || null;
};
const on = (v: Value) => str(v) === "1";
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A plain number, or null. Commas as thousands separators are allowed. */
function plainNumber(s: string): number | null {
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null;
  // "12.500" is twelve thousand five hundred in much of Europe and twelve and
  // a half in English. Too ambiguous to take as a figure.
  if (/^\d{1,3}\.\d{3}$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A score within a test's range; nought, text and anything out of range is null. */
function score(v: Value, min: number, max: number, opts: { int?: boolean } = {}): number | null {
  const n = plainNumber(str(v));
  if (n == null || n === 0 || n < min || n > max) return null;
  if (opts.int && !Number.isInteger(n)) return null;
  return n;
}

/** A fee written as a plain figure, with an optional currency mark before or after and an optional "per year". */
export function feeFigure(raw: string, mark: string, currency: string): number | null {
  let s = raw.trim().replace(/\s*(\/\s*(year|yr|annum)|per\s+(academic\s+)?(year|annum)|p\.?a\.?)\.?$/i, "");
  let marks = [mark];
  const lead = s.match(/^([^\d\s]{1,4}|[a-z]{2,4}\s*\$?)\s*(?=\d)/i);
  if (lead) {
    marks.push(lead[1].replace(/\s+/g, ""));
    s = s.slice(lead[0].length);
  }
  const tail = s.match(/(?<=\d)\s*([a-z]{3}|€|£)$/i);
  if (tail) {
    marks.push(tail[1]);
    s = s.slice(0, s.length - tail[0].length);
  }
  marks = marks.map((m) => m.trim().toLowerCase()).filter(Boolean);
  if (!marks.length) return null;
  // Every mark given has to be one the country's currency answers to.
  if (!marks.every((m) => (CURRENCY_MARKS[m] ?? []).includes(currency))) return null;
  const n = plainNumber(s.trim());
  if (n == null || n <= 0) return null;
  return Math.round(n);
}

/** A yearly tuition fee: a fee figure, and not one so small it cannot be a year's tuition. */
export function tuitionFigure(raw: string, mark: string, currency: string): number | null {
  const n = feeFigure(raw, mark, currency);
  return n != null && n >= 100 ? n : null;
}

/** "24 months", "18 Month(s) months", "2 YEARS months". Ranges, weeks and semesters are not a number of months. */
export function durationMonths(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(months?|month\(s\))\b/);
  if (m) {
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 && n <= 120 ? n : null;
  }
  m = s.match(/^(\d+(?:\.\d+)?)\s*years?\b/);
  if (m) {
    const n = Number(m[1]) * 12;
    return Number.isInteger(n) && n > 0 && n <= 120 ? n : null;
  }
  return null;
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A month as a whole word, short or long: "Mar" and "March" count, "Rolling" and "decision" do not. */
const MONTH_WORD = /(?<![a-z])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|sepetember|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])/g;
/** "January,September", "SEP", "Fall (Aug)", "septemberNovember": the months named, in calendar order. */
export function intakeMonths(raw: string): number[] {
  const s = raw.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const found = new Set<number>();
  for (const m of s.matchAll(MONTH_WORD)) found.add(MONTH_KEYS.indexOf(m[1].slice(0, 3)) + 1);
  return [...found].sort((a, b) => a - b);
}

/** "Waiver" as the app's users typed it. */
const WAIVER = /^(w|waiver|wavier|waier|wiaver|waived|fee waiver)\.?$/i;

const NOTHING = new Set(["", "na", "n/a", "nil", "none", "null", "asap", "-", "0", "tbc"]);

/** Builds what the portal needs from the app's tables. */
export function buildMioc(t: DumpTables): MiocBuild {
  const skipped: MiocBuild["skipped"] = {
    hiddenCountries: [],
    unknownCountries: [],
    hiddenUniversities: 0,
    orphanCourses: 0,
    hiddenCourses: 0,
    duplicateCourses: 0,
    unnamedCourses: 0,
  };

  // ---- Countries
  const countryOf = new Map<string, MiocCountry>();
  const countries = new Map<string, MiocCountry>();
  for (const d of t.tb_destinations ?? []) {
    const name = str(d.country);
    const c = MIOC_COUNTRIES[key(name)];
    if (!c) {
      skipped.unknownCountries.push(name);
      continue;
    }
    if (!on(d.status)) {
      skipped.hiddenCountries.push(c.name);
      continue;
    }
    countryOf.set(str(d.id), c);
  }

  // ---- Universities
  const universities = new Map<number, MiocUniversity>();
  for (const u of t.tb_universities ?? []) {
    const c = countryOf.get(str(u.d_id));
    const name = str(u.name);
    if (!c || !name) continue;
    if (!on(u.status)) {
      skipped.hiddenUniversities++;
      continue;
    }
    const id = Number(u.id);
    universities.set(id, { miocId: id, name, city: str(u.location) || null, countryCode: c.code });
  }

  const areas = new Map((t.tb_main_course ?? []).map((a) => [str(a.id), str(a.name) || null]));

  // ---- Courses
  const programs: MiocProgram[] = [];
  const seen = new Map<string, { program: MiocProgram; areas: Set<string> }>();
  const courses = [...(t.tb_courses ?? [])].sort((a, b) => Number(a.id) - Number(b.id));
  for (const c of courses) {
    const uniId = Number(c.u_id);
    const uni = universities.get(uniId);
    if (!uni) {
      skipped.orphanCourses++;
      continue;
    }
    if (!on(c.status)) {
      skipped.hiddenCourses++;
      continue;
    }
    const name = str(c.course);
    if (!name) {
      skipped.unnamedCourses++;
      continue;
    }
    const country = [...countryOf.values()].find((x) => x.code === uni.countryCode)!;
    countries.set(country.code, country);

    const notes: string[] = [];
    const levelKey = key(str(c.level));
    const level = LEVELS[levelKey] ?? "CERTIFICATE";
    if (str(c.level) && (LOSSY_LEVELS.has(levelKey) || !LEVELS[levelKey])) notes.push(`Level in the MIOC app: ${str(c.level)}`);

    const dur = durationMonths(str(c.duration));
    // The app added "months" after whatever was typed ("6 week months"); it
    // is dropped when the words already carry their own unit.
    const durRaw = str(c.duration);
    const durText = /\b(months?|month\(s\)|weeks?|years?|semesters?)\s+months$/i.test(durRaw) ? durRaw.replace(/\s+months$/i, "") : durRaw;
    if (dur == null && durText) notes.push(`Duration in the MIOC app: ${durText}`);

    const feeRaw = str(c.fees);
    const tuition = tuitionFigure(feeRaw, str(c.currency), country.currency);
    if (tuition == null && !NOTHING.has(feeRaw.toLowerCase())) {
      notes.push(`Tuition in the MIOC app: ${[str(c.currency), feeRaw].filter(Boolean).join(" ")}`);
    }

    const appRaw = str(c.applicationfee);
    let applicationFee: number | null = null;
    let feeWaiver: string | null = null;
    if (WAIVER.test(appRaw)) {
      feeWaiver = "Application fee waiver recorded in the MIOC app";
    } else if (!NOTHING.has(appRaw.toLowerCase())) {
      applicationFee = feeFigure(appRaw, str(c.currency), country.currency);
      if (applicationFee == null) {
        const plain = plainNumber(appRaw.replace(/\.$/, ""));
        // A bare figure with no mark is in the course's own currency.
        if (plain != null && plain > 0 && (CURRENCY_MARKS[str(c.currency).toLowerCase()] ?? []).includes(country.currency)) applicationFee = Math.round(plain);
      }
      if (applicationFee == null) notes.push(`Application fee in the MIOC app: ${appRaw}`);
    }

    const intakes = intakeMonths(str(c.intakes));

    const minIelts = score(c.ielts, 3, 9);
    if (minIelts == null && str(c.ielts) && !NOTHING.has(str(c.ielts).toLowerCase())) notes.push(`English test in the MIOC app: ${str(c.ielts)}`);
    let minIeltsBand = score(c.ieltsless, 3, 9);
    if (minIeltsBand != null && minIelts != null && minIeltsBand > minIelts) minIeltsBand = null;

    const pteLow = score(c.pteless, 10, 90, { int: true });
    if (pteLow != null) notes.push(`PTE, lowest in any skill: ${pteLow}`);
    const toeflLow = score(c.toeflless, 1, 30, { int: true });
    if (toeflLow != null) notes.push(`TOEFL, lowest in any section: ${toeflLow}`);
    const act = score(c.act, 1, 36, { int: true });
    if (act != null) notes.push(`ACT: ${act}`);

    const deadline = str(c.deadline);
    if (deadline && !NOTHING.has(deadline.toLowerCase())) notes.push(`Deadline in the MIOC app: ${deadline}`);
    const stipend = str(c.stipend);
    if (stipend && !NOTHING.has(stipend.toLowerCase()) && !/^not applicable$/i.test(stipend)) notes.push(`Stipend in the MIOC app: ${stipend}`);

    const entry = tidy(c.entryrequirement);
    const remarks = tidy(c.remarks);
    const entryRequirements = [entry, remarks ? `Remarks: ${remarks}` : null, ...notes].filter(Boolean).join("\n") || null;

    const p: MiocProgram = {
      miocId: Number(c.id),
      universityMiocId: uniId,
      name,
      level,
      studyArea: areas.get(str(c.c_id)) ?? null,
      durationMonths: dur,
      tuitionPerYear: tuition,
      applicationFee,
      feeWaiver,
      intakeMonths: intakes,
      minIelts,
      minIeltsBand,
      minPte: score(c.pte, 10, 90, { int: true }),
      minToefl: score(c.toefl, 1, 120, { int: true }),
      minDuolingo: score(c.duolingo, 10, 160, { int: true }) ?? score(c.det, 10, 160, { int: true }),
      minGre: score(c.gre, 260, 340, { int: true }),
      minGmat: score(c.gmat, 200, 800, { int: true }),
      minSat: score(c.sat, 400, 1600, { int: true }),
      entryRequirements,
    };
    // The app holds the same course many times over, once under each study
    // area it is filed in, identical in every other field. The first (lowest
    // id) stands for the rest, and names the other areas in its notes.
    const sig = JSON.stringify({ ...p, miocId: 0, studyArea: null });
    const first = seen.get(sig);
    if (first) {
      skipped.duplicateCourses++;
      if (p.studyArea && p.studyArea !== first.program.studyArea) first.areas.add(p.studyArea);
      continue;
    }
    seen.set(sig, { program: p, areas: new Set() });
    programs.push(p);
  }
  for (const { program, areas } of seen.values()) {
    if (!areas.size) continue;
    const line = `Also filed in the MIOC app under: ${[...areas].join(", ")}`;
    program.entryRequirements = program.entryRequirements ? `${program.entryRequirements}\n${line}` : line;
  }

  // Only universities with at least one course come over: an empty one is a
  // name with nothing behind it.
  const used = new Set(programs.map((p) => p.universityMiocId));
  const count = (f: (p: MiocProgram) => boolean) => programs.filter(f).length;
  const figures = {
    tuition: count((p) => p.tuitionPerYear != null),
    tuitionInWords: count((p) => !!p.entryRequirements?.includes("Tuition in the MIOC app:")),
    applicationFee: count((p) => p.applicationFee != null),
    intakes: count((p) => p.intakeMonths.length > 0),
    ielts: count((p) => p.minIelts != null),
    duration: count((p) => p.durationMonths != null),
  };
  return {
    countries: [...countries.values()].sort((a, b) => a.code.localeCompare(b.code)),
    universities: [...universities.values()].filter((u) => used.has(u.miocId)),
    programs,
    skipped,
    figures,
  };
}
