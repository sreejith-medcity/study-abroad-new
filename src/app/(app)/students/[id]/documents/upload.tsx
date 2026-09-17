"use client";

import { ActionForm } from "@/components/action-form";
import { Select } from "@/components/ui";
import { uploadDocumentAction } from "./actions";

export function UploadForm({ studentId, types, defaultType, compact }: { studentId: string; types: { code: string; label: string }[]; defaultType?: string; compact?: boolean }) {
  const idBase = `${defaultType ?? "any"}-${studentId}`;
  return (
    <ActionForm action={uploadDocumentAction} submitLabel="Upload" pendingLabel="Uploading…" resetOnSuccess submitVariant={compact ? "secondary" : "primary"} className={compact ? "space-y-2" : undefined}>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-center gap-2">
        {defaultType ? (
          <input type="hidden" name="typeCode" value={defaultType} />
        ) : (
          <>
            <label htmlFor={`type-${idBase}`} className="sr-only">Document type</label>
            <Select id={`type-${idBase}`} name="typeCode" defaultValue="" className="w-auto">
              <option value="" disabled>Document type</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </Select>
          </>
        )}
        <label htmlFor={`file-${idBase}`} className="sr-only">File</label>
        <input id={`file-${idBase}`} type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs" />
      </div>
    </ActionForm>
  );
}
