"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { saveLostReasonAction, saveRoutingRuleAction } from "./actions";

export type RuleValues = {
  id?: string;
  name?: string;
  orgId?: string | null;
  source?: string | null;
  pathway?: string | null;
  method?: string;
  assignToId?: string | null;
  priority?: number;
  active?: boolean;
};

type Person = { id: string; name: string; orgId: string; role: string };

const SOURCES: [string, string][] = [
  ["WALK_IN", "Walk in"],
  ["PHONE", "Phone call"],
  ["WHATSAPP", "WhatsApp"],
  ["WEBSITE", "Website"],
  ["REFERRAL", "Referral"],
  ["EVENT", "Event or seminar"],
  ["SOCIAL", "Social media"],
  ["OTHER", "Other"],
];

/**
 * A routing rule. The head office picks the branch, or every branch; a branch
 * head's rule is their own branch's and the choice is not offered. The person
 * list follows the branch chosen, so nobody can be named at a branch they do
 * not work at.
 */
export function RoutingRuleForm({
  values = {},
  orgs,
  people,
  fixedOrgId,
}: {
  values?: RuleValues;
  orgs: { id: string; name: string }[];
  people: Person[];
  /** Set for a branch head: their branch, not offered as a choice. */
  fixedOrgId?: string;
}) {
  const [orgId, setOrgId] = useState(fixedOrgId ?? values.orgId ?? "");
  const [method, setMethod] = useState(values.method ?? "ROUND_ROBIN");
  const here = people.filter((p) => p.orgId === orgId);
  return (
    <ActionForm action={saveRoutingRuleAction} submitLabel={values.id ? "Save rule" : "Add rule"} pendingLabel="Saving…" resetOnSuccess={!values.id}>
      {values.id && <input type="hidden" name="ruleId" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <TextField label="Name" name="name" required defaultValue={values.name ?? ""} placeholder="Website Ausbildung enquiries to Anu" />
        <TextField label="Order" name="priority" type="number" min="1" max="999" defaultValue={values.priority ?? 100} hint="Lower goes first" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {fixedOrgId ? (
          <input type="hidden" name="orgId" value={fixedOrgId} />
        ) : (
          <SelectField label="Branch" name="orgId" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Every branch</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </SelectField>
        )}
        <SelectField label="Source" name="source" defaultValue={values.source ?? ""}>
          <option value="">Any source</option>
          {SOURCES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </SelectField>
        <SelectField label="Pathway" name="pathway" defaultValue={values.pathway ?? ""}>
          <option value="">Any pathway</option>
          <option value="DEGREE">University degree</option>
          <option value="AUSBILDUNG">Ausbildung (Germany)</option>
          <option value="NURSING">Nurse registration</option>
          <option value="FSJ">FSJ, Freiwilliges Soziales Jahr (Germany)</option>
          <option value="BFD">BFD, Bundesfreiwilligendienst (Germany)</option>
          <option value="NCLEX">NCLEX-RN (USA nurse licensing)</option>
          <option value="WEITERBILDUNG">Weiterbildung (Germany: further training and nurse recognition)</option>
          <option value="CCM">CCM</option>
        </SelectField>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Goes to</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="method" value="ROUND_ROBIN" checked={method === "ROUND_ROBIN"} onChange={() => setMethod("ROUND_ROBIN")} />
          Round robin across the branch&apos;s active counsellors, fewest open enquiries first
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="method" value="PERSON" checked={method === "PERSON"} onChange={() => setMethod("PERSON")} />
          A named person
        </label>
      </fieldset>
      {method === "PERSON" && (
        <SelectField label="Person" name="assignToId" defaultValue={values.assignToId ?? ""} hint={orgId ? undefined : "Pick the branch first"}>
          <option value="">Pick who gets these</option>
          {here.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </SelectField>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={values.active ?? true} /> Rule is on
      </label>
    </ActionForm>
  );
}

/** Adding a reason, or renaming one. */
export function LostReasonForm({ values = {} }: { values?: { id?: string; label?: string; sortOrder?: number } }) {
  return (
    <ActionForm action={saveLostReasonAction} submitLabel={values.id ? "Save" : "Add reason"} pendingLabel="Saving…" resetOnSuccess={!values.id}>
      {values.id && <input type="hidden" name="reasonId" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <TextField label="Reason" name="label" required defaultValue={values.label ?? ""} placeholder="Family decided against it" />
        <TextField label="Order" name="sortOrder" type="number" min="0" defaultValue={values.sortOrder ?? 100} />
      </div>
    </ActionForm>
  );
}
