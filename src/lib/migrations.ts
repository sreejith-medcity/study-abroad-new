/**
 * Whether the database has every migration this build was made with, and
 * nothing this build has never heard of.
 *
 * drizzle-kit writes one row per applied migration into
 * drizzle.__drizzle_migrations, with created_at set to the "when" of the entry
 * in drizzle/meta/_journal.json, and applies a migration only when its "when"
 * is newer than the newest row. So the two lists are compared by that number:
 * a tag in the journal with no row is a migration a release added that nobody
 * ran, and a row with no tag is a database that is ahead of the code running
 * against it. Pure, so it can be tested without a database.
 */

export type JournalEntry = { idx: number; tag: string; when: number };

export type MigrationComparison = {
  /** How many migration files this build was made with. */
  known: number;
  /** How many the database has recorded, or null where there is no history table at all. */
  recorded: number | null;
  /** Journal tags with no row: a release's migration that was never applied. */
  notApplied: string[];
  /** Rows with no tag, as their "when": the database is ahead of this build. */
  unknown: number[];
  status: "in-step" | "behind" | "ahead" | "no-history";
  /** One plain sentence for the screen and the report. */
  message: string;
};

export function compareMigrations(journal: readonly JournalEntry[], recordedWhens: readonly number[] | null): MigrationComparison {
  const known = journal.length;
  if (recordedWhens === null) {
    return {
      known,
      recorded: null,
      notApplied: journal.map((e) => e.tag),
      unknown: [],
      status: "no-history",
      message: `The database has no migration history table, so it cannot be compared with the ${known} migration files this build knows. Run the migrate step before the next release.`,
    };
  }
  const recordedSet = new Set(recordedWhens.map(Number));
  const knownSet = new Set(journal.map((e) => e.when));
  const notApplied = journal.filter((e) => !recordedSet.has(e.when)).map((e) => e.tag);
  const unknown = [...recordedSet].filter((w) => !knownSet.has(w)).sort((a, b) => a - b);
  const recorded = recordedSet.size;

  if (notApplied.length === 0 && unknown.length === 0) {
    return { known, recorded, notApplied, unknown, status: "in-step", message: `${recorded} migrations recorded, ${known} in this build. The database and the code are in step.` };
  }
  if (notApplied.length > 0) {
    const list = notApplied.length <= 3 ? notApplied.join(", ") : `${notApplied.slice(0, 3).join(", ")} and ${notApplied.length - 3} more`;
    return {
      known,
      recorded,
      notApplied,
      unknown,
      status: "behind",
      message: `${recorded} migrations recorded, ${known} in this build. Not applied: ${list}. Run the migrate step; until then, screens that need the new tables will fail.`,
    };
  }
  return {
    known,
    recorded,
    notApplied,
    unknown,
    status: "ahead",
    message: `${recorded} migrations recorded, ${known} in this build. The database has ${unknown.length} migration${unknown.length === 1 ? "" : "s"} this build does not know, which usually means an older build is running against a newer database.`,
  };
}
