"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { saveVendorAction } from "@/server/vendor-actions";
import { PAYABLE_ON, VENDOR_COLOURS } from "@/lib/vendors";
import { NAMING_TOKENS, PACK_SHAPES } from "@/lib/pack";
import { Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";

export type EditableVendor = {
  id: string;
  name: string;
  code: string;
  colour: string;
  isDirect: boolean;
  packShape: string;
  packNaming: string | null;
  packLimitMb: number | null;
  currency: string;
  payableOn: string;
  daysToPay: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  portalUrl: string | null;
  billingName: string | null;
  billingAddress: string | null;
  gstin: string | null;
  notes: string | null;
};

const v = (x: string | number | null) => (x == null ? "" : String(x));

/**
 * One vendor. The colour and the code travel together everywhere in the
 * portal, so they are chosen together here.
 */
export function VendorForm({ vendor, onDone }: { vendor?: EditableVendor; onDone?: () => void }) {
  const [colour, setColour] = useState(vendor?.colour ?? VENDOR_COLOURS[0].value);
  return (
    <ActionForm action={saveVendorAction} submitLabel={vendor ? "Save" : "Add the vendor"} pendingLabel="Saving…">
      {vendor && <input type="hidden" name="vendorId" value={vendor.id} />}
      <input type="hidden" name="colour" value={colour} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="vendor-name" required>
          <Input id="vendor-name" name="name" defaultValue={v(vendor?.name ?? "")} placeholder="KC Overseas" />
          <FieldError name="name" />
        </Field>
        <Field label="Code" htmlFor="vendor-code" required hint="Two to four letters, shown beside the colour on every screen.">
          <Input id="vendor-code" name="code" defaultValue={v(vendor?.code ?? "")} placeholder="KC" className="uppercase" />
          <FieldError name="code" />
        </Field>
      </div>
      <Field label="Colour" htmlFor="vendor-colour" hint="Every row, chip and report uses it, always with the code beside it.">
        <div className="flex flex-wrap gap-2" id="vendor-colour">
          {VENDOR_COLOURS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColour(c.value)}
              aria-pressed={colour === c.value}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]", colour === c.value ? "border-ink text-ink" : "border-line-strong text-muted")}
            >
              <span className="size-3 rounded-sm" style={{ background: c.value }} /> {c.label}
            </button>
          ))}
        </div>
        <FieldError name="colour" />
      </Field>
      <Checkbox name="isDirect" label="Medcity's own agreement with the university, not a vendor" defaultChecked={vendor?.isDirect} />
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-[13px] font-medium text-brand-700">How they want a submission pack</legend>
        <p className="mb-3 text-xs text-muted">
          Theirs to dictate, not ours. A pack sent in the wrong shape or under the wrong names is a pack that comes back, so it is recorded here once
          instead of remembered every time.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Shape" htmlFor="vendor-pack-shape" required>
            <Select id="vendor-pack-shape" name="packShape" defaultValue={vendor?.packShape ?? "FOLDER"}>
              {Object.entries(PACK_SHAPES).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
            <FieldError name="packShape" />
          </Field>
          <Field label="File names" htmlFor="vendor-pack-naming" hint={`Leave it blank for the portal's own numbering. The portal fills in ${NAMING_TOKENS.join(" ")}, and the capitals you write are the capitals you get.`}>
            <Input id="vendor-pack-naming" name="packNaming" defaultValue={v(vendor?.packNaming ?? "")} placeholder="{SURNAME}_{GIVEN}_{TYPE}" />
            <FieldError name="packNaming" />
          </Field>
          <Field label="Their upload limit" htmlFor="vendor-pack-limit" hint="Megabytes. Blank where they have not said, and then nothing is refused.">
            <Input id="vendor-pack-limit" name="packLimitMb" inputMode="numeric" defaultValue={v(vendor?.packLimitMb ?? "")} placeholder="10" />
            <FieldError name="packLimitMb" />
          </Field>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="They settle in" htmlFor="vendor-currency" required hint="The currency their invoices are raised in.">
          <Input id="vendor-currency" name="currency" defaultValue={v(vendor?.currency ?? "INR")} className="uppercase" />
          <FieldError name="currency" />
        </Field>
        <Field label="Commission is due once" htmlFor="vendor-payable" required>
          <Select id="vendor-payable" name="payableOn" defaultValue={vendor?.payableOn ?? "ENROLMENT_CONFIRMED"}>
            {Object.entries(PAYABLE_ON).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Select>
          <FieldError name="payableOn" />
        </Field>
        <Field label="Then they pay within" htmlFor="vendor-days" required hint="Days. What the invoice's due date is counted from.">
          <Input id="vendor-days" name="daysToPay" inputMode="numeric" defaultValue={v(vendor?.daysToPay ?? 60)} />
          <FieldError name="daysToPay" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Who we deal with" htmlFor="vendor-contact"><Input id="vendor-contact" name="contactName" defaultValue={v(vendor?.contactName ?? "")} /></Field>
        <Field label="Their email" htmlFor="vendor-email"><Input id="vendor-email" name="contactEmail" type="email" defaultValue={v(vendor?.contactEmail ?? "")} /><FieldError name="contactEmail" /></Field>
        <Field label="Their phone" htmlFor="vendor-phone"><Input id="vendor-phone" name="contactPhone" defaultValue={v(vendor?.contactPhone ?? "")} /></Field>
      </div>
      <Field label="Their portal" htmlFor="vendor-portal" hint="Where our team submits, for the link on an application.">
        <Input id="vendor-portal" name="portalUrl" defaultValue={v(vendor?.portalUrl ?? "")} placeholder="https://" />
        <FieldError name="portalUrl" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Billed as" htmlFor="vendor-billing"><Input id="vendor-billing" name="billingName" defaultValue={v(vendor?.billingName ?? "")} placeholder="Their legal name" /></Field>
        <Field label="GSTIN" htmlFor="vendor-gstin"><Input id="vendor-gstin" name="gstin" defaultValue={v(vendor?.gstin ?? "")} className="uppercase" /></Field>
        <Field label="Billing address" htmlFor="vendor-address"><Input id="vendor-address" name="billingAddress" defaultValue={v(vendor?.billingAddress ?? "")} /></Field>
      </div>
      <Field label="Notes" htmlFor="vendor-notes"><Textarea id="vendor-notes" name="notes" rows={2} defaultValue={v(vendor?.notes ?? "")} /></Field>
      {onDone && (
        <button type="button" onClick={onDone} className="text-[13px] text-muted hover:text-ink">
          Cancel
        </button>
      )}
    </ActionForm>
  );
}

/** Opens the form for one vendor, so the list stays readable until it is needed. */
export function EditVendor({ vendor }: { vendor: EditableVendor }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] font-medium text-brand-600 hover:underline">
        Edit
      </button>
    );
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-2/40 p-3">
      <VendorForm vendor={vendor} onDone={() => setOpen(false)} />
    </div>
  );
}
