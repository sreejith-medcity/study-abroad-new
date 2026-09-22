import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { setPromotionPublishedAction } from "@/server/directory";
import { PromotionForm } from "@/components/directory-forms";
import { Button, Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";
import { promotionState, rangeText } from "@/lib/promotions";

export const metadata = { title: "Promotional schemes" };

export default async function AdminPromotionsPage() {
  await requireUser([...ADMIN_ROLES]);
  const rows = await db.select().from(schema.promotions).orderBy(desc(schema.promotions.endsOn)).limit(100);
  const countries = await db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  return (
    <>
      <PageHeader title="Promotional schemes" subtitle="Incentives for partners, with the dates they run and their terms. Partners are told when one is published." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader title="Schemes" subtitle="Latest end date first" />
          {rows.length === 0 ? (
            <EmptyState title="No schemes yet">Publish the first on the right.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((p) => {
                const st = promotionState(p.startsOn, p.endsOn);
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <div>
                      <p className="font-medium text-ink">{p.title}</p>
                      <p className="text-muted">{rangeText(p.startsOn, p.endsOn)}{p.countries.length ? ` · ${p.countries.join(", ")}` : " · All destinations"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!p.published ? <Chip>Withdrawn</Chip> : st === "running" ? <Chip tone="ok">Running</Chip> : st === "upcoming" ? <Chip tone="info">Upcoming</Chip> : <Chip>Ended</Chip>}
                      <form action={setPromotionPublishedAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="published" value={p.published ? "false" : "true"} />
                        <Button size="sm" variant="quiet">{p.published ? "Withdraw" : "Republish"}</Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">New scheme</h2>
          <PromotionForm countries={countries} />
        </Card>
      </div>
    </>
  );
}
