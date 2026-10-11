import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import Link from "next/link";
import { NewProgramForm } from "./form";

export const metadata = { title: "Add a course" };

/**
 * One course, added by hand.
 *
 * The catalogue is filled by import, which is right for thousands of rows and
 * useless when a counsellor has one student in front of them and the course
 * they want is not there.
 */
export default async function NewProgramPage() {
  await requireUser([...PROCESSING_ROLES]);
  const countries = await db
    .select({ code: schema.countries.code, name: schema.countries.name })
    .from(schema.countries)
    .orderBy(asc(schema.countries.name));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/programs" className="hover:underline">Programs</Link>}
        title="Add a course"
        subtitle="For the one a counsellor needs now and the catalogue has not got. It saves as a draft, so nothing reaches a search until you have filled in the rest and set it live."
      />
      <div className="mx-auto max-w-2xl">
        <NewProgramForm countries={countries} />
      </div>
    </>
  );
}
