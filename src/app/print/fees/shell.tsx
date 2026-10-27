import type { ReactNode } from "react";
import { PrintButton } from "@/components/print-button";

/** A page of paper: the document and nothing of the app around it. */
export function PaperShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto my-6 max-w-3xl bg-white p-8 text-[13px] text-[#1f1a24] shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none">
      <div className="mb-4 flex justify-end" data-print="hide">
        <PrintButton />
      </div>
      {children}
    </main>
  );
}

export function PaperHead({ seller, gstin, state, address, title, number, date }: { seller: string; gstin: string | null; state: string | null; address: string | null; title: string; number: string; date: string }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-6 border-b border-[#e6e1eb] pb-4">
      <div>
        <p className="text-[16px] font-semibold">{seller}</p>
        {address && <p className="text-[#6b6275]">{address}</p>}
        <p className="text-[#6b6275]">
          {gstin ? `GSTIN ${gstin}` : "GSTIN not recorded"}
          {state ? ` · ${state}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="text-[18px] font-bold uppercase tracking-wide">{title}</p>
        <p className="font-mono">{number}</p>
        <p className="text-[#6b6275]">{date}</p>
      </div>
    </div>
  );
}
