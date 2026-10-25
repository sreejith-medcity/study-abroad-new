import "server-only";
import ExcelJS from "exceljs";
import { FIGURES_HEAD, PEOPLE_HEAD, coverRows, figuresRows, peopleRows, type DayReport } from "@/lib/journal-day-export";
import { sheet } from "./workbook";

/*
 * One day's consolidated day end report as a workbook: a cover saying which
 * day and when and why the report went, a sheet of everybody issued a report
 * and how they answered, and a sheet of the day's figures per counsellor with
 * branch totals and the overall total. The rows come from the pure builder;
 * this only pours them into the portal's shared sheet layout.
 */
export function dayWorkbook(report: DayReport, organisation: string, downloadedBy: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Medcity Overseas portal";
  wb.created = new Date();
  sheet(wb, "Cover", ["", ""], coverRows(report, organisation, downloadedBy), [24, 72]);
  sheet(wb, "People", PEOPLE_HEAD, peopleRows(report.people), [26, 28, 24, 22, 22, 24, 48]);
  const { rows, totalRows } = figuresRows(report.figures);
  const ws = sheet(wb, "Figures", FIGURES_HEAD, rows, [26, 28, 26, 14, 12, 16, 16, 18]);
  // The heading is row 1, so a total's place in the list is one further down the sheet.
  for (const i of totalRows) ws.getRow(i + 2).font = { bold: true };
  return wb;
}
