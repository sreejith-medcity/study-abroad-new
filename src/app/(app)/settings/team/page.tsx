import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { setCounsellorActiveAction } from "@/server/team";
import { Alert, Button, Card, CardHeader, Chip } from "@/components/ui";
import { AddCounsellorForm, DeskLabelForm, ResetPasswordForm } from "./forms";

export const metadata = { title: "Team" };

/** The branch owner's own team: counsellors within the tier's seats, their desks, passwords and students. */
export default async function TeamPage() {
  const owner = await requireUser(["PARTNER"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, owner.orgId) });
  if (!org) return <Alert tone="bad">This branch could not be loaded.</Alert>;
  const u = schema.users;
  const people = await db
    .select({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      deskLabel: u.deskLabel,
      active: u.active,
      lastSignInAt: u.lastSignInAt,
      students: sql<number>`(select count(*)::int from students s where s.assigned_to_id = users.id and not s.archived)`,
      apps: sql<number>`(select count(*)::int from applications a join students s on s.id = a.student_id where s.assigned_to_id = users.id)`,
    })
    .from(u)
    .where(and(eq(u.orgId, org.id), inArray(u.role, ["PARTNER", "COUNSELLOR"])))
    .orderBy(sql`${u.role} = 'PARTNER' desc`, sql`${u.active} desc`, u.name);
  const [{ used }] = await db.select({ used: count() }).from(u).where(and(eq(u.orgId, org.id), eq(u.active, true), inArray(u.role, ["PARTNER", "COUNSELLOR"])));
  const free = Math.max(0, org.counsellorSeats - used);

  return (
    <>
      <Card>
        <CardHeader title="Your team" subtitle={`${used} of ${org.counsellorSeats} seats in use on the ${org.tier.charAt(0) + org.tier.slice(1).toLowerCase()} tier. Switching someone off moves their students to you and signs them out at once.`} />
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="px-4 py-3 text-[13px]" data-testid={`member-${p.email}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">
                    {p.name} {p.role === "PARTNER" ? <Chip tone="brand">Owner</Chip> : null} {!p.active && <Chip>Switched off</Chip>}
                  </p>
                  <p className="text-muted">{[p.email, p.phone, p.deskLabel].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs text-muted">
                    {p.students} student{p.students === 1 ? "" : "s"}, {p.apps} application{p.apps === 1 ? "" : "s"} · {p.lastSignInAt ? `last signed in ${fmtDateTime(p.lastSignInAt)}` : "never signed in"}
                  </p>
                </div>
                {p.role === "COUNSELLOR" && (
                  <form action={setCounsellorActiveAction}>
                    <input type="hidden" name="userId" value={p.id} />
                    <Button size="sm" variant={p.active ? "quiet" : "secondary"} disabled={!p.active && free === 0} aria-label={`${p.active ? "Switch off" : "Switch on"} ${p.name}`}>
                      {p.active ? "Switch off" : free === 0 ? "No seat free" : "Switch back on"}
                    </Button>
                  </form>
                )}
              </div>
              {p.role === "COUNSELLOR" && p.active && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Desk and password</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <DeskLabelForm userId={p.id} label={p.deskLabel} />
                    <ResetPasswordForm userId={p.id} name={p.name} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Add a counsellor" subtitle={free > 0 ? `${free} seat${free === 1 ? "" : "s"} free.` : "Every seat is in use. Switch someone off first, or ask the Overseas team about a higher tier."} />
        {free > 0 && <div className="p-4 pt-0"><AddCounsellorForm /></div>}
      </Card>
    </>
  );
}
