import { and, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";

/** The admin Programs filters. One definition for the list and for the bulk action, so "All N matching" is exactly the list. */
export const PROGRAM_FILTER_KEYS = ["q", "country", "pathway", "status", "level", "source", "workRights", "tag"] as const;
export type ProgramFilters = Partial<Record<(typeof PROGRAM_FILTER_KEYS)[number], string>>;

export function programFilterWhere(f: ProgramFilters): SQL | undefined {
  const { programs: p, universities: u, countries: c } = schema;
  return and(
    f.q ? or(ilike(p.name, `%${f.q}%`), ilike(u.name, `%${f.q}%`)) : undefined,
    f.country ? eq(c.code, f.country) : undefined,
    f.pathway ? eq(p.pathway, f.pathway as schema.Pathway) : undefined,
    f.status ? eq(p.status, f.status as "LIVE") : undefined,
    f.level ? eq(p.level, f.level as "PG") : undefined,
    f.source === "CRICOS" ? eq(p.source, "CRICOS") : f.source === "catalogue" ? isNull(p.source) : undefined,
    f.workRights ? eq(p.workRights, f.workRights as "ELIGIBLE") : undefined,
    f.tag === "none" ? sql`cardinality(${p.tags}) = 0` : f.tag ? sql`${f.tag} = any(${p.tags})` : undefined,
  );
}

export function readProgramFilters(get: (key: string) => string | null | undefined): ProgramFilters {
  const out: ProgramFilters = {};
  for (const k of PROGRAM_FILTER_KEYS) {
    const v = (get(k) ?? "").trim();
    if (v) out[k] = v;
  }
  return out;
}
