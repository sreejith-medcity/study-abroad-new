import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNSELLING_ROLES, isStaff } from "@/lib/permissions";
import { DASHBOARD_KINDS, dashboardFor, kindLabel, mayViewAs } from "@/lib/dashboard-kinds";
import { PERIODS, type Lens } from "@/server/dashboard-lens";
import { LensBar } from "@/components/charts/lens-bar";
import { ViewAs } from "@/components/dashboard/view-as";
import { IconExport } from "@/components/icons";

/** A dashboard's own address with some of what it is looking at changed. */
export function hrefWith(sp: Record<string, string | string[] | undefined>, patch: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) q.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  const s = q.toString();
  return s ? `/dashboard?${s}` : "/dashboard";
}

/** The period links, for a layout that draws them itself. */
export function periodLinks(lens: Lens, sp: Record<string, string | string[] | undefined>) {
  return PERIODS.filter(([k]) => k !== "today").map(([k, label]) => ({ key: k, label, href: hrefWith(sp, { period: k === "all" ? null : k }), on: lens.period === k }));
}

/**
 * What every dashboard can be pointed at: a period, for the desk a branch,
 * and for the super admin and the ops manager, another job's dashboard.
 */
export async function Controls({ lens, periods = true }: { lens: Lens; periods?: boolean }) {
  const { user, kind } = lens;
  const staff = isStaff(user);
  // A branch picker means something where the dashboard reads more than one
  // branch: the desk's own, and anybody at the desk looking as a branch or a
  // counsellor. Money and documents are counted across the whole portal.
  const branchPicker = staff && (kind === "leadership" || kind === "desk" || (lens.viewingAs && (kind === "branch" || kind === "counsellor")));
  const people =
    lens.viewingAs && kind === "counsellor"
      ? await db
          .select({ id: schema.users.id, name: schema.users.name, branch: schema.organizations.name })
          .from(schema.users)
          .innerJoin(schema.organizations, eq(schema.users.orgId, schema.organizations.id))
          .where(and(eq(schema.users.active, true), inArray(schema.users.role, [...COUNSELLING_ROLES]), lens.org ? eq(schema.users.orgId, lens.org) : undefined))
          .orderBy(asc(schema.organizations.name), asc(schema.users.name))
      : null;
  const orgs = branchPicker
    ? await db
        .select({ id: schema.organizations.id, name: schema.organizations.name, type: schema.organizations.type })
        .from(schema.organizations)
        .where(and(inArray(schema.organizations.type, ["BRANCH", "SUB_AGENT"]), eq(schema.organizations.active, true)))
        .orderBy(asc(schema.organizations.type), asc(schema.organizations.name))
    : [];
  const showLens = periods || orgs.length > 0;
  // The workbook takes exactly what this screen is looking at.
  const exportQuery = new URLSearchParams(
    Object.entries({ as: lens.viewingAs ? kind : "", org: lens.org ?? "", who: lens.viewingAs ? (lens.person?.id ?? "") : "", period: lens.period === "all" ? "" : lens.period }).filter(([, v]) => v),
  ).toString();
  return (
    <div className="flex flex-wrap items-center gap-2" data-print="hide">
      {mayViewAs(user.role) && (
        <ViewAs kinds={DASHBOARD_KINDS.map((k) => ({ key: k.key, label: k.label }))} kind={kind} own={dashboardFor(user.role)} people={people} person={lens.person?.id ?? null} />
      )}
      {showLens && (
        <LensBar periods={PERIODS} period={lens.period} hidePeriods={!periods} orgs={orgs.map((o) => ({ id: o.id, name: o.name, subAgent: o.type === "SUB_AGENT" }))} org={lens.org} />
      )}
      {/* A plain link rather than a button: the browser downloads it, and it
          works before the page's script has loaded. */}
      <a
        href={`/api/dashboard/export${exportQuery ? `?${exportQuery}` : ""}`}
        data-export
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink hover:bg-surface-2"
      >
        <IconExport className="size-3.5" /> Excel
      </a>
    </div>
  );
}

/** Said at the top of a dashboard that is not the viewer's own. */
export function ViewingAsNote({ lens }: { lens: Lens }) {
  if (!lens.viewingAs) return null;
  const whose = lens.kind === "counsellor" ? (lens.person ? `${lens.person.name}'s own students` : "every counsellor's students together") : lens.orgName ? lens.orgName : null;
  return (
    <p data-viewing-as className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-info-500/25 bg-info-50 px-3 py-2 text-sm text-info-700">
      <span>
        You are looking at the <strong>{kindLabel(lens.kind)}</strong> dashboard{whose ? `, for ${whose}` : ""}, as that desk sees it.
      </span>
      <Link href="/dashboard" className="font-semibold underline">
        Back to yours
      </Link>
    </p>
  );
}

/** The greeting, so the screen says hello before it says numbers. */
export function partOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export const firstName = (name: string) => name.split(" ")[0];
