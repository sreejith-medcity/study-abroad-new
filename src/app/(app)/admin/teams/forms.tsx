"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { Button, Select } from "@/components/ui";
import { addTeamMemberAction, applyTeamToExistingAction, createTeamAction } from "./actions";

export function NewTeamForm() {
  return (
    <ActionForm action={createTeamAction} submitLabel="Add the team" resetOnSuccess>
      <TextField label="Name" name="name" required placeholder="Ausbildung" />
      <TextField label="What it covers" name="note" placeholder="Nursing and care pathways into Germany" />
    </ActionForm>
  );
}

type Candidate = { id: string; name: string; deskLabel: string | null; orgName: string; headOffice: boolean };

export function AddMemberForm({ teamId, people }: { teamId: string; people: Candidate[] }) {
  // Grouped by where they sit, head office first: a team carries files across
  // branches, so its people can come from any of them.
  const groups = new Map<string, Candidate[]>();
  for (const p of people) {
    const key = p.headOffice ? "Head office" : p.orgName;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <ActionForm action={addTeamMemberAction} hideSubmit className="space-y-2" resetOnSuccess>
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`add-${teamId}`} className="sr-only">
          Somebody to add
        </label>
        <Select id={`add-${teamId}`} name="userId" defaultValue="" className="w-56 py-1.5 text-sm">
          <option value="" disabled>
            Add somebody
          </option>
          {[...groups].map(([where, list]) => (
            <optgroup key={where} label={where}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.deskLabel ?? p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
          <input type="checkbox" name="lead" value="1" className="size-4 rounded border-line-strong accent-brand-600" />
          Leads it
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Add
        </Button>
      </div>
    </ActionForm>
  );
}

/** The one-off run over the files already in the portal, with what it did. */
export function ApplyExistingForm({ teamId }: { teamId: string }) {
  return (
    <ActionForm action={applyTeamToExistingAction} submitLabel="Apply to existing students" className="space-y-2">
      <input type="hidden" name="teamId" value={teamId} />
    </ActionForm>
  );
}
