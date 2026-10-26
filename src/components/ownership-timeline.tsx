import Link from "next/link";
import { LEDGER_KIND_LABEL } from "@/lib/ledger";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Chip } from "./ui";

type Entry = {
  id: string;
  seq: number;
  kind: string;
  ownerName: string | null;
  ownerId: string | null;
  orgName: string | null;
  prevOwnerName: string | null;
  prevOwnerId: string | null;
  prevOrgName: string | null;
  detail: string | null;
  actorName: string | null;
  createdAt: Date;
  hash: string;
};

const nobody = (id: string | null, name: string | null) => (id ? (name ?? "Not recorded") : "Nobody");

/**
 * Who has owned one student or enquiry, oldest first, as the ownership ledger
 * holds it. Each line carries its entry number and the start of its hash, so
 * a line can be found on the ledger and checked.
 */
export function OwnershipTimeline({ entries, owner, admin }: { entries: Entry[]; owner: string; admin?: boolean }) {
  return (
    <Card data-ownership>
      <CardHeader title="Ownership record" subtitle="From the tamper-evident ownership ledger" action={admin ? <Link href="/admin/ledger" className="text-sm font-medium text-brand-600 hover:underline">Verify the ledger</Link> : undefined} />
      {entries.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">
          Nothing on the ledger yet: ownership has not changed since the ledger started. Held now by {owner}.
        </p>
      ) : (
        <ol className="relative px-4 py-3">
          {entries.map((e) => (
            <li key={e.id} className="relative border-l border-line pb-3 pl-4 last:pb-0" data-ledger-seq={e.seq}>
              <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-brand-600 ring-4 ring-surface" />
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{LEDGER_KIND_LABEL[e.kind] ?? e.kind}</span>
                {e.kind === "BRANCH_MOVE" && e.orgName && <Chip tone="info">{e.orgName}</Chip>}
                <span className="ml-auto text-xs text-muted">{fmtDateTime(e.createdAt)}</span>
              </div>
              <p className="text-sm text-ink-soft">
                {e.kind === "ASSIGNED" || e.kind === "BRANCH_MOVE"
                  ? `${nobody(e.prevOwnerId, e.prevOwnerName)} to ${nobody(e.ownerId, e.ownerName)}`
                  : `Held by ${nobody(e.ownerId, e.ownerName)}${e.orgName ? `, ${e.orgName}` : ""}`}
                {e.detail ? `. ${e.detail}` : ""}
              </p>
              <p className="text-2xs text-muted">
                Entry {e.seq} · by {e.actorName ?? "the portal"} · <span className="font-mono">{e.hash.slice(0, 12)}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
