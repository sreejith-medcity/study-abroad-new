"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { copyTargetsAction, saveTargetsAction } from "./actions";

type Row = { subject: string; name: string; sub?: string; values: Record<string, number | null>; actual: Record<string, number> };
const METRICS = [
  ["REGISTRATIONS", "Registrations"],
  ["APPLICATIONS", "Applications"],
  ["VISAS", "Visas"],
] as const;

/** One row per branch or person, a box per metric, with what has happened so far beside it. */
export function TargetsForm({ month, rows, label }: { month: string; rows: Row[]; label: string }) {
  return (
    <ActionForm action={saveTargetsAction} submitLabel="Save targets">
      <input type="hidden" name="month" value={month} />
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" data-targets-form>
          <thead>
            <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
              <th className="px-3 py-2">{label}</th>
              {METRICS.map(([, l]) => (
                <th key={l} className="px-3 py-2">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subject} className="border-b border-line/70 last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium text-ink">{r.name}</span>
                  {r.sub && <span className="block text-2xs text-muted">{r.sub}</span>}
                </td>
                {METRICS.map(([key]) => {
                  const name = `t:${r.subject}:${key}`;
                  return (
                    <td key={key} className="px-3 py-2">
                      <input
                        name={name}
                        aria-label={`${r.name}, ${key.toLowerCase()} target`}
                        inputMode="numeric"
                        defaultValue={r.values[key] ?? ""}
                        placeholder="None"
                        className="h-9 w-24 rounded-lg border border-line-strong bg-surface px-2.5 tabular"
                      />
                      <span className="ml-2 text-2xs text-muted">{r.actual[key]} so far</span>
                      <FieldError name={name} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ActionForm>
  );
}

export function CopyLastMonth({ month, subjects }: { month: string; subjects: string[] }) {
  return (
    <ActionForm action={copyTargetsAction} submitLabel="Copy last month's" submitVariant="secondary" className="space-y-0">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="subjects" value={subjects.join(",")} />
    </ActionForm>
  );
}
