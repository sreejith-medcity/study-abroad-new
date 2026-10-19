"use client";

import { ActionForm } from "@/components/action-form";
import { Button, Select } from "@/components/ui";
import { SERVICE_LABEL, SERVICE_TYPES, type ServiceType } from "@/lib/services";
import { setServiceOwnerAction } from "./actions";

/**
 * Who each kind of request lands on.
 *
 * Medcity has a person for tickets and another for forex, and until now every
 * request arrived at the whole desk and was picked up by whoever saw it first,
 * or by nobody.
 */
export function ServiceOwners({
  owners,
  people,
}: {
  owners: Record<string, { id: string; name: string } | undefined>;
  people: { id: string; name: string; deskLabel: string | null }[];
}) {
  return (
    <div className="divide-y divide-line">
      {SERVICE_TYPES.map((type) => (
        <ActionForm key={type} action={setServiceOwnerAction} hideSubmit className="space-y-0">
          <input type="hidden" name="type" value={type} />
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="min-w-44 text-sm font-medium">{SERVICE_LABEL[type as ServiceType]}</span>
            <label htmlFor={`owner-${type}`} className="sr-only">
              Who handles {SERVICE_LABEL[type as ServiceType]}
            </label>
            <Select id={`owner-${type}`} name="userId" defaultValue={owners[type]?.id ?? ""} className="w-56 py-1.5 text-sm">
              <option value="">Nobody, it goes to the whole desk</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.deskLabel ?? p.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="quiet" size="sm">
              Save
            </Button>
          </div>
        </ActionForm>
      ))}
    </div>
  );
}
