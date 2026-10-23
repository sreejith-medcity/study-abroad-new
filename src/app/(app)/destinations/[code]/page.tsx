import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { feeText } from "@/lib/catalogue";
import { APP_ROLES, isAdmin } from "@/lib/permissions";
import { DestinationGuide, hasGuide } from "@/components/destination-guide";
import { Card, CardHeader, DataList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { IconGlobe } from "@/components/icons";

export const metadata = { title: "Destination guide" };

/**
 * One country's guide, for counsellors talking a student through the
 * destination. Reached from the program and university pages and from the
 * universities list filtered to the country.
 */
export default async function DestinationPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const { code } = await params;
  if (!/^[A-Za-z]{2}$/.test(code)) notFound();
  const country = await db.query.countries.findFirst({ where: eq(schema.countries.code, code.toUpperCase()) });
  if (!country) notFound();
  const cur = country.currency;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/universities?country=${country.code}`} className="text-sm font-medium text-brand-600 hover:underline">
            ← Universities in {country.name}
          </Link>
        }
        title={country.name}
        subtitle="Destination guide"
        actions={isAdmin(user) ? <LinkButton variant="secondary" href={`/admin/destinations#guide-${country.code}`}>Edit guide</LinkButton> : undefined}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        {hasGuide(country) ? (
          <DestinationGuide country={country} />
        ) : (
          <Card>
            <EmptyState icon={<IconGlobe />} title="No guide recorded yet">
              Nobody has written a guide for {country.name}. Ask the Overseas team.
            </EmptyState>
          </Card>
        )}
        <div className="space-y-5 self-start">
          <Card>
            <CardHeader title="Money" />
            <DataList
              rows={[
                { label: "Currency", value: cur },
                {
                  label: "Visa living funds, first year",
                  value:
                    country.visaLivingFunds != null ? (
                      <>
                        {feeText(country.visaLivingFunds, cur, { zero: "" })}
                        {country.visaLivingSource && (
                          <a href={country.visaLivingSource} target="_blank" rel="noopener noreferrer" className="block text-xs font-normal text-brand-600 hover:underline">
                            {country.name} government figure ↗
                          </a>
                        )}
                      </>
                    ) : (
                      "Not recorded"
                    ),
                },
              ]}
            />
          </Card>
          <Card className="space-y-2 p-4 text-sm">
            <Link href={`/universities?country=${country.code}`} className="block font-medium text-brand-600 hover:underline">Universities in {country.name}</Link>
            <Link href={`/search?country=${country.code}`} className="block font-medium text-brand-600 hover:underline">Programs in {country.name}</Link>
          </Card>
        </div>
      </div>
    </>
  );
}
