"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { UploadError, deleteUpload, saveUpload } from "@/server/storage";

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string[] | undefined> };

const AUDIENCES = ["PARTNER", "COUNSELLOR", "ADMIN", "MANAGEMENT"] as const;

const resourceShape = z.object({
  title: z.string().trim().min(3, "Give it a title").max(160),
  summary: z.string().trim().max(500).optional().transform((v) => v || null),
  kind: z.enum(schema.resourceKind.enumValues),
  pathway: z.enum(schema.pathway.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  countryId: z.string().trim().optional().transform((v) => v || null),
  url: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^https?:\/\//i.test(v), "Links must start with http or https"),
});

export async function saveResourceAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = resourceShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const audience = AUDIENCES.filter((role) => formData.get(`audience_${role}`) === "on");
  if (audience.length === 0) return { error: "Pick at least one audience." };

  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !d.url) return { error: "Attach a file or paste a link." };

  let saved = null;
  if (hasFile) {
    try {
      saved = await saveUpload(file, "resources");
    } catch (e) {
      if (e instanceof UploadError) return { error: e.message, fieldErrors: { file: [e.message] } };
      throw e;
    }
  }

  const [row] = await db
    .insert(schema.resources)
    .values({
      title: d.title,
      summary: d.summary,
      kind: d.kind,
      pathway: d.pathway,
      countryId: d.countryId,
      audience,
      url: d.url,
      storageKey: saved?.storageKey,
      fileName: hasFile ? (file as File).name : null,
      mimeType: saved?.mimeType,
      sizeBytes: saved?.sizeBytes,
      createdById: user.id,
    })
    .returning();
  await audit(user.id, "resource.create", "resource", row.id, { kind: d.kind, audience });
  revalidatePath("/learning");
  return { ok: `"${d.title}" is in the library.` };
}

export async function toggleResourceAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("resourceId"));
  const field = String(formData.get("field"));
  if (!["published", "pinned"].includes(field)) return;
  const row = await db.query.resources.findFirst({ where: eq(schema.resources.id, id) });
  if (!row) return;
  const next = field === "published" ? { published: !row.published } : { pinned: !row.pinned };
  await db.update(schema.resources).set({ ...next, updatedAt: new Date() }).where(eq(schema.resources.id, id));
  await audit(user.id, `resource.${field}`, "resource", id, next);
  revalidatePath("/learning");
}

export async function deleteResourceAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("resourceId"));
  const row = await db.query.resources.findFirst({ where: eq(schema.resources.id, id) });
  if (!row) return;
  if (row.storageKey) await deleteUpload(row.storageKey).catch(() => {});
  await db.delete(schema.resources).where(eq(schema.resources.id, id));
  await audit(user.id, "resource.delete", "resource", id, { title: row.title });
  revalidatePath("/learning");
}
