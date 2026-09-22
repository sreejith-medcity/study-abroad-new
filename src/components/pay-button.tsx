"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmPaymentAction, startFeePaymentAction } from "@/server/payments";
import { toast } from "./toast";
import { Button } from "./ui";

type RazorpayHandler = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayCtor = new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: { error?: { description?: string } }) => void) => void };

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Checkout did not load")));
    s.onerror = () => reject(new Error("Checkout could not be reached"));
    document.body.appendChild(s);
  });
}

/** Pays an application fee through Razorpay Checkout, then has the server verify it. */
export function PayFeeButton({ applicationId, label }: { applicationId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      const start = await startFeePaymentAction(applicationId);
      if (!start.ok) {
        toast(start.error, "bad");
        return;
      }
      const Razorpay = await loadCheckout();
      const rzp = new Razorpay({
        key: start.keyId,
        order_id: start.orderId,
        amount: start.amountMinor,
        currency: start.currency,
        name: "Medcity Overseas",
        description: start.description,
        prefill: { name: start.name, email: start.email, contact: start.phone },
        handler: async (r: RazorpayHandler) => {
          const done = await confirmPaymentAction({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
          toast(done.ok ? "Paid. The fee is marked paid." : done.error ?? "Could not verify the payment.", done.ok ? "ok" : "bad");
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (r) => toast(r.error?.description ?? "The payment failed.", "bad"));
      rzp.open();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size="sm" onClick={pay} disabled={busy}>
      {busy ? "Opening…" : label}
    </Button>
  );
}
