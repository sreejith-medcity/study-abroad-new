"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Input, Select } from "@/components/ui";
import { uploadDocumentAction } from "./actions";

/** What the server accepts. Kept here too so an oversize file never leaves the browser. */
const MAX_MB = 10;

/**
 * Catching the file before it is sent.
 *
 * A file the server will not take used to be found out the hard way: the
 * upload went up, something between the browser and the app refused it, and
 * what came back was not an answer the page could read, so the screen died
 * with "an unexpected response was received from the server" and the
 * counsellor had no idea it was about the size of their scan.
 */
function tooBig(fd: FormData): string | null {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose a file to upload.";
  if (file.size > MAX_MB * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That file is ${mb} MB and the limit is ${MAX_MB} MB. Scan it again at a lower quality, or split it, and upload it again.`;
  }
  return null;
}

export function UploadForm({ studentId, types, defaultType, compact }: { studentId: string; types: { code: string; label: string }[]; defaultType?: string; compact?: boolean }) {
  const idBase = `${defaultType ?? "any"}-${studentId}`;
  // "Something else" is only useful if the next person can tell what it was,
  // so choosing it asks for the name of the document.
  const [typeCode, setTypeCode] = useState(defaultType ?? "");
  const named = typeCode === "OTHER";
  return (
    <ActionForm action={uploadDocumentAction} beforeSubmit={tooBig} submitLabel="Upload" pendingLabel="Uploading…" resetOnSuccess submitVariant={compact ? "secondary" : "primary"} className={compact ? "space-y-2" : undefined}>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-center gap-2">
        {defaultType ? (
          <input type="hidden" name="typeCode" value={defaultType} />
        ) : (
          <>
            <label htmlFor={`type-${idBase}`} className="sr-only">Document type</label>
            <Select id={`type-${idBase}`} name="typeCode" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className="w-auto">
              <option value="" disabled>Document type</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </Select>
          </>
        )}
        {named && (
          <>
            <label htmlFor={`label-${idBase}`} className="sr-only">What this document is</label>
            <Input id={`label-${idBase}`} name="label" placeholder="What is it? e.g. Experience certificate" className="w-64" />
          </>
        )}
        <label htmlFor={`file-${idBase}`} className="sr-only">File</label>
        <input id={`file-${idBase}`} type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs" />
      </div>
    </ActionForm>
  );
}
