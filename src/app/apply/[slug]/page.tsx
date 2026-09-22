import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { orgForPublicSlug } from "@/server/public-form";
import { Card } from "@/components/ui";
import { OrgBrandLogo, OrgBrandStyle } from "@/components/brand";
import { ToastHost } from "@/components/toast";
import { getSettings } from "@/server/settings";
import { IconCheck } from "@/components/icons";
import { PublicEnquiryForm } from "./form";

export const metadata = { title: "Enquire · Medcity Overseas" };

const POINTS = [
  "University degrees, Ausbildung in Germany and nurse registration, all from one counter",
  "A counsellor who stays with you from the first call to the day you fly",
  "Every step of your application visible to you, in writing",
];

/** The public face of a branch. No sign in, one enquiry, nothing else exposed. */
export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await orgForPublicSlug(slug);
  if (!org) notFound();
  const countries = await db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  const settings = await getSettings();

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <OrgBrandStyle org={org} />
      <ToastHost />
      <section className="brand-wash grain relative hidden flex-col justify-between p-10 lg:flex">
        <OrgBrandLogo org={org} className="relative z-10" />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[32px] font-semibold leading-[1.15] text-white">
            Tell us what you want to study, and we will take it from there.
          </h1>
          <ul className="mt-7 space-y-3">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-2.5 text-[15px] leading-relaxed text-white/85">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/20">
                  <IconCheck className="size-3.5" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-[13px] text-white/60">
          {org.name}
          {org.city ? ` · ${org.city}` : ""} · {settings.organisationName}
        </p>
      </section>

      <section className="px-4 py-10 md:px-10">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-6 lg:hidden">
            <OrgBrandLogo org={org} tone="dark" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            {org.name}
            {org.city ? ` · ${org.city}` : ""}
          </p>
          <h2 className="mt-1 font-display text-[24px] font-semibold text-ink">Start your enquiry</h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            Two minutes now, and a counsellor from this branch will call you. Nothing is charged and nothing is committed.
          </p>
          <Card className="mt-5 p-5">
            <PublicEnquiryForm slug={slug} countries={countries.map((c) => c.name)} questions={org.signupQuestions} />
          </Card>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            We use your details only to answer this enquiry. Ask us at any time to correct or delete them.
          </p>
          {(settings.supportEmail || settings.supportPhone) && (
            <p className="mt-2 text-[12px] text-muted">
              Questions before you send this? {settings.supportPhone}
              {settings.supportEmail ? ` · ${settings.supportEmail}` : ""}
              {settings.supportHours ? ` · ${settings.supportHours}` : ""}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
