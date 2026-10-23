import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { fieldLabel, formatValue, restorable, SOURCE_LABEL, type CatalogueEntity } from "@/lib/catalogue-history";
import type { HistoryRow } from "@/server/catalogue-history";
import { Card, CardHeader } from "./ui";
import { RestoreButton } from "./restore-button";

/** The automatic writers, which are named for what they are when nobody in particular ran them. */
const SYNCS = new Set(["cricos", "registry", "mioc"]);

/**
 * What a program or a university said before each change, newest first, one
 * entry per save with its fields under it. The page hands in the rows and
 * whether the viewer may restore, so nothing here decides who sees what.
 */
export function ChangeHistory({
  entity,
  entityId,
  rows,
  more,
  moreHref,
  currency,
  docLabels,
  canRestore,
}: {
  entity: CatalogueEntity;
  entityId: string;
  rows: HistoryRow[];
  more: boolean;
  moreHref: string;
  currency: string;
  docLabels?: Record<string, string>;
  canRestore: boolean;
}) {
  // Rows of one save share a batch id and a moment, so they arrive together.
  const groups: HistoryRow[][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last[0].batchId === r.batchId) last.push(r);
    else groups.push([r]);
  }
  const show = (field: string, v: unknown) => formatValue(entity, field, v, { currency, docLabels });

  return (
    <Card data-change-history="">
      <CardHeader title="Change history" subtitle="Newest first. Restore puts back the value from before a change." />
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {groups.map((g) => {
            const head = g[0];
            const who = head.by ?? (SYNCS.has(head.source) ? SOURCE_LABEL[head.source] : "A former user");
            const canUndo = g.filter((r) => restorable(entity, r.field));
            return (
              <li key={`${head.batchId}-${head.id}`} className="px-4 py-2.5" data-change-batch={head.batchId}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{who}</p>
                    <p className="text-xs text-muted">
                      {fmtDateTime(head.createdAt)} · {SOURCE_LABEL[head.source] ?? head.source}
                    </p>
                  </div>
                  {canRestore && canUndo.length > 1 && <RestoreButton batchId={head.batchId} entity={entity} entityId={entityId} label="Restore all" title="Restore every field of this change" />}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.map((r) => {
                    const label = fieldLabel(entity, r.field);
                    return (
                      <li key={r.id} className="flex items-start justify-between gap-2" data-change-field={r.field}>
                        <p className="min-w-0 break-words text-xs">
                          <span className="font-medium text-ink">{label}</span>
                          {": "}
                          <span className="text-muted" data-before="">{show(r.field, r.before)}</span>
                          {" → "}
                          <span className="text-ink" data-after="">{show(r.field, r.after)}</span>
                        </p>
                        {canRestore && restorable(entity, r.field) && <RestoreButton changeId={r.id} entity={entity} entityId={entityId} title={`Restore ${label}`} />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {more && (
        <div className="border-t border-line px-4 py-3 text-sm">
          <Link href={moreHref} scroll={false} className="font-medium text-brand-600 hover:underline">
            Show more
          </Link>
        </div>
      )}
    </Card>
  );
}
