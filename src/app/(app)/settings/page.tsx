import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { isPartner, ROLE_BLURB, ROLE_LABEL } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, DataList } from "@/components/ui";
import { ProfileForm } from "./forms";

export const metadata = { title: "Profile settings" };

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });

  return (
    <>
      <Card>
        <CardHeader title="Your details" subtitle="How your name shows up on files, messages and the audit log." />
        <div className="p-4">
          <ProfileForm
            name={user.name}
            email={user.email}
            phone={row?.phone ?? null}
            deskLabel={user.deskLabel}
            locale={user.locale}
            showDeskLabel={!isPartner(user)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Your access" subtitle="Set by the Medcity Overseas team. Ask them if something here is wrong." />
        <div className="p-4">
          <DataList
            rows={[
              { label: "Role", value: ROLE_LABEL[user.role] },
              { label: "What that covers", value: ROLE_BLURB[user.role] ?? "—" },
              { label: "Organisation", value: user.orgName },
              { label: "Account created", value: row?.createdAt ? fmtDateTime(row.createdAt) : "—" },
              { label: "Last sign-in", value: row?.lastSignInAt ? fmtDateTime(row.lastSignInAt) : "First session" },
            ]}
          />
        </div>
      </Card>
    </>
  );
}
