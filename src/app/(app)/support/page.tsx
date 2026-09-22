import Link from "next/link";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { CATEGORY_LABEL, TICKET_STATUSES, TICKET_STATUS_LABEL, TICKET_STATUS_TONE, type TicketStatus } from "@/lib/tickets";
import { Card, CardHeader, Chip, EmptyState, PageHeader, cn } from "@/components/ui";
import { OpenTicketForm } from "@/components/ticket-forms";

export const metadata = { title: "Help desk" };

/** Partners see their branch's tickets; the Overseas team sees every branch, open ones first. */
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const staff = isStaff(user);
  const sp = await searchParams;
  const status = (TICKET_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as TicketStatus) : undefined;
  const t = schema.tickets;
  const conds: (SQL | undefined)[] = [staff ? undefined : eq(t.orgId, user.orgId), status ? eq(t.status, status) : sp.status === "all" ? undefined : sql`${t.status} <> 'RESOLVED'`];
  const rows = await db.query.tickets.findMany({
    where: and(...conds),
    with: { org: { columns: { name: true } }, raisedBy: { columns: { name: true } }, owner: { columns: { name: true } } },
    orderBy: [sql`${t.status} = 'OPEN' desc`, desc(t.updatedAt)],
    limit: 100,
  });
  const counts = await db.select({ status: t.status, n: count() }).from(t).where(staff ? undefined : eq(t.orgId, user.orgId)).groupBy(t.status);
  const n = (s: TicketStatus) => counts.find((c) => c.status === s)?.n ?? 0;
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:border-brand-300")}>{label}</Link>
  );
  const now = Date.now();

  return (
    <>
      <PageHeader title="Help desk" subtitle={staff ? "Questions from every branch that are not about one student's file." : "Ask the Overseas team about commission, access, the catalogue or anything else."} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-line p-3">
            {tab("/support", `Open (${n("OPEN") + n("WAITING_PARTNER")})`, !sp.status)}
            {tab("/support?status=OPEN", `With the team (${n("OPEN")})`, status === "OPEN")}
            {tab("/support?status=WAITING_PARTNER", `Waiting on the partner (${n("WAITING_PARTNER")})`, status === "WAITING_PARTNER")}
            {tab("/support?status=RESOLVED", `Resolved (${n("RESOLVED")})`, status === "RESOLVED")}
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No tickets here">{staff ? "Nothing waiting." : "Raise one on the right when you need the team."}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const days = Math.floor((now - r.updatedAt.getTime()) / 86_400_000);
                return (
                  <li key={r.id}>
                    <Link href={`/support/${r.id}`} className="block px-4 py-3 hover:bg-surface-2/60">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{r.subject}</p>
                        <Chip tone={TICKET_STATUS_TONE[r.status]}>{staff && r.status === "WAITING_PARTNER" ? "Waiting on the partner" : !staff && r.status === "OPEN" ? "With the Overseas team" : TICKET_STATUS_LABEL[r.status]}</Chip>
                      </div>
                      <p className="text-xs text-muted">
                        {CATEGORY_LABEL[r.category]}{staff ? ` · ${r.org.name}` : ""} · raised by {r.raisedBy?.name ?? "someone who has left"}
                        {r.owner ? ` · with ${r.owner.name}` : ""} · updated {fmtDateTime(r.updatedAt)}
                        {staff && r.status === "OPEN" && days >= 2 && <span className="font-medium text-red-700"> · waiting {days} days</span>}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {!staff && (
          <Card className="h-fit">
            <CardHeader title="New ticket" />
            <div className="p-4"><OpenTicketForm /></div>
          </Card>
        )}
      </div>
    </>
  );
}
