"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Checkbox, Field, Input, Textarea } from "@/components/ui";
import { addQuestionAction, createCourseAction, submitQuizAction } from "@/server/training";

export function QuizForm({ courseId, questions }: { courseId: string; questions: { id: string; prompt: string; options: string[] }[] }) {
  return (
    <ActionForm action={submitQuizAction} submitLabel="Submit answers" pendingLabel="Marking…">
      <input type="hidden" name="courseId" value={courseId} />
      <ol className="space-y-4">
        {questions.map((q, n) => (
          <li key={q.id}>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">{n + 1}. {q.prompt}</legend>
              <div className="space-y-1">
                {q.options.map((o, i) => (
                  <label key={i} className="flex items-start gap-2 text-[13px]">
                    <input type="radio" name={`q_${q.id}`} value={i} className="mt-0.5 accent-brand-600" />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
    </ActionForm>
  );
}

export function CourseForm({ resources }: { resources: { id: string; title: string }[] }) {
  return (
    <ActionForm action={createCourseAction} submitLabel="Create course" resetOnSuccess>
      <Field label="Title" htmlFor="tc-title" required>
        <Input id="tc-title" name="title" />
        <FieldError name="title" />
      </Field>
      <Field label="What it teaches" htmlFor="tc-desc">
        <Textarea id="tc-desc" name="description" rows={2} />
      </Field>
      <Field label="Pass mark (%)" htmlFor="tc-pass" required>
        <Input id="tc-pass" name="passMark" inputMode="numeric" defaultValue="70" />
        <FieldError name="passMark" />
      </Field>
      {resources.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Reading from the learning library</legend>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {resources.map((r) => <Checkbox key={r.id} name="resource" value={r.id} label={r.title} />)}
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

export function QuestionForm({ courseId }: { courseId: string }) {
  return (
    <ActionForm action={addQuestionAction} submitLabel="Add question" submitVariant="secondary" resetOnSuccess>
      <input type="hidden" name="courseId" value={courseId} />
      <Field label="Question" htmlFor={`tq-${courseId}`}>
        <Input id={`tq-${courseId}`} name="prompt" />
        <FieldError name="prompt" />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted">Answers: tick the right one</legend>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="radio" name="correct" value={i} aria-label={`Answer ${i + 1} is right`} className="accent-brand-600" />
            <Input name={`option${i}`} aria-label={`Answer ${i + 1}`} placeholder={i < 2 ? `Answer ${i + 1}` : `Answer ${i + 1} (optional)`} />
          </div>
        ))}
        <FieldError name="option0" />
        <FieldError name="correct" />
      </fieldset>
    </ActionForm>
  );
}
