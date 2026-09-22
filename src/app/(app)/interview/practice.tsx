"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { interviewTurnAction, type Line } from "@/server/ai-actions";
import { INTERVIEW_KINDS } from "@/lib/interview";
import { RichText } from "@/components/rich-text";
import { Button, Select, Textarea, cn } from "@/components/ui";

export function InterviewPractice({ apps, preselect }: { apps: { id: string; label: string }[]; preselect?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("UK_CREDIBILITY");
  const [appId, setAppId] = useState(preselect ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = lines.length > 0;
  const asked = lines.filter((l) => l.role === "interviewer").length;

  const step = async (transcript: Line[]) => {
    setBusy(true);
    setError(null);
    const r = await interviewTurnAction({ kind, applicationId: appId || null, transcript });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.question) setLines([...transcript, { role: "interviewer", text: r.question }]);
    if (r.feedback) {
      setLines(transcript);
      setFeedback(r.feedback);
      router.refresh();
    }
  };

  if (!started) {
    return (
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="iv-kind" className="text-[13px] font-medium text-ink-soft">Interview</label>
            <Select id="iv-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1">
              {Object.entries(INTERVIEW_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="iv-app" className="text-[13px] font-medium text-ink-soft">For an application (optional)</label>
            <Select id="iv-app" value={appId} onChange={(e) => setAppId(e.target.value)} className="mt-1">
              <option value="">General practice</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted">Six questions, then feedback. Only the course, university, country and intake are sent to the AI service, never the student&apos;s name or documents. Each question uses one of the branch&apos;s AI requests.</p>
        {error && <p className="text-[13px] text-red-700" role="alert">{error}</p>}
        <Button type="button" onClick={() => step([])} disabled={busy}>{busy ? "Starting…" : "Start the interview"}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {lines.map((l, i) => (
        <div key={i} className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed", l.role === "student" ? "ml-auto bg-brand-600 text-white" : "bg-surface-2 text-ink")} data-role={l.role}>
          {l.role === "interviewer" && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Question {lines.slice(0, i + 1).filter((x) => x.role === "interviewer").length}</p>}
          {l.text}
        </div>
      ))}
      {feedback ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4" data-testid="feedback">
          <h2 className="mb-2 font-display text-[16px] font-semibold">Feedback</h2>
          <RichText text={feedback} className="text-[14px] leading-relaxed" />
          <p className="mt-3 text-xs text-muted">Saved below with the transcript.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) {
              const t: Line[] = [...lines, { role: "student", text: answer.trim() }];
              setLines(t);
              setAnswer("");
              step(t);
            }
          }}
          className="space-y-2"
        >
          <label htmlFor="iv-answer" className="sr-only">Answer</label>
          <Textarea id="iv-answer" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="The student's answer, in their words" />
          {error && <p className="text-[13px] text-red-700" role="alert">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Question {asked} of 6</span>
            <Button type="submit" disabled={busy || !answer.trim()}>{busy ? "Thinking…" : asked >= 6 ? "Answer and get feedback" : "Answer"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
