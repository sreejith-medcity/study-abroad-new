"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Textarea } from "@/components/ui";
import { saveDocumentTypeAction } from "@/server/document-types";

export function DocumentTypeForm({ code, label, guidance, sampleFileName }: { code: string; label: string; guidance: string | null; sampleFileName: string | null }) {
  return (
    <ActionForm action={saveDocumentTypeAction} submitLabel={`Save ${label}`} pendingLabel="Saving…" submitVariant="secondary">
      <input type="hidden" name="code" value={code} />
      <label htmlFor={`g-${code}`} className="text-[13px] font-medium text-ink-soft">Guidance for {label}</label>
      <Textarea id={`g-${code}`} name="guidance" rows={2} defaultValue={guidance ?? ""} placeholder="What a good one looks like: who issues it, what it must show, how recent it must be" className="mt-1" />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <label htmlFor={`s-${code}`} className="font-medium text-ink-soft">{sampleFileName ? "Replace the sample" : "Sample file"}</label>
        <input id={`s-${code}`} type="file" name="sample" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs" />
        {sampleFileName && (
          <>
            <a href={`/api/document-samples/${code}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{sampleFileName}</a>
            <label className="flex items-center gap-1.5"><input type="checkbox" name="removeSample" /> Remove the sample</label>
          </>
        )}
      </div>
      <FieldError name="sample" />
    </ActionForm>
  );
}
