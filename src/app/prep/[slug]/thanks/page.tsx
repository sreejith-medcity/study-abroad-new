import { notFound } from "next/navigation";
import { orgForPrepSlug } from "@/server/public-form";
import { Card } from "@/components/ui";
import { OrgBrandLogo, OrgBrandStyle } from "@/components/brand";
import { IconCheck } from "@/components/icons";

export const metadata = { title: "Thank you" };

export default async function PrepThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await orgForPrepSlug(slug);
  if (!org) notFound();
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <OrgBrandStyle org={org} />
      <Card className="w-full max-w-md p-7 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-good-50 text-good-700">
          <IconCheck className="size-6" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-semibold text-ink">We have your details</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Someone from {org.portalName ?? org.name}{org.city ? `, ${org.city}` : ""} will call you within a working day about batches and dates.
        </p>
        <div className="mt-6 flex justify-center border-t border-line pt-5">
          <OrgBrandLogo org={org} tone="dark" />
        </div>
      </Card>
    </main>
  );
}
