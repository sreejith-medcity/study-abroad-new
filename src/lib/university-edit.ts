import { parseRank } from "./rankings";

/**
 * The rules of the university edit screen, kept apart from the database so
 * they can be tested on their own. The server action reads the form into
 * plain strings, hands them here with the row as it stands, and writes what
 * comes back.
 */

export const ABOUT_MAX = 20000;
export const FACT_MAX = 1000;
export const FACTS_MAX = 100;
export const NAME_MAX = 200;
export const CITY_MAX = 120;
export const WEBSITE_MAX = 500;

export type UniversityInput = {
  name: string;
  city: string;
  website: string;
  isPublic: boolean;
  qsRank: string;
  qsYear: string;
  theRank: string;
  theYear: string;
  about: string;
  facts: string;
};

export type UniversityNow = {
  name: string;
  city: string | null;
  website: string | null;
  isPublic: boolean;
  qsRank: string | null;
  qsYear: number | null;
  theRank: string | null;
  theYear: number | null;
  about: string | null;
  facts: string[];
};

export type UniversityValues = UniversityNow;

const lines = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * A website as somebody typed it, or the reason it is refused. Only a full
 * http or https address with a real host name: the page turns this into a
 * link partners click, so anything else would be a broken or unsafe one.
 */
export function websiteProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.length > WEBSITE_MAX) return `Keep the address under ${WEBSITE_MAX} characters`;
  if (/\s/.test(s)) return "An address cannot contain spaces";
  if (!/^https?:\/\//i.test(s)) return "A full address, starting https://";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "That does not read as a web address";
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return "That does not read as a web address";
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(u.hostname.toLowerCase())) return "The address needs a proper site name, such as www.example.ac.uk";
  return null;
}

/**
 * The facts box, one fact per line, as the list it stands for. Blank lines
 * are dropped and the same fact twice is kept once.
 */
export function readFacts(raw: string): string[] {
  const out: string[] = [];
  for (const l of lines(raw).split("\n")) {
    const f = l.trim();
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** The facts as the edit box shows them. */
export const factsText = (facts: string[]) => facts.join("\n");

/**
 * Checks the form and returns the values to write, or the field errors.
 *
 * A field left exactly as the page showed it keeps its stored value, even
 * where today's rules would word it differently. Imports wrote some of these
 * (a bare "www." website, a fact with a line break inside it), and correcting
 * the city must not refuse the save over a website nobody touched, nor split
 * a fact in two and record that as a change.
 */
export function readUniversityForm(input: UniversityInput, now: UniversityNow): { values: UniversityValues; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const fail = (field: string, message: string) => {
    errors[field] = [message];
  };

  const name = input.name.trim();
  if (!name) fail("name", "Enter the university's name");
  else if (name.length > NAME_MAX) fail("name", `Keep the name under ${NAME_MAX} characters`);

  const city = input.city.trim() || null;
  if (city && city.length > CITY_MAX) fail("city", `Keep the city under ${CITY_MAX} characters`);

  const websiteRaw = input.website.trim();
  let website: string | null = websiteRaw || null;
  if (websiteRaw && websiteRaw === (now.website ?? "").trim()) website = now.website;
  else {
    const problem = websiteProblem(websiteRaw);
    if (problem) fail("website", problem);
  }

  const rank = (field: "qsRank" | "theRank", raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    if (t === (now[field] ?? "").trim()) return now[field];
    const p = parseRank(t);
    if (!p) {
      fail(field, "Write it as published: 154, =154, 601-650 or 1001+");
      return null;
    }
    return p.text;
  };
  const year = (field: "qsYear" | "theYear", raw: string): number | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    if (!/^\d{4}$/.test(t) || n < 2000 || n > 2100) {
      fail(field, "The edition year, such as 2026");
      return null;
    }
    return n;
  };

  const about = lines(input.about).trim() || null;
  if (about && about.length > ABOUT_MAX) fail("about", `Keep it under ${ABOUT_MAX.toLocaleString("en-IN")} characters (this is ${about.length.toLocaleString("en-IN")})`);

  let facts: string[];
  if (lines(input.facts).trim() === factsText(now.facts).trim()) facts = now.facts;
  else {
    facts = readFacts(input.facts);
    const long = facts.findIndex((f) => f.length > FACT_MAX);
    if (facts.length > FACTS_MAX) fail("facts", `Up to ${FACTS_MAX} facts (this is ${facts.length})`);
    else if (long >= 0) fail("facts", `Fact ${long + 1} is longer than ${FACT_MAX.toLocaleString("en-IN")} characters. Put long text under About`);
  }

  const values: UniversityValues = {
    name,
    city,
    website,
    isPublic: input.isPublic,
    qsRank: rank("qsRank", input.qsRank),
    qsYear: year("qsYear", input.qsYear),
    theRank: rank("theRank", input.theRank),
    theYear: year("theYear", input.theYear),
    about,
    facts,
  };
  return { values, errors };
}
