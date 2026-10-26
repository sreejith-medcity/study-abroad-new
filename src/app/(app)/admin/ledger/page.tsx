import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { FORMULA, LEDGER_KIND_LABEL } from "@/lib/ledger";
import { feedViewer, mayReadLedger } from "@/server/history-feed";
import { dailyStamping, ledgerCounts, ledgerHeadRow, recentStamps } from "@/server/ledger";
import type { FeedViewer } from "@/server/record-history";
import { Alert, Button, Card, CardHeader, Chip, EmptyState, Input, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { stampLedgerAction, verifyLedgerAction } from "./actions";

export const metadata = { title: "Ownership ledger" };
export const dynamic = "force-dynamic";

/** Ledger entries about records this person may open. Entries about anything else are counted, never listed. */
function ledgerScope(viewer: FeedViewer): SQL {
  const L = schema.ownershipLedger;
  const st = schema.students;
  const en = schema.enquiries;
  return or(
    and(eq(L.entity, "student"), exists(db.select({ one: sql`1` }).from(st).where(and(eq(st.id, L.entityId), viewer.studentScope)))),
    and(eq(L.entity, "enquiry"), exists(db.select({ one: sql`1` }).from(en).where(and(eq(en.id, L.entityId), viewer.headOffice ? undefined : eq(en.orgId, viewer.orgId))))),
  )!;
}

/**
 * The ownership ledger: who has owned each student and enquiry over time,
 * every entry chained to the one before it by its hash. Verify recomputes
 * the whole chain and names the first entry that does not add up.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ q?: string; intact?: string; broken?: string; note?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  if (!mayReadLedger(user)) redirect("/forbidden");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80);
  const viewer = await feedViewer(user);
  const L = schema.ownershipLedger;
  const scope = ledgerScope(viewer);
  const search = q ? or(ilike(L.ownerName, `%${q}%`), ilike(L.prevOwnerName, `%${q}%`), ilike(L.hash, `${q}%`), /^\d{1,9}$/.test(q) ? eq(L.seq, Number(q)) : undefined) : undefined;

  const [entries, counts, [{ visible }], head, stamps] = await Promise.all([
    db.select().from(L).where(and(scope, search)).orderBy(desc(L.seq)).limit(100),
    ledgerCounts(),
    db.select({ visible: sql<number>`count(*)::int` }).from(L).where(scope),
    ledgerHeadRow(),
    recentStamps(8),
  ]);
  const studentIds = entries.filter((e) => e.entity === "student").map((e) => e.entityId);
  const enquiryIds = entries.filter((e) => e.entity === "enquiry").map((e) => e.entityId);
  const [students, enquiries] = await Promise.all([
    studentIds.length ? db.select({ id: schema.students.id, f: schema.students.firstName, l: schema.students.lastName, mc: schema.students.medcityId }).from(schema.students).where(inArray(schema.students.id, studentIds)) : [],
    enquiryIds.length ? db.select({ id: schema.enquiries.id, name: schema.enquiries.name }).from(schema.enquiries).where(inArray(schema.enquiries.id, enquiryIds)) : [],
  ]);
  const title = new Map<string, { text: string; href: string }>([
    ...students.map((s) => [s.id, { text: `${s.f} ${s.l}${s.mc ? ` (${s.mc})` : ""}`, href: `/students/${s.id}/history` }] as const),
    ...enquiries.map((e) => [e.id, { text: e.name, href: `/enquiries/${e.id}/history` }] as const),
  ]);
  const lastGood = stamps.find((s) => s.status === "SENT");
  const daily = dailyStamping();
  const hidden = counts.entries - visible;

  return (
    <>
      <PageHeader
        title="Ownership ledger"
        subtitle="Who has owned each student and enquiry, append-only. Every entry carries the hash of the one before it, so an edited, removed or reordered entry breaks the chain from that point on."
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={verifyLedgerAction}>
              <Button type="submit">Verify chain</Button>
            </form>
            {isAdmin(user) && (
              <form action={stampLedgerAction}>
                <Button type="submit" variant="secondary">
                  Stamp now
                </Button>
              </form>
            )}
          </div>
        }
      />
      {sp.intact && (
        <div className="mb-4" data-verify="intact">
          <Alert tone="ok" title="Intact">
            {sp.intact}
          </Alert>
        </div>
      )}
      {sp.broken && (
        <div className="mb-4" data-verify="broken">
          <Alert tone="bad" title="The chain does not add up">
            {sp.broken} An entry has been changed or removed outside the portal. The entries before it are still sound; tell whoever runs the database.
          </Alert>
        </div>
      )}
      {sp.note && (
        <div className="mb-4">
          <Alert tone="info">{sp.note}</Alert>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Entries" value={head?.seq ?? 0} />
        <Stat label="Records on the ledger" value={counts.records} />
        <Stat label="Owner and branch changes" value={counts.moves} />
        <Stat label="Last public stamp" value={lastGood ? fmtDateTime(lastGood.createdAt) : "Not stamped"} tone={lastGood ? "good" : "warn"} />
      </div>
      {!daily && (
        <p className="mb-4 text-sm text-muted" data-daily-stamp="off">
          Daily stamping is off. The ledger and Verify chain work the same without it.{isAdmin(user) ? " Stamp now sends the head to the public calendars whenever you choose." : ""} It is switched on with
          LEDGER_STAMP=on in the server&apos;s settings.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Entries"
            subtitle={hidden > 0 ? `Newest first. ${hidden} entr${hidden === 1 ? "y is" : "ies are"} about records you cannot open, or that no longer exist, and are not listed; Verify still checks them.` : "Newest first"}
            action={
              <form className="flex gap-2">
                <Input name="q" defaultValue={q} placeholder="Person, entry number or hash" aria-label="Find an entry" className="w-56 py-1.5 text-sm" />
                <Button type="submit" variant="secondary" size="sm">
                  Find
                </Button>
              </form>
            }
          />
          {entries.length === 0 ? (
            <EmptyState title={q ? "No entry matches" : "Nothing on the ledger yet"}>
              {q ? "Try a name, an entry number or the start of a hash." : "The first time a student or an enquiry is created, reassigned or moved, it is written here."}
            </EmptyState>
          ) : (
            <Table tableClassName="min-w-[860px]">
              <thead>
                <tr>
                  <Th className="w-14">#</Th>
                  <Th>What</Th>
                  <Th>Record</Th>
                  <Th>Owner</Th>
                  <Th>By</Th>
                  <Th>When</Th>
                  <Th>Hash</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const t = title.get(e.entityId);
                  return (
                    <tr key={e.id} data-ledger-row={e.seq}>
                      <Td className="text-muted tabular">{e.seq}</Td>
                      <Td>
                        <Chip tone={e.kind === "ASSIGNED" || e.kind === "BRANCH_MOVE" ? "brand" : e.kind === "REMOVED" ? "bad" : "neutral"}>{LEDGER_KIND_LABEL[e.kind] ?? e.kind}</Chip>
                        {e.detail && <p className="mt-1 text-xs text-muted">{e.detail}</p>}
                      </Td>
                      <Td>
                        <p className="text-xs uppercase tracking-wide text-muted">{e.entity === "student" ? "Student" : "Enquiry"}</p>
                        {t ? (
                          <Link href={t.href} className="font-medium text-brand-600 hover:underline">
                            {t.text}
                          </Link>
                        ) : (
                          <span className="text-muted">No longer on file</span>
                        )}
                      </Td>
                      <Td>
                        {e.ownerId ? (e.ownerName ?? "Not recorded") : "Nobody"}
                        {(e.kind === "ASSIGNED" || e.kind === "BRANCH_MOVE") && <p className="text-xs text-muted">from {e.prevOwnerId ? (e.prevOwnerName ?? "Not recorded") : "nobody"}</p>}
                        {e.orgName && <p className="text-xs text-muted">{e.orgName}</p>}
                      </Td>
                      <Td>{e.actorName ?? "The portal"}</Td>
                      <Td className="whitespace-nowrap text-muted tabular">{fmtDateTime(e.createdAt)}</Td>
                      <Td className="font-mono text-2xs" title={e.hash}>
                        {e.hash.slice(0, 12)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Public stamps" subtitle="OpenTimestamps, free and with no account" />
            {stamps.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">{daily ? "Not stamped yet. A stamp is made in the background once a day after the ledger moves." : "Not stamped yet. Daily stamping is off, so a stamp is made only when an admin presses Stamp now."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {stamps.map((s) => (
                  <li key={s.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Chip tone={s.status === "SENT" ? "ok" : "warn"}>{s.status === "SENT" ? "Stamped" : "Not stamped"}</Chip>
                      <span className="text-muted">{fmtDateTime(s.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Entries 1 to {s.uptoSeq} · head <span className="font-mono">{s.headHash.slice(0, 12)}</span>
                    </p>
                    {s.status === "SENT" ? (
                      <p className="mt-1 flex gap-3 text-xs">
                        <a className="font-medium text-brand-600 hover:underline" href={`/api/ledger/stamp/${s.id}?file=txt`}>
                          Checkpoint file
                        </a>
                        <a className="font-medium text-brand-600 hover:underline" href={`/api/ledger/stamp/${s.id}?file=ots`}>
                          Proof (.ots)
                        </a>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted">{s.error ?? "No calendar could be reached."}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-sm text-muted">
            <p className="font-medium text-ink">How to check it</p>
            <ol className="mt-1 list-decimal space-y-1.5 pl-4">
              <li>
                <b>Verify chain</b> recomputes every entry&apos;s hash from its own fields and the hash before it, and checks the last one against the recorded head. Any edited, removed or reordered
                entry is reported by number.
              </li>
              <li>The database refuses to change or delete an entry. Somebody who switches that off still cannot make the hashes add up again without rewriting every entry after the one they changed.</li>
              <li>
                Each hash is the sha256 of the JSON list [&quot;{FORMULA}&quot;, number, kind, record type, record id, branch id, branch, owner id, owner, previous branch id, previous branch,
                previous owner id, previous owner, detail, by id, by, time in ISO 8601, previous hash], with anything missing as null.
              </li>
              <li>
                {daily ? "Once a day" : "When daily stamping is on (it is off here), once a day"} the head hash is stamped on the public OpenTimestamps calendars, when they can be reached. Without a
                network the ledger reads &quot;Not stamped&quot; and works the same.
              </li>
              <li>Entries name staff and branches, never a student or an enquirer.</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
