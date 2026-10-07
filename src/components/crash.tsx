"use client";

import { useEffect, useState } from "react";

/**
 * What a crash looks like, instead of a white page.
 *
 * Next's own screen says "a client-side exception has occurred" and nothing
 * else, which tells the person nothing and tells us less. This one names the
 * error, carries the digest the server log can be matched against, and gives
 * two ways out.
 *
 * It also handles the one crash that is nobody's mistake: a deploy went out
 * while somebody had a screen open, so the script the page asks for next is no
 * longer on the server. That is a stale page, not a broken portal, so it
 * reloads itself once and carries on.
 */
export function Crash({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const stale = /ChunkLoadError|Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    `${error.name}: ${error.message}`,
  );
  const [reloading, setReloading] = useState(stale);

  useEffect(() => {
    if (!stale) return;
    // Once only: a reload loop on a genuinely broken build is worse than the
    // crash, so the flag survives the reload and stops the second attempt.
    let already = false;
    try {
      already = sessionStorage.getItem("portal-reloaded-after-deploy") === "1";
      sessionStorage.setItem("portal-reloaded-after-deploy", "1");
    } catch {
      // Private browsing, or storage turned off. Reload anyway.
    }
    if (already) {
      setReloading(false);
      return;
    }
    window.location.reload();
  }, [stale]);

  useEffect(() => {
    if (stale) return;
    try {
      sessionStorage.removeItem("portal-reloaded-after-deploy");
    } catch {
      // Nothing to clear.
    }
  }, [stale]);

  if (reloading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-sm text-muted">A new version of the portal went out while this screen was open. Loading it now.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-lg font-semibold">This screen stopped working</h1>
      <p className="mt-2 text-sm text-muted">
        Nothing you typed has been sent, and nothing on the file has changed. Try it again, and if it keeps happening send us the two lines below.
      </p>
      <div className="mt-4 rounded-lg border border-line bg-surface-2/60 px-3.5 py-3 text-[13px]">
        <p className="break-words font-mono">{error.message || error.name || "No message was given."}</p>
        {error.digest && <p className="mt-1 break-words font-mono text-muted">Reference {error.digest}</p>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {reset && (
          <button type="button" onClick={reset} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
            Try again
          </button>
        )}
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium">
          Reload the page
        </button>
        <a href="/dashboard" className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium">
          Back to the dashboard
        </a>
      </div>
    </div>
  );
}
