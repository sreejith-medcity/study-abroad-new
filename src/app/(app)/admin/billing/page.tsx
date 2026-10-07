import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { fmtDate } from "@/lib/format";
import { taxFor } from "@/lib/invoicing";
import { MAX_BILLING_COMPANIES, maskAccount } from "@/lib/billing";
import { BillingCompanyForm, RemoveBillingCompany } from "../../settings/branch/billing";
import { setDefaultBillingCompanyAction } from "@/server/billing";
import { Alert, Card, CardHeader, Chip, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Billing companies" };
export const dynamic = "force-dynamic";

/**
 * The companies Medcity Overseas raises its vendor invoices from.
 *
 * Until now these existed only in the seed, which meant replacing the one that
 * ships, with its placeholder PAN, was a hand-written database statement before
 * anybody could invoice for real. The GSTIN and the LUT decide the tax on every
 * invoice, so the screen says which treatment each company is currently in
 * rather than leaving that to be discovered when one goes out wrong.
 */
export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ add?: string; edit?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  if (!(await can(user, "RAISE_INVOICES"))) redirect("/forbidden");
  const sp = await searchParams;

  const hq = await db.query.organizations.findFirst({ where: eq(schema.organizations.type, "HQ"), columns: { id: true, name: true } });
  if (!hq) {
    return <EmptyState title="No head office on record">An invoice is raised by a company, and a company belongs to the head office organisation.</EmptyState>;
  }
  const companies = await db.query.billingCompanies.findMany({
    where: eq(schema.billingCompanies.orgId, hq.id),
    orderBy: asc(schema.billingCompanies.legalName),
  });
  const editing = sp.edit ? companies.find((c) => c.id === sp.edit) : undefined;

  return (
    <>
      <PageHeader
        title="Billing companies"
        subtitle={`Who ${hq.name} invoices its vendors as. The GSTIN and the LUT on the company decide the tax on every invoice it raises.`}
        actions={companies.length < MAX_BILLING_COMPANIES && !sp.add && !editing ? <LinkButton href="/admin/billing?add=1">Add a company</LinkButton> : undefined}
      />

      {companies.length === 0 && (
        <Alert tone="warn" title="Nothing can be invoiced yet">
          An invoice is raised by a company. Add the one Medcity Overseas bills from, with its PAN, its GSTIN and its LUT, before the first invoice goes out.
        </Alert>
      )}

      {(sp.add || editing) && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 font-semibold text-brand-700">{editing ? `Edit ${editing.legalName}` : "Add a company"}</h2>
          <BillingCompanyForm
            values={
              editing
                ? {
                    id: editing.id,
                    legalName: editing.legalName,
                    address: editing.address,
                    state: editing.state,
                    pan: editing.pan,
                    gstin: editing.gstin,
                    lutNumber: editing.lutNumber,
                    lutValidUntil: editing.lutValidUntil,
                    bankAccountName: editing.bankAccountName,
                    ifsc: editing.ifsc,
                    maskedAccount: maskAccount(editing.bankAccountNumber),
                  }
                : undefined
            }
          />
        </Card>
      )}

      {companies.length > 0 && (
        <Card>
          <CardHeader
            title={`${companies.length} compan${companies.length === 1 ? "y" : "ies"}`}
            subtitle="The default is the one an invoice is raised from unless somebody picks another."
          />
          <ul className="divide-y divide-line">
            {companies.map((c) => {
              // What an invoice raised today would say, rather than what the
              // paperwork says it should: an expired LUT is the kind of thing
              // nobody notices until a zero-rated invoice turns out not to be.
              const tax = taxFor({ gstin: c.gstin, lutNumber: c.lutNumber, lutValidUntil: c.lutValidUntil }, false);
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{c.legalName}</span>
                    {c.isDefault && <Chip tone="ok">Default</Chip>}
                    <span className="ml-auto flex items-center gap-3 text-[13px]">
                      <a href={`/admin/billing?edit=${c.id}`} className="font-medium text-brand-600 hover:underline">Edit</a>
                      {!c.isDefault && (
                        <form action={setDefaultBillingCompanyAction} className="inline">
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="font-medium text-brand-600 hover:underline">Make it the default</button>
                        </form>
                      )}
                      <RemoveBillingCompany id={c.id} name={c.legalName} />
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {c.address}, {c.state}
                  </p>
                  <p className="mt-0.5 text-[13px] tabular text-muted">
                    PAN {c.pan} · GSTIN {c.gstin ?? "Not recorded"} · LUT {c.lutNumber ? `${c.lutNumber} to ${c.lutValidUntil ? fmtDate(c.lutValidUntil) : "a date not recorded"}` : "Not recorded"}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {c.bankAccountName} · {maskAccount(c.bankAccountNumber)} · {c.ifsc}
                  </p>
                  <p className={`mt-1 text-[13px] ${tax.percent > 0 ? "font-medium text-amber-700" : "text-emerald-700"}`}>
                    An invoice raised today: {tax.treatment}
                    {tax.note ? `. ${tax.note}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
