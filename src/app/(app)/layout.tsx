import Link from "next/link";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { SideNav, type NavItem } from "@/components/nav";
import { logoutAction } from "@/app/login/actions";

const PARTNER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/students", label: "Students" },
  { href: "/applications", label: "Applications" },
  { href: "/search", label: "Search programs", soon: "P2" },
  { href: "/enquiries", label: "Enquiries", soon: "P2" },
  { href: "/wallet", label: "Wallet", soon: "P3" },
  { href: "/commission", label: "Commission", soon: "P3" },
  { href: "/learning", label: "Learning resources", soon: "P4" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/queue", label: "Work queue" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/applications", label: "Applications" },
  { href: "/students", label: "Students" },
  { href: "/admin/programs", label: "Programs" },
  { href: "/admin/partners", label: "Partners" },
  { href: "/admin/statuses", label: "Status flows" },
  { href: "/admin/insights", label: "Insights", soon: "P4" },
];

const MANAGEMENT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/applications", label: "Applications" },
  { href: "/students", label: "Students" },
  { href: "/admin/insights", label: "Insights", soon: "P4" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"]);
  const nav = user.role === "ADMIN" ? ADMIN_NAV : user.role === "MANAGEMENT" ? MANAGEMENT_NAV : PARTNER_NAV;

  const [{ unread }] = await db
    .select({ unread: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  const latest = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(6);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-brand-600 px-4 text-white">
        <Link href="/" className="text-lg font-bold tracking-tight">
          medcity overseas
        </Link>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1.5 hover:bg-white/10" aria-label={`Notifications, ${unread} unread`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              {unread > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold tabular">{unread}</span>}
            </summary>
            <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-line bg-white text-ink shadow-lg">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className="font-semibold">Notifications</span>
                <Link href="/notifications" className="text-xs text-brand-600 hover:underline">View all</Link>
              </div>
              {latest.length === 0 && <p className="px-3 py-6 text-center text-muted">You're all caught up.</p>}
              <ul>
                {latest.map((n) => (
                  <li key={n.id} className="border-b border-line last:border-0">
                    <Link href={`/notifications/${n.id}`} className="block px-3 py-2 hover:bg-ground">
                      <p className={n.readAt ? "text-muted" : "font-medium"}>{n.title}</p>
                      {n.body && <p className="text-xs text-muted">{n.body}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md px-2 py-1.5 hover:bg-white/10">
              Hello, {user.name.split(" ")[0]} <span aria-hidden="true">▾</span>
            </summary>
            <div className="absolute right-0 mt-2 w-60 rounded-lg border border-line bg-white p-3 text-ink shadow-lg">
              <p className="font-medium">{user.name}</p>
              <p className="text-xs text-muted">{user.email}</p>
              <p className="mt-1 text-xs text-muted">{user.orgName} · {user.role.toLowerCase()}</p>
              <form action={logoutAction} className="mt-3">
                <button className="w-full rounded-md border border-line px-3 py-1.5 text-left hover:bg-ground">Sign out</button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-line bg-white md:block">
          <SideNav items={nav} />
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mb-4 overflow-x-auto md:hidden">
            <div className="flex gap-1">
              {nav.filter((n) => !n.soon).map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md border border-line bg-white px-3 py-1.5 whitespace-nowrap">{n.label}</Link>
              ))}
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
