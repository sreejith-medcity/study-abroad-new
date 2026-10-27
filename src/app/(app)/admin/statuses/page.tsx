import Link from "next/link";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Pathway } from "@/db/schema";
import { PATHWAYS } from "@/lib/pathways";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { Button, Card, Input, PageHeader, Select, StatusBadge, cn } from "@/components/ui";
import { ADMIN_ROLES } from "@/lib/permissions";

export const metadata = { title: "Status flows" };

/** The short name each pathway goes by on the tabs. */
const TAB_LABEL: Record<Pathway, string> = {
  DEGREE: "Study abroad",
  AUSBILDUNG: "Ausbildung",
  NURSING: "Nurse registration",
  NCLEX: "NCLEX-RN",
  WEITERBILDUNG: "Weiterbildung",
  CCM: "CCM",
  AU_PAIR: "Au pair",
  FSJ: "FSJ",
  BFD: "BFD",
};

const PATHWAY_LABEL: Record<Pathway, string> = {
  DEGREE: "Study abroad (UK, IE, AU, CA, MT)",
  AUSBILDUNG: "Ausbildung (Germany)",
  NURSING: "Nurse registration (OET, Anerkennung, and NCLEX-RN files opened before NCLEX-RN had its own pathway)",
  NCLEX: "NCLEX-RN (USA nurse licensing)",
  WEITERBILDUNG: "Weiterbildung (Germany), provisional until the written guide arrives",
  CCM: "CCM, provisional until the written guide arrives",
  AU_PAIR: "Au pair (Germany), following the written Au pair process",
  FSJ: "FSJ, Freiwilliges Soziales Jahr (Germany)",
  BFD: "BFD, Bundesfreiwilligendienst (Germany)",
};

async function saveStatus(formData: FormData) {
  "use server";
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim();
  const studentLabel = String(formData.get("studentLabel") ?? "").trim();
  const group = String(formData.get("group")) as (typeof schema.statusGroup.enumValues)[number];
  const sortOrder = Number(formData.get("sortOrder"));
  if (!label || !studentLabel || !schema.statusGroup.enumValues.includes(group) || !Number.isInteger(sortOrder)) return;
  await db.update(schema.statusDefinitions).set({
    label, studentLabel, group, sortOrder,
    requiresReason: formData.get("requiresReason") === "on",
    isMilestone: formData.get("isMilestone") === "on",
    active: formData.get("active") === "on",
  }).where(eq(schema.statusDefinitions.id, id));
  await audit(user.id, "status.update", "status_definition", id, { label, group });
  revalidatePath("/admin/statuses");
}

/**
 * One pathway at a time, picked from a row of tabs.
 *
 * Every pathway's statuses on one page had grown to well over a hundred rows
 * as pathways were added, and finding Au pair meant scrolling past all of
 * Study abroad, Ausbildung and the nursing lists first. The tabs carry how
 * many statuses each pathway has in use, the chosen one is in the address
 * (?pathway=AU_PAIR) so it can be bookmarked and comes back after a save,
 * and an address naming no pathway, or one that does not exist, opens the
 * first.
 */
export default async function StatusesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser([...ADMIN_ROLES]);
  const sp = await searchParams;
  const asked = String((Array.isArray(sp.pathway) ? sp.pathway[0] : sp.pathway) ?? "").toUpperCase();
  const pathways = PATHWAYS;
  const pw: Pathway = (pathways as readonly string[]).includes(asked) ? (asked as Pathway) : pathways[0];
  const rows = await db.select().from(schema.statusDefinitions).orderBy(asc(schema.statusDefinitions.pathway), asc(schema.statusDefinitions.sortOrder));
  const inUse = (p: Pathway) => rows.filter((r) => r.pathway === p && r.active).length;
  const shown = rows.filter((r) => r.pathway === pw);

  return (
    <>
      <PageHeader title="Status flows" subtitle="Each pathway has its own statuses. Milestones send the student a WhatsApp update; closed and deferred statuses need a reason." />
      <nav aria-label="Pathways" className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {pathways.map((p) => (
            <li key={p}>
              <Link
                href={`/admin/statuses?pathway=${p}`}
                aria-current={p === pw ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium",
                  p === pw ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-ink",
                )}
              >
                {TAB_LABEL[p]}
                <span className={cn("rounded-full px-1.5 text-2xs", p === pw ? "bg-white/20" : "bg-ground text-muted")}>{inUse(p)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Card>
        <h2 className="border-b border-line px-4 py-3 font-semibold">
          {PATHWAY_LABEL[pw]}
          <span className="ml-2 text-sm font-normal text-muted">
            {inUse(pw)} in use{shown.length > inUse(pw) ? `, ${shown.length - inUse(pw)} switched off` : ""}
          </span>
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[60px_1.4fr_1.1fr_150px_80px_80px_70px_70px] gap-2 border-b border-line bg-ground/60 px-4 py-2 text-xs font-semibold text-muted">
              <span>Order</span><span>Label (partners and team)</span><span>Label shown to student</span><span>Group</span><span>Reason</span><span>Milestone</span><span>Active</span><span></span>
            </div>
            {shown.length === 0 && <p className="px-4 py-6 text-sm text-muted">This pathway has no statuses yet. Its deploy SQL adds them.</p>}
            {shown.map((r) => (
              <form key={r.id} action={saveStatus} className={cn("grid grid-cols-[60px_1.4fr_1.1fr_150px_80px_80px_70px_70px] items-center gap-2 border-b border-line px-4 py-2 last:border-0", !r.active && "bg-ground/50 opacity-70")}>
                <input type="hidden" name="id" value={r.id} />
                <Input name="sortOrder" type="number" defaultValue={r.sortOrder} aria-label="Order" className="py-1" />
                <div className="space-y-1">
                  <Input name="label" defaultValue={r.label} aria-label="Label" className="py-1" />
                  <StatusBadge group={r.group} label={r.code} />
                </div>
                <Input name="studentLabel" defaultValue={r.studentLabel} aria-label="Student label" className="py-1" />
                <Select name="group" defaultValue={r.group} aria-label="Group" className="py-1">
                  {schema.statusGroup.enumValues.map((g) => <option key={g}>{g}</option>)}
                </Select>
                <input type="checkbox" name="requiresReason" defaultChecked={r.requiresReason} aria-label="Requires reason" className="size-4 justify-self-center" />
                <input type="checkbox" name="isMilestone" defaultChecked={r.isMilestone} aria-label="Milestone" className="size-4 justify-self-center" />
                <input type="checkbox" name="active" defaultChecked={r.active} aria-label="Active" className="size-4 justify-self-center" />
                <Button variant="quiet" className="px-2 py-1">Save</Button>
              </form>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
