import "server-only";
import type ExcelJS from "exceljs";

/*
 * How every workbook the portal hands out is laid out: a bold brand-coloured
 * heading row that stays put when the sheet scrolls, columns wide enough for
 * their headings, money in rupees with a rupee format so a column can be
 * summed. Shared by the dashboard export and the month of day end figures, so
 * the two files look like they came from the same place.
 */

export const RUPEES = '"₹"#,##0';
export const BRAND = "FFC01F53";

export type Row = (string | number | Date | null | undefined)[];

/** Excel allows 31 characters in a sheet name and none of : \ / ? * [ ]. */
export function sheetName(name: string) {
  return name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
}

export function sheet(wb: ExcelJS.Workbook, name: string, head: string[], rows: Row[], widths?: number[], money: number[] = []) {
  const ws = wb.addWorksheet(sheetName(name), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(head);
  const top = ws.getRow(1);
  top.font = { bold: true, color: { argb: "FFFFFFFF" } };
  top.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  for (const r of rows) ws.addRow(r.map((v) => (v === undefined ? null : v)));
  head.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = widths?.[i] ?? Math.min(48, Math.max(12, h.length + 4));
    if (money.includes(i)) col.numFmt = RUPEES;
  });
  if (rows.length === 0) ws.addRow(["Nothing to list"]);
  return ws;
}
