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
