"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "./ui";
import {
  IconApplications,
  IconBuilding,
  IconClock,
  IconCommission,
  IconDashboard,
  IconEnquiry,
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
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; soon?: string };
export type NavGroup = { title: string; items: NavItem[] };

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

function Item({ item, isActive, onNavigate }: { item: NavItem; isActive: boolean; onNavigate?: () => void }) {
  const Icon = ICONS[item.icon];
  if (item.soon) {
    return (
      <span
        className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted/60"
        title={`Planned for phase ${item.soon.replace("P", "")}`}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{item.soon}</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-sm font-medium transition-colors",
        isActive ? "bg-brand-50 text-brand-700" : "text-ink-soft hover:bg-surface-2 hover:text-ink",
      )}
    >
      {/* A marker on the edge, so the active item reads at a glance down the column. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full transition-all",
          isActive ? "bg-brand-600" : "bg-transparent",
        )}
      />
      <Icon className={cn("size-[18px] shrink-0", isActive ? "text-brand-600" : "text-muted")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Groups({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const active = useActive(groups);
  return (
    <nav aria-label="Main" className="space-y-5 p-3">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/70">{group.title}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Item key={item.href} item={item} isActive={active(item.href)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  return <Groups groups={groups} />;
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
            <Groups groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
