"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { outcomeText, REVIEW_SOURCES, type ReviewOutcome, type ReviewSource } from "@/lib/draft-review";
import { archiveDrafts, publishDrafts } from "@/server/draft-review";

/** `at` tells one answer from the next, even when two read the same. */
export type ReviewState = { ok?: string; error?: string; outcome?: ReviewOutcome; at?: number };

/** More than one page of drafts holds, so a forged request cannot ask for the whole catalogue by id. */
const MAX_TICKED = 500;

/**
 * Publishes or archives drafts at one university: the ticked ones, every
 * draft there, or every draft with no worth-a-look flag. Publishing goes
 * through the same rules as setting one course live on its edit screen, and a
 * course that fails them stays a draft and is counted in the answer with its
 * reason. The flags themselves change nothing: a clean publish only narrows
 * which drafts the press is about.
 */
export async function reviewDraftsAction(_: ReviewState, fd: FormData): Promise<ReviewState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const op = String(fd.get("op") ?? "");
  const at = Date.now();
  if (!["publish", "archive", "publishAll", "publishClean"].includes(op)) return { error: "Choose publish or archive.", at };
  const universityId = String(fd.get("universityId") ?? "");
  const rawSource = String(fd.get("source") ?? "");
  const source = rawSource in REVIEW_SOURCES ? (rawSource as ReviewSource) : undefined;
  const uni = await db.query.universities.findFirst({ where: eq(schema.universities.id, universityId), columns: { id: true } });
  if (!uni) return { error: "That university is no longer in the catalogue.", at };

  const ids = [...new Set(fd.getAll("id").map(String).filter(Boolean))];
  const whole = op === "publishAll" || op === "publishClean";
  if (!whole && !ids.length) return { error: "Tick at least one course first.", at };
  if (ids.length > MAX_TICKED) return { error: `Tick at most ${MAX_TICKED} courses at a time, or use Publish all.`, at };

  const outcome =
    op === "archive"
      ? await archiveDrafts({ universityId, source, ids }, user.id)
      : await publishDrafts({ universityId, source, ids: whole ? undefined : ids, clean: op === "publishClean" }, user.id);

  if (outcome.done) {
    await audit(user.id, op === "archive" ? "programs.review_archive" : "programs.review_publish", "university", universityId, {
      all: op === "publishAll",
      clean: op === "publishClean",
      source: source ?? null,
      ticked: whole ? null : ids,
      done: outcome.done,
      leftNoIntakes: outcome.noIntakes,
      leftNoEvidence: outcome.noEvidence,
      leftFlagged: outcome.flagged ?? null,
      notDrafts: outcome.gone,
    });
    revalidatePath("/admin/programs");
    revalidatePath("/search");
  }
  revalidatePath(`/admin/programs/review/${universityId}`);
  revalidatePath("/admin/programs/review");
  const text = outcomeText(outcome);
  return outcome.done ? { ok: text, outcome, at } : { error: text, outcome, at };
}
