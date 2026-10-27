import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addDays } from "@/lib/calling";
import { dayText, istDay } from "@/lib/journal";
import { NOT_RECORDED, readPeriod, shown } from "@/lib/leaderboard";
import { redirect } from "next/navigation";
import { LEADERBOARD_ROLES, leaderboard, leaderboardBranches, readsLeaderboard } from "@/server/leaderboard";
import { Button, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Counsellor leaderboard" };
export const dynamic = "force-dynamic";

/**
 * Calls, connections, follow-ups and conversions per counsellor for a
 * period, from what was recorded in the portal and nothing else. Where there
 * is no record the board says so, rather than showing a 0 it cannot vouch for.
 */
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; branch?: string }> }) {
  const user = await requireUser([...LEADERBOARD_ROLES]);
  // A sub-agent firm's head runs a firm, not a Medcity branch.
  if (!readsLeaderboard(user)) redirect("/forbidden");
  const sp = await searchParams;
  const today = istDay();
  const period = readPeriod(sp, today);
  const { options, locked } = await leaderboardBranches(user);
  const branch = locked ?? (sp.branch && options.some((o) => o.id === sp.branch) ? sp.branch : null);
  const rows = await leaderboard(period, branch);

  const q = (p: { from: string; to: string }) => {
    const params = new URLSearchParams({ from: p.from, to: p.to, ...(branch && !locked ? { branch } : {}) });
    return `?${params.toString()}`;
  };
  const presets = [
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { label: "Last 7 days", from: addDays(today, -6), to: today },
    { label: "Last 30 days", from: addDays(today, -29), to: today },
    { label: "Today", from: today, to: today },
  ];
  const csv = `/api/reports/leaderboard${q(period)}`;

  return (
    <>
      <PageHeader
        title="Counsellor leaderboard"
        subtitle={`${dayText(period.from)} to ${dayText(period.to)}. Calls, connected calls, follow-ups and conversions per person, from what was recorded.`}
        actions={
          <LinkButton href={csv} variant="secondary" size="sm" prefetch={false} data-leaderboard-csv>
            Download CSV
          </LinkButton>
        }
      />
      <Card className="mb-4 p-3">
        <form method="get" className="flex flex-wrap items-end gap-3" data-leaderboard-filter>
          <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
            From
            <Input type="date" name="from" defaultValue={period.from} max={today} className="mt-1" />
          </label>
          <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
            To
            <Input type="date" name="to" defaultValue={period.to} max={today} className="mt-1" />
          </label>
          {!locked && (
            <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
              Branch
              <Select name="branch" defaultValue={branch ?? ""} className="mt-1">
                <option value="">Every branch</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </label>
          )}
          <Button type="submit" size="sm">Show</Button>
          <span className="flex flex-wrap gap-2 text-xs">
            {presets.map((p) => (
              <Link key={p.label} href={q(p)} className="rounded-full border border-line px-3 py-1 text-muted hover:text-ink">{p.label}</Link>
            ))}
          </span>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nobody to list">There are no counsellors at this branch.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Counsellor</Th>
                <Th className="text-right">Calls made</Th>
                <Th className="text-right">Connected</Th>
                <Th className="text-right">Follow-ups on time</Th>
                <Th className="text-right">Follow-ups late</Th>
                <Th className="text-right">Enquiries converted</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cell = (v: number | null) => (v === null ? <span className="text-muted">{NOT_RECORDED}</span> : v);
                return (
                  <tr key={r.id} data-leader-row={r.id}>
                    <Td className="text-muted">{i + 1}</Td>
                    <Td>
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-muted">{r.branch}</span>
                    </Td>
                    <Td className="text-right tabular">{cell(r.f.calls)}</Td>
                    <Td className="text-right tabular">
                      {cell(r.f.connected)}
                      {r.f.connectedPct !== null && <span className="text-xs text-muted"> ({r.f.connectedPct}%)</span>}
                    </Td>
                    <Td className="text-right tabular">{cell(r.f.onTime)}</Td>
                    <Td className="text-right tabular">{cell(r.f.late)}</Td>
                    <Td className="text-right tabular font-semibold">{cell(r.f.converted)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
      <p className="mt-2 text-xs text-muted">
        Calls are the calls logged against students and enquiries, connected the ones where somebody was reached. A follow-up is on time when it was finished on or
        before the day it was due. Converted counts the enquiries a person held whose student was registered in the period. {NOT_RECORDED} means there is nothing in the
        portal to count from, which is not the same as {shown(0)}.
      </p>
    </>
  );
}
