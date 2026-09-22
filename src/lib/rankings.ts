import Papa from "papaparse";

/** A rank as published ("154", "=154", "#154", "601-650", "1001+"), tidied, with the number to sort by. */
export function parseRank(raw: string | null | undefined): { text: string; sort: number } | null {
  const t = (raw ?? "").trim().replace(/^#/, "").replace(/[–—]/g, "-").replace(/\s+/g, "");
  if (!t) return null;
  const m = t.match(/^=?(\d{1,4})(?:-(\d{1,4})|\+)?$/);
  if (!m) return null;
  if (m[2] && Number(m[2]) <= Number(m[1])) return null;
  return { text: t, sort: Number(m[1]) };
}

export function bestRankSort(qs: string | null, the: string | null) {
  const values = [parseRank(qs)?.sort, parseRank(the)?.sort].filter((v): v is number => v != null);
  return values.length ? Math.min(...values) : null;
}

export function rankLabels(u: { qsRank: string | null; qsYear: number | null; theRank: string | null; theYear: number | null }) {
  const show = (r: string) => (/^\d+$/.test(r) ? `#${r}` : r);
  return [u.qsRank && `QS${u.qsYear ? ` ${u.qsYear}` : ""} ${show(u.qsRank)}`, u.theRank && `THE${u.theYear ? ` ${u.theYear}` : ""} ${show(u.theRank)}`].filter((x): x is string => !!x);
}

export type RankingRow = { line: number; university: string; countryCode: string | null; qsRank: string | null; qsYear: number | null; theRank: string | null; theYear: number | null };

/** Reads a rankings CSV: university, country_code (optional), qs_rank, qs_year, the_rank, the_year. */
export function parseRankingsCsv(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  const rows: RankingRow[] = [];
  const errors: { line: number; message: string }[] = [];
  if (!parsed.meta.fields?.includes("university")) return { rows, errors: [{ line: 1, message: "The first line must name the columns, including university" }] };
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const e: string[] = [];
    const year = (v: string | undefined, f: string) => {
      if (!v?.trim()) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 2000 || n > 2100) e.push(`${f} must be a year`);
      return n;
    };
    const rank = (v: string | undefined, f: string) => {
      if (!v?.trim()) return null;
      const p = parseRank(v);
      if (!p) e.push(`${f} "${v}" is not a rank (154, =154 or 601-650)`);
      return p?.text ?? null;
    };
    const row: RankingRow = {
      line,
      university: (r.university ?? "").trim(),
      countryCode: r.country_code?.trim().toUpperCase() || null,
      qsRank: rank(r.qs_rank, "qs_rank"),
      qsYear: year(r.qs_year, "qs_year"),
      theRank: rank(r.the_rank, "the_rank"),
      theYear: year(r.the_year, "the_year"),
    };
    if (!row.university) e.push("university is required");
    if (!row.qsRank && !row.theRank) e.push("give a qs_rank or a the_rank");
    if (e.length) errors.push({ line, message: e.join("; ") });
    else rows.push(row);
  });
  return { rows, errors };
}
