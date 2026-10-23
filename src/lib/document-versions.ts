/**
 * Versions of one student document.
 *
 * A replaced file is not overwritten: the replacement is a new row pointing at
 * the one it replaced, and the old row is marked superseded. Rows linked that
 * way are one document's history, and exactly one of them is the file the team
 * works from. Everything here is worked out from the rows alone, so the screens
 * and the server agree on which file is current and what number it carries.
 */

export type VersionRow = {
  id: string;
  replacesId: string | null;
  createdAt: Date;
  supersededAt: Date | null;
  supersededById: string | null;
  removedAt: Date | null;
};

export type Version<T> = T & { version: number };

export type DocumentFamily<T extends VersionRow> = {
  /** The first version's id, which names the whole history. */
  rootId: string;
  /**
   * The file in use. Null when every version was removed, or on a record left
   * from before removing the file in use handed the document to an earlier one.
   */
  current: Version<T> | null;
  /** Every other version still on record, newest first. */
  earlier: Version<T>[];
  /** Every version, oldest first. */
  all: Version<T>[];
  /**
   * Set when the current version is an older file brought back, rather than
   * the latest upload: when that happened and who did it.
   */
  restored: { at: Date; byId: string | null } | null;
};

/** Neither replaced nor removed: the file the team works from. */
export const isCurrent = (d: Pick<VersionRow, "supersededAt" | "removedAt">) => d.supersededAt == null && d.removedAt == null;

/**
 * The first version a row descends from. A link that leads outside the rows
 * given, or round in a circle, stops the walk where it is, so bad data shows a
 * shorter history rather than hanging the page.
 */
export function rootOf<T extends VersionRow>(row: T, byId: Map<string, T>): string {
  const seen = new Set<string>([row.id]);
  let at = row;
  while (at.replacesId && byId.has(at.replacesId) && !seen.has(at.replacesId)) {
    at = byId.get(at.replacesId)!;
    seen.add(at.id);
  }
  return at.id;
}

/**
 * Groups one student's rows into documents with their versions.
 *
 * Versions are numbered by upload time within each document, so the first file
 * is version one whatever happened to it later. If two rows of one document
 * claim to be current, which only a race between two replacements could cause,
 * the newer is shown as current and the other as an earlier version, so neither
 * file is hidden.
 */
export function documentFamilies<T extends VersionRow>(rows: T[]): DocumentFamily<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const root = rootOf(r, byId);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }

  const families: DocumentFamily<T>[] = [];
  for (const [rootId, members] of groups) {
    const all = [...members]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((m, i) => ({ ...m, version: i + 1 }));
    const live = all.filter(isCurrent);
    const current = live.length ? live[live.length - 1] : null;
    const earlier = all.filter((v) => v !== current && v.removedAt == null).reverse();
    families.push({ rootId, current, earlier, all, restored: current ? restoredBy(current, all) : null });
  }
  // Newest activity first, as the lists were before versions existed.
  return families.sort((a, b) => lastTouched(b).getTime() - lastTouched(a).getTime());
}

/**
 * Whether the current version came back rather than being the latest upload.
 *
 * A replacement is stamped with the very moment the file it replaced was set
 * aside, so on a plain replacement nothing was set aside after the current file
 * arrived. Anything set aside later than that was set aside to bring this one
 * back, and the newest such moment is the restore.
 */
function restoredBy<T extends VersionRow>(current: Version<T>, all: Version<T>[]) {
  const later = all.filter((v) => v !== current && v.supersededAt != null && v.supersededAt.getTime() > current.createdAt.getTime());
  if (!later.length) return null;
  const last = later.reduce((a, b) => (b.supersededAt!.getTime() > a.supersededAt!.getTime() ? b : a));
  return { at: last.supersededAt!, byId: last.supersededById };
}

function lastTouched<T extends VersionRow>(f: DocumentFamily<T>) {
  const at = f.current ?? f.all[f.all.length - 1];
  return f.restored && f.restored.at > at.createdAt ? f.restored.at : at.createdAt;
}

/** The family a row belongs to, found among one student's rows. */
export function familyOf<T extends VersionRow>(rows: T[], id: string): DocumentFamily<T> | null {
  return documentFamilies(rows).find((f) => f.all.some((v) => v.id === id)) ?? null;
}

/** "3 Nov 2026", in Kerala time, which is where the files are worked. */
export function versionDay(d: Date | string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}

/**
 * The line under a document that has a history: "Version 2, replaced 3 Nov 2026
 * by Anita", or "Version 1, restored 4 Nov 2026 by Nithin". Null for a document
 * that has only ever had one file, which needs no line at all.
 */
export function versionLine<T extends VersionRow>(f: DocumentFamily<T>, nameOf: (userId: string | null) => string | null, uploaderOf: (row: T) => string | null): string | null {
  if (!f.current || f.all.length < 2) return null;
  const by = (who: string | null) => (who ? ` by ${who}` : "");
  if (f.restored) return `Version ${f.current.version}, restored ${versionDay(f.restored.at)}${by(nameOf(f.restored.byId))}`;
  // The first file is current again only by way of a later one being removed,
  // which is not a replacement, so it says when it was put up instead.
  const did = f.current.replacesId ? "replaced" : "uploaded";
  return `Version ${f.current.version}, ${did} ${versionDay(f.current.createdAt)}${by(uploaderOf(f.current))}`;
}

/** Only the current versions, for anything that counts or asks "is there one". */
export const currentOnly = <T extends Pick<VersionRow, "supersededAt" | "removedAt">>(rows: T[]) => rows.filter(isCurrent);

/**
 * What taking one version off the record leaves as the document's current file.
 *
 * Removing the file in use hands the document to the newest earlier version
 * still on record, so a mistaken upload removed does not hide the passport
 * underneath it. With nothing earlier left, the document has no current file
 * and its checklist item goes back to missing. Removing an earlier version
 * changes nothing about which file is current. Null when the row is not in the
 * rows given or is already removed.
 *
 * `promote` says whether the next file has to be made current, as opposed to
 * already being current, which only a race between two replacements leaves.
 */
export function planRemoval<T extends VersionRow>(rows: T[], id: string): { next: Version<T> | null; promote: boolean } | null {
  const family = familyOf(rows, id);
  const target = family?.all.find((v) => v.id === id);
  if (!family || !target || target.removedAt) return null;
  if (!isCurrent(target)) return { next: family.current, promote: false };
  const others = family.all.filter((v) => v.id !== id && v.removedAt == null);
  const live = others.filter(isCurrent);
  if (live.length) return { next: live[live.length - 1], promote: false };
  // Oldest first, so the last is the newest earlier version.
  return others.length ? { next: others[others.length - 1], promote: true } : { next: null, promote: false };
}

/**
 * How a removed file comes back.
 *
 * Into a document that still has a current file it comes back as an earlier
 * version, dated as set aside when the current file took over rather than now,
 * so the current file is not mistaken for one somebody restored a moment ago.
 * Into a document with no current file it comes back as the current one. Either
 * way the document ends with exactly one current file. Null when the row is not
 * removed, or not among the rows.
 */
export function planPutBack<T extends VersionRow>(
  rows: T[],
  id: string,
  actorId: string,
): { asCurrent: true } | { asCurrent: false; setAside: { at: Date; byId: string } | null } | null {
  const family = familyOf(rows, id);
  const target = family?.all.find((v) => v.id === id);
  if (!family || !target || !target.removedAt) return null;
  const current = family.current;
  if (!current) return { asCurrent: true };
  if (target.supersededAt) return { asCurrent: false, setAside: null };
  return { asCurrent: false, setAside: { at: family.restored?.at ?? current.createdAt, byId: family.restored?.byId ?? actorId } };
}

/**
 * What making an earlier version current again has to set aside: every file of
 * the document that is current now, so there is one current file afterwards
 * even where a race once left two.
 */
export function planRestore<T extends VersionRow>(rows: T[], id: string): { error: "removed" | "missing" } | { already: true } | { setAside: Version<T>[] } {
  const family = familyOf(rows, id);
  const target = family?.all.find((v) => v.id === id);
  if (!family || !target) return { error: "missing" };
  if (target.removedAt) return { error: "removed" };
  if (isCurrent(target)) return { already: true };
  return { setAside: family.all.filter(isCurrent) };
}
