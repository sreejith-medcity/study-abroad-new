"use client";

import { ActionForm } from "@/components/action-form";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { portalMessageAction, portalUploadAction } from "./actions";

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
  return (
    <ActionForm action={portalUploadAction} hideSubmit className="space-y-2">
      <input type="hidden" name="typeCode" value={typeCode} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          aria-label={`${chooseLabel}: ${label}`}
          className="max-w-64 py-1.5 text-[13px]"
        />
        <Button type="submit" variant="secondary" size="sm">{uploadLabel}</Button>
      </div>
    </ActionForm>
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
