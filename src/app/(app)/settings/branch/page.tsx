import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { MAX_BILLING_COMPANIES, lutState, maskAccount } from "@/lib/billing";
import { fmtDate } from "@/lib/format";
import { setCounsellorCommissionAction, setDefaultBillingCompanyAction } from "@/server/billing";
import { Alert, Button, Card, CardHeader, Chip, DataList, LinkButton } from "@/components/ui";
import { BranchForm } from "../forms";
import { BillingCompanyForm, RemoveBillingCompany } from "./billing";

export const metadata = { title: "Branch settings" };

const TYPE_LABEL: Record<string, string> = { HQ: "Head office", BRANCH: "Medcity branch", SUB_AGENT: "Sub-agent" };

export default async function BranchSettingsPage({ searchParams }: { searchParams: Promise<{ edit?: string; add?: string }> }) {
  const user = await requireUser(["PARTNER"]);
  const sp = await searchParams;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  if (!org) return <Alert tone="bad">This branch could not be loaded.</Alert>;
  const companies = await db
    .select()
    .from(schema.billingCompanies)
    .where(eq(schema.billingCompanies.orgId, user.orgId))
    .orderBy(desc(schema.billingCompanies.isDefault), asc(schema.billingCompanies.createdAt));
  const editing = companies.find((c) => c.id === sp.edit);

  return (
    <>
      <Card>
        <CardHeader title={org.name} subtitle="Your branch as students and the Medcity Overseas team see it." />
        <div className="p-4">
          <BranchForm
            city={org.city}
            addressLine={org.addressLine}
            contactPhone={org.contactPhone}
            contactEmail={org.contactEmail}
          />
        </div>
      </Card>

      <Card id="billing">
        <CardHeader
          title="Billing companies"
          subtitle={`The companies you invoice Medcity Overseas from, up to ${MAX_BILLING_COMPANIES}. Payouts go to the one you pick when you request them.`}
        />
        {companies.length === 0 && !sp.add && <p className="px-4 pb-2 text-[13px] text-muted">None yet. Add one before your first payout request.</p>}
        <ul className="divide-y divide-line">
          {companies.map((c) => {
            const lut = lutState(c.lutValidUntil);
            return (
              <li key={c.id} className="px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{c.legalName}</span>
                  {c.isDefault && <Chip tone="brand">Default</Chip>}
                  {c.gstin ? <Chip>GST {c.gstin}</Chip> : <Chip tone="warn">No GSTIN</Chip>}
                  {lut === "valid" && <Chip tone="ok">LUT to {fmtDate(new Date(`${c.lutValidUntil}T00:00:00`))}</Chip>}
                  {lut === "expired" && <Chip tone="bad">LUT lapsed {fmtDate(new Date(`${c.lutValidUntil}T00:00:00`))}</Chip>}
                </div>
                <p className="mt-1 text-muted">PAN {c.pan} · {c.state} · {c.bankAccountName}, {maskAccount(c.bankAccountNumber)}, {c.ifsc}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <LinkButton size="sm" variant="secondary" href={`/settings/branch?edit=${c.id}#billing`}>Edit</LinkButton>
                  {!c.isDefault && (
                    <form action={setDefaultBillingCompanyAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <Button size="sm" variant="quiet">Make default</Button>
                    </form>
                  )}
                  <RemoveBillingCompany id={c.id} name={c.legalName} />
                </div>
                {editing?.id === c.id && (
                  <div className="mt-3 rounded-lg border border-line p-3">
                    <BillingCompanyForm
                      values={{
                        id: c.id, legalName: c.legalName, address: c.address, state: c.state, pan: c.pan, gstin: c.gstin,
                        lutNumber: c.lutNumber, lutValidUntil: c.lutValidUntil, bankAccountName: c.bankAccountName, ifsc: c.ifsc,
                        maskedAccount: maskAccount(c.bankAccountNumber),
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {companies.length < MAX_BILLING_COMPANIES && (
          <div className="border-t border-line p-4">
            {sp.add || companies.length === 0 ? (
              <BillingCompanyForm />
            ) : (
              <LinkButton size="sm" variant="secondary" href="/settings/branch?add=1#billing">Add a billing company</LinkButton>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Commission and counsellors" subtitle="Only you, as the branch owner, can change this." />
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
          <p className="max-w-lg">
            {org.counsellorsSeeCommission
              ? "Counsellors see commission figures in search and on program pages, and can open Commission and Wallet."
              : "Counsellors do not see commission figures, the commission pages or the wallet."}
          </p>
          <form action={setCounsellorCommissionAction}>
            <input type="hidden" name="on" value={org.counsellorsSeeCommission ? "0" : "1"} />
            <Button size="sm" variant="secondary">{org.counsellorsSeeCommission ? "Hide commission from counsellors" : "Show commission to counsellors"}</Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader title="Set by Medcity Overseas" subtitle="Ask the team if any of this needs to change." />
        <div className="p-4">
          <DataList
            rows={[
              { label: "Type", value: TYPE_LABEL[org.type] ?? org.type },
              { label: "Tier", value: org.tier },
              {
                label: "Public enquiry form",
                value: org.publicFormEnabled && org.publicSlug ? `On, at /apply/${org.publicSlug}` : "Off",
                tone: org.publicFormEnabled ? undefined : "warn",
              },
            ]}
          />
          <p className="mt-3 text-xs text-muted">
            The public form and its QR code live on the Partners screen at Medcity Overseas. Ask them to switch it on if you
            want one for your branch.
          </p>
        </div>
      </Card>
    </>
  );
}
