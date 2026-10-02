"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { TextField, TextareaField } from "@/components/fields";
import { Button, Checkbox, Field, Input } from "@/components/ui";
import { OUTBOUND_KINDS } from "@/lib/crm-link";
import {
  createIntegrationKeyAction,
  drainNowAction,
  ignoreEventAction,
  resolveEventAction,
  retryEventAction,
  revokeIntegrationKeyAction,
  saveCrmTargetAction,
  sendTestEventAction,
  setSigningAction,
} from "@/server/crm-actions";

/**
 * A new key for the CRM to call with. The secret is shown once, in this form, so
 * the form must not be taken away by a refresh while somebody is copying it.
 */
export function NewKeyForm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New key
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="A key for the CRM"
        description="The secret is shown once and cannot be read back. Copy it before you close this."
      >
        <ActionForm action={createIntegrationKeyAction} submitLabel="Make the key" pendingLabel="Making it…">
          <TextField label="What it is for" name="name" required placeholder="Medcity CRM, staging" />
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">What it may do</legend>
            <Checkbox name="scopes" value="register" defaultChecked label="Register and update students" />
            <Checkbox name="scopes" value="lookup" defaultChecked label="Look a student up" />
            <Checkbox name="scopes" value="enquiry" defaultChecked label="Send leads in" />
            <p className="text-[12px] text-muted">Untick everything to allow all three, which is the same thing said two ways. Ticking some is narrower, and narrower is better.</p>
          </fieldset>
          <Checkbox
            name="signatureRequired"
            label="This key must sign every request"
            />
          <p className="text-[12px] leading-relaxed text-muted">
            With signing on, the secret never leaves the vendor's server: they send a signature over the body instead, so a request copied off the wire is no use
            later. With it off, the secret is sent as a bearer token, which is simpler to get started on. It can be switched on afterwards without a new key.
          </p>
        </ActionForm>
      </Modal>
    </>
  );
}

export function KeyRowActions({ keyId, signing, canSign }: { keyId: string; signing: boolean; canSign: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canSign && (
        <form action={setSigningAction}>
          <input type="hidden" name="keyId" value={keyId} />
          <input type="hidden" name="required" value={signing ? "false" : "true"} />
          <Button variant="quiet" className="py-1 text-xs">{signing ? "Allow a bearer token" : "Require signing"}</Button>
        </form>
      )}
      <form action={revokeIntegrationKeyAction}>
        <input type="hidden" name="keyId" value={keyId} />
        <Button variant="quiet" className="py-1 text-xs text-stop-700">Revoke</Button>
      </form>
    </div>
  );
}

/** Where the portal posts, and which kinds go. */
export function TargetForm({ url, enabled, kinds, hasSecret }: { url: string | null; enabled: boolean; kinds: string[]; hasSecret: boolean }) {
  return (
    <ActionForm action={saveCrmTargetAction} submitLabel="Save" pendingLabel="Saving…">
      <TextField label="Post to" name="url" type="url" defaultValue={url ?? ""} placeholder="https://crm.example.com/hooks/medcity" hint="https only. Student data does not go out in the open." />
      <Field
        label="Signing secret"
        htmlFor="crm-secret"
        hint={hasSecret ? "One is stored. Leave this blank to keep it, or type a new one to replace it." : "Optional. With one, every send carries a signature over the body instead of the secret itself."}
      >
        <Input id="crm-secret" name="secret" type="password" autoComplete="off" placeholder={hasSecret ? "Stored" : "Not set"} />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">What to send</legend>
        {(Object.keys(OUTBOUND_KINDS) as (keyof typeof OUTBOUND_KINDS)[]).map((k) => (
          <Checkbox key={k} name="kinds" value={k} defaultChecked={kinds.includes(k)} label={`${OUTBOUND_KINDS[k]} (${k})`} />
        ))}
      </fieldset>
      <Checkbox name="enabled" defaultChecked={enabled} label="Send events to the CRM" />
    </ActionForm>
  );
}

/** A real request, with the real headers, so the vendor can see one before go-live. */
export function TestEventForm() {
  return (
    <ActionForm action={sendTestEventAction} submitLabel="Send a test event" pendingLabel="Sending…" submitVariant="secondary">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Queued and sent exactly as a real event is, so what arrives carries the same shape and the same headers. It is marked <code>test: true</code> so nothing
        on their side mistakes it for a student.
      </p>
    </ActionForm>
  );
}

export function DrainNowButton() {
  return (
    <form action={drainNowAction}>
      <Button variant="quiet" className="py-1 text-xs">Send what is waiting</Button>
    </form>
  );
}

export function RetryButton({ eventId }: { eventId: string }) {
  return (
    <form action={retryEventAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <Button variant="quiet" className="py-1 text-xs">Try again</Button>
    </form>
  );
}

export function IgnoreButton({ eventId }: { eventId: string }) {
  return (
    <form action={ignoreEventAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <Button variant="quiet" className="py-1 text-xs">Nothing to do</Button>
    </form>
  );
}

/** Dealt with, and what was done, because the next person will ask. */
export function ResolveForm({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" className="py-1 text-xs" onClick={() => setOpen(true)}>
        Dealt with
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="What was done about it" description="The note stays on the row, because somebody will ask later.">
        <ActionForm action={resolveEventAction} submitLabel="Save" pendingLabel="Saving…">
          <input type="hidden" name="eventId" value={eventId} />
          <TextareaField label="What was done" name="note" rows={3} required />
        </ActionForm>
      </Modal>
    </>
  );
}
