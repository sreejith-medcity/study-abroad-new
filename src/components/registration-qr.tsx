import Link from "next/link";
import QRCode from "qrcode";
import { publicFormUrl } from "@/server/public-form";
import { Card } from "@/components/ui";
import { IconGlobe } from "@/components/icons";

/**
 * The branch's own registration link, as a code somebody can print.
 *
 * It existed already, three screens deep in the admin area, where a branch
 * head would find it once and never again. On the dashboard it is the thing
 * a counter actually uses: scan it at the desk and the student fills their
 * own details in, which is a form the branch does not have to type.
 *
 * Drawn as inline SVG, so it needs no image host and prints sharply at any
 * size somebody chooses to blow it up to.
 */
export async function RegistrationQr({
  slug,
  enabled,
  orgName,
}: {
  slug: string | null;
  enabled: boolean;
  orgName: string;
}) {
  if (!enabled || !slug) return null;
  const url = publicFormUrl(slug);
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 104,
    errorCorrectionLevel: "M",
    color: { dark: "#1b1420", light: "#ffffff" },
  });

  return (
    <Card className="flex flex-wrap items-center gap-4 p-4">
      <div
        className="shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-line"
        // From the QR library, not from anything anybody typed.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="min-w-48 flex-1">
        <p className="font-display text-base font-semibold text-ink">Student registration code</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">
          Print it for the {orgName} counter. Whoever scans it fills in their own details, and the enquiry lands here with a
          follow-up due the next day.
        </p>
        <Link
          href={url}
          target="_blank"
          className="mt-1.5 inline-flex items-center gap-1.5 break-all font-mono text-xs text-brand-600 hover:underline"
        >
          <IconGlobe className="size-3.5 shrink-0" />
          {url}
        </Link>
      </div>
    </Card>
  );
}
