import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { orgUsers } from "@/server/queries";
import { Card, PageHeader } from "@/components/ui";
import { NewStudentForm } from "./form";

export const metadata = { title: "Register student" };

export default async function NewStudentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR"]);
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const counsellors = await orgUsers(user.orgId);
  const countries = await db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));

  const enquiryId = one("enquiryId");
  const prefill = {
    firstName: one("firstName"),
    lastName: one("lastName"),
    email: one("email"),
    phone: one("phone"),
    preferredCountry: one("preferredCountry"),
    preferredPathway: one("preferredPathway"),
    enquiryId,
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Register new student"
        subtitle={enquiryId ? "Carried over from the enquiry. Check the details, take consent, and the enquiry closes as converted." : "Basic details first. You'll complete the full profile next."}
      />
      <Card className="p-5">
        <NewStudentForm counsellors={counsellors} countries={countries.map((c) => c.name)} prefill={prefill} />
      </Card>
    </div>
  );
}
