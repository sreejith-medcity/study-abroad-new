import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { readSkin } from "@/lib/skins";
import { readTextSize } from "@/lib/text-size";
/*
  The type, served from this application rather than from Google.

  Every page used to wait on a stylesheet from fonts.googleapis.com before it
  could paint, which is a third party on the critical path of a portal that
  holds student files, and a request from every branch in Kerala to a server
  somewhere else. These are the same fonts as files in the bundle: no
  round trip, nothing to be blocked, and nobody told who is reading what.

  Only the weights the portal uses, and only latin, because that is what the
  portal is written in. Each one is about 25 kilobytes.
*/
import "@fontsource/plus-jakarta-sans/latin-600.css";
import "@fontsource/plus-jakarta-sans/latin-700.css";
import "@fontsource/plus-jakarta-sans/latin-800.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Medcity Overseas Portal", template: "%s · Medcity Overseas" },
  description: "Study abroad application platform for Medcity Overseas partners, counsellors and students",
  // Served from the brand route, so an uploaded favicon takes effect without a deploy.
  icons: { icon: [{ url: "/api/brand/favicon" }], apple: [{ url: "/api/brand/favicon" }] },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The surface this person chose. Read here, at the html element, so the
  // page behind the app carries it too: a dark portal with a white
  // overscroll under it is worse than no dark portal at all. Signed out,
  // there is no cookie and no query, and the default surface is used.
  const session = await getSession();
  const skin = readSkin(session?.skin);
  // Their reading size, read here for the same reason as the surface: it
  // moves the document's own font size, and every size in the portal is a
  // multiple of that one.
  const text = readTextSize(session?.textSize);
  return (
    <html lang="en" data-skin={skin} data-text={text}>
      <body className="min-h-screen text-base antialiased">{children}</body>
    </html>
  );
}
