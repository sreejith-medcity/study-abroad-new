import { getSession } from "@/lib/auth";
import { isImportKind, IMPORT_KINDS } from "@/lib/import-kinds";
import { isAdmin } from "@/lib/permissions";

/** An empty CSV with the column names for one bulk upload. It opens in Excel. */
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSession();
  if (!user || (user.role !== "PARTNER" && !isAdmin(user))) return new Response("Not allowed", { status: 403 });
  const { kind } = await params;
  if (!isImportKind(kind) || (IMPORT_KINDS[kind].team && !isAdmin(user))) return new Response("Not found", { status: 404 });
  const header = IMPORT_KINDS[kind].header.filter((h) => h !== "branch" || isAdmin(user));
  return new Response("﻿" + header.join(",") + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-template.csv"` },
  });
}
