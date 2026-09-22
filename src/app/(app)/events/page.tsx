import Link from "next/link";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { EVENT_KIND_LABEL } from "@/lib/events";
import { fullName, istDateTime, istTime } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { Button, Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { AttendForm, RegisterStudentForm } from "@/components/event-forms";
import { removeRegistrationAction } from "@/server/events";

export const metadata = { title: "Events" };

/** Webinars, university visits, training and fairs: upcoming first, or what already happened. */
export default async function EventsPage({ searchParams }: { searchParams: Promise<{ past?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const past = (await searchParams).past === "1";
  const e = schema.events;
  const rows = await db.query.events.findMany({
    where: and(eq(e.published, true), past ? lt(e.startsAt, sql`now()`) : gte(sql`coalesce(${e.endsAt}, ${e.startsAt})`, sql`now()`)),
    with: { university: { columns: { id: true, name: true } }, registrations: { with: { user: { columns: { id: true, name: true, orgId: true } }, student: { columns: { firstName: true, lastName: true } } } } },
    orderBy: past ? desc(e.startsAt) : asc(e.startsAt),
    limit: 60,
  });
  const canRegister = user.role !== "MANAGEMENT";
  const students = canRegister && !isStaff(user)
    ? await db.select({ id: schema.students.id, firstName: schema.students.firstName, lastName: schema.students.lastName }).from(schema.students).where(and(eq(schema.students.orgId, user.orgId), eq(schema.students.archived, false))).orderBy(asc(schema.students.firstName)).limit(300)
    : [];

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Webinars, university visits, training and fairs run by the Overseas team. Times are in IST."
        actions={<Link href={past ? "/events" : "/events?past=1"} className="text-[13px] font-medium text-brand-600 hover:underline">{past ? "Upcoming events" : "Past events"}</Link>}
      />
      {rows.length === 0 ? (
        <Card><EmptyState title={past ? "Nothing yet" : "Nothing scheduled"}>{past ? "Past events will be listed here." : "New events show up here, and you are notified when one is published."}</EmptyState></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((ev) => {
            const mine = ev.registrations.find((r) => r.user.id === user.id && !r.studentId);
            const branch = ev.registrations.filter((r) => r.studentId && (isStaff(user) || r.user.orgId === user.orgId));
            const left = ev.capacity != null ? ev.capacity - ev.registrations.length : null;
            const taken = new Set(branch.map((r) => r.studentId));
            return (
              <Card key={ev.id} className="flex flex-col p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="info">{EVENT_KIND_LABEL[ev.kind]}</Chip>
                  {ev.openToStudents && <Chip tone="ok">Students welcome</Chip>}
                  {left != null && <Chip tone={left <= 0 ? "bad" : left <= 5 ? "warn" : "neutral"}>{left <= 0 ? "Full" : `${left} seat${left === 1 ? "" : "s"} left`}</Chip>}
                </div>
                <h2 className="mt-2 text-base font-semibold">{ev.title}</h2>
                <p className="text-[13px] text-ink-soft">{istDateTime(ev.startsAt)}{ev.endsAt ? ` to ${istTime(ev.endsAt)}` : ""}</p>
                {ev.location && <p className="text-[13px] text-muted">{ev.location}</p>}
                {ev.university && <Link href={`/universities/${ev.university.id}`} className="text-[13px] text-brand-600 hover:underline">{ev.university.name}</Link>}
                {ev.description && <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink-soft">{ev.description}</p>}
                {ev.joinUrl && (mine || isStaff(user)) && !past && (
                  <a href={ev.joinUrl} target="_blank" rel="noopener noreferrer" className="mt-2 text-[13px] font-medium text-brand-600 hover:underline">Join link ↗</a>
                )}
                {!past && canRegister && (
                  <div className="mt-3 space-y-3 border-t border-line pt-3">
                    <AttendForm eventId={ev.id} attending={!!mine} />
                    {ev.joinUrl && !mine && !isStaff(user) && <p className="text-xs text-muted">The join link appears once you are on the list.</p>}
                    {ev.openToStudents && !isStaff(user) && (
                      <RegisterStudentForm eventId={ev.id} students={students.filter((s) => !taken.has(s.id)).map((s) => ({ id: s.id, name: fullName(s) }))} />
                    )}
                  </div>
                )}
                {branch.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{isStaff(user) ? "Students registered" : "Your students registered"}</p>
                    <ul className="space-y-1 text-[13px]">
                      {branch.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <span>{r.student ? fullName(r.student) : ""}<span className="text-xs text-muted"> · by {r.user.name}</span></span>
                          {!past && canRegister && (
                            <form action={removeRegistrationAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <Button type="submit" variant="quiet" size="sm">Remove</Button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
