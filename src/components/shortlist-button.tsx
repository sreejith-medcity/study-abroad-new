"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toggleShortlistAction } from "@/server/shortlist";
import { toast } from "./toast";
import { Button } from "./ui";

/**
 * Adds or removes one program on a student's shortlist.
 *
 * The label follows the server's answer directly rather than waiting for the
 * page to re-render: the refresh that follows is occasionally cancelled by the
 * router, and a button that stays on "Saving…" invites the second click that
 * takes the program straight back off. Clicks are ignored while one is saving.
 */
export function ShortlistButton({
  studentId,
  programId,
  on: initial,
  labels = { on: "Shortlisted ✓", off: "Shortlist" },
  reload = false,
}: {
  studentId: string;
  programId: string;
  on: boolean;
  labels?: { on: string; off: string };
  /** Reload the whole page afterwards, for pages whose layout depends on the list (the comparison). */
  reload?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  // Plain state, not a transition: a transition would stay pending for as long
  // as the router's refresh does, which is the very thing that can hang.
  const [pending, setPending] = useState(false);
  useEffect(() => setOn(initial), [initial]);
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "secondary" : "quiet"}
      aria-pressed={on}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const fd = new FormData();
          fd.set("studentId", studentId);
          fd.set("programId", programId);
          const result = await toggleShortlistAction(fd);
          if (reload && !result.error) {
            window.location.reload();
            return;
          }
          setOn(result.on);
          if (result.error) toast(result.error, "bad");
        } catch {
          toast("That did not save. Try again.", "bad");
        } finally {
          setPending(false);
        }
        // Counts elsewhere on the page catch up with this; the button does not depend on it.
        router.refresh();
      }}
    >
      {pending ? "Saving…" : on ? labels.on : labels.off}
    </Button>
  );
}
