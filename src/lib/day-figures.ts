import { COUNTED_FIGURES, FIGURE_KEYS, type CountedFigures, type DayEndFigures, type FigureKey } from "./journal";

/*
 * The day's figures as a dashboard reads them: today's five, and the month so
 * far. Kept free of the database so the merge of an answered report with the
 * portal's live counts, and the month's adding up, can be tested on their own.
 *
 * The one rule throughout is that a figure nobody gave is never shown as 0.
 * A count the portal made is a figure, 0 included, because nothing logged is
 * itself an answer; a figure the count did not deliver stays null until the
 * person answers.
 */

/** The five figures, each a number or null where nobody has given it. */
export type FigureSet = Record<FigureKey, number | null>;

export type TodayFigures = {
  /** Whether the figures are what the person typed on today's report, or the portal's own count so far. */
  source: "answered" | "live";
  figures: FigureSet;
};

export type MonthFigures = {
  /** Answered reports the figures were added up from. For one person that is the days they answered. */
  reports: number;
  figures: FigureSet;
};

export const nullFigures = (): FigureSet => ({ leadsReceived: null, callsMade: null, connectedCalls: null, followUpsDone: null, registrationsDone: null });

/**
 * One person's figures for today. The answered report wins whenever there is
 * one, because it is what they signed off, edits included. Until then the
 * portal's counts stand in, every figure the count delivered, 0 included; a
 * figure the count did not deliver (null or missing) stays null and reads as
 * not given yet, rather than being written down as 0.
 */
export function mergeToday(answered: DayEndFigures | null | undefined, live: CountedFigures | null | undefined): TodayFigures {
  if (answered) return { source: "answered", figures: { ...nullFigures(), ...answered } };
  const figures = nullFigures();
  for (const k of COUNTED_FIGURES) {
    const v = live?.[k];
    if (typeof v === "number") figures[k] = v;
  }
  return { source: "live", figures };
}

/**
 * Add up a figure across a list. Null where nobody gave it, so a branch whose
 * counsellors have all yet to answer reads "not given" rather than 0 for the
 * figures that come only with the report.
 */
function sumKey(list: FigureSet[], key: FigureKey): number | null {
  let total: number | null = null;
  for (const f of list) {
    const v = f[key];
    if (v == null) continue;
    total = (total ?? 0) + v;
  }
  return total;
}

function sumSets(list: FigureSet[]): FigureSet {
  const out = nullFigures();
  for (const k of FIGURE_KEYS) out[k] = sumKey(list, k);
  return out;
}

/** Several people's today, added up, with how many of them have answered. */
export function sumToday(list: TodayFigures[]): { answered: number; of: number; figures: FigureSet } {
  return { answered: list.filter((t) => t.source === "answered").length, of: list.length, figures: sumSets(list.map((t) => t.figures)) };
}

/**
 * One person's month so far: the figures from every report they answered,
 * added up. Reports without figures (a documentation officer's, or one
 * written as missed) add nothing and are not counted as answered.
 */
export function sumMonth(reports: (DayEndFigures | null | undefined)[]): MonthFigures {
  const given = reports.filter((f): f is DayEndFigures => !!f).map((f) => ({ ...nullFigures(), ...f }));
  return { reports: given.length, figures: sumSets(given) };
}

/** Several people's months, added up, the report count with them. */
export function addMonths(list: MonthFigures[]): MonthFigures {
  return { reports: list.reduce((n, m) => n + m.reports, 0), figures: sumSets(list.map((m) => m.figures)) };
}

/** A figure the portal has not counted, said that way while the report is still to come. */
export const NOT_GIVEN_YET = "Not given yet";
/** A figure on an answered report that was never filled, which only an older report can have. */
export const NOT_GIVEN = "Not given";
/** A month with no answered report yet. */
export const NOT_RECORDED = "Not recorded";

/** What an empty today figure reads as, by how the day's figures came. */
export function todayBlank(source: TodayFigures["source"]) {
  return source === "live" ? NOT_GIVEN_YET : NOT_GIVEN;
}
