import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ViewTabs } from "@/components/view-tabs";
import { FilterBar } from "@/components/filter-bar";
import { viewsWithPins } from "@/server/views";
import { fmtDate } from "@/lib/format";
import { isAdmin, PROCESSING_ROLES } from "@/lib/permissions";
import { activeRejectionReasons, branchChecked, deskOfficers, documentationQueue, queueCounts } from "@/server/documentation";
import { can } from "@/server/capabilities";
import { claimHeld, CLAIM_MINUTES, STAGES, stageLabel } from "@/lib/journey";
import { documentCount, groupQueue, holdersText, QUEUE_PAGE, queuePageNumber, queuePaging } from "@/lib/documentation-queue";
import { Card, CardHeader, Chip, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { ItemActions } from "../students/[id]/documentation/client";
import { RunReminders } from "./chase";
import { Reassign } from "./reassign";
import { StudentRows } from "./student-rows";
import type { JourneyStage } from "@/db/schema";

export const metadata = { title: "Documentation queue" };
export const dynamic = "force-dynamic";

/** How long a file has been waiting, in the words somebody would use out loud. */
function waited(since: Date | null) {
  if (!since) return "Not recorded";
  const mins = Math.max(0, Math.floor((Date.now() - since.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default async function DocumentationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; stage?: string; vendor?: string; sort?: string; mine?: string; view?: string; page?: string }>;
}) {
  const user = await requireUser([...PROCESSING_ROLES]);
  // The saved ways of looking at this list, each with what it holds now.
  const savedViews = await viewsWithPins(user, "DOCUMENTATION");
  const sp = await searchParams;
  const sort = sp.sort === "VISA_FIRST" ? "VISA_FIRST" : "OLDEST";
  const branchView = sp.view === "branch";
  const page = queuePageNumber(sp.page);
  const canReassign = await can(user, "REASSIGN_DOCUMENTS");
  const [queue, counts, reasons, branches, vendors, checkedByBranches, officers] = await Promise.all([
    documentationQueue({ branch: sp.branch, stage: sp.stage as JourneyStage | undefined, vendor: sp.vendor, sort, mine: sp.mine, page }, user.id),
    queueCounts(user.id),
    activeRejectionReasons(),
    db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).orderBy(asc(schema.organizations.name)),
    db.select({ id: schema.vendors.id, name: schema.vendors.name, code: schema.vendors.code, colour: schema.vendors.colour }).from(schema.vendors).where(eq(schema.vendors.active, true)).orderBy(asc(schema.vendors.name)),
    branchChecked(),
    canReassign ? deskOfficers() : Promise.resolve([]),
  ]);

  // One row per student, because the desk picks up a file, not a document.
  const mine = sp.mine === "1";
  const students = groupQueue(queue.rows, sort, { viewerId: user.id, mineFirst: mine });
  const paging = queuePaging(page, queue.hasNext);
  const routeChip = (code: string, colour: string | null) => (
    <span key={code} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: colour ?? "#475569" }}>{code}</span>
  );

  // The page number is not carried: a change of mode, sort or filter starts
  // again at the first page, and only the links at the foot name a page.
  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { branch: sp.branch, stage: sp.stage, vendor: sp.vendor, sort: sp.sort, mine: sp.mine, view: sp.view, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return `/documentation${q ? `?${q}` : ""}`;
  };
  const pageHref = (n: number) => href({ page: n > 1 ? String(n) : undefined });
  const pill = (on: boolean) => (on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink");

  return (
    <>
      <PageHeader
        title="Documentation queue"
        subtitle={`${counts.waiting} ${counts.waiting === 1 ? "document" : "documents"} from ${counts.students} ${counts.students === 1 ? "student" : "students"} waiting · ${counts.mine} claimed by you. One row per student, oldest first; open a row for the documents. A document is claimed while somebody checks it so two people never check the same one.`}
        actions={isAdmin(user) ? <RunReminders /> : undefined}
      />

      <ViewTabs scope="DOCUMENTATION" views={savedViews} canShareWithEverybody={true} />
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ mine: undefined, view: undefined })} className={pill(!sp.mine && !branchView)}>Everything</Link>
          <Link href={href({ mine: "1", view: undefined })} className={pill(sp.mine === "1" && !branchView)}>Mine</Link>
          {checkedByBranches.length > 0 && (
            <Link href={href({ view: "branch", mine: undefined })} className={pill(branchView)}>
              Checked by a branch ({checkedByBranches.length})
            </Link>
          )}
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
          <Link href={href({ sort: undefined })} className={pill(sort === "OLDEST")}>Oldest first</Link>
          <Link href={href({ sort: "VISA_FIRST" })} className={pill(sort === "VISA_FIRST")}>Visa stage first</Link>
        </div>
      </Card>

      <FilterBar
        primary={3}
        keep={["mine", "sort"]}
        fields={[
          { kind: "select", name: "stage", label: "Stage", options: STAGES.map((x) => ({ value: x.value, label: `${x.number}. ${x.label}` })) },
          { kind: "select", name: "branch", label: "Branch", options: branches.map((b) => ({ value: b.id, label: b.name })) },
          ...(vendors.length > 0
            ? [{ kind: "select" as const, name: "vendor", label: "Route", options: vendors.map((v) => ({ value: v.id, label: v.name })) }]
            : []),
        ]}
      />

      {branchView ? (
        <Card>
          <CardHeader
            title="What the branches decided themselves"
            subtitle="Branches set to do their own first pass. These are not waiting on the desk: they are here so somebody can look over what was accepted rather than check all of it again. Any of them can still be sent back from the student's file."
          />
          <Table>
            <thead>
              <tr>
                <Th>Decided</Th>
                <Th>Student and branch</Th>
                <Th>Document</Th>
                <Th>Stage</Th>
                <Th>Outcome</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {checkedByBranches.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(r.decidedAt)}</Td>
                  <Td>
                    <Link href={`/students/${r.studentId}/documentation`} className="font-medium text-brand-600 hover:underline">
                      {r.studentName}
                    </Link>
                    <span className="block text-xs text-muted">{r.branch}</span>
                  </Td>
                  <Td>{r.label}</Td>
                  <Td className="whitespace-nowrap text-xs">{stageLabel(r.stage)}</Td>
                  <Td>
                    <Chip tone={r.state === "ACCEPTED" ? "ok" : "warn"}>{r.state === "ACCEPTED" ? "Accepted" : "Sent back"}</Chip>
                    {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
                  </Td>
                  <Td className="text-xs text-muted">{r.decidedByName ?? "Somebody at the branch"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : students.length === 0 ? (
        page > 1 ? (
          <EmptyState title="Nothing on this page" action={<LinkButton variant="secondary" href={pageHref(1)}>Back to the first page</LinkButton>}>
            The queue has moved on since this page was opened.
          </EmptyState>
        ) : mine ? (
          <EmptyState title="Nothing with you">Claim a document from the queue and that student appears here, with everything else of theirs that is waiting.</EmptyState>
        ) : (
          <EmptyState title="Nothing to check">Every document that has been sent in has been decided. A student appears here as soon as one of their uploads lands.</EmptyState>
        )
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Waiting</Th>
                <Th>Student and branch</Th>
                <Th>Stage</Th>
                <Th>Route</Th>
                <Th>Documents</Th>
                <Th>With</Th>
                <Th />
              </tr>
            </thead>
            {students.map((g) => (
              <StudentRows
                key={g.studentId}
                studentId={g.studentId}
                studentName={g.studentName}
                count={g.items.length}
                defaultOpen={mine}
                summary={
                  <>
                    <Td className="whitespace-nowrap text-xs tabular">
                      {waited(g.oldestUploadedAt)}
                      {g.soonestDueOn && <span className="block text-2xs text-muted">Wanted by {fmtDate(g.soonestDueOn)}</span>}
                    </Td>
                    <Td>
                      <Link href={`/students/${g.studentId}/documentation`} className="font-medium text-brand-600 hover:underline">{g.studentName}</Link>
                      <span className="block text-xs text-muted">{g.branch}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{stageLabel(g.stage)}</Td>
                    <Td>
                      {g.routes.length > 0 ? (
                        <span className="inline-flex flex-wrap gap-1">{g.routes.map((r) => routeChip(r.code, r.colour))}</span>
                      ) : (
                        <span className="text-xs text-muted">No route</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{documentCount(g.items.length)}</Td>
                    <Td className="text-xs">
                      {g.holders.length > 0 ? <Chip tone="info">{holdersText(g.holders, user.id)}</Chip> : <span className="text-muted">None claimed</span>}
                    </Td>
                  </>
                }
                documents={g.items.map((r) => (
                  <tr key={r.id} className="bg-surface-2/40">
                    <Td className="whitespace-nowrap text-xs tabular">
                      {waited(r.uploadedAt)}
                      {r.dueOn && <span className="block text-2xs text-muted">Wanted by {fmtDate(r.dueOn)}</span>}
                    </Td>
                    <Td className="pl-6">
                      {r.label}
                      {r.version > 0 && <span className="ml-2 text-xs text-muted">v{r.version}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{stageLabel(r.stage)}</Td>
                    <Td>{r.vendorCode ? routeChip(r.vendorCode, r.vendorColour) : <span className="text-xs text-muted">No route</span>}</Td>
                    <Td />
                    <Td className="text-xs">
                      {r.claimedById && claimHeld(r.claimedAt) ? (
                        <Chip tone="info">{r.claimedById === user.id ? `You, for ${CLAIM_MINUTES} min` : (r.claimedByName ?? "Claimed")}</Chip>
                      ) : (
                        <span className="text-muted">Unclaimed</span>
                      )}
                      {/* Somebody opened it and went home: whoever runs the desk
                          can move it rather than wait for the claim to lapse. */}
                      {canReassign && r.claimedById && r.claimedById !== user.id && (
                        <Reassign itemId={r.id} holder={r.claimedByName ?? null} officers={officers.filter((o) => o.id !== r.claimedById)} />
                      )}
                    </Td>
                    <Td>
                      <ItemActions
                        item={{
                          id: r.id,
                          studentId: r.studentId,
                          label: r.label,
                          state: r.state,
                          typeCode: r.typeCode,
                          source: r.source,
                          version: r.version,
                          validityMonths: r.validityMonths,
                          issuedOn: r.issuedOn,
                          guidance: r.guidance,
                          fileName: r.fileName,
                          documentId: r.documentId,
                          claimedById: r.claimedById,
                          claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
                        }}
                        reasons={reasons.map((x) => ({ code: x.code, label: x.label }))}
                        canProcess
                        userId={user.id}
                      />
                    </Td>
                  </tr>
                ))}
              />
            ))}
          </Table>
          {(paging.previous !== null || paging.next !== null) && (
            <div data-list-foot className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
              <span>
                Students {(page - 1) * QUEUE_PAGE + 1} to {(page - 1) * QUEUE_PAGE + students.length}, {QUEUE_PAGE} to a page
              </span>
              <span className="flex items-center gap-2">
                {paging.previous !== null && (
                  <LinkButton variant="secondary" size="sm" href={pageHref(paging.previous)} scroll={false}>
                    Previous
                  </LinkButton>
                )}
                {paging.next !== null && (
                  <LinkButton variant="secondary" size="sm" href={pageHref(paging.next)} scroll={false}>
                    Next {QUEUE_PAGE} students
                  </LinkButton>
                )}
              </span>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
