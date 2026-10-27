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
import { PROCESSING_ROLES, canAssignDesk, canChangeStatus } from "@/lib/permissions";
import { getSlaDays } from "@/server/dashboard";
import { deskOfficers } from "@/server/documentation";
import { InlineSelect } from "@/components/inline-select";
import { assignOfficerAction } from "./actions";
import { can, overrides } from "@/server/capabilities";
import { worksOwnFilesOnly } from "@/lib/desk-scope";
import { ownApplicationsOnly, unassignedFile } from "@/server/scope";
import { unassignedFileCount } from "@/server/unassigned-files";
import { UNASSIGNED, unassignedText } from "@/lib/unassigned-files";

export const metadata = { title: "Work queue" };

const LANE_LABEL: { group: StatusGroup; label: string }[] = [
  { group: "NEW", label: "New / assessment" },
  { group: "PENDING_PARTNER", label: "Pending from partner" },
  { group: "IN_PROGRESS", label: "In progress" },
  { group: "OFFER", label: "Offer / contract" },
  { group: "HOLD", label: "On hold" },
  { group: "SUCCESS", label: "Visa / done" },
];
const PATHWAYS: { key: Pathway; label: string }[] = [
  { key: "DEGREE", label: "Study abroad" },
  { key: "AUSBILDUNG", label: "Ausbildung" },
  { key: "NURSING", label: "Nurse registration" },
  { key: "FSJ", label: "FSJ" },
  { key: "BFD", label: "BFD" },
  { key: "NCLEX", label: "NCLEX-RN" },
  { key: "WEITERBILDUNG", label: "Weiterbildung" },
  { key: "CCM", label: "CCM" },
  { key: "AU_PAIR", label: "Au pair" },
];

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const canMoveStatus = canChangeStatus(user);
  const f = readFilters(await searchParams) as Record<string, string>;
  const pathway = (PATHWAYS.find((p) => p.key === f.pathway)?.key ?? "DEGREE") as Pathway;
  // The files handed to the desk that nobody has been given yet, for whoever
  // hands them out. Anybody else asking for this view gets their own queue.
  const handsOut = await can(user, "SEE_UNASSIGNED_FILES");
  const waiting = handsOut && f.officer === UNASSIGNED;
  const mine = f.officer !== "all" && !waiting;
  // Whose files this person may see at all, the same as the applications
  // list: nothing for whoever sees every student, their own files for a
  // documentation officer. "Everyone" and "Mine + unassigned" both stay inside
  // it, so an officer is never shown another officer's file or the pool.
  const scope = await ownApplicationsOnly(user);
  const ownOnly = worksOwnFilesOnly(user.role, await overrides());
  const officerWhere = and(
    scope,
    waiting ? unassignedFile() : mine ? sql`(${schema.applications.officerId} = ${user.id} or ${schema.applications.officerId} is null)` : undefined,
  );

  const { applications: a, statusDefinitions: sd, countries: c } = schema;
  const rows = await applicationsBase()
    .where(and(eq(sd.pathway, pathway), ne(sd.group, "CLOSED"), officerWhere, f.country ? eq(c.code, f.country) : undefined))
    .orderBy(asc(a.statusChangedAt));
  const orgNames = Object.fromEntries((await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations)).map((o) => [o.id, o.name]));
  const statuses = (await statusesFor(pathway)).map((s) => ({ id: s.id, label: s.label, requiresReason: s.requiresReason, isMilestone: s.isMilestone, code: s.code }));
  const statusIdByCode = Object.fromEntries(statuses.map((s) => [s.code, s.id]));
  const countries = await db.select().from(c).orderBy(asc(c.name));
  const pathwayCounts = await db
    .select({ pathway: sd.pathway, n: sql<number>`count(*)::int` })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(and(ne(sd.group, "CLOSED"), officerWhere))
    .groupBy(sd.pathway);
  // How many are waiting for an officer, across every pathway, for the choice
  // that opens them. The same number as the badge on the menu.
  const unassigned = (await unassignedFileCount(user)) ?? 0;

  // Who is carrying each file, and who it could be handed to. The officer
  // used to fill itself in with whoever first moved the file, so nobody was
  // ever given one and the lead had no control to give it with.
  const mayAssign = canAssignDesk(user);
  const officers = mayAssign ? await deskOfficers() : [];

  // Service levels come from platform settings, so a super admin can retune the queue.
  const sla = await getSlaDays();
  const LANES = LANE_LABEL.map((l) => ({ ...l, slaDays: sla[l.group] ?? 9999 }));

  const now = Date.now();
  const breaches = rows.filter((r) => {
    const lane = LANES.find((l) => l.group === r.statusGroup);
    return lane && (now - r.statusChangedAt.getTime()) / 86400000 > lane.slaDays;
  }).length;
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...f, ...extra }).toString();

  return (
    <>
      <PageHeader
        title={waiting ? "Waiting for an officer" : mine ? "My queue" : "All applications queue"}
        subtitle={
          waiting
            ? `${unassignedText(unassigned)}, from every branch. Each one has been handed to the desk and nobody is carrying it yet: choose the officer on the card and it is theirs, with a notice to say so.`
            : ownOnly
              ? "Oldest first within each lane. Only your own files: the applications you are the officer on and the students you have been given. The team leader hands out the rest."
              : "Oldest first within each lane. Unassigned applications show in everyone's queue."
        }
        actions={breaches > 0 ? <Chip tone="bad" className="px-3 py-1 text-md">{breaches} past SLA</Chip> : <Chip tone="ok" className="px-3 py-1 text-md">All within SLA</Chip>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-line bg-surface p-1" role="tablist" aria-label="Pathway">
          {PATHWAYS.map((p) => (
            <Link key={p.key} href={`/admin/queue?${qs({ pathway: p.key })}`} role="tab" aria-selected={p.key === pathway} className={cn("rounded px-3 py-1.5 font-medium", p.key === pathway ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}>
              {p.label} <span className="tabular opacity-80">{pathwayCounts.find((x) => x.pathway === p.key)?.n ?? 0}</span>
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="pathway" value={pathway} />
          <Select name="officer" defaultValue={waiting ? UNASSIGNED : mine ? "me" : "all"} aria-label="Officer" className="w-52">
            <option value="me">Mine + unassigned</option>
            <option value="all">Everyone</option>
            {handsOut && <option value={UNASSIGNED}>Handed over, no officer ({unassigned})</option>}
          </Select>
          <Select name="country" defaultValue={f.country ?? ""} aria-label="Country" className="w-44">
            <option value="">All countries</option>
            {countries.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}
          </Select>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
        {handsOut && (
          <Link
            href={`/admin/queue?${qs({ officer: waiting ? "me" : UNASSIGNED })}`}
            data-unassigned={unassigned}
            className={cn("rounded-full px-3 py-1 text-xs font-medium", waiting ? "bg-brand-600 text-white" : unassigned > 0 ? "border border-warn-500/25 bg-warn-50 text-warn-700" : "border border-line text-muted hover:text-ink")}
          >
            Unassigned ({unassigned})
          </Link>
        )}
        <LinkButton variant="quiet" href={`/applications?pathway=${pathway}&group=CLOSED`} className="ml-auto">Closed cases</LinkButton>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {LANES.map((lane) => {
            const items = rows.filter((r) => r.statusGroup === lane.group);
            return (
              <section key={lane.group} className="flex flex-col rounded-lg bg-surface-2 p-2" aria-label={lane.label}>
                <h2 className="mb-2 flex items-center justify-between px-1 font-semibold">
                  {lane.label} <span className="rounded-full bg-surface px-2 text-xs tabular">{items.length}</span>
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
                            <span className={cn("text-xs tabular", late ? "font-semibold text-stop-500" : "text-muted")}>{days}d</span>
                          </div>
                          <p className="font-medium">{fullName(r)}</p>
                          <p className="text-xs text-muted">{r.programName}</p>
                          <p className="text-xs text-muted">{r.universityName} · {intakeLabel(r.intakeMonth, r.intakeYear)}</p>
                          <p className="mt-1 text-xs"><span className="text-muted">Status:</span> {r.statusLabel}</p>
                          <p className="text-xs text-muted">{orgNames[r.orgId]}</p>
                          {mayAssign ? (
                            <div className="mt-1.5">
                              <InlineSelect
                                action={assignOfficerAction}
                                idName="applicationId"
                                id={r.id}
                                name="officerId"
                                value={r.officerId ?? ""}
                                label={`Officer for ${r.ackNo}`}
                                className="w-full min-w-0 py-1 text-xs"
                              >
                                <option value="">Nobody yet</option>
                                {officers.map((o) => <option key={o.id} value={o.id}>{o.deskLabel ?? o.name}</option>)}
                              </InlineSelect>
                            </div>
                          ) : (
                            <p className="text-xs"><span className="text-muted">Officer:</span> {r.officerLabel ?? <span className="text-muted">Nobody yet</span>}</p>
                          )}
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
