import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Card, Chip, PageHeader } from "@/components/ui";
import { DocumentTypeForm } from "./form";

export const metadata = { title: "Document types" };

/**
 * Guidance and a sample for each document the team asks for. Partners see them
 * next to the upload on the student file, and students in the portal.
 */
export default async function DocumentTypesPage() {
  await requireUser([...ADMIN_ROLES]);
  const types = await db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder));
  const withSample = types.filter((t) => t.sampleStorageKey).length;
  return (
    <>
      <PageHeader
        title="Document types"
        subtitle={`${types.length} types · ${withSample} with a sample. A sample must not carry a real person's details: use a blanked or made-up one.`}
      />
      <div className="space-y-3">
        {types.map((t) => (
          <Card key={t.code} className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{t.label}</h2>
              <Chip>{t.uploadedBy === "team" ? "Uploaded by the team" : "Uploaded by the partner or student"}</Chip>
              {t.sampleStorageKey && <Chip tone="ok">Sample</Chip>}
            </div>
            <DocumentTypeForm code={t.code} label={t.label} guidance={t.guidance} sampleFileName={t.sampleFileName} />
          </Card>
        ))}
      </div>
    </>
  );
}
