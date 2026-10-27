"use client";

import { ActionForm } from "@/components/action-form";
import { Button, Input, Select } from "@/components/ui";
import { addPersonToFileAction, giveToTeamMemberAction } from "./team-actions";

/** Common parts, offered so the same work is not written five ways. */
const PARTS = ["Documents", "Applications", "Visa", "Ticketing", "Forex", "Insurance", "Accommodation", "Loan"];

export function AddPersonForm({ studentId, people }: { studentId: string; people: { id: string; name: string; deskLabel: string | null }[] }) {
  return (
    <ActionForm action={addPersonToFileAction} hideSubmit className="space-y-2" resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`who-${studentId}`} className="sr-only">Somebody to put on this file</label>
        <Select id={`who-${studentId}`} name="userId" defaultValue="" className="w-52 py-1.5 text-sm">
          <option value="" disabled>Who else is on this</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.deskLabel ?? p.name}</option>
          ))}
        </Select>
        <label htmlFor={`part-${studentId}`} className="sr-only">What they do on it</label>
        <Input
          id={`part-${studentId}`}
          name="part"
          list={`parts-${studentId}`}
          placeholder="What they do: Visa"
          className="w-44 py-1.5 text-sm"
        />
        <datalist id={`parts-${studentId}`}>
          {PARTS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Button type="submit" variant="secondary" size="sm">Add</Button>
      </div>
    </ActionForm>
  );
}

/** The team lead's control: which member of the team works this file. */
export function GiveToTeamMemberForm({ studentId, teamName, members, current }: { studentId: string; teamName: string; members: { id: string; name: string; deskLabel: string | null }[]; current: string }) {
  return (
    <ActionForm action={giveToTeamMemberAction} hideSubmit className="space-y-2">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`team-member-${studentId}`} className="text-2xs font-semibold uppercase tracking-wider text-muted">
          Give to somebody in {teamName}
        </label>
        <Select id={`team-member-${studentId}`} name="userId" defaultValue={current} className="w-52 py-1.5 text-sm">
          <option value="" disabled>Pick a team member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.deskLabel ?? m.name}</option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" size="sm">Give it</Button>
      </div>
      <p className="text-2xs text-muted">They are put on the file for the team. The student stays with their branch and counsellor.</p>
    </ActionForm>
  );
}
