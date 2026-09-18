import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Medcity Overseas Portal", template: "%s · Medcity Overseas" },
  description: "Study abroad application platform for Medcity Overseas partners, counsellors and students",
  // Served from the brand route, so an uploaded favicon takes effect without a deploy.
  icons: { icon: [{ url: "/api/brand/favicon" }], apple: [{ url: "/api/brand/favicon" }] },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen text-[15px] antialiased">{children}</body>
    </html>
  );
}
