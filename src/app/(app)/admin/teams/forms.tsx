"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { Button, Select } from "@/components/ui";
import { addTeamMemberAction, createTeamAction } from "./actions";

export function NewTeamForm() {
  return (
    <ActionForm action={createTeamAction} submitLabel="Add the team" resetOnSuccess>
      <TextField label="Name" name="name" required placeholder="Ausbildung" />
      <TextField label="What it covers" name="note" placeholder="Nursing and care pathways into Germany" />
    </ActionForm>
  );
}

export function AddMemberForm({ teamId, people }: { teamId: string; people: { id: string; name: string; deskLabel: string | null }[] }) {
  return (
    <ActionForm action={addTeamMemberAction} hideSubmit className="space-y-2" resetOnSuccess>
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`add-${teamId}`} className="sr-only">
          Somebody to add
        </label>
        <Select id={`add-${teamId}`} name="userId" defaultValue="" className="w-56 py-1.5 text-[13px]">
          <option value="" disabled>
            Add somebody
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.deskLabel ?? p.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
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
