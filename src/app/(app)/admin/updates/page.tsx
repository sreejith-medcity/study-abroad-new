import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { BULLETIN_LABEL } from "@/lib/bulletins";
import { fmtDate } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { setBulletinPublishedAction } from "@/server/bulletins";
import { BulletinForm } from "@/components/bulletin-form";
import { Button, Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Updates" };

export default async function AdminUpdatesPage() {
  await requireUser([...ADMIN_ROLES]);
  const rows = await db.query.bulletins.findMany({ with: { university: { columns: { name: true } } }, orderBy: desc(schema.bulletins.createdAt), limit: 100 });
  const countries = await db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  return (
    <>
      <PageHeader title="Updates and announcements" subtitle="Institution and embassy updates, announcements with an action, and What's New in the portal. Partners are notified of the first two." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader title="Published" subtitle="Newest first" />
          {rows.length === 0 ? (
            <EmptyState title="Nothing yet">Publish the first one on the right.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div>
                    <p className="font-medium">{b.title}</p>
                    <p className="text-xs text-muted">{BULLETIN_LABEL[b.kind]} · {fmtDate(b.createdAt)}{b.countries.length ? ` · ${b.countries.join(", ")}` : ""}{b.university ? ` · ${b.university.name}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {b.published ? <Chip tone="ok">Live</Chip> : <Chip>Withdrawn</Chip>}
                    <form action={setBulletinPublishedAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <input type="hidden" name="published" value={b.published ? "false" : "true"} />
                      <Button type="submit" variant="quiet" size="sm">{b.published ? "Withdraw" : "Republish"}</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">New</h2>
          <BulletinForm countries={countries} />
        </Card>
      </div>
    </>
  );
}
