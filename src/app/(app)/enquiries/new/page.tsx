import { asc, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { orgUsers } from "@/server/queries";
import { Card, PageHeader } from "@/components/ui";
import { EnquiryForm } from "../forms";

export const metadata = { title: "New enquiry" };

export default async function NewEnquiryPage() {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const staff = isStaff(user);
  const [people, countries, orgs] = await Promise.all([
    staff ? Promise.resolve([]) : orgUsers(user.orgId),
    db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name)),
    staff ? db.select().from(schema.organizations).where(ne(schema.organizations.type, "HQ")).orderBy(asc(schema.organizations.name)) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New enquiry"
        subtitle="Two minutes at the counter. Name, number and what they want is enough to start; the rest can follow."
      />
      <Card className="p-5">
        <EnquiryForm mode="create" people={people} countries={countries.map((c) => c.name)} orgs={staff ? orgs : undefined} />
      </Card>
    </div>
  );
}
