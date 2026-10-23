import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES } from "@/lib/permissions";
import { readLens } from "@/server/dashboard-lens";
import { dashboardWorkbook } from "@/server/dashboard-export";

export const dynamic = "force-dynamic";

/**
 * The dashboard on screen, as an Excel workbook. Takes the same address as the
 * dashboard (as, org, who, period), and the same rules: a role that may not
 * view as another desk gets its own whatever the address says.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!(APP_ROLES as readonly string[]).includes(user.role)) return new Response("Not found", { status: 404 });
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const lens = await readLens(user, params);
  const wb = await dashboardWorkbook(lens);
  const buffer = await wb.xlsx.writeBuffer();
  await audit(user.id, "dashboard.export", "dashboard", lens.kind, { as: lens.viewingAs ? lens.kind : null, org: lens.org, who: lens.person?.id ?? null, period: lens.period });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dashboard-${lens.kind}-${day}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
