"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { EVENT_KINDS, EVENT_KIND_LABEL } from "@/lib/events";
import { createEventAction, registerStudentAction, toggleAttendAction } from "@/server/events";

export function AttendForm({ eventId, attending }: { eventId: string; attending: boolean }) {
  return (
    <ActionForm action={toggleAttendAction} submitLabel={attending ? "Cancel my seat" : "I'll attend"} pendingLabel="Saving…" submitVariant={attending ? "secondary" : "primary"}>
      <input type="hidden" name="eventId" value={eventId} />
    </ActionForm>
  );
}

export function RegisterStudentForm({ eventId, students }: { eventId: string; students: { id: string; name: string }[] }) {
  return (
    <ActionForm action={registerStudentAction} submitLabel="Register student" submitVariant="secondary" pendingLabel="Registering…">
      <input type="hidden" name="eventId" value={eventId} />
      <label htmlFor={`st-${eventId}`} className="sr-only">Student</label>
      <Select id={`st-${eventId}`} name="studentId" defaultValue="">
        <option value="">Choose a student</option>
        {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </ActionForm>
  );
}

export function CreateEventForm() {
  return (
    <ActionForm action={createEventAction} submitLabel="Publish event" resetOnSuccess>
      <Field label="Title" htmlFor="ev-title" required>
        <Input id="ev-title" name="title" />
        <FieldError name="title" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor="ev-kind" required>
          <Select id="ev-kind" name="kind" defaultValue="">
            <option value="">Choose</option>
            {EVENT_KINDS.map((k) => <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>)}
          </Select>
          <FieldError name="kind" />
        </Field>
        <Field label="Seats (blank for no limit)" htmlFor="ev-capacity">
          <Input id="ev-capacity" name="capacity" inputMode="numeric" />
          <FieldError name="capacity" />
        </Field>
        <Field label="Starts (IST)" htmlFor="ev-starts" required>
          <Input id="ev-starts" name="startsAt" type="datetime-local" />
          <FieldError name="startsAt" />
        </Field>
        <Field label="Ends (IST)" htmlFor="ev-ends">
          <Input id="ev-ends" name="endsAt" type="datetime-local" />
          <FieldError name="endsAt" />
        </Field>
      </div>
      <Field label="Place" htmlFor="ev-location" hint="City and venue, for a visit or a fair">
        <Input id="ev-location" name="location" />
        <FieldError name="location" />
      </Field>
      <Field label="Join link" htmlFor="ev-join" hint="For a webinar or online training">
        <Input id="ev-join" name="joinUrl" placeholder="https://" />
        <FieldError name="joinUrl" />
      </Field>
      <Field label="University (optional)" htmlFor="ev-uni" hint="Exactly as it is named in the catalogue">
        <Input id="ev-uni" name="university" />
        <FieldError name="university" />
      </Field>
      <Field label="What it covers" htmlFor="ev-desc">
        <Textarea id="ev-desc" name="description" rows={3} />
      </Field>
      <Checkbox name="openToStudents" label="Partners may register their students too" />
    </ActionForm>
  );
}
