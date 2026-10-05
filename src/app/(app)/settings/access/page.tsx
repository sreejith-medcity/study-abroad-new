import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { canManageSettings, ROLE_LABEL } from "@/lib/permissions";
import {
  CAPABILITIES,
  SHORT_ROLE,
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
        subtitle="A tick is allowed. Click one to change it. A dot means it has been moved from where the portal started."
      />

      <Card>
        <CardHeader title={matrixSummary(set)} subtitle="A super admin always keeps everything. Students and parents never gain any of it." />
        <Table>
          <thead>
            <tr>
              <Th>What</Th>
              {SETTABLE_ROLES.map((r) => (
                <Th key={r} className="whitespace-nowrap px-2 text-center">
                  <span title={ROLE_LABEL[r] ?? r}>{SHORT_ROLE[r] ?? ROLE_LABEL[r] ?? r}</span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => (
              <tr key={capability}>
                {/* The explanation is on hover rather than in the row: ten columns
                    and a paragraph do not fit on one screen, and a matrix you
                    have to scroll is not telling you its shape. */}
                <Td className="whitespace-nowrap font-medium" title={CAPABILITY_MEANS[capability as Capability]}>
                  {CAPABILITY_LABEL[capability as Capability]}
                </Td>
                {SETTABLE_ROLES.map((role) => {
                  const allowed = roleCan(role, capability as Capability, set);
                  const moved = isChanged(role, capability as Capability, allowed);
                  const who = by.get(`${role}:${capability}`);
                  return (
                    <Td key={role} className="text-center">
                      <CapabilityToggle
                        role={role}
                        capability={capability}
                        allowed={allowed}
                        moved={moved}
                        note={who?.setBy ? `${who.setBy}, ${who.setAt ? fmtDateTime(who.setAt) : ""}` : undefined}
                      />
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        A tick here reaches every person with that role, at every branch. It never overrides the rules that are not Medcity&rsquo;s to
        choose: nobody passes a document they uploaded themselves, every passport reveal is in the audit log, and a branch
        owner&rsquo;s own switches still sit on top of this.
      </p>
    </>
  );
}
