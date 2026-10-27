import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { istDay } from "@/lib/journal";
import { LEADERBOARD_HEADER, csvCell, leaderboardCsvRow, readPeriod } from "@/lib/leaderboard";
import { leaderboard, leaderboardBranches, readsLeaderboard } from "@/server/leaderboard";

/** The leaderboard as a spreadsheet: the same people, period and branch as the page, "Not recorded" written out. */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (user.mustChangePassword || !readsLeaderboard(user)) return new Response("Not found", { status: 404 });

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const period = readPeriod(params, istDay());
  const { options, locked } = await leaderboardBranches(user);
  const branch = locked ?? (params.branch && options.some((o) => o.id === params.branch) ? params.branch : null);
  const rows = await leaderboard(period, branch);

  const lines = [LEADERBOARD_HEADER.map(csvCell).join(","), ...rows.map(leaderboardCsvRow)];
  await audit(user.id, "leaderboard.export", "report", "leaderboard", { ...period, branch, rows: rows.length });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leaderboard-${period.from}-to-${period.to}.csv"`,
    },
  });
}
