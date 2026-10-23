import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { ChangeHistory } from "@/components/change-history";
import { changeHistory, latestRestore } from "@/server/catalogue-history";
import { UniversityEditForm } from "./edit-form";

export const metadata = { title: "Edit university" };

export default async function EditUniversityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser([...ADMIN_ROLES]);
  const { id } = await params;
  const sp = await searchParams;
  // Fifty changes to start with, and fifty more each time "Show more" is used.
  const historyLimit = Math.min(500, Math.max(50, Number(typeof sp.history === "string" ? sp.history : 50) || 50));
  const university = await db.query.universities.findFirst({ where: eq(schema.universities.id, id), with: { country: true } });
  if (!university) notFound();
  const [history, restoredBy] = await Promise.all([changeHistory("university", id, historyLimit), latestRestore("university", id)]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/universities/${university.id}`} className="text-sm font-medium text-brand-600 hover:underline">
            ← {university.name}
          </Link>
        }
        title={`Edit ${university.name}`}
        subtitle={`${university.city ? `${university.city}, ` : ""}${university.country.name}${university.externalCode ? ` · register code ${university.externalCode}` : ""}`}
        actions={<LinkButton variant="secondary" href={`/universities/${university.id}`}>View as partners see it</LinkButton>}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5" data-university-edit={university.id}>
          {/* Started afresh after a restore, as the program screen does: a form
              still holding the value a restore replaced would quietly undo the
              restore on its next save. An ordinary save keeps its state. */}
          <UniversityEditForm
            key={restoredBy ?? "no-restore"}
            university={{
              id: university.id,
              name: university.name,
              city: university.city,
              website: university.website,
              isPublic: university.isPublic,
              qsRank: university.qsRank,
              qsYear: university.qsYear,
              theRank: university.theRank,
              theYear: university.theYear,
              about: university.about,
              facts: university.facts ?? [],
            }}
            country={university.country.name}
          />
        </Card>
        <div className="self-start">
          <ChangeHistory
            entity="university"
            entityId={university.id}
            rows={history.rows}
            more={history.more}
            moreHref={`/admin/universities/${university.id}?history=${historyLimit + 50}`}
            currency={university.country.currency}
            canRestore
          />
        </div>
      </div>
    </>
  );
}
