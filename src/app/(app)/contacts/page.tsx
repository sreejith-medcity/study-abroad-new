import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { activeTeamContacts, quickLinkList } from "@/server/directory-queries";
import { Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Contacts" };

const LEVEL = ["", "First call", "If it is not resolved", "Final escalation"];
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/** Who to call at Medcity Overseas, who to escalate to, and the links partners use most. */
export default async function ContactsPage() {
  const user = await requireUser([...APP_ROLES]);
  const [contacts, links, org] = await Promise.all([
    activeTeamContacts(),
    quickLinkList(),
    db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), with: { relationshipManager: true } }),
  ]);
  const areas = [...new Set(contacts.map((c) => c.area))];
  const rm = org?.relationshipManager;

  return (
    <>
      <PageHeader title="Contacts" subtitle="Who to call at Medcity Overseas, who to go to if it is not resolved, and links you use often. For one student's application, comment on it: that reaches the right person fastest." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {rm && org?.type !== "HQ" && (
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Your relationship manager</p>
              <p className="mt-1 font-semibold text-ink">{rm.name}</p>
              <p className="text-[13px] text-muted">{[rm.deskLabel, rm.phone].filter(Boolean).join(" · ")}</p>
              <a href={`mailto:${rm.email}`} className="text-[13px] text-brand-600 hover:underline">{rm.email}</a>
            </Card>
          )}
          {areas.length === 0 ? (
            <Card>
              <EmptyState title="No contacts listed yet">The Overseas team adds them. Until then, use the help desk.</EmptyState>
            </Card>
          ) : (
            areas.map((area) => (
              <Card key={area}>
                <CardHeader title={area} />
                <ul className="divide-y divide-line">
                  {contacts
                    .filter((c) => c.area === area)
                    .map((c) => (
                      <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-[13px]">
                        <div>
                          <p className="font-medium text-ink">{c.name}{c.title ? <span className="font-normal text-muted">, {c.title}</span> : null}</p>
                          {c.hours && <p className="text-xs text-muted">{c.hours}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip tone={c.level === 1 ? "ok" : c.level === 2 ? "warn" : "bad"}>{LEVEL[c.level]}</Chip>
                          {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="tabular text-brand-600 hover:underline">{c.phone}</a>}
                          {c.phone && c.whatsapp && <a href={waLink(c.phone)} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">WhatsApp</a>}
                          {c.email && <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">{c.email}</a>}
                        </div>
                      </li>
                    ))}
                </ul>
              </Card>
            ))
          )}
        </div>
        <Card className="h-fit">
          <CardHeader title="Quick links" subtitle="Opened in a new tab" />
          {links.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-muted">None yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {links.map((l) => (
                <li key={l.id} className="px-4 py-2.5 text-[13px]">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">{l.label} ↗</a>
                  {l.note && <p className="text-xs text-muted">{l.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
