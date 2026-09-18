import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Card } from "@/components/ui";
import { BrandLogo, BrandStyle } from "@/components/brand";
import { getSettings, signInPoints } from "@/server/settings";
import { IconCheck } from "@/components/icons";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const AUDIENCE = ["Overseas team", "Management", "Branch owners", "Counsellors", "Sub-agents"];

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const settings = await getSettings();
  const POINTS = signInPoints(settings);

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <BrandStyle />
      <section className="brand-wash grain relative hidden flex-col justify-between p-10 lg:flex">
        <BrandLogo className="relative z-10" />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[34px] font-semibold leading-[1.15] text-white">
            {settings.signInHeadline}
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
        <div className="relative z-10">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">One sign in, five views</p>
          <ul className="mb-5 flex flex-wrap gap-1.5">
            {AUDIENCE.map((who) => (
              <li key={who} className="rounded-full bg-white/12 px-2.5 py-1 text-[12px] font-medium text-white/85 ring-1 ring-inset ring-white/15">
                {who}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-white/60">{settings.organisationName}</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <BrandLogo tone="dark" />
          </div>
          <h2 className="font-display text-[22px] font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-[14px] text-muted">
            Your dashboard is built around your role, so sign in and you land on the work that is yours.
          </p>
          <Card className="mt-5 p-5">
            <LoginForm />
          </Card>
          <div className="mt-4 space-y-2 text-[13px] text-muted">
            <p>
              <span className="font-medium text-ink">First time here?</span> Your one-time password works once, then the portal asks you
              to set your own.
            </p>
            <p>
              <span className="font-medium text-ink">Locked out?</span> Ask your {settings.organisationName} relationship manager to
              issue a new one. Repeated wrong attempts pause sign in for ten minutes.
            </p>
            {(settings.supportEmail || settings.supportPhone) && (
              <p>
                <span className="font-medium text-ink">Need help?</span>{" "}
                {settings.supportEmail && (
                  <a href={`mailto:${settings.supportEmail}`} className="text-brand-600 hover:underline">
                    {settings.supportEmail}
                  </a>
                )}
                {settings.supportEmail && settings.supportPhone ? " · " : ""}
                {settings.supportPhone}
                {settings.supportHours ? ` · ${settings.supportHours}` : ""}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
