"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { Button } from "@/components/ui";
import { GUARDIAN_RELATIONS } from "@/lib/family";
import { addGuardianAction, resetGuardianPasswordAction, revokeGuardianAction, setGuardianMoneyAction } from "@/server/family-actions";

/**
 * Giving a parent their own sign-in, from the student's file.
 *
 * The relation is offered as a list with free text beside it, because a sponsor
 * uncle is as common here as a father, and a dropdown that cannot say "sponsor"
 * gets filled in with "father" by somebody in a hurry.
 */
export function AddGuardianForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={addGuardianAction} submitLabel="Give family access" pendingLabel="Creating the sign-in…" submitVariant="secondary" resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" name="name" required placeholder="Full name" />
        <SelectField label="Relation" name="relation" required defaultValue="Father">
          {GUARDIAN_RELATIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </SelectField>
        <TextField label="Email" name="email" type="email" required hint="They sign in with this address." />
        <TextField label="Mobile" name="phone" hint="Optional. Not used for sign-in." />
      </div>
      <label className="mt-1 flex items-start gap-2 text-[13px]">
        <input type="checkbox" name="seesMoney" className="mt-0.5 size-4 rounded border-line-strong" />
        <span>
          <span className="font-medium">Also let them see the fees</span>
          <span className="block text-muted">What the student has been asked to pay and what has been received. Never what Medcity earns from a university or a vendor.</span>
        </span>
      </label>
    </ActionForm>
  );
}

/** A new one-time password for a parent who has lost theirs. */
export function ResetGuardianForm({ guardianId }: { guardianId: string }) {
  return (
    <ActionForm action={resetGuardianPasswordAction} submitLabel="New password" pendingLabel="Preparing…" submitVariant="secondary">
      <input type="hidden" name="guardianId" value={guardianId} />
    </ActionForm>
  );
}

/** The fees switch and the revoke, both plain forms because both are one click. */
export function GuardianRowActions({ guardianId, seesMoney }: { guardianId: string; seesMoney: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <form action={setGuardianMoneyAction}>
        <input type="hidden" name="guardianId" value={guardianId} />
        <input type="hidden" name="seesMoney" value={seesMoney ? "false" : "true"} />
        <Button variant="quiet" className="py-1 text-xs">{seesMoney ? "Hide the fees" : "Show the fees"}</Button>
      </form>
      <form action={revokeGuardianAction}>
        <input type="hidden" name="guardianId" value={guardianId} />
        <Button variant="quiet" className="py-1 text-xs text-stop-700">Remove access</Button>
      </form>
    </div>
  );
}
