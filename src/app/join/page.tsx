import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/server/settings";
import { Alert, Card, Logo } from "@/components/ui";
import { JoinForm } from "@/components/agent-forms";

export const metadata = { title: "Become a Medcity sub-agent" };
export const dynamic = "force-dynamic";

const POINTS = [
  "Refer a student and watch what happens to them, step by step, without ringing anybody for an update.",
  "Medcity's own team does the counselling, the applications, the documents and the visa file.",
  "You are paid per student who goes, into your own account, once Medcity has been paid.",
  "No targets, no joining fee, no exclusivity.",
];

/**
 * The page somebody lands on when they want to work with Medcity as a sub-agent.
 *
 * Open to anyone with the link and deliberately short: a name, a number, and a
 * few lines about their work. Everything else is asked on the phone, because an
 * application form that takes twenty minutes is one nobody finishes.
 */
export default async function JoinPage() {
  const settings = await getSettings();
  const branches = await db
    .select({ slug: schema.organizations.publicSlug, name: schema.organizations.name })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.active, true), eq(schema.organizations.type, "BRANCH"), isNotNull(schema.organizations.publicSlug)))
    .orderBy(asc(schema.organizations.name));

  return (
    <main className="min-h-screen bg-ground px-4 py-10 md:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <Logo className="mx-auto" />
          <h1 className="mt-6 font-display text-[30px] font-semibold leading-tight text-ink">Work with Medcity Overseas</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Send us the students you cannot place yourself, and we will take them from the first conversation to the airport.
          </p>
        </div>

        <Card className="mb-5 p-5">
          <ul className="space-y-2.5">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-soft">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" />
                {p}
              </li>
            ))}
          </ul>
        </Card>

        {settings.agentSignupOpen ? (
          <Card className="p-5">
            <h2 className="mb-1 font-display text-[17px] font-semibold text-ink">Tell us about yourself</h2>
            <p className="mb-4 text-[13px] text-muted">
              Somebody from the Overseas team will call you. Nothing here commits you to anything: the agreement comes later, in writing, and you read it before you accept it.
            </p>
            <JoinForm branches={branches.filter((b): b is { slug: string; name: string } => !!b.slug)} />
          </Card>
        ) : (
          <Alert tone="warn" title="Applications are closed just now">
            We have more applications than we can look at properly. Try again in a few weeks, or speak to your nearest Medcity branch.
          </Alert>
        )}

        <p className="mt-6 text-center text-[12px] text-muted">
          {settings.organisationName}
          {settings.supportPhone ? ` · ${settings.supportPhone}` : ""}
          {settings.supportEmail ? ` · ${settings.supportEmail}` : ""}
        </p>
      </div>
    </main>
  );
}
