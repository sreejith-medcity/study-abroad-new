"use client";

import { ActionForm } from "@/components/action-form";
import { Button, Input, Select } from "@/components/ui";
import { addPersonToFileAction } from "./team-actions";

/** Common parts, offered so the same work is not written five ways. */
const PARTS = ["Documents", "Applications", "Visa", "Ticketing", "Forex", "Insurance", "Accommodation", "Loan"];

export function AddPersonForm({ studentId, people }: { studentId: string; people: { id: string; name: string; deskLabel: string | null }[] }) {
  return (
    <ActionForm action={addPersonToFileAction} hideSubmit className="space-y-2" resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`who-${studentId}`} className="sr-only">Somebody to put on this file</label>
        <Select id={`who-${studentId}`} name="userId" defaultValue="" className="w-52 py-1.5 text-[13px]">
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
          className="w-44 py-1.5 text-[13px]"
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
