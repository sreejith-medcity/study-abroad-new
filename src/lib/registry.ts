/**
 * Public institution registers turned into universities for the catalogue.
 *
 * Pure functions only: the sync that fetches and saves lives in
 * src/server/registry-sync.ts, so this can be tested against real files.
 *
 * Only registers whose licence allows redistribution are listed here. Each
 * entry records that licence so the next person can check it without
 * repeating the research. Registers that forbid it are listed in BARRED below
 * with the reason, so nobody adds them by mistake later.
 *
 * None of these registers carry tuition, English requirements or intakes.
 * They give the institution and where it is, which is what a counsellor needs
 * in order to find it at all. Courses come from elsewhere.
 */
import Papa from "papaparse";

export type RegistryRow = {
  /** The register's own identifier, kept for the report only. */
  sourceId: string | null;
  name: string;
  /** As the register writes it: an ISO code or a country name. */
  country: string;
  city: string | null;
  website: string | null;
};

export type RegistryParse = {
  rows: RegistryRow[];
  /** Every header the file actually had, so a mismatch can be diagnosed. */
  headers: string[];
  /** Columns this parser looked for and the header it settled on. */
  mapped: Record<string, string | null>;
  /** Rows dropped, with the reason, capped so a report stays readable. */
  dropped: string[];
  droppedCount: number;
};

export type RegistrySource = {
  key: string;
  label: string;
  url: string;
  licence: string;
  /** What the register is, in a sentence, for the card. */
  blurb: string;
  /** Below this the file is treated as broken and nothing is written. */
  floor: number;
  parse: (text: string) => RegistryParse;
};

/**
 * Registers deliberately NOT here, and why. Checked October 2026.
 * Do not add one of these without a written licence from its publisher.
 */
export const BARRED = [
  ["Hochschulkompass (HRK)", "free for personal use only; any commercial use, including of parts, needs the HRK foundation's permission"],
  ["DAAD International Programmes", "all rights reserved, no reuse permission given"],
  ["ETER / EHESO", "licence forbids making the dataset or parts of it available online"],
  ["Studiekeuzedatabase (NL)", "contract only, non-transferable and non-sublicensable"],
  ["Malaysian Qualifications Register", "no licence stated"],
] as const;

/** Header lookup that ignores case, spaces, underscores and hyphens. */
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

export function pickHeader(headers: string[], candidates: string[]): string | null {
  const by = new Map(headers.map((h) => [norm(h), h]));
  for (const c of candidates) {
    const hit = by.get(norm(c));
    if (hit) return hit;
  }
  return null;
}

const text = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

/** A register's first value where a cell may hold several, separated by | or ; */
const first = (v: unknown) => {
  const s = text(v);
  return s ? (s.split(/\s*[|;]\s*/)[0] || "").trim() || null : null;
};

const DEQAR_NAME = ["name_primary", "name_english", "name_official", "name", "institution_name", "institution"];
const DEQAR_COUNTRY = ["country", "countries", "country_name", "iso3166_alpha2", "country_code"];
const DEQAR_CITY = ["city", "cities", "country_city", "locations", "location"];
const DEQAR_SITE = ["website_link", "website", "url", "homepage"];
const DEQAR_ID = ["deqar_id", "id", "eter_id", "identifier"];
const DEQAR_CLOSED = ["closure_date", "closed", "date_closed"];

/**
 * DEQAR, the European Quality Assurance Register's database of institutions
 * that have been through external quality assurance. Metadata is dedicated to
 * the public domain under ODC PDDL, so it can be redistributed.
 *
 * The parser matches columns by header name rather than position, because the
 * file is refreshed nightly and columns have moved before. If a column it
 * needs is missing it says which headers it did find, so the mapping can be
 * corrected rather than guessed at.
 */
function parseDeqar(raw: string): RegistryParse {
  const out = Papa.parse<Record<string, unknown>>(raw, { header: true, skipEmptyLines: true });
  const headers = (out.meta.fields ?? []).slice();
  const mapped = {
    name: pickHeader(headers, DEQAR_NAME),
    country: pickHeader(headers, DEQAR_COUNTRY),
    city: pickHeader(headers, DEQAR_CITY),
    website: pickHeader(headers, DEQAR_SITE),
    id: pickHeader(headers, DEQAR_ID),
    closed: pickHeader(headers, DEQAR_CLOSED),
  };
  const rows: RegistryRow[] = [];
  const dropped: string[] = [];
  let droppedCount = 0;
  const note = (why: string) => {
    droppedCount += 1;
    if (dropped.length < 12) dropped.push(why);
  };
  if (!mapped.name || !mapped.country) return { rows, headers, mapped, dropped, droppedCount };
  for (const r of out.data) {
    if (mapped.closed && text(r[mapped.closed])) {
      note(`closed: ${text(r[mapped.name]) ?? "unnamed"}`);
      continue;
    }
    const name = text(r[mapped.name]);
    const country = first(r[mapped.country]);
    if (!name) {
      note("no name");
      continue;
    }
    if (!country) {
      note(`no country: ${name}`);
      continue;
    }
    rows.push({
      sourceId: mapped.id ? text(r[mapped.id]) : null,
      name,
      country,
      city: mapped.city ? first(r[mapped.city]) : null,
      website: mapped.website ? first(r[mapped.website]) : null,
    });
  }
  return { rows, headers, mapped, dropped, droppedCount };
}

export const REGISTRY_SOURCES: Record<string, RegistrySource> = {
  deqar: {
    key: "deqar",
    label: "DEQAR (European quality assurance register)",
    url: "https://backend.deqar.eu/static/daily-csv/deqar-institutions.csv",
    licence: "Open Data Commons PDDL, public domain",
    blurb:
      "Every higher education institution that has been through external quality assurance in the European Higher Education Area, with its city and website. No courses, fees or entry requirements: this fills in the institutions a counsellor cannot currently find.",
    floor: 200,
    parse: parseDeqar,
  },
};

/** The name a university is matched on: case, punctuation and "&" ignored. */
export const matchKey = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");
