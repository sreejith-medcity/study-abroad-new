import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, ROLE_LABEL } from "@/lib/permissions";
import { deskPeople, teamsWithMembers } from "@/server/teams";
import { Button, Card, Chip, EmptyState, Input, PageHeader } from "@/components/ui";
import { Section } from "@/components/section";
import { IconPartners } from "@/components/icons";
import { removeTeamMemberAction, renameTeamAction, setTeamLeadAction, toggleTeamAction } from "./actions";
import { AddMemberForm, NewTeamForm } from "./forms";

export const metadata = { title: "Teams" };

/**
 * The teams the work divides into: Ausbildung, Austria, the UK desk.
 *
 * Medcity's work has always divided by pathway and destination before it
 * divides by role, and the portal had no word for that, so who covers what
 * lived in people's heads. A team is a name with people in it; a student's
 * file says which one carries it, and the lists can be read one team at a
 * time.
 */
export default async function TeamsPage() {
  await requireUser([...ADMIN_ROLES]);
  const [teams, people] = await Promise.all([teamsWithMembers(), deskPeople()]);

  return (
    <>
      <PageHeader title="Teams" subtitle="The parts the work divides into, and who is in each of them" />

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {teams.length === 0 && (
            <Card>
              <EmptyState title="No teams yet">
                Add the first one on the right. Ausbildung and Austria are the two most Medcity files are carried by.
              </EmptyState>
            </Card>
          )}

          {teams.map((t) => {
            const members = t.members.filter((m) => m.user?.active);
            const leads = members.filter((m) => m.lead);
            const inTeam = new Set(members.map((m) => m.userId));
            const meta = [
              t.active ? null : "Retired",
              `${members.length} ${members.length === 1 ? "person" : "people"}`,
              leads.length ? `led by ${leads.map((l) => l.user?.deskLabel ?? l.user?.name).join(", ")}` : "nobody leads it",
              `${t.students} ${t.students === 1 ? "student" : "students"}`,
              t.note,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <Section key={t.id} id={`team-${t.id}`} title={t.name} meta={meta} defaultOpen={members.length === 0} bodyClassName="">
                <form action={renameTeamAction} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
                  <input type="hidden" name="teamId" value={t.id} />
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Name
                    <Input name="name" defaultValue={t.name} className="mt-1 w-44 py-1.5 text-[13px]" />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    What it covers
                    <Input name="note" defaultValue={t.note ?? ""} className="mt-1 w-72 py-1.5 text-[13px]" />
                  </label>
                  <Button variant="secondary" size="sm">Save</Button>
                </form>

                <ul className="divide-y divide-line">
                  {members.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">Nobody is in this team yet.</li>}
                  {members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                      <span className="font-medium">{m.user?.deskLabel ?? m.user?.name}</span>
                      {m.user?.deskLabel && <span className="text-xs text-muted">{m.user?.name}</span>}
                      <Chip>{ROLE_LABEL[m.user?.role ?? ""] ?? m.user?.role}</Chip>
                      {m.lead && <Chip tone="gold">Leads it</Chip>}
                      <div className="ml-auto flex items-center gap-3">
                        <form action={setTeamLeadAction}>
                          <input type="hidden" name="memberId" value={m.id} />
                          <button className="text-xs text-brand-600 hover:underline">{m.lead ? "Not the lead" : "Make lead"}</button>
                        </form>
                        <form action={removeTeamMemberAction}>
                          <input type="hidden" name="memberId" value={m.id} />
                          <button className="text-xs text-muted hover:text-stop-500">Remove</button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-line px-4 py-3">
                  <AddMemberForm teamId={t.id} people={people.filter((p) => !inTeam.has(p.id))} />
                </div>

                <form action={toggleTeamAction} className="border-t border-line px-4 py-2">
                  <input type="hidden" name="teamId" value={t.id} />
                  <button className="text-xs text-muted hover:text-stop-500">
                    {t.active ? "Retire this team" : "Put it back"}
                  </button>
                  <span className="ml-2 text-xs text-muted">
                    {t.active
                      ? "A retired team stays on the files it already carries and stops being offered on new ones."
                      : "Retired, so it is not offered on new files."}
                  </span>
                </form>
              </Section>
            );
          })}
        </div>

        <Card className="h-fit p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-[15px] font-semibold">
            <IconPartners className="size-4 text-brand-600" /> Add a team
          </h2>
          <p className="mb-3 text-[13px] text-muted">A pathway, a destination, or whatever the work actually divides into.</p>
          <NewTeamForm />
        </Card>
      </div>
    </>
  );
}
