"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { saveRouteAction } from "@/server/vendor-actions";
import { PAYABLE_ON } from "@/lib/vendors";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

type Vendor = { id: string; name: string; code: string; colour: string };
export type EditableRoute = {
  id: string;
  vendorId: string;
  basis: string;
  percentOfTuition: number | null;
  flatAmount: number | null;
  currency: string | null;
  payableOn: string | null;
  daysToPay: number | null;
  applicationFee: number | null;
  offerTatDays: number | null;
  vendorCourseCode: string | null;
  extraDocuments: string | null;
  interviewRequired: boolean;
  active: boolean;
};

const v = (x: string | number | null | undefined) => (x == null ? "" : String(x));

/**
 * One road to this course. Anything left blank falls back: the payment terms
 * to the vendor's, the application fee and the turnaround to the course's own.
 */
export function RouteForm({ programId, vendors, route, currency, onDone }: { programId: string; vendors: Vendor[]; route?: EditableRoute; currency: string; onDone?: () => void }) {
  const [basis, setBasis] = useState(route?.basis ?? "PERCENT_TUITION");
  return (
    <ActionForm action={saveRouteAction} submitLabel={route ? "Save the route" : "Add the route"} pendingLabel="Saving…">
      <input type="hidden" name="programId" value={programId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor" htmlFor={`route-vendor-${route?.id ?? "new"}`} required>
          <Select id={`route-vendor-${route?.id ?? "new"}`} name="vendorId" defaultValue={route?.vendorId ?? ""} disabled={!!route}>
            <option value="">Choose a vendor</option>
            {vendors.map((x) => (
              <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
            ))}
          </Select>
          {route && <input type="hidden" name="vendorId" value={route.vendorId} />}
          <FieldError name="vendorId" />
        </Field>
        <Field label="What they pay" htmlFor={`route-basis-${route?.id ?? "new"}`} required>
          <Select id={`route-basis-${route?.id ?? "new"}`} name="basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="PERCENT_TUITION">A percentage of the first year&apos;s tuition</option>
            <option value="FLAT">A flat fee</option>
          </Select>
        </Field>
      </div>
      {basis === "PERCENT_TUITION" ? (
        <Field label="Rate" htmlFor={`route-pct-${route?.id ?? "new"}`} required hint={`Of the first year, in ${currency}. Never applied to a whole-course fee.`}>
          <Input id={`route-pct-${route?.id ?? "new"}`} name="percentOfTuition" inputMode="decimal" defaultValue={v(route?.percentOfTuition)} placeholder="9" />
          <FieldError name="percentOfTuition" />
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Flat fee" htmlFor={`route-flat-${route?.id ?? "new"}`} required>
            <Input id={`route-flat-${route?.id ?? "new"}`} name="flatAmount" inputMode="numeric" defaultValue={v(route?.flatAmount)} />
            <FieldError name="flatAmount" />
          </Field>
          <Field label="In" htmlFor={`route-cur-${route?.id ?? "new"}`} required>
            <Input id={`route-cur-${route?.id ?? "new"}`} name="currency" className="uppercase" defaultValue={v(route?.currency ?? currency)} />
            <FieldError name="currency" />
          </Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Due once" htmlFor={`route-payable-${route?.id ?? "new"}`} hint="Leave blank to follow the vendor's own terms.">
          <Select id={`route-payable-${route?.id ?? "new"}`} name="payableOn" defaultValue={route?.payableOn ?? ""}>
            <option value="">As the vendor&apos;s terms say</option>
            {Object.entries(PAYABLE_ON).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Paid within, days" htmlFor={`route-days-${route?.id ?? "new"}`} hint="Blank follows the vendor.">
          <Input id={`route-days-${route?.id ?? "new"}`} name="daysToPay" inputMode="numeric" defaultValue={v(route?.daysToPay)} />
          <FieldError name="daysToPay" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Application fee" htmlFor={`route-fee-${route?.id ?? "new"}`} hint="Blank uses the course's own.">
          <Input id={`route-fee-${route?.id ?? "new"}`} name="applicationFee" inputMode="numeric" defaultValue={v(route?.applicationFee)} />
          <FieldError name="applicationFee" />
        </Field>
        <Field label="Offer in, days" htmlFor={`route-tat-${route?.id ?? "new"}`} hint="Through this route.">
          <Input id={`route-tat-${route?.id ?? "new"}`} name="offerTatDays" inputMode="numeric" defaultValue={v(route?.offerTatDays)} />
          <FieldError name="offerTatDays" />
        </Field>
        <Field label="Their course code" htmlFor={`route-code-${route?.id ?? "new"}`} hint="How this course is known in their portal.">
          <Input id={`route-code-${route?.id ?? "new"}`} name="vendorCourseCode" defaultValue={v(route?.vendorCourseCode)} />
        </Field>
      </div>
      <Field label="What this route asks for beyond the university's own list" htmlFor={`route-docs-${route?.id ?? "new"}`}>
        <Textarea id={`route-docs-${route?.id ?? "new"}`} name="extraDocuments" rows={2} defaultValue={v(route?.extraDocuments)} placeholder="Their application form, a counsellor declaration" />
      </Field>
      <Checkbox name="interviewRequired" label="This route runs its own interview before the university's" defaultChecked={route?.interviewRequired} />
      {onDone && (
        <button type="button" onClick={onDone} className="text-[13px] text-muted hover:text-ink">Cancel</button>
      )}
    </ActionForm>
  );
}

export function AddRoute({ programId, vendors, currency }: { programId: string; vendors: Vendor[]; currency: string }) {
  const [open, setOpen] = useState(false);
  if (!vendors.length) return <p className="text-[13px] text-muted">Add a vendor first, under Vendors and routes.</p>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] font-medium text-brand-600 hover:underline">
        Add a route to this course
      </button>
    );
  return <RouteForm programId={programId} vendors={vendors} currency={currency} onDone={() => setOpen(false)} />;
}

export function EditRoute({ programId, vendors, route, currency }: { programId: string; vendors: Vendor[]; route: EditableRoute; currency: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] font-medium text-brand-600 hover:underline">
        Edit
      </button>
    );
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-2/40 p-3">
      <RouteForm programId={programId} vendors={vendors} route={route} currency={currency} onDone={() => setOpen(false)} />
    </div>
  );
}
