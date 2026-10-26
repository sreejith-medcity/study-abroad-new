import Link from "next/link";
import { aiConfig } from "@/server/ai";
import { commissionVisible } from "@/server/commission-visibility";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { MobileNav, SideNav, type NavGroup } from "@/components/nav";
import { CommandPalette } from "@/components/palette";
import { PopMenu } from "@/components/pop-menu";
import { ToastHost } from "@/components/toast";
import { cn } from "@/components/ui";
import { BrandLogo, BrandStyle } from "@/components/brand";
import { IconBell, IconLogout } from "@/components/icons";
import { logoutAction } from "@/app/login/actions";
import { APP_ROLES, PARTNER_ROLES, ROLE_LABEL, isAdmin, isSuperAdmin } from "@/lib/permissions";
import { getSettings } from "@/server/settings";
import { navCounts } from "@/server/nav-counts";
import { journalTick, journalWaiting } from "@/server/journal";
import { JournalPopup } from "@/components/journal-popup";
import { APP_VERSION } from "@/lib/version";
import { journalIssued } from "@/lib/journal";

/*
  The branch menu, in the order of a branch's day: who to see today, the
  students, the applications, finding a course, the money, and then the
  things read now and then, folded.
*/
const partnerNav = (home: string): NavGroup[] => [
  {
    title: "Today",
    items: [
      { href: "/dashboard", label: home, icon: "dashboard" },
      { href: "/my-day", label: "My day", icon: "queue" },
      { href: "/enquiries", label: "Enquiries", icon: "enquiry" },
    ],
  },
  {
    title: "Students",
    items: [
      { href: "/students", label: "Students", icon: "students" },
      { href: "/students/board", label: "By stage", icon: "flow" },
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/program-options", label: "Program options", icon: "spark" },
      { href: "/ausbildung", label: "Placement tracker", icon: "services" },
    ],
  },
  {
    title: "Find a course",
    items: [
      { href: "/finder", label: "Course finder", icon: "spark" },
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/wallet", label: "Wallet", icon: "wallet" },
      { href: "/commission", label: "Commission", icon: "commission" },
      { href: "/admin/income", label: "Income", icon: "insights" },
      { href: "/promotions", label: "Schemes", icon: "spark" },
    ],
  },
  {
    title: "Help",
    items: [
      { href: "/support", label: "Help desk", icon: "support" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/contacts", label: "Contacts", icon: "partners" },
      { href: "/checklists", label: "Document checklists", icon: "training" },
    ],
  },
  {
    title: "More",
    folded: true,
    items: [
      { href: "/updates", label: "Updates", icon: "spark" },
      { href: "/events", label: "Events", icon: "events" },
      { href: "/training", label: "Training", icon: "training" },
      // Who changed what on their own files, or the branch's for a branch head.
      { href: "/admin/history", label: "Change history", icon: "shield" },
    ],
  },
];

/**
 * Finding a group by something in it rather than by its title.
 *
 * The assistant and the practice interview were added to the group titled
 * "Find programs"; the group was renamed "Find a course" and both entries
 * fell out of every menu, silently, for months. A title is wording and will
 * be rewritten. An address is the thing itself, so the four places that pick
 * a group out of this list pick it by one.
 */
const holds = (href: string) => (g: NavGroup) => g.items.some((i) => i.href === href);
const MONEY = holds("/wallet");

const PARTNER_NAV = partnerNav("Dashboard");
// The branch's income is the branch head's screen: a counsellor is refused by
// it, and a link that refuses the person who was shown it is worse than no
// link.
const COUNSELLOR_NAV = partnerNav("My desk").map((g) =>
  MONEY(g) ? { ...g, items: g.items.filter((i) => i.href !== "/admin/income") } : g,
);

/*
  The staff menu, in groups somebody could name.

  It used to be five groups of eleven, ten, eleven, four and one, and the
  first of them held a dashboard, two queues, a desk, students, applications,
  a board, programme options, services and the help desk. That is not a
  group, it is a list with a heading on it, and a list of eleven is read by
  scanning every time.

  Seven groups now, none longer than five, in the order of a working day:
  what is on today, the files, the work the desk does, finding a course, the
  people, the money, and then everything that is set up once and read twice a
  year, which is shut by default rather than sitting between a counsellor and
  their morning.
*/
const ADMIN_NAV: NavGroup[] = [
  {
    title: "Today",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/my-day", label: "My day", icon: "queue" },
      { href: "/admin/queue", label: "Work queue", icon: "queue" },
      { href: "/admin/desk", label: "The Overseas desk", icon: "flow" },
    ],
  },
  {
    title: "Students",
    items: [
      { href: "/students", label: "Students", icon: "students" },
      { href: "/students/board", label: "By stage", icon: "flow" },
      { href: "/enquiries", label: "Enquiries", icon: "enquiry" },
      { href: "/program-options", label: "Program options", icon: "spark" },
      { href: "/ausbildung", label: "Placement tracker", icon: "services" },
    ],
  },
  {
    title: "Applications",
    items: [
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/documentation", label: "Documentation", icon: "applications" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
      { href: "/admin/services", label: "Services", icon: "services" },
      { href: "/checklists", label: "Document checklists", icon: "training" },
    ],
  },
  {
    title: "Find a course",
    items: [
      { href: "/finder", label: "Course finder", icon: "spark" },
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/admin/scholarships", label: "Scholarships", icon: "spark" },
    ],
  },
  {
    title: "Network",
    items: [
      { href: "/admin/partners", label: "Partners", icon: "partners" },
      { href: "/admin/teams", label: "Teams", icon: "partners" },
      { href: "/admin/agents", label: "Sub-agents", icon: "partners" },
      { href: "/admin/contacts", label: "Contacts and links", icon: "partners" },
      { href: "/admin/events", label: "Events", icon: "events" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/commission", label: "Commission", icon: "commission" },
      { href: "/admin/income", label: "Income and rate cards", icon: "insights" },
      { href: "/admin/invoices", label: "Invoices", icon: "commission" },
      { href: "/admin/payments", label: "Online payments", icon: "wallet" },
      // Targets are set in rupees and registrations against the money above,
      // which keeps Reports short enough to read at a glance.
      { href: "/targets", label: "Targets", icon: "insights" },
    ],
  },
  {
    title: "Reports",
    items: [
      { href: "/admin/insights", label: "Insights", icon: "insights" },
      { href: "/journal/report", label: "Day end reports", icon: "deadlines" },
      { href: "/reports/lost-reasons", label: "Lost reasons", icon: "enquiry" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/support", label: "Help desk", icon: "support" },
    ],
  },
  {
    // Who changed what, and who owned which file when: read when something
    // has to be traced, so it is shut until then.
    title: "Records",
    folded: true,
    items: [
      { href: "/admin/history", label: "Change history", icon: "shield" },
      { href: "/admin/ledger", label: "Ownership ledger", icon: "shield" },
    ],
  },
  {
    // Shut unless you are in it. Set once, read twice a year.
    title: "Set up",
    folded: true,
    items: [
      // Whether the portal is well: release, database, documents, scheduled
      // jobs. Read after a deploy, not daily, so it sits with the set-up screens.
      { href: "/admin/system", label: "System", icon: "shield" },
      { href: "/admin/programs", label: "Programs", icon: "programs" },
      { href: "/admin/documents", label: "Documents and rules", icon: "applications" },
      { href: "/admin/statuses", label: "Status flows", icon: "flow" },
      { href: "/admin/destinations", label: "Destinations", icon: "universities" },
      { href: "/admin/vendors", label: "Vendors and routes", icon: "partners" },
      { href: "/admin/prep", label: "Test prep", icon: "learning" },
      { href: "/admin/training", label: "Training", icon: "training" },
      { href: "/admin/updates", label: "Updates", icon: "spark" },
      { href: "/admin/promotions", label: "Schemes", icon: "commission" },
    ],
  },
];

const PLATFORM_NAV: NavGroup = {
  title: "Platform",
  items: [
    { href: "/admin/audit", label: "Audit log", icon: "shield" },
    { href: "/admin/integrations", label: "The CRM link", icon: "flow" },
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
      { href: "/checklists", label: "Document checklists", icon: "training" },
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/events", label: "Events", icon: "events" },
    ],
  },
];

/**
 * Whoever runs the documentation desk: the officers' own screens, plus the two
 * they run the desk with.
 *
 * Built from the officers' nav rather than the counsellors', because a team
 * leader is at the head office. Falling through to a branch counsellor's nav is
 * how they came to be offered a wallet, a branch's enquiries and program
 * options, none of which open to them.
 */
const TEAM_LEAD_NAV: NavGroup[] = [
  {
    title: "The desk",
    items: [
      { href: "/dashboard", label: "The desk", icon: "dashboard" },
      { href: "/documentation", label: "Documentation", icon: "applications" },
      { href: "/admin/queue", label: "Work queue", icon: "queue" },
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/students", label: "Students", icon: "students" },
      { href: "/admin/services", label: "Services", icon: "services" },
    ],
  },
  {
    title: "What the desk works to",
    items: [
      { href: "/admin/documents", label: "Documents and requirements", icon: "applications" },
      { href: "/checklists", label: "Document checklists", icon: "training" },
      { href: "/search", label: "Search programs", icon: "search" },
      { href: "/universities", label: "Universities", icon: "universities" },
      { href: "/deadlines", label: "Deadlines", icon: "deadlines" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/events", label: "Events", icon: "events" },
    ],
  },
];

/**
 * A counsellor at the head office rather than at a branch, so the branch's own
 * screens come out: no wallet, no commission, no branch enquiries, and no
 * program options, which are requested by a branch of the desk.
 */
const DESK_COUNSELLOR_NAV: NavGroup[] = partnerNav("My desk")
  .filter((g) => !MONEY(g))
  .map((g) => ({ ...g, items: g.items.filter((i) => !["/enquiries", "/program-options"].includes(i.href)) }));

/**
 * Finance: the money, and nothing that is not the money.
 *
 * No students, no applications, no documents and no catalogue. Everything here
 * is a screen about what is owed, what has been invoiced and what came in,
 * which is the whole of the job.
 */
const FINANCE_NAV: NavGroup[] = [
  {
    title: "Money",
    items: [
      { href: "/dashboard", label: "The money", icon: "dashboard" },
      { href: "/admin/invoices", label: "Invoices", icon: "commission" },
      { href: "/admin/income", label: "Income", icon: "insights" },
      { href: "/admin/commission", label: "Commission", icon: "commission" },
      { href: "/admin/payments", label: "Online payments", icon: "wallet" },
    ],
  },
  {
    title: "Who it is with",
    items: [
      // Vendors and routes carry the commission terms, which are an admin's to
      // set; finance reads what a route pays through the invoice queue.
      { href: "/admin/billing", label: "Billing companies", icon: "partners" },
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
      { href: "/ausbildung", label: "Placement tracker", icon: "services" },
      { href: "/admin/commission", label: "Commission", icon: "commission" },
      { href: "/admin/insights", label: "Insights", icon: "insights" },
      { href: "/journal/report", label: "Day end reports", icon: "deadlines" },
      { href: "/reports/lost-reasons", label: "Lost reasons", icon: "enquiry" },
      { href: "/learning", label: "Learning resources", icon: "learning" },
      { href: "/admin/history", label: "Change history", icon: "shield" },
      { href: "/admin/ledger", label: "Ownership ledger", icon: "shield" },
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
        : user.role === "APPLICATION_TEAM_LEADER"
          ? TEAM_LEAD_NAV
          : user.role === "FINANCE"
            ? FINANCE_NAV
          : user.role === "DESK_COUNSELLOR"
            ? DESK_COUNSELLOR_NAV
            : user.role === "MANAGEMENT"
              ? MANAGEMENT_NAV
              : user.role === "PARTNER"
                ? PARTNER_NAV
                : (await commissionVisible(user))
                  ? COUNSELLOR_NAV
                  : COUNSELLOR_NAV.filter((g) => !MONEY(g));

  // The AI pages appear for branches only once the owner has switched them on.
  const ai = await aiConfig();
  const aiItems = [
    ...(ai?.enabled && ai.features.assistant ? [{ href: "/assistant", label: "Assistant", icon: "spark" as const }] : []),
    ...(ai?.enabled && ai.features.interview ? [{ href: "/interview", label: "Practice interview", icon: "learning" as const }] : []),
  ];
  // They belong beside the course search, and which group that is was looked
  // up by its title until the title changed and both entries quietly
  // disappeared from every menu. The group is found by what is in it now, and
  // if a role has no course group the entries get one of their own rather
  // than going missing again.
  const withAi = (() => {
    if (aiItems.length === 0) return groups;
    const at = groups.findIndex((g) => holds("/search")(g) || holds("/finder")(g));
    if (at === -1) return [...groups, { title: "Ask the portal", items: aiItems }];
    return groups.map((g, i) => (i === at ? { ...g, items: [...g.items, ...aiItems] } : g));
  })();
  // Bulk upload is for branch owners and the team.
  const withImports = withAi.map((g, i) =>
    i === 0 && (user.role === "PARTNER" || isAdmin(user)) ? { ...g, items: [...g.items, { href: "/imports", label: "Bulk upload", icon: "applications" as const }] } : g,
  );
  // A sub-agent refers rather than only registering, and is held to an
  // agreement. Both screens are theirs alone: a branch has no referrals of its
  // own and nothing to accept.
  const subAgent = user.orgType === "SUB_AGENT" && (PARTNER_ROLES as readonly string[]).includes(user.role);
  const menu: NavGroup[] = [
    ...withImports,
    ...(subAgent
      ? [
          {
            title: "Referrals",
            items: [
              { href: "/referrals", label: "My referrals", icon: "enquiry" as const },
              { href: "/agreement", label: "Agreement", icon: "shield" as const },
            ],
          },
        ]
      : []),
    {
      title: "Account",
      items: [
        // The day end report, for everybody who is issued one.
        ...(journalIssued(user.role, user.orgType) ? [{ href: "/journal", label: "Day end report", icon: "deadlines" as const }] : []),
        // A branch head sets their people's monthly targets, and reads the
        // month of their own branch's day end figures.
        ...(user.role === "PARTNER" ? [{ href: "/targets", label: "Targets", icon: "insights" as const }] : []),
        ...(user.role === "PARTNER" && journalIssued(user.role, user.orgType) ? [{ href: "/journal/report", label: "Day end figures", icon: "deadlines" as const }] : []),
        // Why the branch's enquiries were lost.
        ...(user.role === "PARTNER" && user.orgType === "BRANCH" ? [{ href: "/reports/lost-reasons", label: "Lost reasons", icon: "enquiry" as const }] : []),
        { href: "/settings", label: "Settings", icon: "settings" },
      ],
    },
  ];

  // Four things the shell needs, asked for together rather than one after
  // another: on a page that renders quickly the waiting was most of the wait.
  // The day end reports move with the clock even where no scheduler was set up:
  // whoever opens a page after the day ends announces it, and after the cutoff
  // closes it. At most once every few minutes per server.
  await journalTick();
  const journalDue = await journalWaiting(user);

  const [settings, counts, unreadRows, me] = await Promise.all([
    getSettings(),
    navCounts(user),
    db
      .select({ unread: count() })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))),
    // What's New carries a dot until the person has opened it since the newest item.
    db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { whatsNewSeenAt: true } }),
  ]);
  const unread = unreadRows[0]?.unread ?? 0;

  // The numbers go onto the menu here rather than inside it, so the menu
  // itself stays a plain list of where you can go and nothing in the browser
  // has to know how a count is worked out.
  const navGroups: NavGroup[] = menu.map((g) => ({
    ...g,
    items: g.items.map((i) => (counts[i.href] ? { ...i, count: counts[i.href].count, tone: counts[i.href].tone } : i)),
  }));
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
        <span className="relative z-10 ml-1 hidden text-sm text-white/70 lg:inline">{user.orgName}</span>

        <div className="relative z-10 ml-auto flex items-center gap-1.5">
          <CommandPalette groups={navGroups} />
          <Link href="/whats-new" className="relative hidden items-center rounded-lg px-2.5 py-2 text-sm font-medium text-white/90 hover:bg-white/10 sm:flex">
            What&apos;s new
            {freshNews && <span className="ml-1 size-2 rounded-full bg-gold-400" aria-label="New items" />}
          </Link>
          <PopMenu
            label={`Notifications, ${unread} unread`}
            className="group"
            triggerClassName="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-white/90 transition-colors hover:bg-white/10"
            panelClassName="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-pop"
            trigger={
              <>
                <IconBell />
                {unread > 0 && <span className="rounded-full bg-gold-400 px-1.5 text-2xs font-bold text-ink tabular">{unread}</span>}
              </>
            }
          >
            <>
              <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                <span className="font-display text-md font-semibold">Notifications</span>
                <Link href="/notifications" className="text-sm font-medium text-brand-600 hover:underline">
                  View all
                </Link>
              </div>
              {latest.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
              ) : (
                <ul className="max-h-[22rem] overflow-y-auto">
                  {latest.map((n) => (
                    <li key={n.id} className="border-b border-line last:border-0">
                      <Link href={`/notifications/${n.id}`} className="flex gap-2.5 px-3.5 py-2.5 hover:bg-surface-2">
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                        <span className="min-w-0">
                          <span className={cn("block truncate text-md", n.readAt ? "text-ink-soft" : "font-semibold text-ink")}>{n.title}</span>
                          {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                          <span className="block text-2xs text-muted/80">{fmtDateTime(n.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          </PopMenu>

          <PopMenu
            label={`${user.name}, account menu`}
            triggerClassName="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2.5 text-white transition-colors hover:bg-white/10"
            panelClassName="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-surface p-3.5 text-ink shadow-pop"
            trigger={
              <>
                <span className="grid size-8 place-items-center rounded-full bg-white/15 font-display text-sm font-semibold">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-medium">{user.name.split(" ")[0]}</span>
                  <span className="block text-2xs text-white/70">{ROLE_LABEL[user.role]}</span>
                </span>
                <span aria-hidden="true" className="text-white/70">▾</span>
              </>
            }
          >
            <>
              <p className="font-display text-md font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
              <p className="mt-1 text-xs text-muted">
                {user.orgName} · {ROLE_LABEL[user.role]}
                {user.deskLabel ? ` · ${user.deskLabel}` : ""}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href="/settings" className="rounded-lg border border-line px-3 py-1.5 text-center text-sm font-medium hover:bg-surface-2">
                  Settings
                </Link>
                <Link href="/settings/security" className="rounded-lg border border-line px-3 py-1.5 text-center text-sm font-medium hover:bg-surface-2">
                  Password
                </Link>
              </div>
              <form action={logoutAction} className="mt-2">
                <button className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium hover:bg-brand-50 hover:text-brand-700">
                  <IconLogout className="size-4" /> Sign out
                </button>
              </form>
            </>
          </PopMenu>
        </div>
      </header>

      <div className="flex">
        <aside data-nav className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
          <div className="thin-scroll sticky top-16 flex max-h-[calc(100vh-4rem)] min-h-[calc(100vh-4rem)] flex-col overflow-y-auto overflow-x-hidden">
            <SideNav groups={navGroups} />
            {/* Hidden once the menu is put away: four characters and an
                ellipsis is not the name of a company. */}
            <p className="truncate border-t border-line/70 px-4 pt-3 text-2xs leading-relaxed text-muted/70 [[data-nav-rail='1']_&]:hidden">
              {settings.organisationName}
            </p>
            {/* Which release this is, so anybody can say which version they
                saw a problem on, and the desk can see a deploy has landed. */}
            <Link
              href="/whats-new"
              data-app-version
              className="block truncate px-4 pb-3 text-2xs leading-relaxed text-muted/70 hover:text-brand-700 [[data-nav-rail='1']_&]:hidden"
            >
              Version {APP_VERSION}
            </Link>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-[1400px]">
            {children}
          </div>
        </main>
        {/* From the end of the working day until it is answered: the day end
            report, over whatever page this is, and minimisable. */}
        {journalDue && <JournalPopup due={journalDue} />}
      </div>
    </div>
  );
}
