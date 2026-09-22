import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { publishedBulletins } from "@/server/bulletin-queries";
import { BulletinList } from "@/components/bulletin-list";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "What's new" };

export default async function WhatsNewPage() {
  const user = await requireUser([...APP_ROLES]);
  const rows = await publishedBulletins("WHATS_NEW", { limit: 50 });
  // Opening the page is reading it.
  await db.update(schema.users).set({ whatsNewSeenAt: new Date() }).where(eq(schema.users.id, user.id));
  return (
    <>
      <PageHeader title="What's new" subtitle="Changes to the portal, newest first." />
      <Card>{rows.length ? <BulletinList rows={rows} openId={rows[0]?.id} countryName={new Map()} /> : <EmptyState title="Nothing yet">New features are listed here.</EmptyState>}</Card>
    </>
  );
}
