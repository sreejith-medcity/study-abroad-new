"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { phoneKey } from "@/lib/phone";
import { rateLimit } from "@/server/rate-limit";
import { adminIds, notifyUsers, partnerRecipients } from "@/server/notify";
import { getSettings } from "@/server/settings";
import { AGENT_CONSENT, checkOwnerId, OWNER_ID_KINDS } from "@/lib/agents";
import { GSTIN_RE, PAN_RE, gstinMatchesPan } from "@/lib/billing";
import { activeMou, mouStanding } from "@/server/agents";
import { openReferralEarning } from "@/server/referral-earnings";

import type { FormState } from "@/lib/form-state";
export type { FormState };

/**
 * The sub-agent module's writes: joining, agreeing, referring, and the desk's
 * side of all three.
 */

/** A one-time password, the same shape as every other first login here. */
function onePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (const b of randomBytes(10)) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// ---------- Applying to join ----------

const applicationShape = z.object({
  contactName: z.string().trim().min(2, "Your name"),
  firmName: z.string().trim().max(160).optional().transform((v) => v || null),
  email: z.string().trim().toLowerCase().email("A working email address"),
  phone: z.string().trim().min(8, "A mobile number we can reach you on"),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  state: z.string().trim().max(80).optional().transform((v) => v || null),
  aboutThem: z.string().trim().max(1500).optional().transform((v) => v || null),

  companyLegalName: z.string().trim().max(200).optional().transform((v) => v || null),
  companyAddress: z.string().trim().max(400).optional().transform((v) => v || null),
  gstin: z.string().trim().toUpperCase().max(20).optional().transform((v) => v || null),
  companyPan: z.string().trim().toUpperCase().max(12).optional().transform((v) => v || null),
  companyRegistrationNo: z.string().trim().max(40).optional().transform((v) => v || null),

  ownerName: z.string().trim().max(160).optional().transform((v) => v || null),
  ownerIdKind: z.string().trim().optional().transform((v) => v || null),
  ownerIdNumber: z.string().trim().max(40).optional().transform((v) => v || null),
  referredBy: z.string().trim().optional(),
  consent: z.string().optional(),
  /** A field a person never sees and a robot always fills in. */
  website: z.string().optional(),
});

/**
 * Anybody with the link applying to become a sub-agent.
 *
 * No sign in, so it carries the same guards as the public enquiry form: a
 * honeypot, a limit per caller and per number, and a duplicate check, because
 * an open form is a form that gets hammered.
 */
export async function submitAgentApplicationAction(_: FormState, formData: FormData): Promise<FormState> {
  const settings = await getSettings();
  if (!settings.agentSignupOpen) return { error: "Applications are closed just now. Please try again later, or speak to your nearest Medcity branch." };

  const parsed = applicationShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (d.website) return { keep: true, ok: "Thank you. We will be in touch." };
  if (!d.consent) return { fieldErrors: { consent: ["Please agree before sending"] }, error: "Please agree before sending." };

  /*
   * What they tell us about the firm is checked for shape before it is kept.
   * All of it is optional, because a sub-agent who has not registered a company
   * is still a sub-agent, but a GSTIN that cannot be a GSTIN is caught here
   * rather than at the first invoice.
   */
  if (d.gstin && !GSTIN_RE.test(d.gstin)) {
    return { fieldErrors: { gstin: ["Fifteen characters, like 32ABCDE1234F1Z5"] }, error: "Check the highlighted fields." };
  }
  if (d.companyPan && !PAN_RE.test(d.companyPan)) {
    return { fieldErrors: { companyPan: ["Ten characters, like ABCDE1234F"] }, error: "Check the highlighted fields." };
  }
  // A GSTIN carries its own PAN, so the two disagreeing means one is mistyped.
  if (d.gstin && d.companyPan && !gstinMatchesPan(d.gstin, d.companyPan)) {
    return { fieldErrors: { gstin: ["This GSTIN does not carry that PAN"] }, error: "Check the highlighted fields." };
  }

  let ownerIdNumber: string | null = null;
  if (d.ownerIdNumber || d.ownerIdKind) {
    if (!d.ownerIdKind) return { fieldErrors: { ownerIdKind: ["Say what the number is from"] }, error: "Check the highlighted fields." };
    if (!d.ownerIdNumber) return { fieldErrors: { ownerIdNumber: ["Give the number, or leave both empty"] }, error: "Check the highlighted fields." };
    const checked = checkOwnerId(d.ownerIdKind, d.ownerIdNumber);
    if (!checked.ok) return { fieldErrors: { ownerIdNumber: [checked.says] }, error: "Check the highlighted fields." };
    ownerIdNumber = checked.value;
  }

  const head = await headers();
  const caller = (head.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const digits = phoneKey(d.phone);
  for (const [key, limit, windowMs] of [
    [`agent:ip:${caller}`, 5, 60 * 60_000],
    [`agent:phone:${digits}`, 2, 24 * 60 * 60_000],
  ] as const) {
    if (!rateLimit(key, { limit, windowMs, blockMs: windowMs }).allowed) {
      return { error: "We have already had an application from you. Give us a few days to come back to you." };
    }
  }

  // The same number twice is the same person applying again, not a new partner.
  const already = await db.query.agentApplications.findFirst({
    where: and(sql`right(regexp_replace(${schema.agentApplications.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`, ne(schema.agentApplications.status, "REJECTED")),
  });
  if (already) return { keep: true, ok: "We already have your application and are looking at it. Somebody will call you." };

  const referredBy = d.referredBy
    ? await db.query.organizations.findFirst({ where: and(eq(schema.organizations.publicSlug, d.referredBy), eq(schema.organizations.active, true)) })
    : null;

  const [row] = await db
    .insert(schema.agentApplications)
    .values({
      contactName: d.contactName,
      firmName: d.firmName,
      email: d.email,
      phone: d.phone,
      city: d.city,
      state: d.state,
      aboutThem: d.aboutThem,
      companyLegalName: d.companyLegalName,
      companyAddress: d.companyAddress,
      gstin: d.gstin,
      companyPan: d.companyPan,
      companyRegistrationNo: d.companyRegistrationNo,
      ownerName: d.ownerName,
      ownerIdKind: (d.ownerIdKind as (typeof OWNER_ID_KINDS)[number] | null) ?? null,
      ownerIdNumber,
      referredByOrgId: referredBy?.id ?? null,
      consentAt: new Date(),
      consentText: AGENT_CONSENT,
    })
    .returning();
  await notifyUsers(await adminIds(), "A sub-agent has applied", `${d.contactName}${d.firmName ? `, ${d.firmName}` : ""} · ${d.phone}`, "/admin/agents");
  void row;
  // Kept on the page rather than raised as a toast: /join stands on its own,
  // outside the signed-in shell, so there is no toast host to catch it.
  return { keep: true, ok: "Thank you. We have your application and will call you about the next steps. Nothing is agreed yet: the agreement comes later, in writing." };
}

// ---------- The desk reviewing ----------

export async function startReviewAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("applicationId"));
  const row = await db.query.agentApplications.findFirst({ where: eq(schema.agentApplications.id, id) });
  if (!row || row.status !== "NEW") return;
  await db.update(schema.agentApplications).set({ status: "REVIEWING", reviewedById: user.id }).where(eq(schema.agentApplications.id, id));
  await audit(user.id, "agent.review", "agent_application", id, {});
  revalidatePath("/admin/agents");
}

const SEATS = { SILVER: 3, GOLD: 5, ELITE: 8, PLATINUM: 12 } as const;

const approveShape = z.object({
  applicationId: z.string().min(1),
  orgName: z.string().trim().min(2, "What the sub-agent is called in the portal"),
  parentOrgId: z.string().trim().optional(),
  note: z.string().trim().max(500).optional().transform((v) => v || null),
});

/**
 * Approving one: the organisation, its first login, and the branch it belongs
 * under.
 *
 * The one-time password is shown to whoever approved it, to be read out, and is
 * never stored or emailed from here. The same shape as inviting a partner, so
 * there is one way a partner account comes into being.
 */
export async function approveAgentApplicationAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = approveShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const row = await db.query.agentApplications.findFirst({ where: eq(schema.agentApplications.id, d.applicationId) });
  if (!row) return { error: "That application is no longer there." };
  if (row.status === "APPROVED") return { error: "That one has already been approved." };

  const clash = await db.query.users.findFirst({ where: eq(schema.users.email, row.email) });
  if (clash) return { error: `${row.email} is already used by another account. Ask them for a different address.` };

  const parent = d.parentOrgId
    ? await db.query.organizations.findFirst({ where: and(eq(schema.organizations.id, d.parentOrgId), ne(schema.organizations.type, "SUB_AGENT")) })
    : null;

  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: d.orgName,
      type: "SUB_AGENT",
      tier: "SILVER",
      city: row.city,
      counsellorSeats: SEATS.SILVER,
      parentOrgId: parent?.id ?? row.referredByOrgId ?? null,
      contactPhone: row.phone,
      contactEmail: row.email,
      relationshipManagerId: user.id,
    })
    .returning();

  const password = onePassword();
  await db
    .insert(schema.users)
    .values({
      name: row.contactName,
      email: row.email,
      phone: row.phone,
      passwordHash: await hashPassword(password),
      role: "PARTNER",
      orgId: org.id,
      mustChangePassword: true,
    });

  await db
    .update(schema.agentApplications)
    .set({ status: "APPROVED", reviewedById: user.id, reviewedAt: new Date(), orgId: org.id, decisionNote: d.note })
    .where(eq(schema.agentApplications.id, d.applicationId));
  await audit(user.id, "agent.approve", "agent_application", d.applicationId, { orgId: org.id, email: row.email });

  const mou = await activeMou();
  // Deliberately not revalidated. The one-time password is shown once, in this
  // form, and refreshing the list underneath would swap the approved row for a
  // "Done" cell, taking the form and the password away with it before anybody
  // had read it out. The list is right again on the next visit to the tab.
  return {
    keep: true,
    ok: `${d.orgName} is set up. ${row.contactName} signs in with ${row.email}. One-time password: ${password}. They must change it at sign in.${
      mou ? ` They will be asked to accept ${mou.version} of the agreement before any money can be withdrawn.` : " There is no agreement published yet, so nothing will be asked for."
    } Read the password out before you close this: it is not kept anywhere.`,
  };
}

const rejectShape = z.object({
  applicationId: z.string().min(1),
  note: z.string().trim().min(5, "A reason that can be read out to them").max(500),
});

export async function rejectAgentApplicationAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = rejectShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say why, so it can be read out to them." };
  const { applicationId, note } = parsed.data;
  const row = await db.query.agentApplications.findFirst({ where: eq(schema.agentApplications.id, applicationId) });
  if (!row || row.status === "APPROVED") return { error: "That one cannot be turned down now." };
  await db
    .update(schema.agentApplications)
    .set({ status: "REJECTED", reviewedById: user.id, reviewedAt: new Date(), decisionNote: note })
    .where(eq(schema.agentApplications.id, applicationId));
  await audit(user.id, "agent.reject", "agent_application", applicationId, { reason: note });
  revalidatePath("/admin/agents");
  return { ok: "Turned down. The reason is on the row." };
}

// ---------- The agreement ----------

const mouShape = z.object({
  version: z.string().trim().min(1, "What to call this version").max(40),
  title: z.string().trim().min(3, "A title").max(200),
  body: z.string().trim().min(50, "The agreement itself"),
  effectiveFrom: z.string().trim().optional().transform((v) => v || null),
  publish: z.string().optional(),
});

/**
 * A new version of the agreement.
 *
 * Added, never edited: somebody accepted particular words on a particular day,
 * and rewriting those words afterwards would change what they agreed to without
 * anybody noticing. Publishing it makes it the one being asked for, and every
 * sub-agent is asked again, which is the point of a new version.
 */
export async function saveMouAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  const parsed = mouShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const taken = await db.query.mouVersions.findFirst({ where: eq(schema.mouVersions.version, d.version) });
  if (taken) return { fieldErrors: { version: ["Already used"] }, error: `${d.version} already exists. Give this one its own name.` };

  const publish = d.publish === "on" || d.publish === "true";
  const [row] = await db
    .insert(schema.mouVersions)
    .values({ version: d.version, title: d.title, body: d.body, effectiveFrom: d.effectiveFrom, active: false, createdById: user.id })
    .returning();
  if (publish) await publish_(row.id, user.id);
  await audit(user.id, "mou.create", "mou", row.id, { version: d.version, published: publish });
  revalidatePath("/admin/agents");
  return {
    ok: publish
      ? `${d.version} is published. Every sub-agent will be asked to accept it before their next withdrawal.`
      : `${d.version} is saved as a draft. Publish it when you are ready.`,
  };
}

/** One active version at a time, so "the agreement" means one thing. */
async function publish_(versionId: string, actorId: string) {
  await db.update(schema.mouVersions).set({ active: false }).where(eq(schema.mouVersions.active, true));
  await db.update(schema.mouVersions).set({ active: true }).where(eq(schema.mouVersions.id, versionId));
  await audit(actorId, "mou.publish", "mou", versionId, {});
  const agents = await db.query.organizations.findMany({ where: eq(schema.organizations.type, "SUB_AGENT") });
  for (const a of agents) {
    await notifyUsers(await partnerRecipients(a.id), "A new agreement to accept", "Read it and accept it before your next withdrawal.", "/agreement");
  }
}

export async function publishMouAction(formData: FormData) {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  const id = String(formData.get("versionId"));
  const row = await db.query.mouVersions.findFirst({ where: eq(schema.mouVersions.id, id) });
  if (!row || row.active) return;
  await publish_(id, user.id);
  revalidatePath("/admin/agents");
}

const acceptShape = z.object({
  versionId: z.string().min(1),
  typedName: z.string().trim().min(3, "Type your full name"),
  agree: z.string().optional(),
});

/**
 * A partner accepting the agreement.
 *
 * What is kept is what would be needed if it were ever questioned: who pressed
 * it, the name they typed, the day, and where from. The screen says plainly that
 * this is a record of acceptance and not a signature in law, because pretending
 * otherwise would be the dishonest part.
 */
export async function acceptMouAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER"]);
  const parsed = acceptShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Type your full name to accept." };
  const { versionId, typedName, agree } = parsed.data;
  if (!agree) return { fieldErrors: { agree: ["Tick to accept"] }, error: "Tick the box to accept." };

  const version = await db.query.mouVersions.findFirst({ where: and(eq(schema.mouVersions.id, versionId), eq(schema.mouVersions.active, true)) });
  if (!version) return { error: "That version is no longer the one being asked for. Open the page again." };

  const head = await headers();
  await db
    .insert(schema.mouAcceptances)
    .values({
      orgId: user.orgId,
      mouVersionId: version.id,
      acceptedById: user.id,
      acceptedName: typedName,
      ipAddress: (head.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      userAgent: head.get("user-agent"),
    })
    .onConflictDoNothing({ target: [schema.mouAcceptances.orgId, schema.mouAcceptances.mouVersionId] });
  await audit(user.id, "mou.accept", "organization", user.orgId, { version: version.version, name: typedName });
  await notifyUsers(await adminIds(), "Agreement accepted", `${user.orgName} accepted ${version.version}`, "/admin/agents?tab=agreement");
  revalidatePath("/agreement");
  revalidatePath("/wallet");
  return { ok: `Accepted ${version.version}. A copy stays on this page.` };
}

// ---------- Referral rates ----------

const rateShape = z.object({
  orgId: z.string().trim().optional(),
  kind: z.enum(["SHARE_OF_COMMISSION", "FLAT_PER_ENROLMENT"]),
  percent: z.string().trim().optional(),
  flatAmountInr: z.string().trim().optional(),
  activeFrom: z.string().trim().min(1, "From when"),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});

/**
 * A referral rate, added rather than edited so an old figure can still be read
 * back. A share carries a percentage and a flat fee carries an amount; one rate
 * never carries both, because then nobody could say which applied.
 */
export async function saveAgentRateAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = rateShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const percent = d.percent ? Number(d.percent) : null;
  const flat = d.flatAmountInr ? Math.round(Number(d.flatAmountInr)) : null;
  if (d.kind === "SHARE_OF_COMMISSION") {
    if (percent == null || Number.isNaN(percent) || percent <= 0 || percent > 100) return { fieldErrors: { percent: ["A share between 0 and 100"] }, error: "Give the share as a percentage." };
    if (flat != null) return { error: "A share and a fixed amount cannot both be on one rate." };
  } else {
    if (flat == null || Number.isNaN(flat) || flat <= 0) return { fieldErrors: { flatAmountInr: ["An amount in rupees"] }, error: "Give the amount per enrolment." };
    if (percent != null) return { error: "A share and a fixed amount cannot both be on one rate." };
  }

  const [row] = await db
    .insert(schema.agentRates)
    .values({
      orgId: d.orgId || null,
      kind: d.kind,
      percent: d.kind === "SHARE_OF_COMMISSION" ? percent : null,
      flatAmountInr: d.kind === "FLAT_PER_ENROLMENT" ? flat : null,
      activeFrom: d.activeFrom,
      note: d.note,
      createdById: user.id,
    })
    .returning();
  await audit(user.id, "agent.rate", "agent_rate", row.id, { orgId: d.orgId || null, kind: d.kind, percent, flat });
  revalidatePath("/admin/agents");
  return { ok: d.orgId ? "Rate saved for that sub-agent." : "Platform rate saved. It applies to every sub-agent without one of their own." };
}

export async function deleteAgentRateAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("rateId"));
  const used = await db.query.referralEarnings.findFirst({ where: eq(schema.referralEarnings.rateId, id) });
  if (used) return;
  await db.delete(schema.agentRates).where(eq(schema.agentRates.id, id));
  await audit(user.id, "agent.rate.delete", "agent_rate", id, {});
  revalidatePath("/admin/agents");
}

// ---------- Referring a lead ----------

const referralShape = z.object({
  name: z.string().trim().min(2, "The person's name"),
  phone: z.string().trim().min(8, "A mobile number"),
  email: z.string().trim().toLowerCase().email("A working email address").optional().or(z.literal("")).transform((v) => v || null),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  interestCountry: z.string().trim().max(80).optional().transform((v) => v || null),
  interestPathway: z.enum(["DEGREE", "AUSBILDUNG", "NURSING"]).optional(),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
  consent: z.string().optional(),
});

/**
 * A sub-agent sending a lead to Medcity.
 *
 * It lands as an enquiry owned by the head office, with the sub-agent recorded
 * as the referrer. The desk then passes it to a branch, and the ownership moves
 * while the referrer does not, because the referrer is who gets paid.
 */
export async function submitReferralAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  if (org?.type !== "SUB_AGENT") return { error: "Referrals are for sub-agents. Register the student yourself from Students." };

  const parsed = referralShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!d.consent) return { fieldErrors: { consent: ["Confirm you have their permission"] }, error: "Confirm the person agreed to being referred." };

  const settings = await getSettings();
  if (settings.requireMouBeforePortal) {
    const standing = await mouStanding(user.orgId);
    if (standing.version && !standing.accepted) return { error: "Accept the agreement first. It is on the Agreement page." };
  }

  // The same number twice from the same sub-agent is the same lead again.
  const digits = phoneKey(d.phone);
  const already = await db.query.enquiries.findFirst({
    where: and(
      eq(schema.enquiries.submittedByOrgId, user.orgId),
      sql`right(regexp_replace(${schema.enquiries.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`,
    ),
  });
  if (already) return { error: `You have already referred that number: ${already.name}.` };

  const desk = await db.query.organizations.findFirst({ where: eq(schema.organizations.type, "HQ") });
  if (!desk) return { error: "The head office is not set up. Tell the Overseas team." };

  const [row] = await db
    .insert(schema.enquiries)
    .values({
      orgId: desk.id,
      createdById: user.id,
      submittedByOrgId: user.orgId,
      name: d.name,
      phone: d.phone,
      email: d.email,
      city: d.city,
      source: "REFERRAL",
      stage: "NEW",
      interestCountry: d.interestCountry,
      interestPathway: d.interestPathway,
      notes: d.notes,
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60_000),
    })
    .returning();
  await db.insert(schema.enquiryNotes).values({
    enquiryId: row.id,
    authorId: user.id,
    body: `Referred by ${user.orgName}. The sub-agent confirmed the person agreed to being referred.`,
    stageAfter: "NEW",
  });
  await audit(user.id, "referral.submit", "enquiry", row.id, { agent: user.orgId });
  await notifyUsers(await adminIds(), "A sub-agent has referred somebody", `${d.name} · ${d.phone} · from ${user.orgName}`, "/admin/agents?tab=referrals");
  revalidatePath("/referrals");
  return { redirectTo: "/referrals?sent=1" };
}

const assignShape = z.object({ enquiryId: z.string().min(1), orgId: z.string().min(1) });

/** The desk passing a referral to the branch that will work it. */
export async function assignReferralAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = assignShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick the branch to give it to." };
  const { enquiryId, orgId } = parsed.data;

  const enquiry = await db.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
  if (!enquiry?.submittedByOrgId) return { error: "That is not a sub-agent's referral." };
  if (enquiry.studentId) return { error: "That one is already registered as a student." };
  const branch = await db.query.organizations.findFirst({ where: and(eq(schema.organizations.id, orgId), ne(schema.organizations.type, "SUB_AGENT")) });
  if (!branch) return { error: "Pick a branch or the head office." };

  // A referral needs an owner inside the branch as well, or it lands in a list
  // nobody is accountable for.
  const owner = await db.query.users.findFirst({
    where: and(eq(schema.users.orgId, branch.id), eq(schema.users.role, "PARTNER"), eq(schema.users.active, true)),
  });

  await db
    .update(schema.enquiries)
    .set({ orgId: branch.id, assignedToId: owner?.id ?? null, updatedAt: new Date() })
    .where(eq(schema.enquiries.id, enquiryId));
  await db.insert(schema.enquiryNotes).values({
    enquiryId,
    authorId: user.id,
    body: `Given to ${branch.name} to work.`,
    stageAfter: enquiry.stage,
  });
  await audit(user.id, "referral.assign", "enquiry", enquiryId, { to: branch.id });
  await notifyUsers(await partnerRecipients(branch.id, owner?.id ?? null), "A referral for you to work", `${enquiry.name} · ${enquiry.phone}`, `/enquiries/${enquiryId}`);
  if (enquiry.submittedByOrgId) {
    await notifyUsers(await partnerRecipients(enquiry.submittedByOrgId), "Your referral has been picked up", `${enquiry.name} is with ${branch.name}.`, "/referrals");
  }
  revalidatePath("/admin/agents");
  return { ok: `${enquiry.name} is with ${branch.name}.` };
}

// ---------- The desk's hand on an earning ----------

const priceShape = z.object({
  earningId: z.string().min(1),
  amountInr: z.string().trim().min(1, "An amount in rupees"),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});

/**
 * Putting a figure on an earning by hand.
 *
 * For the cases a rate cannot answer: a commission in a currency with no rate
 * on file, or a figure agreed on the phone. It credits the wallet if the earning
 * is already payable, and leaves it alone if it is not.
 */
export async function priceEarningAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = priceShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Give the amount in rupees." };
  const { earningId, note } = parsed.data;
  const amount = Math.round(Number(parsed.data.amountInr));
  if (Number.isNaN(amount) || amount <= 0) return { fieldErrors: { amountInr: ["An amount in rupees"] }, error: "Give the amount in rupees." };

  const earning = await db.query.referralEarnings.findFirst({ where: eq(schema.referralEarnings.id, earningId), with: { student: true } });
  if (!earning) return { error: "That earning is no longer there." };
  if (earning.state === "PAID" || earning.state === "CANCELLED") return { error: "That one is settled already." };

  await db
    .update(schema.referralEarnings)
    .set({ amountInr: amount, note: note ?? earning.note, updatedAt: new Date() })
    .where(eq(schema.referralEarnings.id, earningId));

  // Payable and not yet credited: the wallet gets it now. Pending earnings wait
  // for the money to come in, which is what pending means.
  if (earning.state === "PAYABLE" && !earning.walletEntryId) {
    const [entry] = await db
      .insert(schema.walletEntries)
      .values({
        orgId: earning.orgId,
        kind: "REFERRAL",
        amountInr: amount,
        reference: earning.student.medcityId,
        note: `Referral fee for ${earning.student.firstName} ${earning.student.lastName}`,
        createdById: user.id,
      })
      .returning();
    await db.update(schema.referralEarnings).set({ walletEntryId: entry.id, updatedAt: new Date() }).where(eq(schema.referralEarnings.id, earningId));
    await notifyUsers(await partnerRecipients(earning.orgId), "Referral fee credited to your wallet", `For ${earning.student.firstName} ${earning.student.lastName}`, "/wallet");
  }
  await audit(user.id, "agent.earning.price", "referral_earning", earningId, { amount });
  revalidatePath("/admin/agents");
  return { ok: "Saved." };
}

const cancelShape = z.object({ earningId: z.string().min(1), reason: z.string().trim().min(5, "Why").max(300) });

/** Cancelling an earning, with the reason the sub-agent will read. */
export async function cancelEarningAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = cancelShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say why it is cancelled." };
  const { earningId, reason } = parsed.data;
  const earning = await db.query.referralEarnings.findFirst({ where: eq(schema.referralEarnings.id, earningId) });
  if (!earning) return { error: "That earning is no longer there." };
  if (earning.walletEntryId) return { error: "That one is already in their wallet. Use a wallet adjustment instead, so the ledger still adds up." };
  await db
    .update(schema.referralEarnings)
    .set({ state: "CANCELLED", cancelledReason: reason, updatedAt: new Date() })
    .where(eq(schema.referralEarnings.id, earningId));
  await audit(user.id, "agent.earning.cancel", "referral_earning", earningId, { reason });
  revalidatePath("/admin/agents");
  return { ok: "Cancelled. The sub-agent sees the reason." };
}

// ---------- Settings ----------

const settingsShape = z.object({
  agentSignupOpen: z.string().optional(),
  requireMouBeforePortal: z.string().optional(),
  minWithdrawalInr: z.string().trim().optional(),
});

export async function saveAgentSettingsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["SUPER_ADMIN"]);
  const parsed = settingsShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the highlighted fields." };
  const d = parsed.data;
  const typed = d.minWithdrawalInr?.trim();
  // Left empty means no minimum, which is different from a minimum of nought.
  const minimum = typed ? Math.round(Number(typed)) : null;
  if (minimum != null && (Number.isNaN(minimum) || minimum < 0)) return { fieldErrors: { minWithdrawalInr: ["A figure in rupees, or leave it empty"] }, error: "Check the minimum." };

  await db
    .update(schema.appSettings)
    .set({
      agentSignupOpen: d.agentSignupOpen === "on" || d.agentSignupOpen === "true",
      requireMouBeforePortal: d.requireMouBeforePortal === "on" || d.requireMouBeforePortal === "true",
      minWithdrawalInr: minimum,
      updatedById: user.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.appSettings.id, "app"));
  await audit(user.id, "settings.agents", "settings", "app", { minimum, signupOpen: d.agentSignupOpen === "on" });
  revalidatePath("/admin/agents");
  revalidatePath("/settings/platform");
  return { ok: minimum == null ? "Saved. There is no minimum withdrawal." : `Saved. The minimum withdrawal is ₹${minimum.toLocaleString("en-IN")}.` };
}

// ---------- Used by the student registration path ----------

/**
 * Opens the referral earning when a referred enquiry becomes a student. Kept
 * here so the students action does not have to know how earnings work.
 */
export async function openEarningForStudent(studentId: string, referredByOrgId: string) {
  await openReferralEarning(studentId, referredByOrgId);
}
