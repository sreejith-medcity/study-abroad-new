"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

/**
 * Settings reads best in a narrow column, except the permissions matrix, which
 * is ten columns wide and unreadable squeezed into one.
 */
const WIDE = ["/settings/access"];

export function SettingsWidth({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div className={cn("space-y-5", WIDE.includes(path) ? undefined : "max-w-3xl")}>{children}</div>;
}
