import Link from "next/link";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { MobileNav, SideNav, type NavGroup } from "@/components/nav";
import { Logo, cn } from "@/components/ui";
import { IconBell, IconLogout } from "@/components/icons";
import { logoutAction } from "@/app/login/actions";
import { APP_ROLES, isAdmin, isSuperAdmin, ROLE_LABEL } from "@/lib/permissions";

const partnerNav = (home: string): NavGroup[] => [
  {
    title: "Work",
    items: [
      { href: "/dashboard", label: home, icon: "dashboard" },
      { href: "/students", label: "Students", icon: "students" },
      { href: "/applications", label: "Applications", icon: "applications" },
    ],
  },
  {
    title: "Find programs",
    items: [
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/enquiries", label: "Enquiries", icon: "enquiry" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/wallet", label: "Wallet", icon: "wallet" },
      { href: "/commission", label: "Commission", icon: "commission" },
    ],
  },
  { title: "Support", items: [{ href: "/learning", label: "Learning resources", icon: "learning" }] },
];

const PARTNER_NAV = partnerNav("Dashboard");
const COUNSELLOR_NAV = partnerNav("My desk");

const ADMIN_NAV: NavGroup[] = [
  {
    title: "Processing",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/admin/queue", label: "Work queue", icon: "queue" },
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/students", label: "Students", icon: "students" },
    ],
  },
  {
    title: "Catalogue",
    items: [
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/admin/programs", label: "Programs", icon: "programs" },
      { href: "/admin/statuses", label: "Status flows", icon: "flow" },
    ],
  },
  {
    title: "Network",
    items: [
      { href: "/enquiries", label: "Enquiries", icon: "enquiry" },
      { href: "/admin/partners", label: "Partners", icon: "partners" },
      { href: "/admin/insights", label: "Insights", icon: "insights" },
    ],
  },
  {
    title: "Money",
    items: [{ href: "/admin/commission", label: "Commission", icon: "commission" }],
  },
  {
    title: "Support",
    items: [{ href: "/learning", label: "Learning resources", icon: "learning" }],
  },
];

const PLATFORM_NAV: NavGroup = {
  title: "Platform",
  items: [{ href: "/admin/audit", label: "Audit log", icon: "shield" }],
};

/** The documentation team works files, so they get the file screens and nothing else. */
const DOCUMENTATION_NAV: NavGroup[] = [
  {
    title: "Files",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/admin/queue", label: "Work queue", icon: "queue" },
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/students", label: "Students", icon: "students" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
    ],
  },
];

const MANAGEMENT_NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Performance", icon: "dashboard" },
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/students", label: "Students", icon: "students" },
      { href: "/admin/commission", label: "Commission", icon: "commission" },
      { href: "/admin/insights", label: "Insights", icon: "insights" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser([...APP_ROLES]);
  const groups = isSuperAdmin(user)
    ? [...ADMIN_NAV, PLATFORM_NAV]
    : isAdmin(user)
      ? ADMIN_NAV
      : user.role === "DOCUMENTATION"
        ? DOCUMENTATION_NAV
        : user.role === "MANAGEMENT"
          ? MANAGEMENT_NAV
          : user.role === "PARTNER"
            ? PARTNER_NAV
            : COUNSELLOR_NAV;

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
      <header className="brand-wash grain relative sticky top-0 z-30 flex h-16 items-center gap-3 px-3 md:px-5">
        <MobileNav groups={groups} />
        <Link href="/" className="relative z-10 rounded-lg px-1 py-1">
          <Logo />
        </Link>
        <span className="relative z-10 ml-1 hidden text-[13px] text-white/70 lg:inline">{user.orgName}</span>

        <div className="relative z-10 ml-auto flex items-center gap-1.5">
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 py-2 text-white/90 transition-colors hover:bg-white/10" aria-label={`Notifications, ${unread} unread`}>
              <IconBell />
              {unread > 0 && <span className="rounded-full bg-gold-400 px-1.5 text-[11px] font-bold text-ink tabular">{unread}</span>}
            </summary>
            <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-pop">
              <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                <span className="font-display text-sm font-semibold">Notifications</span>
                <Link href="/notifications" className="text-[13px] font-medium text-brand-600 hover:underline">
                  View all
                </Link>
              </div>
              {latest.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted">You&apos;re all caught up.</p>
              ) : (
                <ul className="max-h-[22rem] overflow-y-auto">
                  {latest.map((n) => (
                    <li key={n.id} className="border-b border-line last:border-0">
                      <Link href={`/notifications/${n.id}`} className="flex gap-2.5 px-3.5 py-2.5 hover:bg-surface-2">
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                        <span className="min-w-0">
                          <span className={cn("block truncate text-sm", n.readAt ? "text-ink-soft" : "font-semibold text-ink")}>{n.title}</span>
                          {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                          <span className="block text-[11px] text-muted/80">{fmtDateTime(n.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2.5 text-white transition-colors hover:bg-white/10">
              <span className="grid size-8 place-items-center rounded-full bg-white/15 font-display text-[13px] font-semibold">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-[13px] font-medium">{user.name.split(" ")[0]}</span>
                <span className="block text-[11px] text-white/70">{ROLE_LABEL[user.role]}</span>
              </span>
              <span aria-hidden="true" className="text-white/70">▾</span>
            </summary>
            <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-surface p-3.5 text-ink shadow-pop">
              <p className="font-display text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
              <p className="mt-1 text-xs text-muted">
                {user.orgName} · {ROLE_LABEL[user.role]}
                {user.deskLabel ? ` · ${user.deskLabel}` : ""}
              </p>
              <Link href="/change-password" className="mt-3 block rounded-lg border border-line px-3 py-1.5 text-center text-[13px] font-medium hover:bg-surface-2">
                Change password
              </Link>
              <form action={logoutAction} className="mt-2">
                <button className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] font-medium hover:bg-brand-50 hover:text-brand-700">
                  <IconLogout className="size-4" /> Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
          <div className="thin-scroll sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto">
            <SideNav groups={groups} />
            <p className="px-5 pb-6 pt-2 text-[11px] leading-relaxed text-muted/70">
              Medcity Overseas partner portal
            </p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
