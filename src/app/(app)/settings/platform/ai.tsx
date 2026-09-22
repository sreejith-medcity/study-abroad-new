"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { saveAiSettingsAction } from "@/server/ai-settings";

type Props = { keySet: boolean; envKey: boolean; model: string; enabled: boolean; assistant: boolean; interview: boolean; autofill: boolean; quota: Record<string, number> };

export function AiSettingsForm(p: Props) {
  return (
    <ActionForm action={saveAiSettingsAction} submitLabel="Save AI settings" pendingLabel="Saving…">
      <div className="grid gap-3 sm:grid-cols-2">
        {p.envKey ? (
          <p className="text-[13px] text-muted sm:col-span-2">The key comes from the server&apos;s environment (ANTHROPIC_API_KEY).<input type="hidden" name="apiKey" value="" /></p>
        ) : (
          <TextField id="ai-key" label="Anthropic API key" name="apiKey" type="password" autoComplete="new-password" hint={p.keySet ? "Set. Leave blank to keep it." : "Not set"} />
        )}
        <TextField id="ai-model" label="Model" name="model" defaultValue={p.model} hint="As Anthropic names it" />
      </div>
      <fieldset className="grid gap-1.5 text-sm">
        <legend className="mb-1 text-[13px] font-medium text-ink-soft">Features</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={p.enabled} className="size-4" /> AI switched on</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="assistant" defaultChecked={p.assistant} className="size-4" /> Assistant</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="interview" defaultChecked={p.interview} className="size-4" /> Practice interviews</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="autofill" defaultChecked={p.autofill} className="size-4" /> Reading documents into the profile</label>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-ink-soft">Requests a branch may make a month, by tier</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {["SILVER", "GOLD", "ELITE", "PLATINUM"].map((t) => (
            <TextField key={t} id={`ai-q-${t}`} label={t.charAt(0) + t.slice(1).toLowerCase()} name={t} type="number" min={0} defaultValue={String(p.quota[t] ?? 0)} />
          ))}
        </div>
      </fieldset>
    </ActionForm>
  );
}
