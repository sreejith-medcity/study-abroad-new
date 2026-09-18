import Link from "next/link";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fullName, intakeLabel } from "@/lib/format";
import { statusesFor } from "@/server/applications";
import { applicationsBase, readFilters } from "@/server/queries";
import type { Pathway, StatusGroup } from "@/db/schema";
import { Button, Card, Chip, LinkButton, PageHeader, Select, cn } from "@/components/ui";
import { StatusForm } from "@/app/(app)/students/[id]/applications/client";
import { PROCESSING_ROLES, canChangeStatus } from "@/lib/permissions";

export const metadata = { title: "Work queue" };

const LANES: { group: StatusGroup; label: string; slaDays: number }[] = [
  { group: "NEW", label: "New / assessment", slaDays: 2 },
  { group: "PENDING_PARTNER", label: "Pending from partner", slaDays: 5 },
  { group: "IN_PROGRESS", label: "In progress", slaDays: 7 },
  { group: "OFFER", label: "Offer / contract", slaDays: 10 },
  { group: "HOLD", label: "On hold", slaDays: 60 },
  { group: "SUCCESS", label: "Visa / done", slaDays: 9999 },
];
const PATHWAYS: { key: Pathway; label: string }[] = [
  { key: "DEGREE", label: "Degree" },
  { key: "AUSBILDUNG", label: "Ausbildung" },
  { key: "NURSING", label: "Nurse registration" },
];

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const canMoveStatus = canChangeStatus(user);
  const f = readFilters(await searchParams) as Record<string, string>;
  const pathway = (PATHWAYS.find((p) => p.key === f.pathway)?.key ?? "DEGREE") as Pathway;
  const mine = f.officer !== "all";

  const { applications: a, statusDefinitions: sd, countries: c } = schema;
  const rows = await applicationsBase()
    .where(and(eq(sd.pathway, pathway), ne(sd.group, "CLOSED"), mine ? sql`(${a.officerId} = ${user.id} or ${a.officerId} is null)` : undefined, f.country ? eq(c.code, f.country) : undefined))
    .orderBy(asc(a.statusChangedAt));
  const orgNames = Object.fromEntries((await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations)).map((o) => [o.id, o.name]));
  const statuses = (await statusesFor(pathway)).map((s) => ({ id: s.id, label: s.label, requiresReason: s.requiresReason, isMilestone: s.isMilestone, code: s.code }));
  const statusIdByCode = Object.fromEntries(statuses.map((s) => [s.code, s.id]));
  const countries = await db.select().from(c).orderBy(asc(c.name));
  const pathwayCounts = await db
    .select({ pathway: sd.pathway, n: sql<number>`count(*)::int` })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(and(ne(sd.group, "CLOSED"), mine ? sql`(${a.officerId} = ${user.id} or ${a.officerId} is null)` : undefined))
    .groupBy(sd.pathway);

  const now = Date.now();
  const breaches = rows.filter((r) => {
    const lane = LANES.find((l) => l.group === r.statusGroup);
    return lane && (now - r.statusChangedAt.getTime()) / 86400000 > lane.slaDays;
  }).length;
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...f, ...extra }).toString();

  return (
    <>
      <PageHeader
        title={mine ? "My queue" : "All applications queue"}
        subtitle="Oldest first within each lane. Unassigned applications show in everyone's queue."
        actions={breaches > 0 ? <Chip tone="bad" className="px-3 py-1 text-sm">{breaches} past SLA</Chip> : <Chip tone="ok" className="px-3 py-1 text-sm">All within SLA</Chip>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-line bg-white p-1" role="tablist" aria-label="Pathway">
          {PATHWAYS.map((p) => (
            <Link key={p.key} href={`/admin/queue?${qs({ pathway: p.key })}`} role="tab" aria-selected={p.key === pathway} className={cn("rounded px-3 py-1.5 font-medium", p.key === pathway ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}>
              {p.label} <span className="tabular opacity-80">{pathwayCounts.find((x) => x.pathway === p.key)?.n ?? 0}</span>
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="pathway" value={pathway} />
          <Select name="officer" defaultValue={mine ? "me" : "all"} aria-label="Officer" className="w-44">
            <option value="me">Mine + unassigned</option>
            <option value="all">Everyone</option>
          </Select>
          <Select name="country" defaultValue={f.country ?? ""} aria-label="Country" className="w-44">
            <option value="">All countries</option>
            {countries.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}
          </Select>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
        <LinkButton variant="quiet" href={`/applications?pathway=${pathway}&group=CLOSED`} className="ml-auto">Closed cases</LinkButton>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {LANES.map((lane) => {
            const items = rows.filter((r) => r.statusGroup === lane.group);
            return (
              <section key={lane.group} className="flex flex-col rounded-lg bg-slate-200/60 p-2" aria-label={lane.label}>
                <h2 className="mb-2 flex items-center justify-between px-1 font-semibold">
                  {lane.label} <span className="rounded-full bg-white px-2 text-xs tabular">{items.length}</span>
                </h2>
                <ul className="space-y-2">
                  {items.map((r) => {
                    const days = Math.floor((now - r.statusChangedAt.getTime()) / 86400000);
                    const late = days > lane.slaDays;
                    return (
                      <li key={r.id}>
                        <Card className={cn("p-2.5", late && "border-l-4 border-l-red-500")}>
                          <div className="flex items-start justify-between gap-2">
                            <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="whitespace-nowrap font-semibold tabular hover:underline">{r.ackNo}</Link>
                            <span className={cn("text-xs tabular", late ? "font-semibold text-red-600" : "text-muted")}>{days}d</span>
                          </div>
                          <p className="font-medium">{fullName(r)}</p>
                          <p className="text-xs text-muted">{r.programName}</p>
                          <p className="text-xs text-muted">{r.universityName} · {intakeLabel(r.intakeMonth, r.intakeYear)}</p>
                          <p className="mt-1 text-xs"><span className="text-muted">Status:</span> {r.statusLabel}</p>
                          <p className="text-xs text-muted">{orgNames[r.orgId]}</p>
                          <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2 text-xs">
                            {lane.group === "NEW" && <Link href={`/admin/applications/${r.id}/check`} className="text-brand-600 hover:underline">Run check</Link>}
                            {canMoveStatus ? (
                              <details className="w-full">
                                <summary className="cursor-pointer text-brand-600">Change status</summary>
                                <div className="mt-2">
                                  <StatusForm applicationId={r.id} currentId={statusIdByCode[r.statusCode]} statuses={statuses} />
                                </div>
                              </details>
                            ) : (
                              <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="text-brand-600 hover:underline">
                                Open the file
                              </Link>
                            )}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                  {items.length === 0 && <li className="px-1 py-4 text-center text-xs text-muted">Empty</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
