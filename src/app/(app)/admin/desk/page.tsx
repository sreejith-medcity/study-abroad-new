import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, intakeLabel } from "@/lib/format";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { deskCounts, deskQueue, vendorTurnaroundReport } from "@/server/desk";
import { DESK_STAGE_LABEL, OUTCOME_LABEL, turnaroundText } from "@/lib/desk";
import { Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import type { DeskStage } from "@/db/schema";

export const metadata = { title: "The Overseas desk" };
export const dynamic = "force-dynamic";

const STAGES: DeskStage[] = ["READY", "CHOSEN", "SUBMITTED", "RETURNED"];

/** How long a file has been sitting at this step, in words somebody would use. */
function waited(since: Date | null) {
  if (!since) return "Not recorded";
  const hours = Math.max(0, Math.floor((Date.now() - since.getTime()) / 3_600_000));
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ stage?: string; branch?: string; vendor?: string; pathway?: string; quiet?: string }> }) {
  await requireUser([...PROCESSING_ROLES]);
  const sp = await searchParams;
  const stage = STAGES.includes(sp.stage as DeskStage) ? (sp.stage as DeskStage) : undefined;
  const [rows, counts, branches, vendors, turnaround] = await Promise.all([
    deskQueue({ stage, branch: sp.branch, vendor: sp.vendor, pathway: sp.pathway, quiet: sp.quiet }),
    deskCounts(),
    db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).orderBy(asc(schema.organizations.name)),
    db.select({ id: schema.vendors.id, code: schema.vendors.code, name: schema.vendors.name }).from(schema.vendors).where(eq(schema.vendors.active, true)).orderBy(asc(schema.vendors.name)),
    vendorTurnaroundReport(),
  ]);

  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { stage: sp.stage, branch: sp.branch, vendor: sp.vendor, pathway: sp.pathway, quiet: sp.quiet, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return `/admin/desk${q ? `?${q}` : ""}`;
  };
  const pill = (on: boolean) => (on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink");
  const quiet = rows.filter((r) => r.quiet).length;

  return (
    <>
      <PageHeader
        title="The Overseas desk"
        subtitle="Files the branches have handed over. Choose the road, lodge it in the vendor's portal, then record whatever they tell you. Oldest first, because that is the one a branch is asking about."
      />

      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ stage: undefined })} className={pill(!stage)}>Everything with the desk ({counts.READY + counts.CHOSEN + counts.SUBMITTED + counts.RETURNED})</Link>
          {STAGES.map((s) => (
            <Link key={s} href={href({ stage: s })} className={pill(stage === s)}>
              {DESK_STAGE_LABEL[s]} ({counts[s]})
            </Link>
          ))}
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
          <Link href={href({ quiet: sp.quiet === "1" ? undefined : "1" })} className={pill(sp.quiet === "1")}>
            Vendor gone quiet ({quiet})
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={href({ branch: undefined })} className={pill(!sp.branch)}>Every branch</Link>
          {branches.map((b) => (
            <Link key={b.id} href={href({ branch: b.id })} className={pill(sp.branch === b.id)}>{b.name}</Link>
          ))}
        </div>
        {vendors.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={href({ vendor: undefined })} className={pill(!sp.vendor)}>Every vendor</Link>
            {vendors.map((v) => (
              <Link key={v.id} href={href({ vendor: v.id })} className={pill(sp.vendor === v.id)} title={v.name}>{v.code}</Link>
            ))}
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nothing with the desk">
          When a branch has the documents in, they hand the file over and it appears here.
        </EmptyState>
      ) : (
        <Card className="mb-4">
          <Table>
            <thead>
              <tr>
                <Th>Waiting</Th>
                <Th>Student and branch</Th>
                <Th>Course</Th>
                <Th>Where it is</Th>
                <Th>Route</Th>
                <Th>Last we heard</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.quiet ? "bg-amber-50/60" : undefined}>
                  <Td className="whitespace-nowrap text-xs tabular">
                    {waited(r.deskStage === "SUBMITTED" ? (r.lastUpdateAt ?? r.submittedToVendorAt) : r.handedOverAt)}
                    {r.quiet && <span className="block text-[11px] font-medium text-amber-700">Quiet {r.quietDays} days</span>}
                  </Td>
                  <Td>
                    <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="font-medium text-brand-600 hover:underline">{r.studentName}</Link>
                    <span className="block text-xs text-muted">{r.branch} · {r.ackNo}</span>
                  </Td>
                  <Td>
                    {r.course}
                    <span className="block text-xs text-muted">{r.university} · {intakeLabel(r.intakeMonth, r.intakeYear)}</span>
                  </Td>
                  <Td>
                    <Chip tone={r.deskStage === "RETURNED" ? "bad" : r.deskStage === "SUBMITTED" ? "ok" : r.deskStage === "READY" ? "warn" : "info"}>{DESK_STAGE_LABEL[r.deskStage]}</Chip>
                    <span className="block text-xs text-muted">{r.statusLabel}</span>
                    {r.handoverNote && <span className="mt-0.5 block max-w-xs text-xs text-muted">{r.handoverNote}</span>}
                  </Td>
                  <Td>
                    {r.vendorCode ? (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: r.vendorColour ?? "#475569" }}>{r.vendorCode}</span>
                    ) : (
                      <span className="text-xs text-muted">Not chosen</span>
                    )}
                    {r.vendorReference && <span className="block text-xs text-muted">{r.vendorReference}</span>}
                  </Td>
                  <Td className="text-xs">
                    {r.lastOutcome ? (
                      <>
                        {OUTCOME_LABEL[r.lastOutcome]}
                        {r.lastUpdateAt && <span className="block text-muted">{fmtDate(r.lastUpdateAt)}</span>}
                      </>
                    ) : r.submittedToVendorAt ? (
                      <span className="text-muted">Nothing since it was lodged</span>
                    ) : (
                      <span className="text-muted">Not lodged yet</span>
                    )}
                  </Td>
                  <Td>
                    <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="text-[13px] font-medium text-brand-600 hover:underline">Work it</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader
          title="What each vendor actually takes"
          subtitle="From their own dates: the day it was lodged to the day they answered. Only applications that have been answered count, so nothing here is a guess."
        />
        {turnaround.length === 0 ? (
          <p className="p-4 text-muted">Nothing has been lodged and answered yet, so there is nothing to measure.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Answered</Th>
                <Th>Usually takes</Th>
                <Th>Slowest</Th>
                <Th>Against what they quote</Th>
              </tr>
            </thead>
            <tbody>
              {turnaround.map((t) => (
                <tr key={t.code}>
                  <Td>
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: t.colour }}>{t.code}</span>
                    <span className="ml-2">{t.vendor}</span>
                  </Td>
                  <Td className="tabular">{t.count}</Td>
                  <Td className="tabular">{t.median} day{t.median === 1 ? "" : "s"}</Td>
                  <Td className="tabular">{t.slowest} day{t.slowest === 1 ? "" : "s"}</Td>
                  <Td className="text-xs">{turnaroundText(t.median, t.promised)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
