import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";
import type { StatusGroup } from "@/db/schema";

export function cn(...args: Parameters<typeof clsx>) {
  return twMerge(clsx(...args));
}

/* ---------------- Brand ---------------- */

export function Logo({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
        <path d="M6 26C6 15.5 11.2 7.6 20.4 4c-1.1 4.9-3 8.7-5.6 11.6C12.1 18.6 9.2 22 6 26z" fill="var(--color-gold-400)" />
        <path d="M13 26c0-9 4.5-15.9 13-19.4-1 4.6-2.8 8.2-5.2 11C18.3 20.3 15.8 23 13 26z" fill={tone === "light" ? "#fff" : "var(--color-brand-600)"} />
      </svg>
      <span className="leading-none">
        <span className={cn("block font-display text-[15px] font-bold tracking-tight", tone === "light" ? "text-white" : "text-ink")}>
          MEDCITY
        </span>
        <span className={cn("block text-[10px] font-semibold tracking-[0.18em]", tone === "light" ? "text-white/80" : "text-brand-600")}>
          OVERSEAS
        </span>
      </span>
    </span>
  );
}

/* ---------------- Buttons ---------------- */

const btn = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  size: { sm: "px-2.5 py-1.5 text-[13px]", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5" },
  variant: {
    primary: "bg-brand-600 text-white shadow-[0_1px_0_rgba(0,0,0,0.04)] hover:bg-brand-700",
    secondary: "border border-line-strong bg-surface text-ink hover:border-brand-300 hover:text-brand-700",
    quiet: "text-muted hover:bg-brand-50 hover:text-brand-700",
    danger: "border border-stop-500/40 bg-surface text-stop-500 hover:bg-stop-50",
    gold: "bg-gold-400 text-ink hover:bg-gold-300",
  },
};
type Variant = keyof typeof btn.variant;
type Size = keyof typeof btn.size;

export function Button({ variant = "primary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={cn(btn.base, btn.size[size], btn.variant[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cn(btn.base, btn.size[size], btn.variant[variant], className)} {...props} />;
}

/* ---------------- Form controls ---------------- */

const field =
  "block w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-muted/60 hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-surface-2 disabled:text-muted";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236c6374' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")" }} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-20 leading-relaxed", className)} {...props} />;
}

export function Field({ label, htmlFor, children, hint, required }: { label: string; htmlFor: string; children: ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
        {required && <span className="text-brand-600"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-line-strong text-brand-600 accent-brand-600" {...props} />
      <span>{label}</span>
    </label>
  );
}

/* ---------------- Surfaces ---------------- */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div>
        <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-surface p-3 shadow-card", className)}>{children}</div>;
}

/* ---------------- Status and chips ---------------- */

const groupStyle: Record<StatusGroup, string> = {
  NEW: "bg-surface-2 text-ink-soft ring-line-strong",
  PENDING_PARTNER: "bg-warn-50 text-warn-700 ring-warn-500/25",
  IN_PROGRESS: "bg-info-50 text-info-700 ring-info-500/25",
  OFFER: "bg-good-50 text-good-700 ring-good-500/25",
  SUCCESS: "bg-good-500 text-white ring-good-700/20",
  HOLD: "bg-surface-2 text-muted ring-line-strong",
  CLOSED: "bg-stop-50 text-stop-700 ring-stop-500/25",
};

export function StatusBadge({ group, label, className }: { group: StatusGroup; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-xs font-medium leading-5 ring-1 ring-inset", groupStyle[group], className)}>
      {label}
    </span>
  );
}

const chipTone = {
  neutral: "bg-surface-2 text-ink-soft ring-line-strong",
  ok: "bg-good-50 text-good-700 ring-good-500/25",
  warn: "bg-warn-50 text-warn-700 ring-warn-500/25",
  bad: "bg-stop-50 text-stop-700 ring-stop-500/25",
  info: "bg-info-50 text-info-700 ring-info-500/25",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  gold: "bg-gold-400/20 text-[#7a5c00] ring-gold-500/30",
};

export function Chip({ tone = "neutral", children, className }: { tone?: keyof typeof chipTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", chipTone[tone], className)}>{children}</span>;
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white", className)}>{children}</span>;
}

/* ---------------- Data display ---------------- */

export function Stat({ label, value, tone = "brand", href, icon }: { label: string; value: ReactNode; tone?: "brand" | "good" | "warn" | "stop" | "info"; href?: string; icon?: ReactNode }) {
  const tones = {
    brand: "text-brand-600 bg-brand-50",
    good: "text-good-500 bg-good-50",
    warn: "text-warn-500 bg-warn-50",
    stop: "text-stop-500 bg-stop-50",
    info: "text-info-500 bg-info-50",
  };
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {icon && <span className={cn("grid size-7 place-items-center rounded-lg", tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 font-display text-[26px] font-semibold leading-none tabular text-ink">{value}</p>
    </>
  );
  const shell = "rounded-xl border border-line bg-surface p-3.5 shadow-card";
  return href ? (
    <Link href={href} className={cn(shell, "transition-colors hover:border-brand-300 hover:bg-brand-50/40")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      {icon && <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">{icon}</div>}
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Table({ children, className, tableClassName }: { children: ReactNode; className?: string; tableClassName?: string }) {
  return (
    <div className={cn("thin-scroll overflow-x-auto", className)}>
      <table className={cn("w-full border-collapse text-left text-sm", tableClassName)}>{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("sticky top-0 z-10 border-b border-line bg-surface-2/95 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted backdrop-blur", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line px-3 py-3 align-top", className)}>{children}</td>;
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "bad" | "ok" | "warn"; children: ReactNode; title?: string }) {
  const tones = {
    info: "border-info-500/25 bg-info-50 text-info-700",
    warn: "border-warn-500/25 bg-warn-50 text-warn-700",
    bad: "border-stop-500/25 bg-stop-50 text-stop-700",
    ok: "border-good-500/25 bg-good-50 text-good-700",
  };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-lg border px-3.5 py-2.5 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function Progress({ value, max = 100, tone = "brand" }: { value: number; max?: number; tone?: "brand" | "gold" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
      <div className={cn("h-full rounded-full", tone === "brand" ? "bg-brand-600" : "bg-gold-400")} style={{ width: `${pct}%` }} />
    </div>
  );
}
