"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, isStaff, isSuperAdmin } from "@/lib/permissions";
import { expectedFromRate, INCOME_LABEL, PAYER_LABEL } from "@/lib/income";
import { getStudentForUser } from "@/server/queries";
import { kindsOnFile, ratesForOrg } from "@/server/income";
import type { FormState } from "@/lib/form-state";
import type { IncomeKind, IncomePayer, IncomeState } from "@/db/schema";

const { incomeLines: il, rateCards: rc } = schema;

const dateOnly = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const money = (v: unknown, errors: Record<string, string[]>, field: string) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    errors[field] = ["A whole amount, or leave it empty"];
    return null;
  }
  return n;
};

const lineSchema = z.object({
  lineId: z.string().optional(),
  studentId: z.string().min(1),
  applicationId: z.string().optional(),
  kind: z.string().min(1),
  payer: z.string().optional(),
  vendorId: z.string().optional(),
  providerName: z.string().trim().max(120).optional(),
  currency: z.string().trim().toUpperCase().optional(),
  expectedAmount: z.string().optional(),
  invoicedAmount: z.string().optional(),
  receivedAmount: z.string().optional(),
  state: z.string().optional(),
  branchSharePercent: z.string().optional(),
  dueOn: z.string().optional(),
  receivedOn: z.string().optional(),
  note: z.string().trim().max(400).optional(),
});

/**
 * One line of money on one student.
 *
 * An amount left empty stays empty: it reads "Not recorded" on the sheet and is
 * counted in no total. Nought means the line is genuinely worth nothing, which
 * is a different fact and is kept as one.
 */
export async function saveIncomeLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES, "PARTNER"]);
  const parsed = lineSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!(d.kind in INCOME_LABEL)) return { fieldErrors: { kind: ["Pick one from the list"] }, error: "Check the highlighted fields." };
  const kind = d.kind as IncomeKind;
  const student = await getStudentForUser(user, d.studentId);
  const errors: Record<string, string[]> = {};
  const expected = money(d.expectedAmount, errors, "expectedAmount");
  const invoiced = money(d.invoicedAmount, errors, "invoicedAmount");
  const received = money(d.receivedAmount, errors, "receivedAmount");
  const share = d.branchSharePercent?.trim() ? Number(d.branchSharePercent) : null;
  if (share != null && (!Number.isFinite(share) || share < 0 || share > 100)) errors.branchSharePercent = ["A percentage between 0 and 100"];
  if (Object.keys(errors).length) return { fieldErrors: errors, error: "Check the highlighted fields." };

  const payer = d.payer && d.payer in PAYER_LABEL ? (d.payer as IncomePayer) : "STUDENT";
  const state = (d.state && ["EXPECTED", "INVOICED", "RECEIVED", "NOT_APPLICABLE"].includes(d.state) ? d.state : received != null ? "RECEIVED" : invoiced != null ? "INVOICED" : "EXPECTED") as IncomeState;
  const values = {
    orgId: student.orgId,
    studentId: student.id,
    applicationId: d.applicationId || null,
    kind,
    payer,
    vendorId: d.vendorId || null,
    providerName: d.providerName || null,
    currency: /^[A-Z]{3}$/.test(d.currency ?? "") ? (d.currency as string) : "INR",
    expectedAmount: expected,
    invoicedAmount: invoiced,
    receivedAmount: received,
    state,
    branchSharePercent: share,
    dueOn: dateOnly(d.dueOn),
    receivedOn: dateOnly(d.receivedOn) ?? (received != null ? new Date().toISOString().slice(0, 10) : null),
    note: d.note || null,
    updatedAt: new Date(),
  };

  if (d.lineId) {
    const held = await db.query.incomeLines.findFirst({ where: eq(il.id, d.lineId) });
    if (!held) return { error: "That line is gone." };
    if (!isStaff(user) && held.orgId !== user.orgId) return { error: "That line belongs to another branch." };
    if (held.state === "WRITTEN_OFF") return { error: "A written-off line cannot be changed. Raise a fresh one if it is owed after all." };
    await db.update(il).set(values).where(eq(il.id, d.lineId));
    await audit(user.id, "income.update", "income_line", d.lineId, { kind, expected, invoiced, received, state });
  } else {
    const [made] = await db.insert(il).values({ ...values, createdById: user.id }).returning({ id: il.id });
    await audit(user.id, "income.create", "income_line", made.id, { kind, expected, state, studentId: student.id });
  }
  revalidatePath(`/students/${student.id}`, "layout");
  revalidatePath("/admin/income");
  return { ok: `${INCOME_LABEL[kind]} saved.` };
}

/** Money in. The day it arrived is what the report counts, not today. */
export async function markReceivedAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES, "PARTNER"]);
  const id = String(fd.get("lineId") ?? "");
  const errors: Record<string, string[]> = {};
  const amount = money(fd.get("receivedAmount"), errors, "receivedAmount");
  const on = dateOnly(fd.get("receivedOn")) ?? new Date().toISOString().slice(0, 10);
  if (Object.keys(errors).length) return { fieldErrors: errors, error: "Check the highlighted fields." };
  const held = await db.query.incomeLines.findFirst({ where: eq(il.id, id) });
  if (!held) return { error: "That line is gone." };
  if (!isStaff(user) && held.orgId !== user.orgId) return { error: "That line belongs to another branch." };
  const got = amount ?? held.invoicedAmount ?? held.expectedAmount;
  if (got == null) return { fieldErrors: { receivedAmount: ["Give the amount that came in"] }, error: "Check the highlighted fields." };
  const owed = held.invoicedAmount ?? held.expectedAmount;
  // Part payment is normal, so the line stays open until the whole of it is in.
  const whole = owed == null || got >= owed;
  await db
    .update(il)
    .set({ receivedAmount: got, receivedOn: on, state: whole ? "RECEIVED" : held.state, updatedAt: new Date() })
    .where(eq(il.id, id));
  await audit(user.id, "income.received", "income_line", id, { amount: got, on, whole });
  revalidatePath(`/students/${held.studentId}`, "layout");
  revalidatePath("/admin/income");
  return { ok: whole ? "Recorded as received in full." : `Part payment recorded. ${owed! - got} still owed.` };
}

const offSchema = z.object({ lineId: z.string().min(1), reason: z.string().trim().min(5, "Say why it will never come in").max(400) });

/**
 * Money that stops being owed should never be quiet, so only a super admin may
 * write a line off, it needs a reason, and it stays on the sheet saying so.
 */
export async function writeOffIncomeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!isSuperAdmin(user)) return { error: "Only a super admin can write money off." };
  const parsed = offSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say why it will never come in." };
  const held = await db.query.incomeLines.findFirst({ where: eq(il.id, parsed.data.lineId) });
  if (!held) return { error: "That line is gone." };
  await db
    .update(il)
    .set({ state: "WRITTEN_OFF", writtenOffReason: parsed.data.reason, writtenOffById: user.id, updatedAt: new Date() })
    .where(eq(il.id, held.id));
  await audit(user.id, "income.write_off", "income_line", held.id, { reason: parsed.data.reason, kind: held.kind, amount: held.invoicedAmount ?? held.expectedAmount });
  revalidatePath(`/students/${held.studentId}`, "layout");
  revalidatePath("/admin/income");
  return { ok: "Written off. It stays on the sheet with the reason, and it is in the audit log." };
}

/** Takes off a line added in error, which is not the same as writing one off. */
export async function deleteIncomeLineAction(fd: FormData): Promise<void> {
  const user = await requireUser([...ADMIN_ROLES, "PARTNER"]);
  const id = String(fd.get("lineId") ?? "");
  const held = await db.query.incomeLines.findFirst({ where: eq(il.id, id) });
  if (!held) return;
  if (!isStaff(user) && held.orgId !== user.orgId) return;
  if (held.receivedAmount != null || held.invoicedAmount != null) return;
  await db.delete(il).where(eq(il.id, id));
  await audit(user.id, "income.delete", "income_line", id, { kind: held.kind });
  revalidatePath(`/students/${held.studentId}`, "layout");
  revalidatePath("/admin/income");
}

/**
 * Lays out the lines a student should have, from the branch's rate cards.
 *
 * Nothing is invented: a kind with no rate card behind it is still laid out, with
 * no amount, so somebody can see what has not been priced rather than it being
 * quietly absent.
 */
export async function layOutLinesAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES, "PARTNER"]);
  const studentId = String(fd.get("studentId") ?? "");
  const student = await getStudentForUser(user, studentId);
  const wanted = fd.getAll("kinds").map(String).filter((k) => k in INCOME_LABEL) as IncomeKind[];
  if (!wanted.length) return { error: "Tick what this student should have." };
  const held = await kindsOnFile(studentId);
  const rates = await ratesForOrg(student.orgId);
  const toAdd = wanted.filter((k) => !held.has(k));
  if (!toAdd.length) return { ok: "Every one of those is already on the sheet." };
  let priced = 0;
  for (const kind of toAdd) {
    const rate = rates.get(kind) ?? null;
    const { amount } = expectedFromRate(rate, null);
    if (amount != null) priced += 1;
    await db.insert(il).values({
      orgId: student.orgId,
      studentId,
      kind,
      payer: rate?.payer ?? "STUDENT",
      currency: rate?.currency ?? "INR",
      expectedAmount: amount,
      branchSharePercent: rate?.branchSharePercent ?? null,
      rateCardId: (rate as unknown as { id?: string } | null)?.id ?? null,
      createdById: user.id,
      state: "EXPECTED",
    });
  }
  await audit(user.id, "income.lay_out", "student", studentId, { kinds: toAdd, priced });
  revalidatePath(`/students/${studentId}`, "layout");
  return {
    ok:
      priced === toAdd.length
        ? `${toAdd.length} line${toAdd.length === 1 ? "" : "s"} added from the rate card.`
        : `${toAdd.length} line${toAdd.length === 1 ? "" : "s"} added. ${toAdd.length - priced} have no rate recorded, so they read "Not recorded" until somebody prices them.`,
  };
}

const rateSchema = z.object({
  kind: z.string().min(1),
  orgId: z.string().optional(),
  amount: z.string().optional(),
  percentOfSale: z.string().optional(),
  currency: z.string().trim().toUpperCase().optional(),
  payer: z.string().optional(),
  branchSharePercent: z.string().optional(),
  activeFrom: z.string().min(1, "From which day"),
  note: z.string().trim().max(300).optional(),
});

/**
 * What a branch charges or keeps for one kind, from a day.
 *
 * Rates are added, never edited: an older student's line can still be read
 * against the rate that applied when it was agreed, which is the only way a
 * figure from last season survives a change this one.
 */
export async function saveRateCardAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = rateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!(d.kind in INCOME_LABEL)) return { fieldErrors: { kind: ["Pick one from the list"] }, error: "Check the highlighted fields." };
  const errors: Record<string, string[]> = {};
  const amount = money(d.amount, errors, "amount");
  const percent = d.percentOfSale?.trim() ? Number(d.percentOfSale) : null;
  if (percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) errors.percentOfSale = ["A percentage between 0 and 100"];
  const share = d.branchSharePercent?.trim() ? Number(d.branchSharePercent) : null;
  if (share != null && (!Number.isFinite(share) || share < 0 || share > 100)) errors.branchSharePercent = ["A percentage between 0 and 100"];
  if (amount == null && percent == null) errors.amount = ["Give a flat amount or a percentage of the sale"];
  if (amount != null && percent != null) errors.amount = ["One or the other, not both"];
  const activeFrom = dateOnly(d.activeFrom);
  if (!activeFrom) errors.activeFrom = ["Give the day it starts from"];
  if (Object.keys(errors).length) return { fieldErrors: errors, error: "Check the highlighted fields." };

  const [made] = await db
    .insert(rc)
    .values({
      orgId: d.orgId || null,
      kind: d.kind as IncomeKind,
      amount,
      percentOfSale: percent,
      currency: /^[A-Z]{3}$/.test(d.currency ?? "") ? (d.currency as string) : "INR",
      payer: d.payer && d.payer in PAYER_LABEL ? (d.payer as IncomePayer) : "STUDENT",
      branchSharePercent: share,
      activeFrom: activeFrom as string,
      note: d.note || null,
      setById: user.id,
    })
    .returning({ id: rc.id });
  await audit(user.id, "rate_card.create", "rate_card", made.id, { kind: d.kind, orgId: d.orgId || null, amount, percent, activeFrom });
  revalidatePath("/admin/income");
  return { ok: `${INCOME_LABEL[d.kind as IncomeKind]} rate recorded from ${activeFrom}. Lines laid out after today use it.` };
}

/** Removes a rate nobody has used yet, for a figure typed in wrongly. */
export async function deleteRateCardAction(fd: FormData): Promise<void> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("rateCardId") ?? "");
  const used = await db.query.incomeLines.findFirst({ where: eq(il.rateCardId, id) });
  if (used) return;
  const held = await db.query.rateCards.findFirst({ where: eq(rc.id, id) });
  if (!held) return;
  await db.delete(rc).where(eq(rc.id, id));
  await audit(user.id, "rate_card.delete", "rate_card", id, { kind: held.kind });
  revalidatePath("/admin/income");
}

/** Gives every placement's commission a line on the student's sheet, once. */
export async function fillCommissionLinesAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  void fd;
  const { commissionsWithoutLines } = await import("@/server/income");
  const rows = await commissionsWithoutLines(isStaff(user) ? undefined : user.orgId);
  if (!rows.length) return { ok: "Every placement's commission already has a line." };
  await db.insert(il).values(
    rows.map((r) => ({
      orgId: r.orgId,
      studentId: r.studentId,
      applicationId: r.applicationId,
      kind: "COMMISSION" as const,
      payer: "VENDOR" as const,
      commissionId: r.commissionId,
      createdById: user.id,
      state: "EXPECTED" as const,
    })),
  );
  await audit(user.id, "income.fill_commissions", "income_line", "*", { count: rows.length });
  revalidatePath("/admin/income");
  return { ok: `${rows.length} commission line${rows.length === 1 ? "" : "s"} added. The figures are read from the placement, not copied.` };
}
