import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { activeRejectionReasons, documentationQueue, queueCounts } from "@/server/documentation";
import { claimHeld, CLAIM_MINUTES, STAGES, stageLabel } from "@/lib/journey";
import { Card, Chip, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { ItemActions } from "../students/[id]/documentation/client";
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

export default async function DocumentationQueuePage({ searchParams }: { searchParams: Promise<{ branch?: string; stage?: string; vendor?: string; sort?: string; mine?: string }> }) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const sp = await searchParams;
  const sort = sp.sort === "VISA_FIRST" ? "VISA_FIRST" : "OLDEST";
  const [rows, counts, reasons, branches, vendors] = await Promise.all([
    documentationQueue({ branch: sp.branch, stage: sp.stage as JourneyStage | undefined, vendor: sp.vendor, sort, mine: sp.mine }, user.id),
    queueCounts(user.id),
    activeRejectionReasons(),
    db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).orderBy(asc(schema.organizations.name)),
    db.select({ id: schema.vendors.id, name: schema.vendors.name, code: schema.vendors.code, colour: schema.vendors.colour }).from(schema.vendors).where(eq(schema.vendors.active, true)).orderBy(asc(schema.vendors.name)),
  ]);

  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { branch: sp.branch, stage: sp.stage, vendor: sp.vendor, sort: sp.sort, mine: sp.mine, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return `/documentation${q ? `?${q}` : ""}`;
  };
  const pill = (on: boolean) => (on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink");

  return (
    <>
      <PageHeader
        title="Documentation queue"
        subtitle={`${counts.waiting} waiting · ${counts.mine} claimed by you. Oldest first, and a document is claimed while somebody checks it so two people never check the same one.`}
      />
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ mine: undefined })} className={pill(!sp.mine)}>Everything</Link>
          <Link href={href({ mine: "1" })} className={pill(sp.mine === "1")}>Mine</Link>
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
          <Link href={href({ sort: undefined })} className={pill(sort === "OLDEST")}>Oldest first</Link>
          <Link href={href({ sort: "VISA_FIRST" })} className={pill(sort === "VISA_FIRST")}>Visa stage first</Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={href({ stage: undefined })} className={pill(!sp.stage)}>Every stage</Link>
          {STAGES.map((s) => (
            <Link key={s.value} href={href({ stage: s.value })} className={pill(sp.stage === s.value)}>{s.number}. {s.label}</Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={href({ branch: undefined })} className={pill(!sp.branch)}>Every branch</Link>
          {branches.map((b) => (
            <Link key={b.id} href={href({ branch: b.id })} className={pill(sp.branch === b.id)}>{b.name}</Link>
          ))}
        </div>
        {vendors.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={href({ vendor: undefined })} className={pill(!sp.vendor)}>Every route</Link>
            {vendors.map((v) => (
              <Link key={v.id} href={href({ vendor: v.id })} className={pill(sp.vendor === v.id)}>{v.code}</Link>
            ))}
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nothing to check">Every document that has been sent in has been decided. New uploads land here.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Waiting</Th>
                <Th>Student and branch</Th>
                <Th>Document</Th>
                <Th>Stage</Th>
                <Th>Route</Th>
                <Th>With</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs tabular">
                    {waited(r.uploadedAt)}
                    {r.dueOn && <span className="block text-[11px] text-muted">Wanted by {fmtDate(r.dueOn)}</span>}
                  </Td>
                  <Td>
                    <Link href={`/students/${r.studentId}/documentation`} className="font-medium text-brand-600 hover:underline">{r.studentName}</Link>
                    <span className="block text-xs text-muted">{r.branch}</span>
                  </Td>
                  <Td>{r.label}{r.version > 0 && <span className="ml-2 text-xs text-muted">v{r.version}</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{stageLabel(r.stage)}</Td>
                  <Td>
                    {r.vendorCode ? (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: r.vendorColour ?? "#475569" }}>{r.vendorCode}</span>
                    ) : (
                      <span className="text-xs text-muted">No route</span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {r.claimedById && claimHeld(r.claimedAt) ? (
                      <Chip tone="info">{r.claimedById === user.id ? `You, for ${CLAIM_MINUTES} min` : (r.claimedByName ?? "Claimed")}</Chip>
                    ) : (
                      <span className="text-muted">Unclaimed</span>
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
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
