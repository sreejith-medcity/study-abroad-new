import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { Alert, Card, CardHeader, DataList } from "@/components/ui";
import { BranchForm } from "../forms";

export const metadata = { title: "Branch settings" };

const TYPE_LABEL: Record<string, string> = { HQ: "Head office", BRANCH: "Medcity branch", SUB_AGENT: "Sub-agent" };

export default async function BranchSettingsPage() {
  const user = await requireUser(["PARTNER"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  if (!org) return <Alert tone="bad">This branch could not be loaded.</Alert>;

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
