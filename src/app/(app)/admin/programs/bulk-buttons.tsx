"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

/** Publish and back-to-draft for a whole filter, saying so while a large batch runs. */
export function BulkStatusButtons({ total }: { total: number }) {
  const { pending, data } = useFormStatus();
  const doing = pending ? data?.get("to") : null;
  return (
    <>
      <Button name="to" value="LIVE" size="sm" variant="secondary" disabled={pending}>
        {doing === "LIVE" ? `Publishing ${total.toLocaleString("en-IN")}…` : "Publish"}
      </Button>
      <Button name="to" value="DRAFT" size="sm" variant="quiet" disabled={pending}>
        {doing === "DRAFT" ? "Moving back…" : "Back to draft"}
      </Button>
    </>
  );
}
