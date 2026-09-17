import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const user = await requireUser();
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const user = await requireUser();
  const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" actions={<form action={markAllRead}><Button variant="secondary">Mark all as read</Button></form>} />
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
