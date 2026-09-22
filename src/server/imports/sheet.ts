import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";

export const MAX_ROWS = 5000;
export const MAX_BYTES = 5 * 1024 * 1024;

/** A header as the importers expect it: lower case, words joined by underscores. */
export const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/^﻿/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export type Sheet = { rows: Record<string, string>[]; error?: string };

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("hyperlink" in v) return String((v as { text?: string }).text ?? v.hyperlink);
    return "";
  }
  return String(v);
}

/** Reads the first sheet of an .xlsx file, or a CSV, into rows keyed by normalised header. Blank rows are dropped. */
export async function readSheet(file: File): Promise<Sheet> {
  if (file.size > MAX_BYTES) return { rows: [], error: "Files must be 5 MB or smaller." };
  const name = file.name.toLowerCase();
  let table: string[][];
  if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    } catch {
      return { rows: [], error: "That Excel file could not be read. Save it again as .xlsx or CSV." };
    }
    const ws = wb.worksheets[0];
    if (!ws) return { rows: [], error: "The Excel file has no sheet." };
    table = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value).trim());
      table.push(cells);
    });
  } else if (name.endsWith(".csv") || file.type === "text/csv") {
    const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: false });
    table = parsed.data.map((r) => r.map((c) => String(c ?? "").trim()));
  } else {
    return { rows: [], error: "Upload a CSV or an Excel (.xlsx) file." };
  }
  const [head, ...body] = table;
  if (!head?.some(Boolean)) return { rows: [], error: "The first row must hold the column names." };
  const headers = head.map(normaliseHeader);
  const rows = body
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]).filter(([h]) => h)));
  if (rows.length > MAX_ROWS) return { rows: [], error: `Up to ${MAX_ROWS.toLocaleString("en-IN")} rows at a time. Split the file.` };
  if (!rows.length) return { rows: [], error: "The file has no rows under the column names." };
  return { rows };
}
