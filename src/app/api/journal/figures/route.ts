import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { monthScopeFor } from "@/lib/journal";
import { isMonth, thisMonth } from "@/lib/month";
import { journalBranches, monthFigures } from "@/server/journal";
import { figuresWorkbook } from "@/server/journal-export";

export const dynamic = "force-dynamic";

/**
 * The month of day end figures on screen, as an Excel workbook. Takes the same
 * address as the month view (month, org), under the same rules: the report's
 * readers get every branch or the one named, a branch head gets their own
 * whatever the address says, and anybody else gets nothing.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  const scope = monthScopeFor(user, new URL(req.url).searchParams.get("org"));
  if (!scope) return new Response("Not found", { status: 404 });
  const asked = new URL(req.url).searchParams.get("month") ?? undefined;
  const month = isMonth(asked) && asked <= thisMonth() ? asked : thisMonth();
  const branches = await journalBranches();
  const branch = scope.org ? (branches.find((b) => b.id === scope.org) ?? null) : null;
  const people = await monthFigures(month, scope.orgIds);
  const wb = figuresWorkbook(month, people, user.name);
  const buffer = await wb.xlsx.writeBuffer();
  await audit(user.id, "journal.export", "journal", month, { org: scope.org });
  // The branch's name in the file name, letters and digits only, so the file says whose figures it holds.
  const slug = branch ? `-${branch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="day-end-figures${slug}-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
