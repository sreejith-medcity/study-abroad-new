import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fmtDateTime } from "@/lib/format";
import { isSuperAdmin } from "@/lib/permissions";
import { actionLabel, auditBase, auditOrder, auditWhere, readAuditFilters } from "@/server/audit-query";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!isSuperAdmin(user)) return new Response("Not found", { status: 404 });

  const f = readAuditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await auditBase().where(auditWhere(f)).orderBy(auditOrder()).limit(20000);

  const header = ["When", "Who", "Email", "Role", "Action", "Action code", "Record type", "Record id", "Details"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        fmtDateTime(r.createdAt),
        r.actorName ?? "System",
        r.actorEmail ?? "",
        r.actorRole ?? "",
        actionLabel(r.action),
        r.action,
        r.entityType,
        r.entityId,
        r.meta ? JSON.stringify(r.meta) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(user.id, "audit.export", "audit_log", "*", { count: rows.length, filters: f });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
