import { brandStyle, getSettings } from "@/server/settings";
import { Logo, cn } from "./ui";

/**
 * Emits the brand palette as custom properties, so every screen follows the
 * colour set in platform settings. Rendered near the top of each shell.
 */
export async function BrandStyle() {
  const settings = await getSettings();
  return <style dangerouslySetInnerHTML={{ __html: brandStyle(settings) }} />;
}

/**
 * The uploaded logo when a super admin has set one, and the drawn mark with the
 * configured portal name otherwise.
 */
export async function BrandLogo({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const settings = await getSettings();
  if (settings.logoKey) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={`/api/brand/logo?v=${settings.logoKey.slice(-12)}`}
        alt={settings.portalName}
        className={cn("h-8 w-auto max-w-[12rem] object-contain", className)}
      />
    );
  }
  const words = settings.portalName.trim().split(/\s+/);
  return <Logo tone={tone} className={className} primary={words[0]} secondary={words.slice(1).join(" ")} />;
}

type OrgBrand = { id: string; name: string; portalName: string | null; portalColor: string | null; portalLogoKey: string | null };

/** The branch's own colour, where it set one, on the student portal and its form. */
export async function OrgBrandStyle({ org }: { org: OrgBrand }) {
  if (!org.portalColor) return <BrandStyle />;
  const settings = await getSettings();
  return <style dangerouslySetInnerHTML={{ __html: brandStyle({ ...settings, brandColor: org.portalColor }) }} />;
}

/** The branch's logo or name where it set them, with the platform named beside it; the platform's own brand otherwise. */
export async function OrgBrandLogo({ org, tone = "light", className }: { org: OrgBrand; tone?: "light" | "dark"; className?: string }) {
  if (!org.portalLogoKey && !org.portalName) return <BrandLogo tone={tone} className={className} />;
  const settings = await getSettings();
  const label = org.portalName ?? org.name;
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {org.portalLogoKey ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={`/api/org-logo/${org.id}?v=${org.portalLogoKey.slice(-12)}`} alt={label} className="h-8 w-auto max-w-[10rem] rounded bg-white/90 object-contain p-0.5" />
      ) : (
        <span className={cn("font-display text-[16px] font-semibold", tone === "light" ? "text-white" : "text-ink")}>{label}</span>
      )}
      <span className={cn("text-[11px] leading-tight", tone === "light" ? "text-white/70" : "text-muted")}>with {settings.organisationName}</span>
    </span>
  );
}
