import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";
import type { StatusGroup } from "@/db/schema";

export function cn(...args: Parameters<typeof clsx>) {
  return twMerge(clsx(...args));
}

const btn = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50",
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-brand-600 bg-white text-brand-600 hover:bg-brand-50",
  ghost: "text-muted hover:bg-white hover:text-ink",
  danger: "border border-red-600 bg-white text-red-600 hover:bg-red-50",
};
type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(btn.base, btn[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(btn.base, btn[variant], className)} {...props} />;
}

const field = "block w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-ground";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, className)} {...props} />;
}

export function Field({ label, htmlFor, children, hint, required }: { label: string; htmlFor: string; children: ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-line bg-white", className)} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const groupStyle: Record<StatusGroup, string> = {
  NEW: "bg-slate-100 text-slate-700",
  PENDING_PARTNER: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-brand-50 text-brand-700",
  OFFER: "bg-emerald-100 text-emerald-800",
  SUCCESS: "bg-emerald-600 text-white",
  HOLD: "bg-sky-100 text-sky-800",
  CLOSED: "bg-red-100 text-red-700",
};

export function StatusBadge({ group, label, className }: { group: StatusGroup; label: string; className?: string }) {
  return <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium leading-5", groupStyle[group], className)}>{label}</span>;
}

export function Chip({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    ok: "bg-emerald-100 text-emerald-800",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-100 text-red-700",
    info: "bg-brand-50 text-brand-700",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-muted">{children}</div>}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("border-b border-line bg-ground/60 px-3 py-2.5 text-xs font-semibold text-muted", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line px-3 py-3 align-top", className)}>{children}</td>;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "bad" | "ok"; children: ReactNode }) {
  const tones = { info: "border-brand-100 bg-brand-50 text-brand-700", bad: "border-red-200 bg-red-50 text-red-700", ok: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  return <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", tones[tone])}>{children}</div>;
}
