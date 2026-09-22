import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { Chip } from "@/components/ui";

export type BulletinRow = { id: string; title: string; body: string; countries: string[]; intakes: string | null; ctaLabel: string | null; ctaUrl: string | null; createdAt: Date; university: { id: string; name: string } | null };

/** Updates read as a list of expandable items; the one in the link opens by itself. */
export function BulletinList({ rows, openId, countryName }: { rows: BulletinRow[]; openId?: string; countryName: Map<string, string> }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((b) => (
        <li key={b.id}>
          <details open={b.id === openId} className="group px-4 py-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium group-open:text-brand-700">{b.title}</p>
                <span className="text-xs text-muted">{fmtDate(b.createdAt)}</span>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {b.countries.map((c) => <Chip key={c}>{countryName.get(c) ?? c}</Chip>)}
                {b.university && <span>{b.university.name}</span>}
                {b.intakes && <span>· {b.intakes}</span>}
              </p>
              <p className="mt-1 line-clamp-2 text-[13px] text-ink-soft group-open:hidden">{b.body}</p>
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink-soft">{b.body}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-[13px]">
              {b.university && <Link href={`/universities/${b.university.id}`} className="font-medium text-brand-600 hover:underline">University page</Link>}
              {b.ctaLabel && b.ctaUrl && (
                <a href={b.ctaUrl} {...(b.ctaUrl.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="rounded-md bg-brand-600 px-3 py-1 font-medium text-white hover:bg-brand-700">
                  {b.ctaLabel}
                </a>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
