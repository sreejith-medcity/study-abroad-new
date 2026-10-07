"use client";

import { useEffect } from "react";
import { Crash } from "@/components/crash";

/** A crash inside the portal, with the sidebar and the shell still around it. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Portal screen crashed:", error);
  }, [error]);
  return <Crash error={error} reset={reset} />;
}
