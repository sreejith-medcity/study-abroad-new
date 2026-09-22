import Link from "next/link";
import { commissionVisible } from "@/server/commission-visibility";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { MobileNav, SideNav, type NavGroup } from "@/components/nav";
import { CommandPalette } from "@/components/palette";
import { ToastHost } from "@/components/toast";
import { cn } from "@/components/ui";
import { BrandLogo, BrandStyle } from "@/components/brand";
import { IconBell, IconLogout } from "@/components/icons";
import { logoutAction } from "@/app/login/actions";
import { APP_ROLES, isAdmin, isSuperAdmin, ROLE_LABEL } from "@/lib/permissions";
import { getSettings } from "@/server/settings";

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
      { href: "/program-options", label: "Program options", icon: "spark" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
      { href: "/enquiries", label: "Enquiries", icon: "enquiry" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/wallet", label: "Wallet", icon: "wallet" },
      { href: "/commission", label: "Commission", icon: "commission" },
      { href: "/promotions", label: "Schemes", icon: "spark" },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/updates", label: "Updates", icon: "spark" },
      { href: "/events", label: "Events", icon: "events" },
      { href: "/support", label: "Help desk", icon: "support" },
      { href: "/contacts", label: "Contacts", icon: "partners" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/training", label: "Training", icon: "training" },
    ],
  },
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
      { href: "/program-options", label: "Program options", icon: "spark" },
      { href: "/admin/services", label: "Services", icon: "services" },
      { href: "/support", label: "Help desk", icon: "support" },
    ],
  },
  {
    title: "Catalogue",
    items: [
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
      { href: "/admin/programs", label: "Programs", icon: "programs" },
      { href: "/admin/scholarships", label: "Scholarships", icon: "spark" },
      { href: "/admin/destinations", label: "Destinations and rankings", icon: "universities" },
      { href: "/admin/statuses", label: "Status flows", icon: "flow" },
      { href: "/admin/documents", label: "Document types", icon: "applications" },
    ],
  },
  {
    title: "Network",
    items: [
      { href: "/enquiries", label: "Enquiries", icon: "enquiry" },
      { href: "/admin/partners", label: "Partners", icon: "partners" },
      { href: "/admin/updates", label: "Updates", icon: "spark" },
      { href: "/admin/promotions", label: "Schemes", icon: "commission" },
      { href: "/admin/contacts", label: "Contacts and links", icon: "partners" },
      { href: "/admin/prep", label: "Test prep", icon: "learning" },
      { href: "/admin/events", label: "Events", icon: "events" },
      { href: "/admin/training", label: "Training", icon: "training" },
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
  items: [
    { href: "/admin/audit", label: "Audit log", icon: "shield" },
    { href: "/settings/platform", label: "Platform settings", icon: "settings" },
    { href: "/admin/go-live", label: "Go live", icon: "spark" },
  ],
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
      { href: "/admin/services", label: "Services", icon: "services" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/events", label: "Events", icon: "events" },
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
            : (await commissionVisible(user))
              ? COUNSELLOR_NAV
              : COUNSELLOR_NAV.filter((g) => g.title !== "Money");

  const navGroups: NavGroup[] = [
    ...groups,
    { title: "Account", items: [{ href: "/settings", label: "Settings", icon: "settings" }] },
  ];

  const settings = await getSettings();

  const [{ unread }] = await db
    .select({ unread: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  // What's New carries a dot until the person has opened it since the newest item.
  const me = await db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { whatsNewSeenAt: true } });
  const [newest] = await db
    .select({ at: schema.bulletins.createdAt })
    .from(schema.bulletins)
    .where(and(eq(schema.bulletins.kind, "WHATS_NEW"), eq(schema.bulletins.published, true)))
    .orderBy(desc(schema.bulletins.createdAt))
    .limit(1);
  const freshNews = !!newest && (!me?.whatsNewSeenAt || me.whatsNewSeenAt < newest.at);
  const latest = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(6);

  return (
    <div className="min-h-screen">
      <BrandStyle />
      <ToastHost />
      <header className="brand-wash grain relative sticky top-0 z-30 flex h-16 items-center gap-3 px-3 md:px-5">
        <MobileNav groups={navGroups} />
        <Link href="/" className="relative z-10 rounded-lg px-1 py-1">
          <BrandLogo />
        </Link>
        <span className="relative z-10 ml-1 hidden text-[13px] text-white/70 lg:inline">{user.orgName}</span>

        <div className="relative z-10 ml-auto flex items-center gap-1.5">
          <CommandPalette groups={navGroups} />
          <Link href="/whats-new" className="relative hidden items-center rounded-lg px-2.5 py-2 text-[13px] font-medium text-white/90 hover:bg-white/10 sm:flex">
            What&apos;s new
            {freshNews && <span className="ml-1 size-2 rounded-full bg-gold-400" aria-label="New items" />}
          </Link>
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
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href="/settings" className="rounded-lg border border-line px-3 py-1.5 text-center text-[13px] font-medium hover:bg-surface-2">
                  Settings
                </Link>
                <Link href="/settings/security" className="rounded-lg border border-line px-3 py-1.5 text-center text-[13px] font-medium hover:bg-surface-2">
                  Password
                </Link>
              </div>
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
            <SideNav groups={navGroups} />
            <p className="border-t border-line/70 px-4 py-4 text-[11px] leading-relaxed text-muted/70">
              {settings.organisationName}
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
