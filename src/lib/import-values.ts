/** Small readers shared by the importers. Each returns null for a blank cell and pushes a message for a bad one. */

export type Problems = string[];

export const text = (v: string | undefined, max = 200) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/** Dates as 2027-01-31, 31/01/2027 or 31-01-2027 (day first, as written in India). */
export function day(v: string | undefined, label: string, p: Problems): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    p.push(`${label}: use a date like 2027-01-31 or 31/01/2027`);
    return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2100) {
    p.push(`${label}: ${t} is not a real date`);
    return null;
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function num(v: string | undefined, label: string, p: Problems, opts: { int?: boolean; min?: number; max?: number } = {}): number | null {
  const t = (v ?? "").trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n)) || (opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
    p.push(`${label}: ${t} is not ${opts.int ? "a whole number" : "a number"}${opts.min != null && opts.max != null ? ` from ${opts.min} to ${opts.max}` : ""}`);
    return null;
  }
  return n;
}

/** One of a fixed list, matched without case, spaces or hyphens; a friendly label may map to the code. */
export function oneOf<T extends string>(v: string | undefined, label: string, allowed: readonly T[], p: Problems, aliases: Record<string, T> = {}): T | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const key = t.toUpperCase().replace(/[\s-]+/g, "_");
  const hit = allowed.find((a) => a === key) ?? aliases[t.toLowerCase()];
  if (!hit) p.push(`${label}: "${t}" is not one of ${allowed.join(", ")}`);
  return hit ?? null;
}

export const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test((v ?? "").trim());

export const PHONE = /^\+?[\d\s-]{8,16}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
