import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Card, Logo } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const POINTS = [
  "Register students and apply to universities, Ausbildung and nursing routes in one place",
  "See exactly what each application is waiting on, and who has it",
  "Talk to the Medcity Overseas team and to students on one thread",
];

export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="brand-wash grain relative hidden flex-col justify-between p-10 lg:flex">
        <Logo className="relative z-10" />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[34px] font-semibold leading-[1.15] text-white">
            The workspace behind every Medcity student going abroad.
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
        <p className="relative z-10 text-[13px] text-white/60">Medcity International Overseas Corporation · Kerala</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <Logo tone="dark" />
          </div>
          <h2 className="font-display text-[22px] font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-[14px] text-muted">Partners, counsellors and the Medcity Overseas team.</p>
          <Card className="mt-5 p-5">
            <LoginForm />
          </Card>
          <p className="mt-4 text-center text-[13px] text-muted">
            Trouble signing in? Ask your Medcity Overseas relationship manager to reset your password.
          </p>
        </div>
      </section>
    </main>
  );
}
