import Link from "next/link";
import { requireGuardian } from "@/server/family";
import { translator, LOCALE_LABEL, LOCALES } from "@/lib/i18n";
import { cn } from "@/components/ui";
import { OrgBrandLogo, OrgBrandStyle } from "@/components/brand";
import { ToastHost } from "@/components/toast";
import { getSettings } from "@/server/settings";
import { IconApplications, IconDoc, IconLogout } from "@/components/icons";
import { logoutAction } from "@/app/login/actions";
import { setFamilyLocaleAction } from "./actions";

export const metadata = { title: "Family view · Medcity Overseas" };

const NAV = [
  { href: "/family", key: "home", icon: IconApplications },
  { href: "/family/documents", key: "documents", icon: IconDoc },
] as const;

/**
 * The parent's shell.
 *
 * Deliberately thinner than the student's: no messages tab, no uploads, and
 * the header says whose file this is, because a parent of two students signs
 * in twice and should never be in any doubt which one they are looking at.
 */
export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const { student, locale } = await requireGuardian();
  const t = translator(locale);
  const settings = await getSettings();

  return (
    <div className="min-h-screen bg-ground">
      <OrgBrandStyle org={student.org} />
      <ToastHost />
      <header className="brand-wash grain relative sticky top-0 z-30 px-4 py-3 md:px-6">
        <div className="relative z-10 mx-auto flex max-w-4xl items-center gap-3">
          <Link href="/family" className="rounded-lg py-1">
            <OrgBrandLogo org={student.org} />
          </Link>
          <span className="hidden text-[13px] text-white/70 sm:inline">{t("familyView")}</span>

          <div className="ml-auto flex items-center gap-2">
            <form action={setFamilyLocaleAction} className="flex items-center gap-1 rounded-full bg-white/12 p-0.5">
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

      <nav aria-label={t("familyView")} className="sticky top-[57px] z-20 border-b border-line bg-surface/95 backdrop-blur">
        <ul className="thin-scroll mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-3 py-2">
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
          <li className="ml-auto whitespace-nowrap px-2 text-[12px] text-muted">
            {t("familyFor")} {student.firstName} {student.lastName}
            {student.medcityId ? <span className="ml-1.5 font-mono">{student.medcityId}</span> : null}
          </li>
        </ul>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">{children}</main>

      <footer className="mx-auto max-w-4xl px-4 pb-10 text-center text-[12px] text-muted md:px-6">
        {student.org.name} · {settings.organisationName}
      </footer>
    </div>
  );
}
