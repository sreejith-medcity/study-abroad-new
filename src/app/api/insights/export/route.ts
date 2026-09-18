import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { REPORTING_ROLES } from "@/lib/permissions";
import { breakdown, rate, readInsightFilters } from "@/server/insights";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const DIMENSIONS = ["partner", "country", "university", "pathway", "officer"] as const;

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!(REPORTING_ROLES as readonly string[]).includes(user.role)) return new Response("Not found", { status: 404 });

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const f = readInsightFilters(params);
  const dim = (DIMENSIONS as readonly string[]).includes(params.dim) ? (params.dim as (typeof DIMENSIONS)[number]) : "partner";
  const rows = await breakdown(user, f, dim);

  const header = [dim, "Applications", "Live", "Offers", "Offer rate %", "Visas", "Visa rate %", "Closed"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([r.label, r.total, r.live, r.offers, rate(r.offers, r.total), r.visas, rate(r.visas, r.total), r.closed].map(csvCell).join(","));
  }
  await audit(user.id, "insights.export", "report", dim, { filters: f, rows: rows.length });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="insights-${dim}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
