import Link from "next/link";
import QRCode from "qrcode";
import { publicFormUrl } from "@/server/public-form";
import { Button, Chip } from "@/components/ui";
import { IconGlobe } from "@/components/icons";
import { resetPublicSlugAction, togglePublicFormAction } from "./actions";

/**
 * The branch's own enquiry link and its QR code, rendered as inline SVG so the
 * page needs no image host and the code prints sharply at any size.
 */
export async function PublicFormPanel({
  orgId,
  orgName,
  slug,
  enabled,
  enquiries,
}: {
  orgId: string;
  orgName: string;
  slug: string | null;
  enabled: boolean;
  enquiries: number;
}) {
  const url = slug ? publicFormUrl(slug) : null;
  const svg = url
    ? await QRCode.toString(url, { type: "svg", margin: 1, width: 132, errorCorrectionLevel: "M", color: { dark: "#1b1420", light: "#ffffff" } })
    : null;

  return (
    <details className="border-t border-line px-4 py-3" open={enabled && enquiries === 0}>
      <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-brand-600">
        <IconGlobe className="size-4" /> Public enquiry form
        {enabled ? <Chip tone="ok">Open</Chip> : <Chip>Closed</Chip>}
      </summary>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        {enabled && svg && url ? (
          <>
            <div
              className="shrink-0 rounded-lg border border-line bg-white p-2"
              // The SVG comes from the QR library, not from user input.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <div className="min-w-48 flex-1 space-y-2">
              <p className="text-[13px] text-muted">
                Print this for the {orgName} counter. Anyone who scans it lands on a form that files an enquiry straight into this
                branch, with a follow-up due the next day.
              </p>
              <Link href={url} target="_blank" className="block break-all font-mono text-[12px] text-brand-600 hover:underline">
                {url}
              </Link>
              <p className="text-xs text-muted">{enquiries} enquiries have come in through the form.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <form action={togglePublicFormAction}>
                  <input type="hidden" name="orgId" value={orgId} />
                  <Button type="submit" variant="quiet" size="sm">Close the form</Button>
                </form>
                <form action={resetPublicSlugAction}>
                  <input type="hidden" name="orgId" value={orgId} />
                  <Button type="submit" variant="quiet" size="sm" title="Use this if a printed code has to be retired">
                    New link
                  </Button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="max-w-lg text-[13px] text-muted">
              Opening the form gives {orgName} a link and a QR code for its counter, posters and WhatsApp. Submissions arrive as
              enquiries owned by this branch. No sign in, and nothing else about the branch is exposed.
            </p>
            <form action={togglePublicFormAction}>
              <input type="hidden" name="orgId" value={orgId} />
              <Button type="submit" variant="secondary" size="sm">Open the form for this branch</Button>
            </form>
          </div>
        )}
      </div>
    </details>
  );
}
