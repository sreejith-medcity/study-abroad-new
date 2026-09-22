import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDate } from "@/lib/format";
import { publishedBulletins } from "@/server/bulletin-queries";
import { Card, CardHeader, cn } from "@/components/ui";

const TABS = [["", "All"], ["GB", "UK"], ["AU", "AUS"], ["CA", "CAN"], ["US", "US"], ["OTHER", "Other"]] as const;

/** Institution and embassy updates, a country at a time. */
export async function UpdatesCard({ country }: { country?: string }) {
  const rows = await publishedBulletins("UPDATE", { country: country || undefined, limit: 5 });
  return (
    <Card>
      <CardHeader title="Important updates" action={<Link href="/updates" className="text-[13px] font-medium text-brand-600 hover:underline">View all</Link>} />
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 pb-3">
        {TABS.map(([code, label]) => (
          <Link key={label} href={code ? `/dashboard?uc=${code}` : "/dashboard"} scroll={false} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", (country ?? "") === code ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft")}>{label}</Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">No updates here yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((b) => (
            <li key={b.id}>
              <Link href={`/updates?id=${b.id}${country && country !== "OTHER" ? `&country=${country}` : ""}`} className="block px-4 py-2.5 hover:bg-surface-2/60">
                <p className="text-[13px] font-medium">{b.title}</p>
                <p className="line-clamp-1 text-xs text-muted">{b.university ? `${b.university.name} · ` : ""}{b.intakes ? `${b.intakes} · ` : ""}{fmtDate(b.createdAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The newest announcement from the last two weeks, across the top of the dashboard. */
export async function AnnouncementBanner() {
  const b = schema.bulletins;
  const [row] = await db
    .select()
    .from(b)
    .where(and(eq(b.kind, "ANNOUNCEMENT"), eq(b.published, true), gte(b.createdAt, sql`now() - interval '14 days'`)))
    .orderBy(desc(b.createdAt))
    .limit(1);
  if (!row) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">Announcement</p>
        <p className="font-medium">{row.title}</p>
        <p className="line-clamp-1 text-[13px] text-ink-soft">{row.body}</p>
      </div>
      <div className="flex gap-2">
        {row.ctaLabel && row.ctaUrl && (
          <a href={row.ctaUrl} {...(row.ctaUrl.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="rounded-md bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-700">{row.ctaLabel}</a>
        )}
        <Link href={`/updates?tab=announcements&id=${row.id}`} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium">Read</Link>
      </div>
    </div>
  );
}
