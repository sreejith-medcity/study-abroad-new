import Link from "next/link";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { BRANCH_COUNSELLOR_ROLES, PARTNER_ROLES } from "@/lib/permissions";
import { isHeadOffice, mayEditRuleFor, mayManageRouting, orderRules, ruleTarget } from "@/lib/enquiry-routing";
import { lostReasonList, lostReasonUse } from "@/server/lost-reasons";
import { SOURCE_LABEL } from "@/server/enquiries";
import { Alert, Button, Card, CardHeader, Chip, Table, Td, Th } from "@/components/ui";
import { LostReasonForm, RoutingRuleForm } from "./forms";
import { deleteRoutingRuleAction, toggleLostReasonAction } from "./actions";

export const metadata = { title: "Enquiry settings" };

const PATHWAY_LABEL: Record<string, string> = { DEGREE: "Study abroad", AUSBILDUNG: "Ausbildung", NURSING: "Nurse registration", NCLEX: "NCLEX-RN", WEITERBILDUNG: "Weiterbildung", CCM: "CCM", AU_PAIR: "Au pair", FSJ: "FSJ (Germany)", BFD: "BFD (Germany)" };

/**
 * Who new enquiries go to, and the reasons an enquiry can be lost for. The
 * head office sets rules for any branch and keeps the reasons list; a branch
 * head sets their own branch's rules and reads the rest.
 */
export default async function EnquirySettingsPage({ searchParams }: { searchParams: Promise<{ edit?: string; reason?: string }> }) {
  const user = await requireUser();
  if (!mayManageRouting(user)) {
    return <Alert tone="info">Enquiry routing and lost reasons are set by the head office and branch heads.</Alert>;
  }
  const sp = await searchParams;
  const hq = isHeadOffice(user);
  const ruleScope = hq ? undefined : or(isNull(schema.enquiryRoutingRules.orgId), eq(schema.enquiryRoutingRules.orgId, user.orgId));

  const [rules, orgs, people, reasons, used, pool] = await Promise.all([
    db.select().from(schema.enquiryRoutingRules).where(ruleScope),
    hq
      ? db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(ne(schema.organizations.type, "HQ")).orderBy(asc(schema.organizations.name))
      : db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, user.orgId)),
    db
      .select({ id: schema.users.id, name: schema.users.name, orgId: schema.users.orgId, role: schema.users.role, active: schema.users.active })
      .from(schema.users)
      .where(and(inArray(schema.users.role, [...PARTNER_ROLES]), hq ? undefined : eq(schema.users.orgId, user.orgId)))
      .orderBy(asc(schema.users.name)),
    lostReasonList(),
    lostReasonUse(),
    // Who round robin would pick from at this branch, and what each holds now.
    hq
      ? Promise.resolve([])
      : db
          .select({
            name: schema.users.name,
            open: sql<number>`(count(${schema.enquiries.id}) filter (where ${schema.enquiries.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')))::int`,
          })
          .from(schema.users)
          .leftJoin(schema.enquiries, eq(schema.enquiries.assignedToId, schema.users.id))
          .where(and(eq(schema.users.orgId, user.orgId), eq(schema.users.active, true), inArray(schema.users.role, [...BRANCH_COUNSELLOR_ROLES])))
          .groupBy(schema.users.id, schema.users.name)
          .orderBy(asc(schema.users.name)),
  ]);
  const ordered = orderRules(rules);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const personName = new Map(people.map((p) => [p.id, p.active ? p.name : `${p.name} (inactive)`]));
  const editing = sp.edit ? ordered.find((r) => r.id === sp.edit && mayEditRuleFor(user, r.orgId)) : undefined;
  const editingReason = hq && sp.reason ? reasons.find((r) => r.id === sp.reason) : undefined;
  const activePeople = people.filter((p) => p.active);

  return (
    <>
      <Card>
        <CardHeader
          title="Who new enquiries go to"
          subtitle="An enquiry that arrives without an owner (typed in, from your form, from the CRM, a bulk upload or a sub-agent) goes to the first rule that matches. With no rule, it stays unassigned for the branch head to hand out."
        />
        {ordered.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">No rules yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Rule</Th>
                <Th>When the enquiry is</Th>
                <Th>Goes to</Th>
                <Th>Given out</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const when = [
                  r.orgId ? `at ${orgName.get(r.orgId) ?? "another branch"}` : "at any branch",
                  r.source ? `from ${SOURCE_LABEL[r.source]}` : null,
                  r.pathway ? `for ${PATHWAY_LABEL[r.pathway]}` : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                const mine = mayEditRuleFor(user, r.orgId);
                return (
                  <tr key={r.id} className={r.active ? undefined : "opacity-60"}>
                    <Td className="tabular">{r.priority}</Td>
                    <Td>
                      <span className="font-medium">{r.name}</span> {!r.active && <Chip>Off</Chip>}
                    </Td>
                    <Td>{when}</Td>
                    <Td>{ruleTarget(r, r.assignToId ? personName.get(r.assignToId) : null)}</Td>
                    <Td className="tabular">{r.assignedCount}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {mine ? (
                        <span className="inline-flex items-center gap-2">
                          <Link href={`/settings/enquiries?edit=${r.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                            Edit
                          </Link>
                          <form action={deleteRoutingRuleAction}>
                            <input type="hidden" name="ruleId" value={r.id} />
                            <Button type="submit" variant="quiet" size="sm" aria-label={`Remove the rule ${r.name}`}>Remove</Button>
                          </form>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Set by the head office</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {!hq && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            Round robin here picks from{" "}
            {pool.length ? pool.map((p) => `${p.name} (${p.open} open)`).join(", ") : "nobody: the branch has no active counsellor, so a round robin rule passes its enquiries on to the next rule"}
            .
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title={editing ? `Change: ${editing.name}` : "Add a rule"} action={editing ? <Link href="/settings/enquiries" className="text-sm font-medium text-brand-600 hover:underline">Add a new one instead</Link> : undefined} />
        <div className="p-4 pt-0">
          <RoutingRuleForm
            key={editing?.id ?? "new"}
            values={editing ?? {}}
            orgs={orgs}
            people={activePeople}
            fixedOrgId={hq ? undefined : user.orgId}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Why enquiries are lost"
          subtitle={hq ? "Picked from this list when an enquiry is closed as lost, and counted on the Lost reasons report. A reason in use is switched off rather than removed." : "Picked from this list when an enquiry is closed as lost. The head office keeps the list."}
        />
        <ul className="divide-y divide-line border-t border-line" aria-label="Lost reasons">
          {reasons.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className={r.active ? "font-medium" : "font-medium text-muted line-through"}>{r.label}</span>
              {!r.active && <Chip>Off</Chip>}
              <span className="text-xs text-muted">{used.get(r.id) ?? 0} enquir{(used.get(r.id) ?? 0) === 1 ? "y" : "ies"}</span>
              {hq && (
                <span className="ml-auto inline-flex items-center gap-2">
                  <Link href={`/settings/enquiries?reason=${r.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                    Rename
                  </Link>
                  <form action={toggleLostReasonAction}>
                    <input type="hidden" name="reasonId" value={r.id} />
                    <Button type="submit" variant="quiet" size="sm" aria-label={`${r.active ? "Switch off" : "Switch on"} ${r.label}`}>
                      {r.active ? "Switch off" : "Switch on"}
                    </Button>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ul>
        {hq && (
          <div className="border-t border-line p-4">
            <LostReasonForm key={editingReason?.id ?? "new"} values={editingReason ?? {}} />
          </div>
        )}
      </Card>
    </>
  );
}
