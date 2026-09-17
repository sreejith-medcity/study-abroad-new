"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

export type NavItem = { href: string; label: string; soon?: string };

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {items.map((item) => {
        const active = path === item.href || (item.href !== "/" && path.startsWith(item.href + "/")) || path === item.href;
        if (item.soon) {
          return (
            <span key={item.href} className="flex items-center justify-between rounded-md px-3 py-2 text-muted/70" title={`Planned for ${item.soon}`}>
              {item.label}
              <span className="rounded bg-ground px-1.5 text-[10px] font-medium">{item.soon}</span>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 font-medium",
              active ? "bg-brand-600 text-white" : "text-ink hover:bg-ground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
