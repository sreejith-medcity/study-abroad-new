"use client";

import { useRef, useState } from "react";
import { askAssistantAction, type ChatTurn } from "@/server/ai-actions";
import { RichText } from "@/components/rich-text";
import { Button, Textarea, cn } from "@/components/ui";

const STARTERS = [
  "Master's in data science in Ireland with IELTS 6.0",
  "Nursing programs in the UK with a January intake",
  "What does a student need for a German Ausbildung?",
];

export function AssistantChat({ left }: { left: number | null }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(left);
  const end = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: ChatTurn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    setError(null);
    const r = await askAssistantAction(next);
    setBusy(false);
    if (r.ok) {
      setTurns([...next, { role: "assistant", text: r.text }]);
      setRemaining(r.left);
    } else setError(r.error);
    setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-3 p-4" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-muted">Ask about programs in the catalogue, entry requirements or the application process. Figures come only from the catalogue.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-ink-soft hover:border-brand-300 hover:text-brand-700">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed", t.role === "user" ? "ml-auto bg-brand-600 text-white" : "bg-surface-2 text-ink")} data-role={t.role}>
            {t.role === "assistant" ? <RichText text={t.text} /> : t.text}
          </div>
        ))}
        {busy && <p className="text-[13px] text-muted">Looking it up…</p>}
        {error && <p className="text-[13px] text-red-700" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="ask" className="sr-only">Your question</label>
        <Textarea
          id="ask"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="Ask a question"
          className="flex-1"
        />
        <Button type="submit" disabled={busy || !draft.trim()}>Ask</Button>
      </form>
      {remaining != null && <p className="px-3 pb-2 text-right text-xs text-muted">{remaining} AI requests left for your branch this month</p>}
    </div>
  );
}
