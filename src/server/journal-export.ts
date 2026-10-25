import "server-only";
import ExcelJS from "exceljs";
import { ROLE_LABEL } from "@/lib/permissions";
import { FIGURE_KEYS, FIGURE_LABEL, monthFiguresByBranch, type MonthPerson } from "@/lib/journal";
import { monthText } from "@/lib/month";
import { sheet, sheetName, type Row } from "./workbook";

/*
 * A month of day end figures as a workbook: a cover, the totals per branch,
 * then a sheet per branch with a row per counsellor and the branch's total
 * under them. The numbers are the same sums the month view shows, written as
 * numbers so a column can be added up again in Excel.
 */

const FIGURE_HEADS = FIGURE_KEYS.map((k) => FIGURE_LABEL[k]);

/** A branch's sheet name, kept apart from another branch's that trims to the same 31 characters. */
function uniqueSheetNames(names: string[]) {
  const taken = new Set<string>(["Cover", "Totals"]);
  return names.map((name) => {
    let candidate = sheetName(name);
    for (let i = 2; taken.has(candidate); i++) candidate = sheetName(`${name.slice(0, 27)} ${i}`);
    taken.add(candidate);
    return candidate;
  });
}

export function figuresWorkbook(month: string, people: MonthPerson[], downloadedBy: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Medcity Overseas portal";
  wb.created = new Date();
  const grouped = monthFiguresByBranch(people);

  // The cover says what this is and for whom, as the dashboard's does.
  sheet(wb, "Cover", ["", ""], [["Day end figures", monthText(month)], ["Downloaded by", downloadedBy], ["Downloaded at", new Date()]], [18, 40]);
  const totals: Row[] = grouped.branches.map((b) => [b.name, b.people.length, b.answered, b.missed, ...FIGURE_KEYS.map((k) => b.totals[k])]);
  totals.push(["All branches", grouped.people, grouped.answered, grouped.missed, ...FIGURE_KEYS.map((k) => grouped.totals[k])]);
  const ws = sheet(wb, "Totals", ["Branch", "Counsellors", "Days answered", "Days missed", ...FIGURE_HEADS], totals, [36, 14, 14, 12, 14, 12, 16, 16, 18]);
  ws.getRow(ws.rowCount).font = { bold: true };

  const names = uniqueSheetNames(grouped.branches.map((b) => b.name));
  grouped.branches.forEach((b, i) => {
    // A person who answered nothing has no figures, and the sheet says so by
    // leaving the cells empty rather than writing noughts the screen does not show.
    const rows: Row[] = b.people.map((p) => [p.name, ROLE_LABEL[p.role] ?? p.role, p.answered, p.missed, ...FIGURE_KEYS.map((k) => (p.answered === 0 ? null : p.figures[k]))]);
    rows.push([`${b.name} total`, "", b.answered, b.missed, ...FIGURE_KEYS.map((k) => b.totals[k])]);
    const bs = sheet(wb, names[i], ["Counsellor", "Role", "Days answered", "Days missed", ...FIGURE_HEADS], rows, [28, 22, 14, 12, 14, 12, 16, 16, 18]);
    bs.getRow(bs.rowCount).font = { bold: true };
  });
  return wb;
}
