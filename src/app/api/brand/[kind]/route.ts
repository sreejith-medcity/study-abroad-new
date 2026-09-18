import { NextResponse } from "next/server";
import { getSettings } from "@/server/settings";
import { readUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Serves the uploaded logo or favicon. Public on purpose: the sign-in page, the
 * public enquiry form and the browser's own favicon request all reach it before
 * anyone has signed in. It only ever returns the two files a super admin chose.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "logo" && kind !== "favicon") return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  // The settings page asks with ?v=<key>, which is safe to cache hard. A browser
  // asking for the plain URL must be able to see a replacement straight away, so
  // that one revalidates every time and answers 304 while the artwork is unchanged.
  const versioned = url.searchParams.has("v");

  const settings = await getSettings();
  const key = kind === "logo" ? settings.logoKey : settings.faviconKey;
  const type = (kind === "logo" ? settings.logoMimeType : settings.faviconMimeType) ?? "image/png";
  const tag = `"${kind}-${key ?? "drawn"}"`;

  if (request.headers.get("if-none-match") === tag) {
    return new NextResponse(null, { status: 304, headers: { ETag: tag, "Cache-Control": cache(versioned) } });
  }

  if (!key) {
    // No artwork uploaded: hand back the drawn mark so a favicon request still
    // gets something rather than a 404 in the console on every page.
    return new NextResponse(FALLBACK_SVG, {
      headers: { "Content-Type": "image/svg+xml", ETag: tag, "Cache-Control": cache(versioned) },
    });
  }

  try {
    const bytes = await readUpload(key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": type, ETag: tag, "Cache-Control": cache(versioned) },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

function cache(versioned: boolean) {
  return versioned ? "public, max-age=86400, immutable" : "public, max-age=0, must-revalidate";
}

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#c01f53"/><path d="M8 25C8 16 12.4 9.3 20.2 6.3c-.9 4.2-2.5 7.4-4.7 9.9C13.3 18.7 10.8 21.6 8 25z" fill="#f7ec22"/><path d="M14 25c0-7.7 3.8-13.6 11.1-16.6-.9 3.9-2.4 7-4.5 9.4C18.6 20.2 16.4 22.5 14 25z" fill="#fff"/></svg>`;
