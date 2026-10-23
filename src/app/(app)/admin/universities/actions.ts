"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";
import { bestRankSort } from "@/lib/rankings";
import { readUniversityForm } from "@/lib/university-edit";
import { changesOf, newBatchId, recordChanges } from "@/server/catalogue-history";

const nameTaken = (country: string) => ({
  error: `Another university in ${country} already has that name. Use the full official name, or open that university instead.`,
  fieldErrors: { name: [`Already used by another university in ${country}`] },
});

/**
 * Saves the edit university screen. Admins only, like program edits, and every
 * field that changes is recorded in the catalogue history under one batch, so
 * the whole save can be put back with one Restore.
 */
export async function updateUniversityAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("universityId") ?? "");
  const current = await db.query.universities.findFirst({ where: eq(schema.universities.id, id), with: { country: true } });
  if (!current) return { error: "That university no longer exists." };

  const s = (k: string) => String(fd.get(k) ?? "");
  const { values, errors } = readUniversityForm(
    {
      name: s("name"),
      city: s("city"),
      website: s("website"),
      isPublic: fd.get("isPublic") === "on",
      qsRank: s("qsRank"),
      qsYear: s("qsYear"),
      theRank: s("theRank"),
      theYear: s("theYear"),
      about: s("about"),
      facts: s("facts"),
    },
    current,
  );
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };

  // The unique index only stops an exact repeat, but the rankings import finds
  // a university by its name ignoring case, so "University of hull" beside
  // "University of Hull" would make both unreachable to it. Refused either way.
  if (values.name !== current.name) {
    const clash = await db.query.universities.findFirst({
      where: and(eq(schema.universities.countryId, current.countryId), ne(schema.universities.id, id), sql`lower(${schema.universities.name}) = lower(${values.name})`),
      columns: { id: true },
    });
    if (clash) return nameTaken(current.country.name);
  }

  // Compared against the row read locked inside the transaction that writes
  // it, so a save landing at the same moment waits, and the history records
  // the value this save replaced rather than one read before the other save.
  let diff;
  try {
    diff = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(schema.universities).where(eq(schema.universities.id, id)).for("update");
      if (!locked) return null;
      const d = changesOf("university", id, locked, values);
      if (!d.length) return d;
      const set: Record<string, unknown> = Object.fromEntries(d.map((x) => [x.field, values[x.field as keyof typeof values]]));
      // The sort position follows from the two rankings, worked out the way the
      // rankings import and a restore work it out, and is not a change of its own.
      if ("qsRank" in set || "theRank" in set) set.rankSort = bestRankSort(values.qsRank, values.theRank);
      await tx.update(schema.universities).set(set).where(eq(schema.universities.id, id));
      await recordChanges(tx, d, { by: user.id, source: "edit", batchId: newBatchId() });
      return d;
    });
  } catch (e) {
    // Two admins renaming at the same moment can both pass the check above;
    // the index then refuses the second, and it gets the same answer.
    if ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") return nameTaken(current.country.name);
    throw e;
  }
  if (!diff) return { error: "That university no longer exists." };
  if (!diff.length) return { ok: "Nothing changed." };
  const changed = Object.fromEntries(diff.map((d) => [d.field, { from: d.before, to: d.after }]));
  await audit(user.id, "university.update", "university", id, { changed });
  revalidatePath(`/admin/universities/${id}`);
  revalidatePath(`/universities/${id}`);
  revalidatePath("/admin/programs");
  revalidatePath("/search");
  return { ok: `Saved ${diff.length} change${diff.length === 1 ? "" : "s"}.` };
}
