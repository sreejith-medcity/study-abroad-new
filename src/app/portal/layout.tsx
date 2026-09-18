import Link from "next/link";
import { requireStudent } from "@/server/portal";
import { translator, LOCALE_LABEL, LOCALES } from "@/lib/i18n";
import { Logo, cn } from "@/components/ui";
import { IconApplications, IconChat, IconDoc, IconLogout, IconStudents } from "@/components/icons";
import { logoutAction } from "@/app/login/actions";
import { setLocaleAction } from "./actions";

export const metadata = { title: "Student portal · Medcity Overseas" };

const NAV = [
  { href: "/portal", key: "home", icon: IconApplications },
  { href: "/portal/documents", key: "documents", icon: IconDoc },
  { href: "/portal/messages", key: "messages", icon: IconChat },
  { href: "/portal/profile", key: "profile", icon: IconStudents },
] as const;

/**
 * The student's own shell: nothing from the staff app, no other students, and
 * a language switch that sticks to their account.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { student, locale } = await requireStudent();
  const t = translator(locale);

  return (
    <div className="min-h-screen bg-ground">
      <header className="brand-wash grain relative sticky top-0 z-30 px-4 py-3 md:px-6">
        <div className="relative z-10 mx-auto flex max-w-4xl items-center gap-3">
          <Link href="/portal" className="rounded-lg py-1">
            <Logo />
          </Link>
          <span className="hidden text-[13px] text-white/70 sm:inline">{t("portal")}</span>

          <div className="ml-auto flex items-center gap-2">
            <form action={setLocaleAction} className="flex items-center gap-1 rounded-full bg-white/12 p-0.5">
              {LOCALES.map((code) => (
                <button
                  key={code}
                  name="locale"
                  value={code}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                    locale === code ? "bg-white text-brand-700" : "text-white/80 hover:text-white",
                  )}
                  aria-current={locale === code ? "true" : undefined}
                >
                  {LOCALE_LABEL[code]}
                </button>
              ))}
            </form>
            <form action={logoutAction}>
              <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/90 hover:bg-white/10">
                <IconLogout className="size-4" />
                <span className="hidden sm:inline">{t("signOut")}</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <nav aria-label={t("portal")} className="sticky top-[57px] z-20 border-b border-line bg-surface/95 backdrop-blur">
        <ul className="thin-scroll mx-auto flex max-w-4xl gap-1 overflow-x-auto px-3 py-2">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-brand-50 hover:text-brand-700"
              >
                <item.icon className="size-4" />
                {t(item.key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">{children}</main>

      <footer className="mx-auto max-w-4xl px-4 pb-10 text-center text-[12px] text-muted md:px-6">
        {student.org.name} · Medcity International Overseas Corporation
      </footer>
    </div>
  );
}
