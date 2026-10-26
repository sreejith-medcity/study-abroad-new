import Link from "next/link";
import { compareVersions, fieldLabel, restoreRule, showValue, type HistoryEntity, type NameBook } from "@/lib/record-history";
import { fmtDateTime } from "@/lib/format";
import { restoreFieldAction } from "@/server/history-actions";
import type { VersionRow } from "@/server/record-history";
import { Alert, Button, Card, CardHeader, Chip, Select, Table, Td, Th } from "./ui";

/** What each kind of save is called on the history, for the line above its changes. */
const ACTION_LABEL: Record<string, string> = {
  "student.profile": "Profile saved",
  "student.background": "Background answers saved",
  "student.passport": "Passport details saved from a document",
  "student.reassign": "Reassigned",
  "student.stage": "Stage moved",
  "student.team": "Team changed",
  "student.lock": "Profile locked",
  "student.unlock": "Profile unlocked",
  "student.archive": "Archived",
  "student.unarchive": "Brought back from the archive",
  "student.referral": "Referral carried from the enquiry",
  "student.medcity_id": "Medcity ID given",
  "student.pathway_from_application": "Journey set from the first application",
  "student.bulk_upload": "Filled in from a bulk upload",
  "crm.student.update": "Updated from Medcity's CRM",
  "enquiry.update": "Details saved",
  "enquiry.follow_up": "Follow up logged",
  "enquiry.stage": "Stage set",
  "enquiry.lost": "Closed as lost",
  "enquiry.assign": "Taken by",
  "enquiry.convert": "Registered as a student",
  "enquiry.bulk_upload": "Filled in from a bulk upload",
  "referral.assign": "Given to a branch",
  "application.status": "Status changed",
  "application.officer": "Officer assigned",
  "application.handover": "Handed to the desk",
  "application.returned": "Returned to the branch",
  "application.route_chosen": "Route chosen",
  "application.route_changed": "Route changed",
  "application.submitted": "Lodged with the vendor",
  "application.vendor_reference": "Vendor reference saved",
  "application.priority": "Priority set",
  "application.fee_paid": "Fee marked paid",
  "application.fee_paid_online": "Fee paid online",
  "application.offer_visa": "Offer and visa saved",
  "application.bulk_upload": "Updated from a bulk upload",
  "history.restore": "Restored from the history",
};

export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

/**
 * One record's history: every saved version, newest first, field by field
 * with who and when; a compare of any two versions; and Restore beside each
 * field the history may put back, or the reason it may not.
 */
export function RecordHistory({
  entity,
  versions,
  names,
  canRestore,
  fullPassport,
  back,
  a,
  b,
  done,
  why,
  started,
}: {
  entity: HistoryEntity;
  versions: VersionRow[];
  names: NameBook;
  /** Whether this person could change the record, or which fields of it; each field then has its own rule too. */
  canRestore: boolean | ((field: string) => boolean);
  fullPassport: boolean;
  /** This page's own address, for the restore to come back to. */
  back: string;
  a?: string;
  b?: string;
  done?: string;
  why?: string;
  /** When and by whom the record was created, where that is known, as the line under the oldest version. */
  started?: { at: Date; by: string | null };
}) {
  const latest = versions.at(-1);
  const show = (field: string, value: unknown) => showValue(entity, field, value, names, { fullPassport });
  const pick = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= versions.length ? n : fallback;
  };
  const left = pick(a, Math.max(0, versions.length - 1));
  const right = pick(b, versions.length);
  const diffs = compareVersions(entity, versions, left, right);

  return (
    <div className="space-y-4">
      {done && <Alert tone="ok">{done}</Alert>}
      {why && <Alert tone="warn">{why}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader
            title="Versions"
            subtitle={latest ? `${versions.length} saved change${versions.length === 1 ? "" : "s"} · last ${fmtDateTime(latest.createdAt)} by ${latest.by ?? "the portal"}` : "No changes recorded yet"}
          />
          {versions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted" data-history-empty>
              Nothing has been changed since history began. The first change anybody saves will appear here, with who made it and when.
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {[...versions].reverse().map((v) => (
                <li key={v.id} id={`v${v.n}`} className="px-4 py-3" data-version={v.n}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">Version {v.n}</span>
                    <Chip tone={v.action === "history.restore" ? "info" : "neutral"}>{actionLabel(v.action)}</Chip>
                    {latest && v.id === latest.id && <Chip tone="brand">Current</Chip>}
                    {/* A link rather than the form, so it works for somebody reading the file without changing it. */}
                    <Link href={`${back}?a=${v.n - 1}&b=${v.n}#compare`} className="text-xs font-medium text-brand-600 hover:underline">
                      Compare with version {v.n - 1}
                    </Link>
                    <span className="ml-auto text-xs text-muted">
                      {fmtDateTime(v.createdAt)} · {v.by ?? (v.byId ? "Not recorded" : "The portal")}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {v.changes.map((c) => {
                      const rule = restoreRule(entity, c.field);
                      return (
                        <li key={c.field} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-field={c.field}>
                          <span className="text-muted">{fieldLabel(entity, c.field)}:</span>
                          <span className="line-through decoration-stop-500/50">{show(c.field, c.before)}</span>
                          <span aria-hidden="true" className="text-muted">to</span>
                          <span className="font-medium">{show(c.field, c.after)}</span>
                          {rule.ok && (typeof canRestore === "function" ? canRestore(c.field) : canRestore) ? (
                            <form action={restoreFieldAction} className="ml-auto">
                              <input type="hidden" name="versionId" value={v.id} />
                              <input type="hidden" name="field" value={c.field} />
                              <input type="hidden" name="back" value={back} />
                              <Button type="submit" variant="quiet" size="sm" className="py-0.5 text-xs" title={`Put ${fieldLabel(entity, c.field)} back to ${show(c.field, c.before)}`}>
                                Restore
                              </Button>
                            </form>
                          ) : !rule.ok ? (
                            <span className="ml-auto max-w-xs text-right text-2xs text-muted" data-no-restore>
                              Not restored from here. {rule.reason}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
              <li className="px-4 py-3 text-sm text-muted" data-version="0">
                <span className="font-semibold text-ink">Version 0</span> · as it stood before the first change kept here
                {started ? `. Created ${fmtDateTime(started.at)}${started.by ? ` by ${started.by}` : ""}.` : "."}
              </li>
            </ol>
          )}
        </Card>

        <div className="space-y-4">
          <Card id="compare">
            <CardHeader title="Compare two versions" subtitle="Only the fields that differ are listed" />
            {versions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">There is nothing to compare yet.</p>
            ) : (
              <>
                <form className="flex flex-wrap items-center gap-2 px-4 pt-3" data-compare>
                  <Select name="a" defaultValue={String(left)} aria-label="First version" className="w-auto py-1.5 text-sm">
                    {[0, ...versions.map((v) => v.n)].map((n) => (
                      <option key={n} value={n}>
                        Version {n}
                      </option>
                    ))}
                  </Select>
                  <span className="text-sm text-muted">with</span>
                  <Select name="b" defaultValue={String(right)} aria-label="Second version" className="w-auto py-1.5 text-sm">
                    {[0, ...versions.map((v) => v.n)].map((n) => (
                      <option key={n} value={n}>
                        Version {n}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" variant="secondary" size="sm">
                    Compare
                  </Button>
                </form>
                <div className="p-4" data-compare-result>
                  {diffs.length === 0 ? (
                    <p className="text-sm text-muted">Version {left} and version {right} are the same in every field kept here.</p>
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Field</Th>
                          <Th>Version {left}</Th>
                          <Th>Version {right}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.map((d) => (
                          <tr key={d.field}>
                            <Td className="text-muted">{fieldLabel(entity, d.field)}</Td>
                            <Td>{show(d.field, d.a)}</Td>
                            <Td className="font-medium">{show(d.field, d.b)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </Card>
          <Card className="p-4 text-sm text-muted">
            <p className="font-medium text-ink">How the history works</p>
            <p className="mt-1">
              Every save through the portal keeps what each field was before and after, with who made the change and when. Versions cannot be edited. Restore puts one field back while it still holds
              what that change gave it; who carries the file, its branch, its stage or status, the route and anything to do with money are changed on their own screens, which tell the people
              involved.
            </p>
            <p className="mt-2">
              <Link href="/admin/history" className="font-medium text-brand-600 hover:underline">
                Every change you may read, across the portal
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
