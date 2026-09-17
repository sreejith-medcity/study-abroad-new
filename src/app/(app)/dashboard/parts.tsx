import Link from "next/link";
import { fmtDate, fmtDateTime, fullName, intakeLabel, MONTHS } from "@/lib/format";
import { GROUP_LABEL, SLA_DAYS } from "@/server/dashboard";
import type { StatusGroup } from "@/db/schema";
import { Button, Card, CardHeader, Chip, Input, LinkButton, Select, StatusBadge, Table, Td, Th, Toolbar } from "@/components/ui";
import { IconClock } from "@/components/icons";

/** Shared date, intake and destination filter used by the dashboards that report numbers. */
export function DashboardFilters({
  f,
  countries,
  compact = false,
}: {
  f: Record<string, string | undefined>;
  countries: { id: string; code: string; name: string }[];
  /** Set when the filters sit in a side column rather than the full width. */
  compact?: boolean;
}) {
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  return (
    <Toolbar>
      <form className={compact ? "grid gap-2.5 [&>*]:min-w-0" : "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0"}>
        {compact && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Filter the numbers</p>}
        <div className={compact ? "grid grid-cols-2 gap-2 [&>*]:min-w-0" : "flex gap-2 sm:col-span-2 [&>*]:min-w-0"}>
          <Input type="date" name="from" aria-label="Created from" defaultValue={f.from} />
          <Input type="date" name="to" aria-label="Created to" defaultValue={f.to} />
        </div>
        <Select name="intakeMonth" aria-label="Intake month" defaultValue={f.intakeMonth ?? ""}>
          <option value="">Intake month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </Select>
        <Select name="intakeYear" aria-label="Intake year" defaultValue={f.intakeYear ?? ""}>
          <option value="">Intake year</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </Select>
        <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
          <option value="">All destinations</option>
          {countries.map((x) => (
            <option key={x.id} value={x.code}>{x.name}</option>
          ))}
        </Select>
        <div className={compact ? "flex justify-end gap-2" : "flex justify-end gap-2 sm:col-span-2 xl:col-span-3"}>
          <LinkButton href="/dashboard" variant="quiet" size="sm">Clear</LinkButton>
          <Button type="submit" variant="secondary" size="sm">Apply</Button>
        </div>
      </form>
    </Toolbar>
  );
}

type ChangeRow = {
  id: string;
  ackNo: string;
  studentId: string;
  firstName: string;
  lastName: string;
  statusLabel: string;
  statusGroup: StatusGroup;
  changedAt: Date;
  intakeMonth: number;
  intakeYear: number;
  orgName?: string;
};

export function RecentChangesCard({ rows, showOrg = false, title = "Latest movement" }: { rows: ChangeRow[]; showOrg?: boolean; title?: string }) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle="Newest status change first"
        action={<Link href="/applications" className="text-[13px] font-medium text-brand-600 hover:underline">All applications</Link>}
      />
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3 last:border-0">
            <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="ack font-medium text-brand-700 hover:underline">
              {r.ackNo}
            </Link>
            <span className="font-medium">{fullName(r)}</span>
            <span className="text-[13px] text-muted">{intakeLabel(r.intakeMonth, r.intakeYear)}</span>
            {showOrg && r.orgName && <span className="text-[13px] text-muted">· {r.orgName}</span>}
            <span className="ml-auto flex items-center gap-2">
              <StatusBadge group={r.statusGroup} label={r.statusLabel} />
              <span className="text-xs text-muted">{fmtDate(r.changedAt)}</span>
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-8 text-center text-muted">Nothing has moved yet.</li>}
      </ul>
    </Card>
  );
}

export function DeadlinesCard({
  rows,
  days = 14,
}: {
  rows: { id: string; deadline: Date | null; studentId: string; firstName: string; lastName: string; program: string; university: string }[];
  days?: number;
}) {
  return (
    <Card>
      <CardHeader title="Upcoming deadlines" subtitle={`Next ${days} days`} />
      <ul>
        {rows.map((d) => (
          <li key={d.id} className="border-b border-line px-4 py-2.5 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/students/${d.studentId}/applications?app=${d.id}`} className="font-medium hover:underline">
                {fullName(d)}
              </Link>
              <Chip tone="bad">
                <IconClock className="size-3.5" /> {fmtDate(d.deadline)}
              </Chip>
            </div>
            <p className="text-xs text-muted">{d.program} · {d.university}</p>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-center text-muted">No deadlines in the next {days} days.</li>}
      </ul>
    </Card>
  );
}

/** Oldest untouched work, with the lane's SLA turned into a plain "late by" reading. */
export function AgingCard({
  rows,
  showOrg = false,
  title = "Waiting the longest",
  subtitle = "Oldest first, against the lane's service level",
}: {
  rows: {
    id: string;
    ackNo: string;
    studentId: string;
    firstName: string;
    lastName: string;
    statusLabel: string;
    statusGroup: StatusGroup;
    changedAt: Date;
    orgName?: string;
    officerName?: string | null;
  }[];
  showOrg?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const now = Date.now();
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-muted">Nothing is waiting.</p>
      ) : (
        <Table tableClassName="min-w-[640px]">
          <thead>
            <tr>
              <Th>Application</Th>
              <Th>Status</Th>
              {showOrg && <Th>Partner</Th>}
              <Th>Sitting</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const days = Math.floor((now - r.changedAt.getTime()) / 86400000);
              const late = days > (SLA_DAYS[r.statusGroup] ?? 9999);
              return (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="font-medium hover:underline">
                      {fullName(r)}
                    </Link>
                    <p className="ack text-xs text-muted">{r.ackNo}</p>
                  </Td>
                  <Td>
                    <StatusBadge group={r.statusGroup} label={r.statusLabel} />
                    <p className="mt-1 text-xs text-muted">{GROUP_LABEL[r.statusGroup]}</p>
                  </Td>
                  {showOrg && (
                    <Td>
                      <span className="text-[13px]">{r.orgName}</span>
                      {r.officerName && <p className="text-xs text-muted">{r.officerName}</p>}
                    </Td>
                  )}
                  <Td className="whitespace-nowrap">
                    <Chip tone={late ? "bad" : "neutral"}>{days} {days === 1 ? "day" : "days"}</Chip>
                    {late && <p className="mt-1 text-xs text-stop-600">Past {SLA_DAYS[r.statusGroup]} day target</p>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function ActivityCard({
  rows,
  actionLabel,
}: {
  rows: { id: string; action: string; entityType: string; entityId: string; createdAt: Date; actorName: string | null }[];
  actionLabel: (action: string) => string;
}) {
  return (
    <Card>
      <CardHeader
        title="Latest recorded actions"
        subtitle="Straight from the audit log"
        action={<Link href="/admin/audit" className="text-[13px] font-medium text-brand-600 hover:underline">Open audit log</Link>}
      />
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
            <span className="font-medium text-ink">{r.actorName ?? "System"}</span>
            <span className="text-muted">{actionLabel(r.action).toLowerCase()}</span>
            <span className="text-muted">· {r.entityType.replace(/_/g, " ")}</span>
            <span className="ml-auto text-xs text-muted">{fmtDateTime(r.createdAt)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-8 text-center text-muted">Nothing recorded yet.</li>}
      </ul>
    </Card>
  );
}
