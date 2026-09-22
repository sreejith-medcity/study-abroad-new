import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fullName } from "@/lib/format";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { OptionRequestForm } from "@/components/option-forms";

export const metadata = { title: "Request program options" };

export default async function NewOptionRequestPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const sp = await searchParams;
  const s = schema.students;
  const students = await db
    .select({ id: s.id, firstName: s.firstName, lastName: s.lastName })
    .from(s)
    .where(and(eq(s.archived, false), isStaff(user) ? undefined : eq(s.orgId, user.orgId)))
    .orderBy(asc(s.firstName))
    .limit(500);
  const countries = await db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/program-options" className="text-[13px] font-medium text-brand-600 hover:underline">← Program options</Link>}
        title="Request program options"
        subtitle="Tell the Overseas team about the student and they send back programs that fit. You can shortlist or apply straight from their list."
      />
      <Card className="mx-auto max-w-3xl p-5">
        <OptionRequestForm students={students.map((x) => ({ id: x.id, name: fullName(x) }))} countries={countries} preselect={sp.student} />
      </Card>
    </>
  );
}
