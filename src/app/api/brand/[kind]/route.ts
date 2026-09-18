import { NextResponse } from "next/server";
import { getSettings } from "@/server/settings";
import { readUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Serves the uploaded logo or favicon. Public on purpose: the sign-in page, the
 * public enquiry form and the browser's favicon request all reach it before
 * anyone has signed in. It only ever returns the two files a super admin chose.
 */
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "logo" && kind !== "favicon") return new NextResponse("Not found", { status: 404 });

  const settings = await getSettings();
  const key = kind === "logo" ? settings.logoKey : settings.faviconKey;
  const type = (kind === "logo" ? settings.logoMimeType : settings.faviconMimeType) ?? "image/png";

  if (!key) {
    // No artwork uploaded: hand back the drawn mark so a favicon request still
    // gets something rather than a 404 in the console on every page.
    return new NextResponse(FALLBACK_SVG, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const bytes = await readUpload(key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        // The key changes on every upload, so a long cache is safe and the new
        // artwork still appears at once.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#c01f53"/><path d="M8 25C8 16 12.4 9.3 20.2 6.3c-.9 4.2-2.5 7.4-4.7 9.9C13.3 18.7 10.8 21.6 8 25z" fill="#f7ec22"/><path d="M14 25c0-7.7 3.8-13.6 11.1-16.6-.9 3.9-2.4 7-4.5 9.4C18.6 20.2 16.4 22.5 14 25z" fill="#fff"/></svg>`;
