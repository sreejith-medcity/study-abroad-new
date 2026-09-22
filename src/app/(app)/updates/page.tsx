import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { publishedBulletins } from "@/server/bulletin-queries";
import { BulletinList } from "@/components/bulletin-list";
import { Card, EmptyState, PageHeader, cn } from "@/components/ui";

export const metadata = { title: "Updates" };

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; country?: string; id?: string }> }) {
  await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const announcements = sp.tab === "announcements";
  const countries = await db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  const names = new Map(countries.map((c) => [c.code, c.name]));
  const rows = await publishedBulletins(announcements ? "ANNOUNCEMENT" : "UPDATE", { country: announcements ? undefined : sp.country, limit: 100 });
  const pill = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:border-brand-300")}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Updates" subtitle="What changed at institutions and embassies, and announcements from the Overseas team." />
      <div className="mb-4 flex flex-wrap gap-2">
        {pill("/updates", "Important updates", !announcements)}
        {pill("/updates?tab=announcements", "Announcements", announcements)}
      </div>
      {!announcements && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {pill("/updates", "All countries", !sp.country)}
          {["GB", "AU", "CA", "US", "IE", "DE"].map((c) => pill(`/updates?country=${c}`, names.get(c) ?? c, sp.country === c))}
          {pill("/updates?country=OTHER", "Other", sp.country === "OTHER")}
        </div>
      )}
      <Card>
        {rows.length ? <BulletinList rows={rows} openId={sp.id} countryName={names} /> : <EmptyState title="Nothing here yet">New {announcements ? "announcements" : "updates"} show up here, and you are notified.</EmptyState>}
      </Card>
    </>
  );
}
