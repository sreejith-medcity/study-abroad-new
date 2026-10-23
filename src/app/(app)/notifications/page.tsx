import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Alert, Button, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const user = await requireUser();
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  revalidatePath("/", "layout");
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ closed?: string | string[] }> }) {
  const user = await requireUser();
  const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  // Sent back here from a notice whose student can no longer be opened.
  const closedId = (await searchParams).closed;
  const closed = typeof closedId === "string"
    ? await db.query.notifications.findFirst({ where: and(eq(schema.notifications.id, closedId), eq(schema.notifications.userId, user.id)), columns: { title: true } })
    : undefined;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" actions={<form action={markAllRead}><Button variant="secondary">Mark all as read</Button></form>} />
      {closed && (
        <div className="mb-4">
          <Alert tone="warn" title="That student's file is not open to you any more">
            &ldquo;{closed.title}&rdquo; is about a student who has since been removed, or whose file has moved to somebody your role cannot see. Ask a Medcity
            Overseas admin if you think you should still have it.
          </Alert>
        </div>
      )}
      <Card>
        {rows.length === 0 ? <EmptyState title="You're all caught up" /> : (
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id}>
                <Link href={`/notifications/${n.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-ground">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-600"}`} aria-label={n.readAt ? undefined : "Unread"} />
                  <div className="flex-1">
                    <p className={n.readAt ? "" : "font-semibold"}>{n.title}</p>
                    {n.body && <p className="text-muted">{n.body}</p>}
                  </div>
                  <span className="text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
