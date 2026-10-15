"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { UPLOAD_ACCEPT, refusalFromStatus, sizeRefusal } from "@/lib/uploads";
import { portalMessageAction } from "./actions";

export function PortalUploadForm({
  typeCode,
  label,
  chooseLabel,
  uploadLabel,
}: {
  typeCode: string;
  label: string;
  chooseLabel: string;
  uploadLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const busy = percent !== null;

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file first.");
    const tooBig = sizeRefusal(file);
    if (tooBig) return setError(tooBig);
    setError(null);
    setPercent(0);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/portal-document");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setPercent(Math.round((ev.loaded / ev.total) * 95));
    xhr.onload = () => {
      setPercent(null);
      let said: { ok?: string; error?: string; goTo?: string } | null = null;
      try {
        said = JSON.parse(xhr.responseText) as { ok?: string; error?: string; goTo?: string };
      } catch {
        said = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && said?.ok) {
        form.current?.reset();
        // The row leaves "still needed" the moment it is uploaded, and any
        // message under it would go with it, so the confirmation is at the top
        // of the page the student lands on.
        router.push(said.goTo ?? "/portal/documents");
        router.refresh();
        return;
      }
      setError(said?.error ?? refusalFromStatus(xhr.status, file.size));
    };
    xhr.onerror = () => {
      setPercent(null);
      setError(refusalFromStatus(0, file.size));
    };
    xhr.send(fd);
  }

  return (
    <form ref={form} onSubmit={send} className="space-y-2" noValidate>
      {error && <Alert tone="bad">{error}</Alert>}
      <input type="hidden" name="typeCode" value={typeCode} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept={UPLOAD_ACCEPT}
          aria-label={`${chooseLabel}: ${label}`}
          className="max-w-64 py-1.5 text-[13px]"
          onChange={() => setError(null)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>{uploadLabel}</Button>
        {busy && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
            </span>
            {percent}%
          </span>
        )}
      </div>
    </form>
  );
}

export function PortalMessageForm({
  applications,
  placeholder,
  sendLabel,
}: {
  applications: { id: string; label: string }[];
  placeholder: string;
  sendLabel: string;
}) {
  return (
    <ActionForm action={portalMessageAction} hideSubmit className="space-y-2" resetOnSuccess>
      {applications.length > 1 ? (
        <Select name="applicationId" aria-label={placeholder} defaultValue={applications[0]?.id}>
          {applications.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </Select>
      ) : (
        <input type="hidden" name="applicationId" value={applications[0]?.id ?? ""} />
      )}
      <Textarea name="body" rows={3} placeholder={placeholder} aria-label={placeholder} />
      <div className="flex justify-end">
        <Button type="submit">{sendLabel}</Button>
      </div>
    </ActionForm>
  );
}
