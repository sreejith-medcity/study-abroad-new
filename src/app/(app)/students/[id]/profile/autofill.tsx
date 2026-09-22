"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { Button } from "@/components/ui";
import { extractDocumentAction, type Extracted } from "@/server/ai-actions";
import { applyPassportAction } from "../../actions";
import { AcademicForm, TestForm } from "./forms";

/**
 * Reads a passport, a marksheet or a test report and fills the matching form
 * for a person to check. Nothing is saved until they press save.
 */
export function AutofillPanel({ studentId, docs }: { studentId: string; docs: { id: string; label: string }[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Extracted | null>(null);
  const read = async (id: string) => {
    setBusy(id);
    setResult(null);
    setResult(await extractDocumentAction(id));
    setBusy(null);
  };
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2">
        {docs.map((d) => (
          <li key={d.id}>
            <Button type="button" size="sm" variant="secondary" onClick={() => read(d.id)} disabled={!!busy}>
              {busy === d.id ? "Reading…" : `Read ${d.label}`}
            </Button>
          </li>
        ))}
      </ul>
      {result && !result.ok && <p className="text-[13px] text-red-700" role="alert">{result.error}</p>}
      {result?.ok && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3" data-testid="autofill-review">
          <p className="mb-2 text-[13px] font-medium">Check every box against the document, then save. Blank means it could not be read clearly.</p>
          {result.kind === "passport" && (
            <ActionForm action={applyPassportAction} submitLabel="Save passport details">
              <input type="hidden" name="studentId" value={studentId} />
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField id="af-pn" label="Passport number" name="passportNumber" defaultValue={result.fields.passportNumber ?? ""} autoComplete="off" />
                <TextField id="af-pi" label="Issue date" name="passportIssue" type="date" defaultValue={result.fields.passportIssue ?? ""} />
                <TextField id="af-pe" label="Expiry date" name="passportExpiry" type="date" defaultValue={result.fields.passportExpiry ?? ""} />
                <TextField id="af-pc" label="Issue country" name="passportIssueCountry" defaultValue={result.fields.passportIssueCountry ?? ""} />
                <TextField id="af-dob" label="Date of birth" name="dateOfBirth" type="date" defaultValue={result.fields.dateOfBirth ?? ""} />
                <TextField id="af-cob" label="City of birth" name="cityOfBirth" defaultValue={result.fields.cityOfBirth ?? ""} />
              </div>
            </ActionForm>
          )}
          {result.kind === "academic" && <AcademicForm studentId={studentId} defaults={result.fields} idPrefix="af-" />}
          {result.kind === "test" && <TestForm studentId={studentId} defaults={result.fields} idPrefix="af-" />}
          {result.left != null && <p className="mt-2 text-right text-xs text-muted">{result.left} AI requests left this month</p>}
        </div>
      )}
    </div>
  );
}
