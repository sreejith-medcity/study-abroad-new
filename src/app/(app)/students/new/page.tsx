import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { orgUsers } from "@/server/queries";
import { Card, PageHeader } from "@/components/ui";
import { NewStudentForm } from "./form";

export const metadata = { title: "Register student" };

export default async function NewStudentPage() {
  const user = await requireUser(["PARTNER", "COUNSELLOR"]);
  const counsellors = await orgUsers(user.orgId);
  const countries = await db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  return (
    <div className="max-w-3xl">
      <PageHeader title="Register new student" subtitle="Basic details first. You'll complete the full profile next." />
      <Card className="p-5">
        <NewStudentForm counsellors={counsellors} countries={countries.map((c) => c.name)} />
      </Card>
    </div>
  );
}
