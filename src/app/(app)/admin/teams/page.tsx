import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, ROLE_LABEL } from "@/lib/permissions";
import { teamCandidates, teamsWithMembers } from "@/server/teams";
import { schema } from "@/db";
import { PATHWAY_LABEL } from "@/lib/catalogue";
import { Button, Card, Chip, EmptyState, Input, PageHeader } from "@/components/ui";
import { Section } from "@/components/section";
import { IconPartners } from "@/components/icons";
import { deleteTeamAction, removeTeamMemberAction, renameTeamAction, setTeamLeadAction, setTeamPathwaysAction, toggleTeamAction } from "./actions";
import { AddMemberForm, ApplyExistingForm, NewTeamForm } from "./forms";

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
  const [teams, people] = await Promise.all([teamsWithMembers(), teamCandidates()]);
  // Which live teams carry each pathway, so a pathway two teams both carry
  // can be pointed out: the portal leaves those files for a person to place.
  const carriers = new Map<string, string[]>();
  for (const t of teams) {
    if (!t.active) continue;
    for (const p of t.pathways) carriers.set(p.pathway, [...(carriers.get(p.pathway) ?? []), t.name]);
  }

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
            // Counted from everybody ever put in it, not just the people who
            // are still active: a team somebody has been in is not untouched.
            const unused = t.members.length === 0 && t.students === 0;
            const leads = members.filter((m) => m.lead);
            const inTeam = new Set(members.map((m) => m.userId));
            const carried = new Set(t.pathways.map((p) => p.pathway as string));
            const shared = [...carried].filter((p) => (carriers.get(p) ?? []).length > 1);
            const meta = [
              t.active ? null : "Retired",
              carried.size ? `carries ${[...carried].map((p) => PATHWAY_LABEL[p] ?? p).join(", ")}` : null,
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
                  <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                    Name
                    <Input name="name" defaultValue={t.name} className="mt-1 w-44 py-1.5 text-sm" />
                  </label>
                  <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                    What it covers
                    <Input name="note" defaultValue={t.note ?? ""} className="mt-1 w-72 py-1.5 text-sm" />
                  </label>
                  <Button variant="secondary" size="sm">Save</Button>
                </form>

                <div className="border-b border-line px-4 py-3">
                  <form action={setTeamPathwaysAction} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <input type="hidden" name="teamId" value={t.id} />
                    <span className="text-2xs font-semibold uppercase tracking-wider text-muted">Pathways it carries</span>
                    {schema.pathway.enumValues.map((p) => (
                      <label key={p} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" name="pathway" value={p} defaultChecked={carried.has(p)} className="size-4 rounded border-line-strong accent-brand-600" />
                        {PATHWAY_LABEL[p] ?? p}
                      </label>
                    ))}
                    <Button variant="secondary" size="sm">Save</Button>
                  </form>
                  <p className="mt-2 text-2xs text-muted">
                    A student who gets one of these pathways, when they are registered or with an application, and is not on a team yet, goes on this team whichever branch registered them. The team&apos;s people can then open and work the file; the branch and the counsellor stay as they are. A team chosen by hand on a file is never changed.
                  </p>
                  {shared.length > 0 && (
                    <p className="mt-1 text-2xs text-warn-700">
                      {shared.map((p) => `${PATHWAY_LABEL[p] ?? p} is also carried by ${(carriers.get(p) ?? []).filter((n) => n !== t.name).join(", ")}`).join(". ")}. Files on a pathway two teams carry are left for somebody to place by hand.
                    </p>
                  )}
                  {t.active && carried.size > 0 && (
                    <div className="mt-2">
                      <ApplyExistingForm teamId={t.id} />
                    </div>
                  )}
                </div>

                <ul className="divide-y divide-line">
                  {members.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nobody is in this team yet.</li>}
                  {members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="font-medium">{m.user?.deskLabel ?? m.user?.name}</span>
                      {m.user?.deskLabel && <span className="text-xs text-muted">{m.user?.name}</span>}
                      <span className="text-xs text-muted">{m.user?.org?.type === "HQ" ? "Head office" : m.user?.org?.name}</span>
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

                {/* Nothing has used it, so it is a mistake rather than
                    history, and it can go for good. Anything that carried
                    work is retired instead, further down. */}
                {unused ? (
                  <form action={deleteTeamAction} className="border-t border-line px-4 py-2">
                    <input type="hidden" name="teamId" value={t.id} />
                    <button className="text-xs text-muted hover:text-stop-500">Delete this team</button>
                    <span className="ml-2 text-xs text-muted">
                      Nobody is in it and no student is carried by it, so there is nothing to keep.
                    </span>
                  </form>
                ) : (
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
                )}
              </Section>
            );
          })}
        </div>

        <Card className="h-fit p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-base font-semibold">
            <IconPartners className="size-4 text-brand-600" /> Add a team
          </h2>
          <p className="mb-3 text-sm text-muted">A pathway, a destination, or whatever the work actually divides into.</p>
          <NewTeamForm />
        </Card>
      </div>
    </>
  );
}
