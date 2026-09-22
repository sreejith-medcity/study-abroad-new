"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { orgForPrepSlug, orgForPublicSlug } from "@/server/public-form";
import { answerError } from "@/lib/signup-questions";
import { rateLimit } from "@/server/rate-limit";
import { notifyUsers, partnerRecipients } from "@/server/notify";

export type PublicFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> };

const CONSENT_TEXT =
  "I agree to Medcity Overseas contacting me about studying or working abroad, and to their keeping the details I have given here for that purpose.";

const shape = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(2, "Please give your full name").max(120),
  phone: z.string().trim().regex(/^\+?[\d\s-]{8,16}$/, "Please give a mobile number we can reach you on"),
  email: z.string().trim().toLowerCase().email("Please check the email address").optional().or(z.literal("")).transform((v) => v || null),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  interestPathway: z.enum(schema.pathway.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  interestCountry: z.string().trim().max(80).optional().transform((v) => v || null),
  intakeYear: z.string().optional().transform((v) => (v ? Number(v) : null)),
  message: z.string().trim().max(1000).optional().transform((v) => v || null),
  consent: z.literal("on", { message: "Please tick the consent box so we may contact you" }),
  /** Set by the branch's prep page: which course the enquiry is about. */
  prepCourse: z.string().max(40).optional(),
  // Hidden field: a real person leaves it empty, most bots fill it in.
  website: z.string().max(0).optional(),
});

export async function submitPublicEnquiryAction(_: PublicFormState, formData: FormData): Promise<PublicFormState> {
  const parsed = shape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    // A filled honeypot is silently accepted, so a bot learns nothing.
    if (fieldErrors.website) redirect(`/${formData.get("prepCourse") !== null ? "prep" : "apply"}/${String(formData.get("slug"))}/thanks`);
    return { fieldErrors, error: "Please check the highlighted fields." };
  }
  const d = parsed.data;

  const prep = d.prepCourse !== undefined;
  const org = prep ? await orgForPrepSlug(d.slug) : await orgForPublicSlug(d.slug);
  if (!org) return { error: "This form is no longer open. Please contact the branch directly." };
  const back = `/${prep ? "prep" : "apply"}/${d.slug}/thanks`;
  const course = prep && d.prepCourse ? await db.query.prepCourses.findFirst({ where: and(eq(schema.prepCourses.id, d.prepCourse), eq(schema.prepCourses.published, true)) }) : null;
  if (prep && !course) return { fieldErrors: { prepCourse: ["Please choose a course"] }, error: "Please check the highlighted fields." };
  // The branch's own questions, checked against the questions as they stand now.
  const answers: { question: string; answer: string }[] = [];
  const answerErrors: Record<string, string[]> = {};
  if (course) answers.push({ question: "Test preparation course", answer: `${course.title} (${course.test})` });
  for (const q of prep ? [] : org.signupQuestions) {
    const raw = formData.get(`qa_${q.id}`);
    const err = answerError(q, typeof raw === "string" ? raw : null);
    if (err) answerErrors[`qa_${q.id}`] = [err];
    else if (typeof raw === "string" && raw.trim()) answers.push({ question: q.label, answer: raw.trim() });
  }
  if (Object.keys(answerErrors).length) return { fieldErrors: answerErrors, error: "Please check the highlighted fields." };

  const head = await headers();
  const caller = (head.get("x-forwarded-for") ?? head.get("x-real-ip") ?? "unknown").split(",")[0].trim();
  const byIp = rateLimit(`apply:ip:${caller}`, { limit: 5, windowMs: 10 * 60 * 1000, blockMs: 30 * 60 * 1000 });
  if (!byIp.allowed) return { error: "We have had a few submissions from here already. Please try again later, or call the branch." };
  const byPhone = rateLimit(`apply:phone:${d.phone}`, { limit: 2, windowMs: 24 * 60 * 60 * 1000, blockMs: 24 * 60 * 60 * 1000 });
  if (!byPhone.allowed) return { error: "We already have your enquiry. Someone from the branch will call you." };

  // The same number twice in a day is the same person, not a new enquiry.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db.query.enquiries.findFirst({
    where: and(eq(schema.enquiries.orgId, org.id), eq(schema.enquiries.phone, d.phone), gte(schema.enquiries.createdAt, dayAgo)),
  });
  if (existing) redirect(back);

  const owner = await db.query.users.findFirst({
    where: and(eq(schema.users.orgId, org.id), eq(schema.users.role, "PARTNER"), eq(schema.users.active, true)),
  });
  if (!owner) return { error: "This form is not ready yet. Please contact the branch directly." };

  const [row] = await db
    .insert(schema.enquiries)
    .values({
      orgId: org.id,
      createdById: owner.id,
      name: d.name,
      phone: d.phone,
      email: d.email,
      city: d.city,
      source: "WEBSITE",
      stage: "NEW",
      interestCountry: d.interestCountry,
      interestPathway: d.interestPathway,
      intakeYear: d.intakeYear,
      notes: d.message,
      answers,
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();

  await db.insert(schema.enquiryNotes).values({
    enquiryId: row.id,
    body: `Came in through the branch ${prep ? "test preparation page" : "form"}.${d.message ? `\n\n"${d.message}"` : ""}\n\nConsent recorded: ${CONSENT_TEXT}`,
  });
  await audit(null, "enquiry.public_submit", "enquiry", row.id, { org: org.name, source: "WEBSITE" });
  await notifyUsers(await partnerRecipients(org.id), prep ? "New test prep enquiry" : "New enquiry from your form", `${d.name} · ${d.phone}`, `/enquiries/${row.id}`);

  redirect(back);
}
