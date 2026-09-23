"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readBriefAction } from "@/server/finder-ai";
import { Button, Textarea } from "@/components/ui";
import { IconSpark } from "@/components/icons";

const EXAMPLES = [
  "B.Com graduate, 62%, IELTS 6.0, wants a master's in Canada or Ireland, budget 15 lakh, September intake",
  "Nursing student with OET B, looking at UK registration, no backlogs",
  "Plus two 78%, no IELTS yet, Ausbildung in Germany",
];

/**
 * The counsellor's own words, turned into the finder's answers.
 *
 * What it reads goes straight into the address bar, so the fields below fill
 * in and stay correctable. The rules-based reader runs whatever the AI setup
 * is; the AI only adds to it when the team has switched it on.
 */
export function BriefBox({ keys, step = "" }: { keys: readonly string[]; step?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  async function run(value: string) {
    const brief = value.trim();
    if (!brief || busy) return;
    setBusy(true);
    setText(value);
    try {
      const result = await readBriefAction(brief);
      setRead(result.read);
      setNotes(result.notes);
      const params = new URLSearchParams();
      for (const [k, v] of sp.entries()) if (keys.includes(k) && !(k in result.params)) params.append(k, v);
      for (const [k, v] of Object.entries(result.params)) params.set(k, v);
      // Stays on this screen: the fields below fill in, the reading above stays
      // on screen, and the counsellor corrects anything before moving on.
      if (step) params.set("step", step);
      router.push(`/finder?${params.toString()}`);
    } catch {
      setNotes(["That description could not be read. Fill the fields below instead."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <Textarea
        name="brief"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Describe the student"
        placeholder="Describe the student in your own words, as you would to a colleague."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => run(text)} disabled={busy || !text.trim()}>
          <IconSpark className="size-4" /> {busy ? "Reading…" : "Read this"}
        </Button>
        <span className="text-xs text-muted">Or fill the fields below yourself.</span>
      </div>
      {!read.length && !notes.length && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => run(e)} className="rounded-full border border-line-strong px-3 py-1 text-left text-[13px] text-ink-soft hover:border-brand-300 hover:text-brand-700">
              {e}
            </button>
          ))}
        </div>
      )}
      {read.length > 0 && (
        <p className="text-[13px] text-ink-soft" data-testid="brief-read">
          Taken from that: <span className="font-medium text-ink">{read.join(" · ")}</span>. The fields below are filled in; correct anything that is wrong.
        </p>
      )}
      {notes.map((n) => (
        <p key={n} className="text-[13px] text-amber-700" data-testid="brief-note">{n}</p>
      ))}
    </div>
  );
}
