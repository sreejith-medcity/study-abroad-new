import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { orgUsers } from "@/server/queries";
import { Alert, Card, PageHeader } from "@/components/ui";
import { NewStudentForm } from "./form";

export const metadata = { title: "Register student" };

/**
 * Registering one student by hand.
 *
 * Open to the Overseas team as well as to branches, because the desk converts
 * enquiries and sub-agents' referrals, and because somebody ringing the office
 * should not have to be entered through a bulk upload. A student belongs to a
 * branch rather than to the head office, so staff are asked which branch before
 * anything else: every screen that scopes by organisation would otherwise lose
 * the student, and commission is worked out per branch.
 */
export default async function NewStudentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  // Who may register is set on the "Who may do what" screen, not fixed here:
  // the Overseas desk registers walk-ins at Medcity and used to be shown the
  // button and then refused by it.
  if (!(await can(user, "REGISTER_STUDENT"))) redirect("/forbidden");
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const staff = isStaff(user);
  const enquiryId = one("enquiryId");

  // The branch an enquiry already belongs to is the branch its student belongs
  // to, so the desk converting one does not have to remember whose lead it was.
  const enquiry = enquiryId ? await db.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId), with: { org: { columns: { id: true, type: true } } } }) : null;
  const branches = staff
    ? await db
        .select({ id: schema.organizations.id, name: schema.organizations.name, city: schema.organizations.city })
        .from(schema.organizations)
        .where(and(ne(schema.organizations.type, "HQ"), eq(schema.organizations.active, true)))
        .orderBy(asc(schema.organizations.name))
    : [];
  const suggestedOrg = one("org") ?? (enquiry?.org && enquiry.org.type !== "HQ" ? enquiry.org.id : undefined);

  // Staff do not pick the counsellor: the branch assigns one of its own people
  // once the file lands, and a dropdown of somebody else's team is a wrong list.
  const counsellors = staff ? [] : await orgUsers(user.orgId);
  const countries = await db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));

  const prefill = {
    firstName: one("firstName"),
    lastName: one("lastName"),
    email: one("email"),
    phone: one("phone"),
    preferredCountry: one("preferredCountry"),
    preferredPathway: one("preferredPathway"),
    enquiryId,
    orgId: suggestedOrg,
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Register new student"
        subtitle={
          enquiryId
            ? "Carried over from the enquiry. Check the details, take consent, and the enquiry closes as converted."
            : "Basic details first. You'll complete the full profile next."
        }
      />
      {staff && branches.length === 0 && (
        <Alert tone="warn" title="No branch to register them under">
          A student belongs to a branch, not to the head office. Add a partner under Partners and people first.
        </Alert>
      )}
      <Card className="p-5">
        <NewStudentForm counsellors={counsellors} countries={countries.map((c) => c.name)} prefill={prefill} branches={branches} />
      </Card>
    </div>
  );
}
