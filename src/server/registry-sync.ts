import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { matchKey, REGISTRY_SOURCES, type RegistryRow } from "@/lib/registry";
import { changesOf, newBatchId, recordChanges, type ChangeInput } from "./catalogue-history";

export type RegistrySyncResult = {
  source: string;
  dryRun: boolean;
  headers: string[];
  mapped: Record<string, string | null>;
  parsed: number;
  droppedCount: number;
  dropped: string[];
  /** Rows whose country is not one of the destinations, by country, biggest first. */
  unknownCountries: [string, number][];
  unknownCountryRows: number;
  /** Destinations on the countries list this register had nothing at all for. */
  destinationsWithNothing: string[];
  eligible: number;
  created: number;
  filled: number;
  alreadyThere: number;
  seconds: number;
};

/**
 * Some registers write a country name, some an ISO code, and the names do not
 * always match ours. Only variants seen in these registers are listed: a
 * country that is not matched is reported rather than guessed at.
 */
const ALIASES: Record<string, string> = {
  uk: "GB",
  "united kingdom of great britain and northern ireland": "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "czech republic": "CZ",
  czechia: "CZ",
  "the netherlands": "NL",
  holland: "NL",
  "republic of ireland": "IE",
  "korea, republic of": "KR",
  "republic of korea": "KR",
  "south korea": "KR",
  "united states of america": "US",
  usa: "US",
  "russian federation": "RU",
  "slovak republic": "SK",
  "united arab emirates": "AE",
  philippines: "PH",
};

/**
 * Registers qualify a country name in ways an exact match misses: DEQAR writes
 * "United Kingdom (England)" and "Belgium (French Community)", and others put
 * the article or the sub-form after a comma. Each form is tried in turn, and a
 * name that still does not resolve is reported rather than guessed at.
 */
function* countryForms(written: string): Generator<string> {
  const t = written.trim();
  yield t;
  // "United Kingdom (England)" -> "United Kingdom"
  const noParens = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (noParens && noParens !== t) yield noParens;
  // "Netherlands (the)" handled above; "Korea, Republic of" -> "Korea"
  for (const base of [t, noParens]) {
    const beforeComma = base.split(",")[0].trim();
    if (beforeComma && beforeComma !== base) yield beforeComma;
  }
}

export async function fetchRegistry(key: string) {
  const src = REGISTRY_SOURCES[key];
  if (!src) throw new Error(`No register called "${key}".`);
  const res = await fetch(src.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(src.url).host} answered ${res.status}`);
  return res.text();
}

/**
 * Loads one register's institutions into the catalogue.
 *
 * What it will do: create a university for a register row whose country is one
 * of the destinations and whose name is not already on the list, and fill in a
 * missing city or website on one that is.
 *
 * What it will not do: rename anything, overwrite a city or website somebody
 * verified, create a destination that is not already on the countries list, or
 * delete anything at all. A register is a source of names, not an authority
 * over work already done here.
 *
 * `dryRun` reports exactly what a real run would change and writes nothing.
 */
export async function syncRegistry(key: string, raw: string, opts: { dryRun: boolean; by?: string | null }): Promise<RegistrySyncResult> {
  const started = Date.now();
  const src = REGISTRY_SOURCES[key];
  if (!src) throw new Error(`No register called "${key}".`);
  const { rows, headers, mapped, dropped, droppedCount } = src.parse(raw);

  const base = { source: src.label, dryRun: opts.dryRun, headers, mapped, parsed: rows.length, droppedCount, dropped };
  if (!mapped.name || !mapped.country) {
    throw new Error(
      `The file does not have the columns this parser expects, so nothing was changed. It needs a name column and a country column. The headers it found were: ${headers.join(", ") || "none at all"}.`,
    );
  }
  if (rows.length < src.floor) {
    throw new Error(`Only ${rows.length} institutions parsed, below the ${src.floor} this register should have. The file looks incomplete, so nothing was changed.`);
  }

  // ---- Countries: ours only, never created from a register ----
  const countries = await db.select({ id: schema.countries.id, code: schema.countries.code, name: schema.countries.name }).from(schema.countries);
  const byCode = new Map(countries.map((c) => [c.code.toUpperCase(), c.id]));
  const byName = new Map(countries.map((c) => [c.name.toLowerCase(), c.id]));
  const resolve = (written: string) => {
    for (const form of countryForms(written)) {
      const alias = ALIASES[form.toLowerCase()];
      const hit = byCode.get((alias ?? form).toUpperCase()) ?? byName.get(form.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };

  const unknown = new Map<string, number>();
  const eligible: (RegistryRow & { countryId: string })[] = [];
  for (const r of rows) {
    const countryId = resolve(r.country);
    if (!countryId) {
      unknown.set(r.country, (unknown.get(r.country) ?? 0) + 1);
      continue;
    }
    eligible.push({ ...r, countryId });
  }
  const unknownCountries = [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const unknownCountryRows = [...unknown.values()].reduce((a, b) => a + b, 0);
  // Saying which destinations this register simply does not cover is the
  // difference between "it is loaded" and a counsellor finding out the hard way.
  const covered = new Set(eligible.map((e) => e.countryId));
  const destinationsWithNothing = countries
    .filter((c) => !covered.has(c.id))
    .map((c) => c.name)
    .sort();

  // ---- Match against what is already here, by name within the country ----
  const u = schema.universities;
  const countryIds = [...new Set(eligible.map((e) => e.countryId))];
  const here = countryIds.length
    ? await db.select({ id: u.id, name: u.name, countryId: u.countryId, city: u.city, website: u.website }).from(u).where(inArray(u.countryId, countryIds))
    : [];
  const seen = new Map(here.map((x) => [`${x.countryId}|${matchKey(x.name)}`, x]));

  const toCreate: { name: string; city: string | null; website: string | null; countryId: string }[] = [];
  const toFill: { id: string; city?: string; website?: string }[] = [];
  let alreadyThere = 0;
  // A register can list the same institution twice (several campuses, several
  // reports). The first row wins, so a run is the same whatever the order.
  const planned = new Set<string>();
  for (const e of eligible) {
    const k = `${e.countryId}|${matchKey(e.name)}`;
    const mine = seen.get(k);
    if (mine) {
      alreadyThere += 1;
      const patch: { id: string; city?: string; website?: string } = { id: mine.id };
      if (!mine.city && e.city) patch.city = e.city;
      if (!mine.website && e.website) patch.website = e.website;
      if (patch.city || patch.website) toFill.push(patch);
      continue;
    }
    if (planned.has(k)) continue;
    planned.add(k);
    toCreate.push({ name: e.name, city: e.city, website: e.website, countryId: e.countryId });
  }

  if (!opts.dryRun) {
    for (let i = 0; i < toCreate.length; i += 200) {
      await db.insert(u).values(toCreate.slice(i, i + 200)).onConflictDoNothing();
    }
    // Only a blank city or website is ever filled, so the history is small:
    // what each university had (nothing, usually) and what the register gave it.
    // A register that lists one institution twice fills it twice, so what it
    // holds is followed as the patches land. Each part's updates and their
    // history go in one transaction, so they are kept or lost together, and
    // the whole run is one batch in the history.
    const holds = new Map(here.map((x) => [x.id, { city: x.city, website: x.website }]));
    const batchId = newBatchId();
    for (let i = 0; i < toFill.length; i += 500) {
      await db.transaction(async (tx) => {
        const changes: ChangeInput[] = [];
        for (const patch of toFill.slice(i, i + 500)) {
          const { id, ...set } = patch;
          await tx.update(u).set(set).where(eq(u.id, id));
          const was = holds.get(id);
          if (was) {
            changes.push(...changesOf("university", id, was, set));
            holds.set(id, { ...was, ...set });
          }
        }
        await recordChanges(tx, changes, { by: opts.by ?? null, source: "registry", batchId });
      });
    }
  }

  return {
    ...base,
    unknownCountries,
    unknownCountryRows,
    destinationsWithNothing,
    eligible: eligible.length,
    created: toCreate.length,
    filled: toFill.length,
    alreadyThere,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}
