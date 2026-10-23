"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Select } from "@/components/ui";
import { toast } from "@/components/toast";
import { MAX_UPLOAD_MB, UPLOAD_ACCEPT, refusalFromStatus, sizeRefusal } from "@/lib/uploads";

/**
 * Putting a document on a student's file.
 *
 * This used to be a server action, and a counsellor uploading a certificate
 * got a dead screen reading "an unexpected response was received from the
 * server". That answer was not the app's: a file is the one thing big enough
 * for whatever sits in front of the app to refuse on its own, and a server
 * action cannot read a refusal it did not write, so React treated the page as
 * broken.
 *
 * The file is posted to a route now, with a plain request the browser can read
 * the status of. Anything that comes back, from the app or from in front of
 * it, becomes a sentence under the form instead of a lost screen, and the bar
 * shows the file going up so a slow line looks like a slow line rather than a
 * hang.
 */
export function UploadForm({
  studentId,
  types,
  defaultType,
  compact,
  replacesId,
  fileLabel,
}: {
  studentId: string;
  types: { code: string; label: string }[];
  defaultType?: string;
  compact?: boolean;
  /**
   * The file this upload replaces. The old one is kept as an earlier version;
   * the server takes the type from it, so no type is asked for.
   */
  replacesId?: string;
  /** What the file picker is called to a screen reader, where a row has several. */
  fileLabel?: string;
}) {
  const idBase = replacesId ? `replace-${replacesId}` : `${defaultType ?? "any"}-${studentId}`;
  // "Something else" is only useful if the next person can tell what it was,
  // so choosing it asks for the name of the document. A replacement keeps the
  // name the old file had.
  const [typeCode, setTypeCode] = useState(defaultType ?? "");
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const named = typeCode === "OTHER";
  const busy = percent !== null;

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    const tooBig = sizeRefusal(file);
    if (tooBig) return setError(tooBig);
    setError(null);
    setPercent(0);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/document");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setPercent(Math.round((ev.loaded / ev.total) * 95));
    xhr.onload = () => {
      setPercent(null);
      // An answer in the app's own words, whatever the status. Anything else
      // came from in front of the app and has to be read from the status.
      let said: { ok?: string; error?: string } | null = null;
      try {
        said = JSON.parse(xhr.responseText) as { ok?: string; error?: string };
      } catch {
        said = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && said?.ok) {
        form.current?.reset();
        setTypeCode(defaultType ?? "");
        toast(said.ok);
        router.refresh();
        return;
      }
      setError(said?.error ?? refusalFromStatus(xhr.status, file.size));
    };
    xhr.onerror = () => {
      setPercent(null);
      setError(refusalFromStatus(0, file.size));
    };
    xhr.onabort = () => setPercent(null);
    xhr.send(fd);
  }

  return (
    <form ref={form} onSubmit={send} className={compact ? "space-y-2" : "space-y-3"} noValidate>
      {error && <Alert tone="bad">{error}</Alert>}
      <input type="hidden" name="studentId" value={studentId} />
      {replacesId && <input type="hidden" name="replacesId" value={replacesId} />}
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
        {named && !replacesId && (
          <>
            <label htmlFor={`label-${idBase}`} className="sr-only">What this document is</label>
            <Input id={`label-${idBase}`} name="label" placeholder="What is it? e.g. Experience certificate" className="w-64" />
          </>
        )}
        <label htmlFor={`file-${idBase}`} className="sr-only">{fileLabel ?? "File"}</label>
        <input id={`file-${idBase}`} type="file" name="file" accept={UPLOAD_ACCEPT} className="text-xs" onChange={() => setError(null)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={compact ? "secondary" : "primary"} disabled={busy}>
          {busy ? "Uploading…" : replacesId ? "Upload replacement" : "Upload"}
        </Button>
        {busy && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
            </span>
            {percent}%
          </span>
        )}
        {!compact && !busy && <span className="text-xs text-muted">PDF, JPG, PNG or WebP, up to {MAX_UPLOAD_MB} MB.</span>}
      </div>
    </form>
  );
}
