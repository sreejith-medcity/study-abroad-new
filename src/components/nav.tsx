"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "./ui";
import {
  IconApplications,
  IconBuilding,
  IconCalendar,
  IconClock,
  IconCommission,
  IconDashboard,
  IconEnquiry,
  IconChat,
  IconCheck,
  IconFlow,
  IconGlobe,
  IconInsights,
  IconLearning,
  IconMenu,
  IconPartners,
  IconPrograms,
  IconQueue,
  IconSearch,
  IconSettings,
  IconShield,
  IconSpark,
  IconStudents,
  IconWallet,
} from "./icons";

const ICONS = {
  dashboard: IconDashboard,
  students: IconStudents,
  applications: IconApplications,
  search: IconSearch,
  queue: IconQueue,
  wallet: IconWallet,
  commission: IconCommission,
  enquiry: IconEnquiry,
  learning: IconLearning,
  programs: IconPrograms,
  partners: IconPartners,
  flow: IconFlow,
  insights: IconInsights,
  shield: IconShield,
  settings: IconSettings,
  spark: IconSpark,
  universities: IconBuilding,
  deadlines: IconClock,
  services: IconGlobe,
  events: IconCalendar,
  support: IconChat,
  training: IconCheck,
} as const;

export type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  soon?: string;
  /** What is waiting behind this entry, when it is worth saying. */
  count?: number;
  /** Red for late, amber for waiting. Left out, the badge is quiet. */
  tone?: "stop" | "warn";
};
export type NavGroup = {
  title: string;
  items: NavItem[];
  /**
   * A group that is shut until somebody wants it: the configuration screens,
   * which are read once a quarter and otherwise sit between a counsellor and
   * the work. It opens itself when the page you are on is inside it.
   */
  folded?: boolean;
};

/**
 * Only the most specific match lights up. Without this, /settings/platform marks
 * both "Platform settings" and the Account "Settings" entry, which reads as two
 * places at once.
 */
function useActive(groups: NavGroup[]) {
  const path = usePathname();
  const matches = groups
    .flatMap((g) => g.items)
    .map((i) => i.href)
    .filter((href) => path === href || path.startsWith(`${href}/`));
  const best = matches.sort((a, b) => b.length - a.length)[0];
  return (href: string) => href === best;
}

const badgeTone = {
  stop: "bg-stop-500 text-white",
  warn: "bg-warn-500 text-white",
  quiet: "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line-strong",
} as const;

/** The number waiting behind an entry, or nothing at all when there is none. */
function Badge({ item, rail }: { item: NavItem; rail: boolean }) {
  if (!item.count) return null;
  const tone = item.tone ?? "quiet";
  if (rail) {
    // No room for a figure on the rail, so it becomes a dot: enough to send
    // somebody looking, which is all a collapsed menu has to do.
    return (
      <span
        aria-hidden="true"
        className={cn("absolute right-0.5 top-0.5 size-2.5 rounded-full ring-2 ring-surface", tone === "quiet" ? "bg-line-strong" : badgeTone[tone].split(" ")[0])}
      />
    );
  }
  return (
    <span className={cn("ml-auto min-w-[1.35rem] rounded-full px-1.5 py-px text-center text-[11px] font-bold tabular", badgeTone[tone])}>
      {item.count > 99 ? "99+" : item.count}
    </span>
  );
}

function Item({ item, isActive, rail, onNavigate }: { item: NavItem; isActive: boolean; rail: boolean; onNavigate?: () => void }) {
  const Icon = ICONS[item.icon];
  const waiting = item.count ? `, ${item.count} waiting` : "";
  if (item.soon) {
    return (
      <span
        className={cn("flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted/60", rail && "justify-center px-0")}
        title={`${item.label} — planned for phase ${item.soon.replace("P", "")}`}
      >
        <Icon className="size-[18px] shrink-0" />
        {!rail && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{item.soon}</span>
          </>
        )}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      title={rail ? `${item.label}${waiting}` : undefined}
      aria-label={rail ? `${item.label}${waiting}` : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors",
        rail ? "mx-auto size-10 justify-center" : "py-2 pl-3 pr-2",
        isActive
          ? rail
            ? "bg-brand-600 text-white shadow-card"
            : "bg-brand-50 text-brand-700"
          : "text-ink-soft hover:bg-surface-2 hover:text-ink",
      )}
    >
      {/* A marker on the edge, so the active item reads at a glance down the
          column. On the rail the whole square is filled instead: a hairline
          beside a centred icon is not something anybody notices. */}
      {!rail && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full transition-all",
            isActive ? "h-4 bg-brand-600" : "h-0 bg-transparent",
          )}
        />
      )}
      <Icon className={cn("size-[18px] shrink-0 transition-colors", isActive ? (rail ? "text-white" : "text-brand-600") : "text-muted group-hover:text-ink-soft")} />
      {!rail && <span className="truncate">{item.label}</span>}
      <Badge item={item} rail={rail} />
    </Link>
  );
}

const OPEN_KEY = "portal-nav-open";

/**
 * Which groups are open.
 *
 * The first render has to be the same on the server and in the browser, so it
 * is worked out from the address alone: the group holding the page you are on
 * is open and the rest are shut. What somebody actually left open is read
 * from the browser a moment later, once there is a browser to read it from.
 */
function useOpenGroups(groups: NavGroup[], holdsActive: (g: NavGroup) => boolean) {
  const [remembered, setRemembered] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      setRemembered(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch {
      // Private browsing, or storage turned off, or somebody's half-written
      // JSON. The menu still works; it just forgets between visits.
      setRemembered({});
    }
  }, []);

  const isOpen = (group: NavGroup) => {
    // Whatever else is remembered, the group you are standing in is open.
    if (holdsActive(group)) return true;
    if (remembered && group.title in remembered) return remembered[group.title];
    return false;
  };

  const toggle = (group: NavGroup, open: boolean) => {
    const next = { ...(remembered ?? {}), [group.title]: open };
    setRemembered(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // Nothing to do.
    }
  };

  // Used to leave the group transitions alone until the remembered state has
  // arrived, so nothing is seen springing open on the way in.
  return { isOpen, toggle, settled: remembered !== null, groups };
}

function Groups({ groups, rail, onNavigate }: { groups: NavGroup[]; rail: boolean; onNavigate?: () => void }) {
  const active = useActive(groups);
  const holdsActive = (g: NavGroup) => g.items.some((i) => active(i.href));
  const { isOpen, toggle } = useOpenGroups(groups, holdsActive);

  return (
    <nav aria-label="Main" className={cn(rail ? "space-y-2 px-2 py-3" : "space-y-1 p-3")}>
      {groups.map((group) => {
        const items = group.items;
        const here = holdsActive(group);
        // Put away, the menu is the screens somebody works in. A column of
        // thirty icons is not a rail, and nobody collapses the menu in order
        // to reach the configuration screens faster. They are one click away
        // again the moment it is opened.
        if (rail && group.folded && !here) return null;
        // What is waiting inside, which is the whole reason a shut group is
        // still worth looking at.
        const waiting = items.reduce((n, i) => n + (i.count ?? 0), 0);
        const urgent = items.some((i) => i.count && i.tone === "stop");

        if (rail) {
          return (
            <div key={group.title}>
              {/* A rule rather than a word: the groups still read as groups
                  without a label nobody can see at this width. */}
              <div aria-hidden="true" className="mx-2 mb-2 border-t border-line first:hidden" />
              <div className="space-y-0.5">
                {items.map((item) => (
                  <Item key={item.href} item={item} isActive={active(item.href)} rail onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          );
        }

        const open = isOpen(group);
        return (
          <details
            key={group.title}
            open={open}
            onToggle={(e) => {
              const next = e.currentTarget.open;
              if (next !== open) toggle(group, next);
            }}
            className="group/fold"
          >
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors",
                here ? "text-brand-700" : "text-muted/70 hover:text-ink-soft",
              )}
            >
              <span className="truncate">{group.title}</span>
              {/* Shut, this is the only thing the group can tell you. */}
              {waiting > 0 && !open && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-bold tabular tracking-normal",
                    urgent ? "bg-stop-500 text-white" : "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line-strong",
                  )}
                >
                  {waiting > 99 ? "99+" : waiting}
                </span>
              )}
              <span aria-hidden="true" className="ml-auto text-[13px] leading-none transition-transform group-open/fold:rotate-90">
                &rsaquo;
              </span>
            </summary>
            <div className="mb-1 mt-0.5 space-y-0.5">
              {items.map((item) => (
                <Item key={item.href} item={item} isActive={active(item.href)} rail={false} onNavigate={onNavigate} />
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}

const RAIL_KEY = "portal-nav-rail";

/**
 * The side menu, which can be put away.
 *
 * A counsellor working a wide table wants the screen back, and an admin who
 * knows the portal does not need the words. Collapsed it is a column of
 * icons with the counts still on them as dots, so putting it away does not
 * mean losing what is waiting.
 *
 * The choice is remembered in the browser rather than on the account: it is a
 * preference about this screen, and the same person on a laptop and a large
 * monitor will want different answers.
 */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  // Open until told otherwise, and read after mount so the server and the
  // browser render the same thing: the width is written by CSS on the parent,
  // which is told about it through the data attribute below.
  const [rail, setRail] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setRail(localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      // Private browsing, or storage turned off. Open is the right default.
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(RAIL_KEY, rail ? "1" : "0");
    } catch {
      // Nothing to do; the menu still works, it just forgets.
    }
    document.documentElement.dataset.navRail = rail ? "1" : "0";
  }, [rail, ready]);

  return (
    <div className="flex h-full flex-col">
      <Groups groups={groups} rail={rail} />
      <button
        type="button"
        onClick={() => setRail((v) => !v)}
        aria-pressed={rail}
        title={rail ? "Show the menu" : "Put the menu away"}
        className={cn(
          "mx-3 mb-2 mt-auto flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink",
          rail && "mx-2 justify-center px-0",
        )}
      >
        <span aria-hidden="true" className={cn("text-[14px] leading-none transition-transform", rail && "rotate-180")}>
          &lsaquo;&lsaquo;
        </span>
        {!rail && <span>Put the menu away</span>}
      </button>
    </div>
  );
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-lg text-white/90 hover:bg-white/10 md:hidden"
      >
        <IconMenu />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/40" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto bg-surface shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-sm font-semibold">Menu</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2">
                Close
              </button>
            </div>
            <Groups groups={groups} rail={false} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
