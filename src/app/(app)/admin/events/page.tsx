import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { EVENT_KIND_LABEL } from "@/lib/events";
import { fullName, istDateTime } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Button, Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";
import { CreateEventForm } from "@/components/event-forms";
import { setEventPublishedAction } from "@/server/events";

export const metadata = { title: "Events" };

export default async function AdminEventsPage() {
  await requireUser([...ADMIN_ROLES]);
  const rows = await db.query.events.findMany({
    with: { registrations: { with: { user: { columns: { name: true }, with: { org: { columns: { name: true } } } }, student: { columns: { firstName: true, lastName: true } } } } },
    orderBy: desc(schema.events.startsAt),
    limit: 100,
  });
  const now = new Date();
  return (
    <>
      <PageHeader title="Events" subtitle="Publish a webinar, visit, training or fair; partners are notified and register themselves or their students." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader title="All events" subtitle="Newest first" />
          {rows.length === 0 ? (
            <EmptyState title="No events yet">Publish the first one on the right.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((ev) => {
                const seats = ev.registrations.filter((r) => !r.studentId);
                const students = ev.registrations.filter((r) => r.studentId);
                return (
                  <li key={ev.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{ev.title}</p>
                        <p className="text-xs text-muted">{EVENT_KIND_LABEL[ev.kind]} · {istDateTime(ev.startsAt)}{ev.location ? ` · ${ev.location}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!ev.published ? <Chip tone="bad">Cancelled</Chip> : ev.startsAt < now ? <Chip>Past</Chip> : <Chip tone="ok">Published</Chip>}
                        <Chip tone="info">{seats.length} partner{seats.length === 1 ? "" : "s"}, {students.length} student{students.length === 1 ? "" : "s"}{ev.capacity != null ? ` of ${ev.capacity}` : ""}</Chip>
                        {ev.startsAt >= now && (
                          <form action={setEventPublishedAction}>
                            <input type="hidden" name="id" value={ev.id} />
                            <input type="hidden" name="published" value={ev.published ? "false" : "true"} />
                            <Button type="submit" variant="quiet" size="sm">{ev.published ? "Cancel event" : "Publish again"}</Button>
                          </form>
                        )}
                      </div>
                    </div>
                    {ev.registrations.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Who is coming</summary>
                        <ul className="mt-1.5 space-y-0.5 text-[13px]">
                          {ev.registrations.map((r) => (
                            <li key={r.id}>{r.student ? `${fullName(r.student)} (student, via ${r.user.name})` : r.user.name}<span className="text-xs text-muted"> · {r.user.org?.name}</span></li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">New event</h2>
          <CreateEventForm />
        </Card>
      </div>
    </>
  );
}
