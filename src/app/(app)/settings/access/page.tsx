import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { canManageSettings, ROLE_LABEL } from "@/lib/permissions";
import {
  CAPABILITIES,
  CAPABILITY_LABEL,
  CAPABILITY_MEANS,
  SETTABLE_ROLES,
  isChanged,
  matrixSummary,
  roleCan,
  type Capability,
} from "@/lib/capabilities";
import { overrideRows, overrides } from "@/server/capabilities";
import { Alert, Card, CardHeader, Chip, PageHeader, Table, Td, Th } from "@/components/ui";
import { IconShield } from "@/components/icons";
import { CapabilityToggle } from "./form";

export const metadata = { title: "Who may do what" };
export const dynamic = "force-dynamic";

/**
 * Who may do what, as a table Medcity sets rather than a rule in the code.
 *
 * Every box starts where the portal already stood, so opening this screen and
 * changing nothing changes nothing. A box that has been moved says so, with who
 * moved it and when, because a permission nobody can account for is a
 * permission nobody trusts.
 */
export default async function AccessPage() {
  const user = await requireUser();
  if (!canManageSettings(user)) return <Alert tone="bad">Only a super admin can open this page.</Alert>;

  const [set, rows] = await Promise.all([overrides(), overrideRows()]);
  const by = new Map(rows.map((r) => [`${r.role}:${r.capability}`, r]));

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <IconShield className="size-4" /> Super admin
          </span>
        }
        title="Who may do what"
        subtitle="One row per thing somebody can do, one column per role. Everything starts where the portal already stood, so changing nothing here changes nothing."
      />

      <Alert tone={set.length > 0 ? "info" : "ok"} title={matrixSummary(set)}>
        A super admin always keeps everything, so nobody can lock the last person out of this screen. Students and parents never gain
        any of it, whatever is ticked. A branch owner&rsquo;s own switches, for what counsellors see and whether the branch checks its
        own documents, sit on top of this and can only take away.
      </Alert>

      <Card className="mt-4">
        <CardHeader title="The table" subtitle="A tick is allowed. A box that has been moved from where it started is marked." />
        <Table tableClassName="min-w-[900px]">
          <thead>
            <tr>
              <Th>What</Th>
              {SETTABLE_ROLES.map((r) => (
                <Th key={r} className="text-center">
                  {ROLE_LABEL[r] ?? r}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => (
              <tr key={capability}>
                <Td>
                  <span className="font-medium">{CAPABILITY_LABEL[capability as Capability]}</span>
                  <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">{CAPABILITY_MEANS[capability as Capability]}</p>
                </Td>
                {SETTABLE_ROLES.map((role) => {
                  const allowed = roleCan(role, capability as Capability, set);
                  const moved = isChanged(role, capability as Capability, allowed);
                  const who = by.get(`${role}:${capability}`);
                  return (
                    <Td key={role} className="text-center align-top">
                      <CapabilityToggle role={role} capability={capability} allowed={allowed} />
                      {moved && (
                        <span className="mt-1 block text-[11px] text-muted">
                          {who?.setBy ? `${who.setBy}, ` : ""}
                          {who?.setAt ? fmtDateTime(who.setAt) : "changed"}
                        </span>
                      )}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <CardHeader title="What this screen cannot do" />
        <div className="space-y-2 p-4 text-[13px] leading-relaxed text-muted">
          <p>
            It does not make roles. The portal&rsquo;s seven roles are what they are; this decides what each may reach.
          </p>
          <p>
            It does not reach a single person. A counsellor who needs something nobody else at their branch needs is a conversation,
            not a tick: giving it to them here gives it to every counsellor at every branch.
          </p>
          <p>
            It never overrides a rule that exists for a reason outside Medcity&rsquo;s choosing: nobody passes a document they
            uploaded themselves, a reveal of a passport number is in the audit log whoever does it, and a parent sees what the student
            allows and nothing else. <Chip tone="ok">Always</Chip>
          </p>
        </div>
      </Card>
    </>
  );
}
