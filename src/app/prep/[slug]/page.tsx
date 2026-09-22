import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { orgForPrepSlug } from "@/server/public-form";
import { getSettings } from "@/server/settings";
import { PREP_TEST_LABEL } from "@/lib/prep";
import { Card, Chip } from "@/components/ui";
import { OrgBrandLogo, OrgBrandStyle } from "@/components/brand";
import { ToastHost } from "@/components/toast";
import { PrepEnquiryForm } from "./form";

export const metadata = { title: "Test preparation" };

const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(n)}`;

/** A branch's own test preparation page: Medcity's courses, in the branch's look. */
export default async function PrepPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ course?: string }> }) {
  const { slug } = await params;
  const { course } = await searchParams;
  const org = await orgForPrepSlug(slug);
  if (!org) notFound();
  const settings = await getSettings();
  const courses = await db.select().from(schema.prepCourses).where(eq(schema.prepCourses.published, true)).orderBy(asc(schema.prepCourses.sortOrder), asc(schema.prepCourses.title));
  const label = org.portalName ?? org.name;

  return (
    <main className="min-h-screen bg-ground">
      <OrgBrandStyle org={org} />
      <ToastHost />
      <header className="brand-wash grain relative px-4 py-10 md:px-10">
        <div className="relative z-10 mx-auto max-w-5xl">
          <OrgBrandLogo org={org} />
          <h1 className="mt-6 max-w-2xl font-display text-[30px] font-semibold leading-tight text-white">Get the score your university asks for</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/85">
            Test preparation with {label}{org.city ? `, ${org.city}` : ""}, taught with {settings.organisationName}&apos;s practice platform.
          </p>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-3">
          {courses.length === 0 && <p className="text-muted">Courses are being updated. Leave your details and we will call you.</p>}
          {courses.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="brand">{PREP_TEST_LABEL[c.test as keyof typeof PREP_TEST_LABEL] ?? c.test}</Chip>
                <h2 className="font-display text-[17px] font-semibold text-ink">{c.title}</h2>
              </div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{c.summary}</p>
              <p className="mt-2 text-[13px] text-muted">
                {c.mode}
                {c.durationWeeks ? ` · ${c.durationWeeks} week${c.durationWeeks === 1 ? "" : "s"}` : ""}
                {" · "}
                {c.feeInr != null ? (c.feeInr === 0 ? "Free" : inr(c.feeInr)) : "Fee on request"}
              </p>
              <a href={`?course=${c.id}#enquire`} className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">Ask about this course</a>
            </Card>
          ))}
        </section>
        <aside id="enquire" className="scroll-mt-6">
          <Card className="p-5">
            <h2 className="font-display text-[18px] font-semibold text-ink">Talk to us</h2>
            <p className="mb-4 mt-1 text-[13px] text-muted">We will call you within a working day about batches and dates.</p>
            <PrepEnquiryForm slug={slug} courses={courses.map((c) => ({ id: c.id, label: `${c.title} (${PREP_TEST_LABEL[c.test as keyof typeof PREP_TEST_LABEL] ?? c.test})` }))} preselect={courses.some((c) => c.id === course) ? course : undefined} />
          </Card>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">We use your details only to answer this enquiry. Ask us at any time to correct or delete them.</p>
        </aside>
      </div>
    </main>
  );
}
