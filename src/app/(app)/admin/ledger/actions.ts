"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES, isAdmin } from "@/lib/permissions";
import { mayReadLedger } from "@/server/history-feed";
import { stampLedger, verifyLedger } from "@/server/ledger";

/** Recomputes the whole chain and says whether it is intact, or which entry is not. */
export async function verifyLedgerAction() {
  const user = await requireUser([...APP_ROLES]);
  if (!mayReadLedger(user)) redirect("/forbidden");
  const v = await verifyLedger();
  await audit(user.id, "ledger.verify", "ledger", "*", v.ok ? { ok: true, checked: v.checked } : { ok: false, problem: v.problem, brokenSeq: v.brokenSeq });
  const text = v.ok
    ? `Chain intact. All ${v.checked} entries were recomputed and each one points at the one before it.`
    : `Chain broken. ${v.problem}. Checked ${v.checked} entries before it.`;
  redirect(`/admin/ledger?${v.ok ? "intact" : "broken"}=${encodeURIComponent(text)}`);
}

/** Stamps the head on the public calendars now, rather than waiting for the daily stamp. */
export async function stampLedgerAction() {
  const user = await requireUser([...APP_ROLES]);
  if (!isAdmin(user)) redirect("/forbidden");
  const r = await stampLedger();
  await audit(user.id, "ledger.stamp", "ledger", "*", { status: r.status });
  if (r.status === "EMPTY") redirect(`/admin/ledger?note=${encodeURIComponent("The ledger has no entries yet, so there is nothing to stamp.")}`);
  if (r.status === "FAILED") {
    redirect(`/admin/ledger?note=${encodeURIComponent(`Not stamped: no public calendar could be reached (${r.error ?? "no network"}). The ledger itself is unaffected, and the portal tries again an hour after the next change.`)}`);
  }
  redirect(`/admin/ledger?note=${encodeURIComponent(`Stamped entries 1 to ${r.uptoSeq} on ${r.calendars.length} public calendar${r.calendars.length === 1 ? "" : "s"}. It is confirmed in a Bitcoin block within a few hours.`)}`);
}
