import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Medcity Overseas Portal", template: "%s · Medcity Overseas" },
  description: "Study abroad application platform for Medcity Overseas partners and students",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-sm antialiased">{children}</body>
    </html>
  );
}
