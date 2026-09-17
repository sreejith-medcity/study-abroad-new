import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { Button, Card, Input, PageHeader, Select, StatusBadge } from "@/components/ui";

export const metadata = { title: "Status flows" };

const PATHWAY_LABEL = { DEGREE: "Degree (UK, IE, AU, CA, MT)", AUSBILDUNG: "Ausbildung (Germany)", NURSING: "Nurse registration (NCLEX, OET, Anerkennung)" } as const;

async function saveStatus(formData: FormData) {
  "use server";
  const user = await requireUser(["ADMIN"]);
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

export default async function StatusesPage() {
  await requireUser(["ADMIN"]);
  const rows = await db.select().from(schema.statusDefinitions).orderBy(asc(schema.statusDefinitions.pathway), asc(schema.statusDefinitions.sortOrder));
  const pathways = ["DEGREE", "AUSBILDUNG", "NURSING"] as const;

  return (
    <>
      <PageHeader title="Status flows" subtitle="Each pathway has its own statuses. Milestones send the student a WhatsApp update; closed and deferred statuses need a reason." />
      <div className="space-y-5">
        {pathways.map((pw) => (
          <Card key={pw}>
            <h2 className="border-b border-line px-4 py-3 font-semibold">{PATHWAY_LABEL[pw]}</h2>
            <div className="overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-[60px_1.4fr_1.1fr_150px_80px_80px_70px_70px] gap-2 border-b border-line bg-ground/60 px-4 py-2 text-xs font-semibold text-muted">
                  <span>Order</span><span>Label (partners and team)</span><span>Label shown to student</span><span>Group</span><span>Reason</span><span>Milestone</span><span>Active</span><span></span>
                </div>
                {rows.filter((r) => r.pathway === pw).map((r) => (
                  <form key={r.id} action={saveStatus} className="grid grid-cols-[60px_1.4fr_1.1fr_150px_80px_80px_70px_70px] items-center gap-2 border-b border-line px-4 py-2 last:border-0">
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
                    <Button variant="ghost" className="px-2 py-1">Save</Button>
                  </form>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
