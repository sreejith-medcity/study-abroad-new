import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import {
  branchActuals,
  isMonth,
  monthText,
  orgSubject,
  personActuals,
  setsBranchTargets,
  shiftMonth,
  targetBranches,
  targetPeople,
  targetsFor,
  thisMonth,
  userSubject,
} from "@/server/targets";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { CopyLastMonth, TargetsForm } from "./forms";

export const metadata = { title: "Targets" };
export const dynamic = "force-dynamic";

/**
 * Monthly targets. The Overseas desk sets each branch's and sub-agent's, and
 * can set anybody's; a branch head sets their own people's. What has happened
 * so far this month is beside every box, so a target is set against
 * something.
 */
export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string; org?: string }> }) {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "PARTNER"]);
  const sp = await searchParams;
  const month = isMonth(sp.month) ? sp.month : thisMonth();
  const desk = setsBranchTargets(user);

  const branches = desk ? await targetBranches() : [];
  // Whose people: the branch head's own, or the branch the desk picked.
  const peopleOrg = desk ? (sp.org && branches.some((b) => b.id === sp.org) ? sp.org : null) : user.orgId;
  const people = peopleOrg ? await targetPeople(peopleOrg) : [];
  const orgName = peopleOrg ? (await db.query.organizations.findFirst({ where: eq(schema.organizations.id, peopleOrg), columns: { name: true } }))?.name : null;

  const [branchSet, branchActual, peopleSet, peopleActual] = await Promise.all([
    targetsFor(branches.map((b) => orgSubject(b.id)), month),
    branchActuals(branches.map((b) => b.id), month),
    targetsFor(people.map((p) => userSubject(p.id)), month),
    personActuals(people.map((p) => p.id), month),
  ]);
  const values = (v: Partial<Record<string, number>> | undefined) => ({ REGISTRATIONS: v?.REGISTRATIONS ?? null, APPLICATIONS: v?.APPLICATIONS ?? null, VISAS: v?.VISAS ?? null });
  const q = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ month, org: peopleOrg && desk ? peopleOrg : null, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/targets?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Targets"
        subtitle={`${monthText(month)}. Registrations, applications and visas, against what has happened so far.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton variant="secondary" size="sm" href={q({ month: shiftMonth(month, -1) })}>
              {monthText(shiftMonth(month, -1))}
            </LinkButton>
            <LinkButton variant="secondary" size="sm" href={q({ month: shiftMonth(month, 1) })}>
              {monthText(shiftMonth(month, 1))}
            </LinkButton>
          </div>
        }
      />

      {desk && (
        <Card className="mb-5">
          <CardHeader
            title="Branches and sub-agents"
            subtitle="Leave a box empty for no target. A branch's figures count every student registered into it."
            action={<CopyLastMonth month={month} subjects={branches.map((b) => orgSubject(b.id))} />}
          />
          <div className="p-4">
            <TargetsForm
              month={month}
              label="Branch"
              rows={branches.map((b) => ({
                subject: orgSubject(b.id),
                name: b.name,
                sub: b.type === "SUB_AGENT" ? "Sub-agent" : undefined,
                values: values(branchSet.get(orgSubject(b.id))),
                actual: branchActual.get(b.id)!,
              }))}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={peopleOrg ? `People at ${orgName ?? "the branch"}` : "People"}
          subtitle={peopleOrg ? "A person's figures count the students assigned to them." : "Pick a branch to set its people's targets."}
          action={peopleOrg && people.length ? <CopyLastMonth month={month} subjects={people.map((p) => userSubject(p.id))} /> : undefined}
        />
        {desk && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
            {branches.map((b) => (
              <Link
                key={b.id}
                href={q({ org: b.id })}
                className={b.id === peopleOrg ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}
              >
                {b.name}
              </Link>
            ))}
          </div>
        )}
        {peopleOrg && (
          <div className="p-4">
            {people.length === 0 ? (
              <p className="text-sm text-muted">Nobody in this branch carries students yet.</p>
            ) : (
              <TargetsForm
                month={month}
                label="Person"
                rows={people.map((p) => ({
                  subject: userSubject(p.id),
                  name: p.name,
                  sub: ROLE_LABEL[p.role] ?? p.role,
                  values: values(peopleSet.get(userSubject(p.id))),
                  actual: peopleActual.get(p.id)!,
                }))}
              />
            )}
          </div>
        )}
      </Card>
    </>
  );
}
