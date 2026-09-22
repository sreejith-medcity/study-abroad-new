"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { CATEGORY_LABEL, TICKET_CATEGORIES } from "@/lib/tickets";
import { openTicketAction, replyTicketAction } from "@/server/tickets";

export function OpenTicketForm() {
  return (
    <ActionForm action={openTicketAction} submitLabel="Send to the Overseas team" pendingLabel="Sending…">
      <Field label="What is it about" htmlFor="tk-cat" required>
        <Select id="tk-cat" name="category" defaultValue="">
          <option value="">Choose</option>
          {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
        <FieldError name="category" />
      </Field>
      <Field label="Summary" htmlFor="tk-subject" required>
        <Input id="tk-subject" name="subject" />
        <FieldError name="subject" />
      </Field>
      <Field label="Details" htmlFor="tk-body" required hint="For one student's file, the comments on that application reach the team faster.">
        <Textarea id="tk-body" name="body" rows={4} />
        <FieldError name="body" />
      </Field>
    </ActionForm>
  );
}

export function ReplyForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={replyTicketAction} submitLabel="Send reply" pendingLabel="Sending…" resetOnSuccess>
      <input type="hidden" name="ticketId" value={ticketId} />
      <label htmlFor="tk-reply" className="sr-only">Reply</label>
      <Textarea id="tk-reply" name="body" rows={3} placeholder="Write a reply" />
      <FieldError name="body" />
    </ActionForm>
  );
}
