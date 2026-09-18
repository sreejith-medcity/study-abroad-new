import { requireUser } from "@/lib/auth";
import { canManageSettings, ROLE_LABEL } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { SubTabs } from "@/components/tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tabs = [
    { href: "/settings", label: "Profile" },
    { href: "/settings/security", label: "Security" },
    ...(user.role === "PARTNER" ? [{ href: "/settings/branch", label: "Branch" }] : []),
    ...(canManageSettings(user) ? [{ href: "/settings/platform", label: "Platform" }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${user.orgName} · ${ROLE_LABEL[user.role]}`}
        title="Settings"
        subtitle="Your details, how you sign in, and the values the portal runs on."
      />
      <SubTabs tabs={tabs} label="Settings sections" />
      <div className="max-w-3xl space-y-5">{children}</div>
    </div>
  );
}
