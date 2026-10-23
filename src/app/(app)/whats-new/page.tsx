import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { publishedBulletins } from "@/server/bulletin-queries";
import { BulletinList } from "@/components/bulletin-list";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { dayText, istClock, istDay } from "@/lib/journal";
import { RELEASES } from "@/lib/releases";
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION } from "@/lib/version";

export const metadata = { title: "What's new" };

export default async function WhatsNewPage() {
  const user = await requireUser([...APP_ROLES]);
  const rows = await publishedBulletins("WHATS_NEW", { limit: 50 });
  // Opening the page is reading it.
  await db.update(schema.users).set({ whatsNewSeenAt: new Date() }).where(eq(schema.users.id, user.id));
  const built = APP_BUILT_AT ? `${dayText(istDay(new Date(APP_BUILT_AT)))}, ${istClock(APP_BUILT_AT)}` : null;
  return (
    <>
      <PageHeader title="What's new" subtitle="Changes to the portal, newest first." />
      <Card>{rows.length ? <BulletinList rows={rows} openId={rows[0]?.id} countryName={new Map()} /> : <EmptyState title="Nothing yet">New features are listed here.</EmptyState>}</Card>
      <Card className="mt-5" data-releases>
        <CardHeader
          title="Releases"
          subtitle={`You are on version ${APP_VERSION}${built ? `, built ${built}` : ""}${APP_COMMIT ? ` from ${APP_COMMIT}` : ""}.`}
        />
        <ol className="divide-y divide-line">
          {RELEASES.map((r) => (
            <li key={r.version} className="px-5 py-4" data-release={r.version}>
              <p className="font-medium text-ink">
                Version {r.version}
                <span className="ml-2 text-sm font-normal text-muted">{dayText(r.date)}</span>
                {r.version === APP_VERSION && <span className="ml-2 rounded-full bg-good-50 px-2 py-0.5 text-2xs font-semibold text-good-700">Running now</span>}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {r.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
