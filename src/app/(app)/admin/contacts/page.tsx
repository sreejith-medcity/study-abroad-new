import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { deleteQuickLinkAction, setTeamContactActiveAction } from "@/server/directory";
import { quickLinkList } from "@/server/directory-queries";
import { QuickLinkForm, TeamContactForm } from "@/components/directory-forms";
import { Button, Card, CardHeader, Chip, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Contacts and links" };

const LEVEL = ["", "First call", "Escalate to", "Final escalation"];

export default async function AdminContactsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requireUser([...ADMIN_ROLES]);
  const { edit } = await searchParams;
  const t = schema.teamContacts;
  const [contacts, links] = await Promise.all([db.select().from(t).orderBy(asc(t.area), asc(t.level), asc(t.sortOrder)), quickLinkList()]);
  return (
    <>
      <PageHeader title="Contacts and links" subtitle="Who partners call at Medcity Overseas, and the links they use most. Partners see these on their Contacts page." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Team contacts" subtitle={`${contacts.filter((c) => c.active).length} shown to partners`} />
            {contacts.length === 0 ? (
              <EmptyState title="No contacts yet">Add the first on the right.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {contacts.map((c) => (
                  <li key={c.id} className="px-4 py-3 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-ink">{c.name}{c.title ? `, ${c.title}` : ""}</p>
                        <p className="text-muted">{c.area} · {LEVEL[c.level]} · {[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.active ? <Chip tone="ok">Shown</Chip> : <Chip>Hidden</Chip>}
                        <LinkButton size="sm" variant="quiet" href={`/admin/contacts?edit=${c.id}`}>Edit</LinkButton>
                        <form action={setTeamContactActiveAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                          <Button size="sm" variant="quiet">{c.active ? "Hide" : "Show"}</Button>
                        </form>
                      </div>
                    </div>
                    {edit === c.id && <div className="mt-3 rounded-lg border border-line p-3"><TeamContactForm values={c} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Quick links" subtitle="Institution portals, embassy pages, forms" />
            {links.length > 0 && (
              <ul className="divide-y divide-line">
                {links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <div>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">{l.label}</a>
                      {l.note && <p className="text-muted">{l.note}</p>}
                    </div>
                    <form action={deleteQuickLinkAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <Button size="sm" variant="quiet" aria-label={`Remove ${l.label}`}>Remove</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line p-4"><QuickLinkForm /></div>
          </Card>
        </div>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">New contact</h2>
          <TeamContactForm />
        </Card>
      </div>
    </>
  );
}
