import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { publicFormUrl } from "@/server/public-form";
import { Alert, Card, CardHeader } from "@/components/ui";
import { SignupQuestionsForm, StudentBrandForm, StudentNotificationsForm } from "./forms";

export const metadata = { title: "Student platform settings" };

/** How the branch's students see the portal and the branch form, and what reaches them on WhatsApp. */
export default async function StudentPlatformPage() {
  const user = await requireUser(["PARTNER"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  if (!org) return <Alert tone="bad">This branch could not be loaded.</Alert>;
  const formLink = org.publicFormEnabled && org.publicSlug ? publicFormUrl(org.publicSlug) : null;
  return (
    <>
      <Card>
        <CardHeader title="Portal look" subtitle="Your name, colour and logo on the student portal and on your enquiry form. Medcity Overseas is still named beside them." />
        <div className="p-4 pt-0">
          <StudentBrandForm name={org.portalName} color={org.portalColor} hasLogo={!!org.portalLogoKey} orgId={org.id} />
        </div>
      </Card>
      <Card>
        <CardHeader title="What students get on WhatsApp" subtitle="Only for students who agreed to WhatsApp updates. Everything still shows in their portal." />
        <div className="p-4 pt-0">
          <StudentNotificationsForm milestones={org.studentWhatsappMilestones} messages={org.studentWhatsappMessages} />
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Questions on your enquiry form"
          subtitle={formLink ? `Asked on ${formLink}, after the standard questions. Answers show on each enquiry.` : "Your enquiry form is off. Ask the Overseas team to switch it on; these questions are kept for when it is."}
        />
        <div className="p-4 pt-0">
          <SignupQuestionsForm questions={org.signupQuestions} />
        </div>
      </Card>
    </>
  );
}
