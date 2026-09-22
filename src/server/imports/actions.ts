"use server";

import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isImportKind, IMPORT_KINDS } from "@/lib/import-kinds";
import { ADMIN_ROLES, isAdmin } from "@/lib/permissions";
import type { ImportResult } from "./common";
import { importApplicationUpdates } from "./applications";
import { importCommissionPayments } from "./commissions";
import { importEnquiries } from "./enquiries";
import { MAX_ROWS, readSheet } from "./sheet";
import { importStudents } from "./students";

export type ImportState = { kind?: string; result?: ImportResult; committed?: boolean; rows?: Record<string, string>[]; fileName?: string; error?: string };

/**
 * Preview reads the file and checks every row without saving anything. Import
 * checks the same rows again and saves them. Owners upload students and
 * enquiries for their own branch; the team uploads anything, for any branch.
 */
export async function runImportAction(prev: ImportState, fd: FormData): Promise<ImportState> {
  const user = await requireUser(["PARTNER", ...ADMIN_ROLES]);
  const kind = String(fd.get("kind") ?? "");
  if (!isImportKind(kind)) return { error: "Choose what you are uploading." };
  if (IMPORT_KINDS[kind].team && !isAdmin(user)) return { error: "Only the Overseas team can upload this." };
  const commit = fd.get("mode") === "commit";

  let rows: Record<string, string>[];
  let fileName = prev.fileName;
  if (commit) {
    if (prev.kind !== kind || !prev.rows?.length) return { kind, error: "Preview the file first." };
    rows = prev.rows.slice(0, MAX_ROWS).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k), String(v ?? "")])));
  } else {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { kind, error: "Choose a CSV or Excel file." };
    const sheet = await readSheet(file);
    if (sheet.error) return { kind, error: sheet.error };
    rows = sheet.rows;
    fileName = file.name;
    // The team names each row's branch; a branch owner's rows are always their own.
    if (!isAdmin(user)) rows = rows.map((r) => ({ ...r, branch: "" }));
  }
  const known = new Set<string>(IMPORT_KINDS[kind].header);
  const ignored = Object.keys(rows[0] ?? {}).filter((h) => !known.has(h));
  const keyColumn = IMPORT_KINDS[kind].header[kind === "students" || kind === "enquiries" ? 1 : 0];
  if (!(keyColumn in (rows[0] ?? {}))) return { kind, error: `The file has no "${keyColumn}" column. Download the template for the column names.` };

  const run = { students: importStudents, enquiries: importEnquiries, applications: importApplicationUpdates, commissions: importCommissionPayments }[kind];
  let result: ImportResult;
  try {
    result = await run(user, rows, commit);
    if (ignored.length) result.notes.unshift({ line: 1, message: `Columns not used by this upload, ignored: ${ignored.slice(0, 8).join(", ")}` });
  } catch (e) {
    return { kind, rows, fileName, error: `The upload stopped: ${(e as Error).message}. Nothing after that row was saved.` };
  }
  if (commit) {
    await audit(user.id, "import.run", "import", kind, { fileName, created: result.created, updated: result.updated, unchanged: result.unchanged, skipped: result.skipped, errors: result.errors.length });
    return { kind, result, committed: true, fileName };
  }
  return { kind, result, rows, fileName };
}
