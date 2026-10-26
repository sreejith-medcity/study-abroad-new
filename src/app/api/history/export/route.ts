import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES } from "@/lib/permissions";
import { istDateTime } from "@/lib/format";
import { csvCell, ENTITY_LABEL, fieldLabel, readHistoryFilters, showValue } from "@/lib/record-history";
import { can } from "@/server/capabilities";
import { feedViewer } from "@/server/history-feed";
import { feedPage, feedWhere, nameBook, recordTitles } from "@/server/record-history";
import { actionLabel } from "@/components/record-history";

export const dynamic = "force-dynamic";

/**
 * The change feed as a spreadsheet, one line per field changed, under exactly
 * the filters and the scope of the screen: nobody downloads a row they could
 * not have read there.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (user.mustChangePassword || !(APP_ROLES as readonly string[]).includes(user.role)) return new Response("Not found", { status: 404 });

  const f = readHistoryFilters(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await feedViewer(user);
  const rows = await feedPage(feedWhere(viewer, f), 20000, 0);
  const [names, titles, fullPassport] = await Promise.all([nameBook(rows), recordTitles(rows), can(user, "SEE_FULL_PASSPORT")]);

  const header = ["When (IST)", "Who", "Record type", "Record", "Branch", "What was done", "Field", "Before", "After"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    for (const c of r.changes) {
      lines.push(
        [
          istDateTime(r.createdAt),
          r.by ?? (r.byId ? "Not recorded" : "The portal"),
          ENTITY_LABEL[r.entity],
          titles.get(r.entityId)?.title ?? "No longer on file",
          r.org ?? "Not recorded",
          actionLabel(r.action),
          fieldLabel(r.entity, c.field),
          showValue(r.entity, c.field, c.before, names, { fullPassport }),
          showValue(r.entity, c.field, c.after, names, { fullPassport }),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  await audit(user.id, "history.export", "record_version", "*", { count: rows.length, filters: f });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="change-history-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
