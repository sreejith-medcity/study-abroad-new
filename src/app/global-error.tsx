"use client";

import { useEffect } from "react";
import { Crash } from "@/components/crash";
import "./globals.css";

/**
 * The last boundary: a crash in the root layout itself, where nothing of the
 * portal is left standing, so this one brings its own page.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Portal crashed:", error);
  }, [error]);
  return (
    <html lang="en">
      <body className="min-h-screen text-[15px] antialiased">
        <Crash error={error} reset={reset} />
      </body>
    </html>
  );
}
