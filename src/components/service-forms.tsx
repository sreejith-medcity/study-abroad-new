"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SERVICE_HINT, SERVICE_LABEL, SERVICE_STATUSES, SERVICE_TYPES, STATUS_LABEL, type ServiceType } from "@/lib/services";
import { requestServiceAction, updateServiceAction } from "@/server/services";

export function RequestServiceForm({ studentId }: { studentId: string }) {
  const [type, setType] = useState<ServiceType | "">("");
  return (
    <ActionForm action={requestServiceAction} submitLabel="Send request" resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      <Field label="Service" htmlFor="svc-type" required>
        <Select id="svc-type" name="type" value={type} onChange={(e) => setType(e.target.value as ServiceType)}>
          <option value="">Choose</option>
          {SERVICE_TYPES.map((t) => <option key={t} value={t}>{SERVICE_LABEL[t]}</option>)}
        </Select>
        <FieldError name="type" />
      </Field>
      <Field label="What is needed" htmlFor="svc-details" required hint={type ? SERVICE_HINT[type] : undefined}>
        <Textarea id="svc-details" name="details" rows={3} />
        <FieldError name="details" />
      </Field>
    </ActionForm>
  );
}

export function UpdateServiceForm({ id, status, provider, teamNote }: { id: string; status: string; provider: string | null; teamNote: string | null }) {
  return (
    <ActionForm action={updateServiceAction} submitLabel="Save" submitVariant="secondary">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Status" htmlFor={`svc-status-${id}`}>
          <Select id={`svc-status-${id}`} name="status" defaultValue={status}>
            {SERVICE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Provider" htmlFor={`svc-provider-${id}`}>
          <Input id={`svc-provider-${id}`} name="provider" defaultValue={provider ?? ""} placeholder="Bank, forex house, housing provider" />
        </Field>
      </div>
      <Field label="Note for the partner" htmlFor={`svc-note-${id}`}>
        <Textarea id={`svc-note-${id}`} name="teamNote" rows={2} defaultValue={teamNote ?? ""} />
      </Field>
    </ActionForm>
  );
}
