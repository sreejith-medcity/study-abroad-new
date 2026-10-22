"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Look at the dashboard another job opens on.
 *
 * For the super admin and the ops manager, who answer for every desk and
 * want to see what each of them sees. Picking a counsellor's dashboard asks
 * whose, because a counsellor's board is one person's students. The address
 * carries the choice, so a view can be bookmarked or sent on.
 */
export function ViewAs({
  kinds,
  kind,
  own,
  people,
  person,
}: {
  kinds: { key: string; label: string }[];
  kind: string;
  own: string;
  /** Only when looking at a counsellor's dashboard. */
  people: { id: string; name: string; branch: string }[] | null;
  person: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    router.push(s ? `${path}?${s}` : path, { scroll: false });
  };
  const select = "h-8 max-w-[14rem] rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink";
  return (
    <div className="flex flex-wrap items-center gap-2" data-view-as>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        View as
        <select aria-label="View as" value={kind} onChange={(e) => go({ as: e.target.value === own ? null : e.target.value, who: null })} className={select}>
          {kinds.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
              {k.key === own ? " (yours)" : ""}
            </option>
          ))}
        </select>
      </label>
      {people && (
        <select aria-label="Counsellor" value={person ?? ""} onChange={(e) => go({ who: e.target.value || null })} className={select}>
          <option value="">Every counsellor</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.branch}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
