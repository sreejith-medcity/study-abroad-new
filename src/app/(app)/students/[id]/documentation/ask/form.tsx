"use client";

import { useMemo, useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Alert, Card, CardHeader, Checkbox, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { buildAskMessage } from "@/lib/ask";
import { STATE_LABEL } from "@/lib/journey";
import { sendDocumentRequestAction } from "@/server/documentation-actions";
import type { ChecklistState } from "@/db/schema";
import type { Locale } from "@/lib/i18n";

export type AskRow = {
  id: string;
  label: string;
  labelForStudent: string;
  reasonForStudent: string | null;
  stage: string;
  state: ChecklistState;
  required: boolean;
  dueOn: string | null;
};

/**
 * The counsellor's side of the ask. The message is rebuilt as the ticks and the
 * language change, and then it is theirs to edit: nothing goes out that a person
 * has not read.
 */
export function AskForm({
  studentId,
  firstName,
  branchName,
  link,
  locale: initialLocale,
  whatsappOptIn,
  whatsappAllowed,
  items,
}: {
  studentId: string;
  firstName: string;
  branchName: string;
  link: string;
  locale: Locale;
  whatsappOptIn: boolean;
  whatsappAllowed: boolean;
  items: AskRow[];
}) {
  const [ticked, setTicked] = useState<string[]>(items.map((i) => i.id));
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [dueOn, setDueOn] = useState("");
  const [edited, setEdited] = useState<string | null>(null);

  const chosen = items.filter((i) => ticked.includes(i.id));
  const reminder = chosen.some((i) => i.state === "ASKED" || i.state === "REJECTED");
  const drafted = useMemo(
    () =>
      buildAskMessage(
        {
          firstName,
          branchName,
          link,
          dueOn: dueOn || null,
          reminder,
          items: chosen.map((i) => ({ label: i.labelForStudent, reason: i.reasonForStudent })),
        },
        locale,
      ),
    [chosen, firstName, branchName, link, dueOn, locale, reminder],
  );
  const body = edited ?? drafted;
  const canWhatsApp = whatsappOptIn && whatsappAllowed;

  return (
    <ActionForm action={sendDocumentRequestAction} submitLabel="Send" pendingLabel="Sending…" hideSubmit>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="locale" value={locale} />
      {ticked.map((id) => (
        <input key={id} type="hidden" name="itemIds" value={id} />
      ))}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader
            title={`${chosen.length} of ${items.length} ticked`}
            subtitle="Untick anything you will collect yourself. A document sent back keeps its reason, and the reason goes to the student word for word."
          />
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="px-4 py-3">
                <Checkbox
                  checked={ticked.includes(i.id)}
                  onChange={(e) => setTicked((was) => (e.target.checked ? [...was, i.id] : was.filter((x) => x !== i.id)))}
                  label={
                    <span>
                      <span className="font-medium">{i.label}</span>
                      <span className="ml-2 text-xs text-muted">{i.stage}</span>
                      {!i.required && <span className="ml-2 text-xs text-muted">Not required</span>}
                      {i.state !== "NOT_ASKED" && <Chip className="ml-2" tone={i.state === "REJECTED" ? "bad" : "warn"}>{STATE_LABEL[i.state]}</Chip>}
                    </span>
                  }
                />
                {i.reasonForStudent && <p className="ml-6 mt-0.5 max-w-lg text-xs text-muted">{i.reasonForStudent}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Language" htmlFor="ask-locale">
                <Select id="ask-locale" value={locale} onChange={(e) => { setLocale(e.target.value as Locale); setEdited(null); }}>
                  <option value="en">English</option>
                  <option value="ml">മലയാളം</option>
                </Select>
              </Field>
              <Field label="Wanted by" htmlFor="ask-due" hint="Goes on every ticked row as well as into the message.">
                <Input id="ask-due" type="date" name="dueOn" value={dueOn} onChange={(e) => { setDueOn(e.target.value); setEdited(null); }} />
              </Field>
            </div>
            <Field label="The message" htmlFor="ask-body" hint="Edit it freely. What is here is exactly what is sent.">
              <Textarea id="ask-body" name="body" rows={16} value={body} onChange={(e) => setEdited(e.target.value)} className="font-mono text-[13px]" />
              <FieldError name="body" />
            </Field>
            {edited !== null && (
              <button type="button" onClick={() => setEdited(null)} className="text-[13px] text-muted hover:text-ink">
                Start again from the list
              </button>
            )}
          </Card>

          {!canWhatsApp && (
            <Alert tone="info">
              {whatsappOptIn
                ? "This branch has WhatsApp messages to students switched off, so this goes into the portal only."
                : `${firstName} has not agreed to WhatsApp messages, so this goes into the portal only.`}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {canWhatsApp && (
              <button type="submit" name="channel" value="WHATSAPP" disabled={chosen.length === 0} className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">
                Send on WhatsApp
              </button>
            )}
            <button type="submit" name="channel" value="PORTAL" disabled={chosen.length === 0} className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-50">
              Put it in the portal only
            </button>
          </div>
          <p className="text-xs text-muted">Either way the list appears in {firstName}&rsquo;s portal with the reason against each document.</p>
        </div>
      </div>
    </ActionForm>
  );
}
