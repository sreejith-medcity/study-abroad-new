import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES, isAdmin, isStaff } from "@/lib/permissions";
import { Button, Card, CardHeader, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Toolbar } from "@/components/ui";
import { IconDoc, IconGlobe, IconLearning, IconSpark } from "@/components/icons";
import { ResourceForm } from "./forms";
import { deleteResourceAction, toggleResourceAction } from "./actions";

export const metadata = { title: "Learning resources" };

const KIND_LABEL: Record<string, string> = {
  GUIDE: "Guide",
  TEMPLATE: "Template",
  POLICY: "Policy",
  TRAINING: "Training",
  MARKETING: "Marketing",
  FAQ: "FAQ",
};

const KIND_TONE: Record<string, "neutral" | "info" | "brand" | "warn" | "gold" | "ok"> = {
  GUIDE: "brand",
  TEMPLATE: "info",
  POLICY: "warn",
  TRAINING: "ok",
  MARKETING: "gold",
  FAQ: "neutral",
};

function sizeLabel(bytes: number | null) {
  if (!bytes) return null;
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default async function LearningPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const q = one("q");
  const kind = one("kind");
  const staff = isStaff(user);
  const canManage = isAdmin(user);

  const { resources: r, countries: c } = schema;
  const [rows, countries] = await Promise.all([
    db
      .select({
        id: r.id,
        title: r.title,
        summary: r.summary,
        kind: r.kind,
        pathway: r.pathway,
        url: r.url,
        storageKey: r.storageKey,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
        published: r.published,
        pinned: r.pinned,
        downloads: r.downloads,
        audience: r.audience,
        createdAt: r.createdAt,
        countryName: c.name,
      })
      .from(r)
      .leftJoin(c, eq(r.countryId, c.id))
      .where(
        and(
          staff ? undefined : and(eq(r.published, true), sql`${user.role} = any(${r.audience})`),
          kind ? eq(r.kind, kind as schema.ResourceKind) : undefined,
          q ? or(ilike(r.title, `%${q}%`), ilike(r.summary, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(desc(r.pinned), desc(r.createdAt))
      .limit(100),
    db.select({ id: c.id, name: c.name }).from(c).orderBy(asc(c.name)),
  ]);

  const pinned = rows.filter((x) => x.pinned);
  const rest = rows.filter((x) => !x.pinned);

  const cardFor = (x: (typeof rows)[number]) => (
    <li key={x.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={KIND_TONE[x.kind] ?? "neutral"}>{KIND_LABEL[x.kind] ?? x.kind}</Chip>
            {x.pathway && <Chip>{x.pathway === "AUSBILDUNG" ? "Ausbildung" : x.pathway === "NURSING" ? "Nursing" : "Degree"}</Chip>}
            {x.countryName && <Chip tone="info">{x.countryName}</Chip>}
            {!x.published && <Chip tone="bad">Unpublished</Chip>}
          </div>
          <h3 className="mt-2 font-display text-[15px] font-semibold leading-snug">{x.title}</h3>
          {x.summary && <p className="mt-1 text-[13px] leading-relaxed text-muted">{x.summary}</p>}
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
          {x.url ? <IconGlobe className="size-4" /> : <IconDoc className="size-4" />}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{fmtDate(x.createdAt)}</span>
        {x.sizeBytes && <span>· {sizeLabel(x.sizeBytes)}</span>}
        {x.downloads > 0 && <span>· {x.downloads} opened</span>}
        {staff && <span>· {x.audience.map((a) => a.toLowerCase()).join(", ")}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {x.storageKey ? (
          <LinkButton href={`/api/resources/${x.id}`} variant="secondary" size="sm" target="_blank">
            Open {x.fileName ? "file" : "resource"}
          </LinkButton>
        ) : x.url ? (
          <a
            href={x.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] font-medium hover:border-brand-300 hover:text-brand-700"
          >
            Open link
          </a>
        ) : (
          <span className="text-xs text-muted">
            {canManage ? "Nothing attached yet. Delete it or add the file." : "Ask your relationship manager for this one."}
          </span>
        )}
        {canManage && (
          <>
            <form action={toggleResourceAction}>
              <input type="hidden" name="resourceId" value={x.id} />
              <input type="hidden" name="field" value="pinned" />
              <Button type="submit" variant="quiet" size="sm">{x.pinned ? "Unpin" : "Pin"}</Button>
            </form>
            <form action={toggleResourceAction}>
              <input type="hidden" name="resourceId" value={x.id} />
              <input type="hidden" name="field" value="published" />
              <Button type="submit" variant="quiet" size="sm">{x.published ? "Unpublish" : "Publish"}</Button>
            </form>
            <form action={deleteResourceAction}>
              <input type="hidden" name="resourceId" value={x.id} />
              <Button type="submit" variant="quiet" size="sm" className="text-stop-500">Delete</Button>
            </form>
          </>
        )}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Learning resources"
        subtitle="Checklists, templates, policies and training for the whole network. The Overseas team keeps it current."
      />

      <div className={canManage ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]" : ""}>
        <div className="space-y-5">
          <Toolbar>
            <form className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
              <Input name="q" placeholder="Search the library" aria-label="Search" defaultValue={q} />
              <Select name="kind" aria-label="Kind" defaultValue={kind ?? ""}>
                <option value="">Everything</option>
                {Object.entries(KIND_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button type="submit" variant="secondary">Search</Button>
                <LinkButton href="/learning" variant="quiet">Clear</LinkButton>
              </div>
            </form>
          </Toolbar>

          {rows.length === 0 ? (
            <Card>
              <EmptyState title="Nothing in the library yet" icon={<IconLearning className="size-5" />}>
                {canManage ? "Add the first guide or template on the right." : "The Overseas team will publish guides and templates here."}
              </EmptyState>
            </Card>
          ) : (
            <>
              {pinned.length > 0 && (
                <section>
                  <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <IconSpark className="size-3.5" /> Start here
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2">{pinned.map(cardFor)}</ul>
                </section>
              )}
              {rest.length > 0 && (
                <section>
                  {pinned.length > 0 && (
                    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Everything else</h2>
                  )}
                  <ul className="grid gap-3 md:grid-cols-2">{rest.map(cardFor)}</ul>
                </section>
              )}
            </>
          )}
        </div>

        {canManage && (
          <Card className="h-fit p-4">
            <CardHeader title="Add a resource" subtitle="Upload a file or point at a link, then choose who sees it" className="mb-3 p-0" />
            <ResourceForm countries={countries} />
          </Card>
        )}
      </div>

      {!canManage && (
        <p className="mt-6 text-[13px] text-muted">
          Something missing? Ask your relationship manager, or{" "}
          <Link href="/notifications" className="text-brand-600 hover:underline">check your notifications</Link> for the latest updates.
        </p>
      )}
    </>
  );
}
