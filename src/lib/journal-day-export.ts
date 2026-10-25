import { ROLE_LABEL } from "./permissions";
import { FIGURE_KEYS, FIGURE_LABEL, STANDING_LABEL, dayText, figuresByBranch, istClock, type DayEndFigures, type FiguresPerson, type JournalPhase, type JournalStanding } from "./journal";

/*
 * The consolidated day end report laid out as rows for a workbook: a cover,
 * everybody issued a report with how they answered, and the day's figures per
 * counsellor with branch totals and the overall total. Kept free of ExcelJS
 * and the database so the rows can be checked in a unit test and the server
 * only has to pour them into sheets.
 */

/** A cell as the sheet helper takes it: text, a number, an instant, or empty. */
export type DayCell = string | number | Date | null;

/** What the builder needs to know about one person on the report, a subset of what consolidated() returns. */
export type DayReportPerson = FiguresPerson & {
  standing: JournalStanding;
  decidedAt: Date | string | null;
  note: string | null;
  lateSignIns: (Date | string)[];
};

/** The parts of the consolidated report the workbook reads. */
export type DayReport = {
  day: string;
  phase: JournalPhase;
  sentAt: Date | string | null;
  // Stored as text; anything other than the two reasons the portal writes is shown as it is.
  reason: string | null;
  people: DayReportPerson[];
  figures: ReturnType<typeof figuresByBranch>;
};

export const PEOPLE_HEAD = ["Branch", "Name", "Role", "Report", "Answered at (India time)", "Signed in after hours at", "Flag note"];
export const FIGURES_HEAD = ["Branch", "Counsellor", "Role", ...FIGURE_KEYS.map((k) => FIGURE_LABEL[k])];

/** Why the report went out, in words. An unsent report has no reason yet. */
export const REASON_TEXT: Record<string, string> = {
  ALL_DONE: "Everybody answered, so the report went when the last person did",
  CUTOFF: "The cutoff passed, so the report went with whoever had not answered marked missed",
};

/** Where the day stands, in one line, as the screen says it. */
export function dayStateText(r: Pick<DayReport, "phase" | "sentAt" | "reason">) {
  if (r.phase === "NONE") return "Sunday: no day end reports are issued";
  if (r.phase === "BEFORE") return "The day is not over yet";
  if (r.phase === "OPEN") return "Open: day end reports can still be verified";
  return r.sentAt ? `Closed. Sent at ${istClock(r.sentAt)}` : "Closed";
}

/**
 * The cover: the day, where it stands, when the report went and why, and who
 * took the download. The sent time is written as an instant so Excel shows it
 * in the reader's own format; the state line carries it in India time as well.
 */
export function coverRows(r: DayReport, organisation: string, downloadedBy: string, now: Date = new Date()): DayCell[][] {
  return [
    ["Day end reports", dayText(r.day, true)],
    ["Organisation", organisation],
    ["Day", r.day],
    ["Where it stands", dayStateText(r)],
    ["Report sent at", r.sentAt ? new Date(r.sentAt) : null],
    ["Report sent because", r.reason ? (REASON_TEXT[r.reason] ?? r.reason) : null],
    ["People issued a report", r.people.length],
    ["Downloaded by", downloadedBy],
    ["Downloaded at", now],
  ];
}

/**
 * One row per person, in the order the screen lists them (the ones that need
 * a look first). A person who has not answered has an empty cell for the
 * time, not a dash, so the column stays sortable; after-hours sign-ins are
 * listed as clock times in India time, several separated by a comma.
 */
export function peopleRows(people: DayReportPerson[]): DayCell[][] {
  return people.map((p) => [
    p.branch,
    p.name,
    ROLE_LABEL[p.role] ?? p.role,
    STANDING_LABEL[p.standing],
    p.decidedAt ? istClock(p.decidedAt) : null,
    p.lateSignIns.length ? p.lateSignIns.map((at) => istClock(at)).join(", ") : null,
    p.note ?? null,
  ]);
}

/** A figure cell: the number given, or empty when nothing was given. Never a nought that was not typed. */
const figureCell = (figures: DayEndFigures | null, k: (typeof FIGURE_KEYS)[number]): DayCell => (figures ? (figures[k] ?? null) : null);

/**
 * The figures sheet: each branch's counsellors with their five figures, the
 * branch's total under them, and every branch added up at the foot. Which
 * rows are totals is returned too, as positions in the returned list counted
 * from nought, so the server can make them bold without reading the labels back.
 */
export function figuresRows(figures: ReturnType<typeof figuresByBranch>): { rows: DayCell[][]; totalRows: number[] } {
  const rows: DayCell[][] = [];
  const totalRows: number[] = [];
  for (const b of figures.branches) {
    for (const p of b.people) rows.push([b.name, p.name, ROLE_LABEL[p.role] ?? p.role, ...FIGURE_KEYS.map((k) => figureCell(p.figures, k))]);
    rows.push([b.name, `${b.name} total`, `${b.given} of ${b.people.length} gave figures`, ...FIGURE_KEYS.map((k) => b.totals[k])]);
    totalRows.push(rows.length - 1);
  }
  if (figures.branches.length) {
    rows.push(["All branches", "Total", `${figures.given} of ${figures.people} gave figures`, ...FIGURE_KEYS.map((k) => figures.totals[k])]);
    totalRows.push(rows.length - 1);
  }
  return { rows, totalRows };
}

/** The file the browser saves: the day in the name, so a folder of them sorts by date. */
export const dayWorkbookFileName = (day: string) => `day-end-report-${day}.xlsx`;
