import { dueWords, gstWords, itemGst, rupees, usesShares } from "@/lib/student-fees";
import { feePlanList, requireFees, taxDetails } from "@/server/student-fees";
import { toggleFeePlanAction } from "@/server/student-fee-actions";
import { Button, Card, CardHeader, Chip, EmptyState, Table, Td, Th } from "@/components/ui";
import { Fold, PlanEditor, TaxDetailsForm } from "@/components/fee-forms";

export const metadata = { title: "Fee plans" };
export const dynamic = "force-dynamic";

/**
 * The fee plan templates and each organisation's GSTIN. Both are kept by the
 * head office and finance; everybody else who takes fees reads them here.
 */
export default async function FeePlansPage() {
  const { access } = await requireFees();
  const [plans, orgs] = await Promise.all([feePlanList(), taxDetails()]);
  return (
    <div className="space-y-4">
      {access.desk && (
        <Card>
          <CardHeader title="Add a fee plan" subtitle="A package's fee as instalments: fixed amounts, or shares of the fee entered when the plan is applied." />
          <div className="p-4 pt-0">
            <PlanEditor />
          </div>
        </Card>
      )}
      {plans.length === 0 ? (
        <EmptyState title="No fee plans yet">{access.desk ? "Add the first one above." : "Finance or the head office adds them."}</EmptyState>
      ) : (
        plans.map((p) => (
          <Card key={p.id} data-plan={p.name}>
            <CardHeader
              title={p.name}
              subtitle={`${usesShares(p.items) ? "Shares of the package fee" : `Fixed amounts, ${rupees(p.items.reduce((s, i) => s + (i.amount ?? 0), 0))} in all`}. GST ${p.gstPercent == null ? "rate not recorded" : `${p.gstPercent}%`}.${p.note ? ` ${p.note}` : ""}`}
              action={
                <div className="flex items-center gap-2">
                  {p.starterKey && <Chip tone="info">From Medcity&rsquo;s fee sheet</Chip>}
                  {!p.active && <Chip>Retired</Chip>}
                  {access.desk && (
                    <form action={toggleFeePlanAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button variant="secondary" size="sm">
                        {p.active ? "Retire" : "Bring back"}
                      </Button>
                    </form>
                  )}
                </div>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Instalment</Th>
                  <Th className="text-right">Amount or share</Th>
                  <Th>Due</Th>
                  <Th>GST</Th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((it, k) => (
                  <tr key={k}>
                    <Td className="tabular">{k + 1}</Td>
                    <Td>{it.label}</Td>
                    <Td className="text-right tabular">{it.share != null ? `${it.share}%` : rupees(it.amount)}</Td>
                    <Td>{dueWords(it)}</Td>
                    <Td>{gstWords(itemGst(it, p.gstPercent))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {p.source && (
              <p className="px-4 pt-2 text-xs text-muted" data-source>
                The fee sheet says: {p.source}
              </p>
            )}
            {access.desk && (
              <div className="p-4 pt-2">
                <Fold label="Edit plan">
                  <PlanEditor plan={p} />
                </Fold>
              </div>
            )}
          </Card>
        ))
      )}
      <Card>
        <CardHeader title="GSTIN and state" subtitle="A student's invoice carries GST only where its organisation has a GSTIN recorded. Without one it is a bill of supply." />
        <Table>
          <thead>
            <tr>
              <Th>Organisation</Th>
              <Th>GSTIN</Th>
              <Th>State</Th>
              {access.desk && <Th />}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} data-org={o.name}>
                <Td>{o.name}</Td>
                <Td className="font-mono text-xs">{o.gstin ?? <span className="text-muted">Not recorded</span>}</Td>
                <Td>{o.state ?? <span className="text-muted">Not recorded</span>}</Td>
                {access.desk && (
                  <Td className="w-[30rem]">
                    <Fold label="Change">
                      <TaxDetailsForm org={o} />
                    </Fold>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
