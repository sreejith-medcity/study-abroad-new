import { notFound } from "next/navigation";
import { orgForPublicSlug } from "@/server/public-form";
import { Card, Logo } from "@/components/ui";
import { IconCheck } from "@/components/icons";

export const metadata = { title: "Thank you · Medcity Overseas" };

export default async function ThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await orgForPublicSlug(slug);
  if (!org) notFound();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <Card className="w-full max-w-md p-7 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-good-50 text-good-700">
          <IconCheck className="size-6" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-semibold text-ink">We have your details</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Someone from {org.name}
          {org.city ? `, ${org.city}` : ""} will call you within a working day. Keep your qualification certificates and passport
          handy for that conversation.
        </p>
        <div className="mt-6 border-t border-line pt-5">
          <Logo tone="dark" className="mx-auto" />
          <p className="mt-2 text-[12px] text-muted">Medcity International Overseas Corporation</p>
        </div>
      </Card>
    </main>
  );
}
