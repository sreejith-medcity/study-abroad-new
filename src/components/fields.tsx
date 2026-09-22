"use client";

import type { ComponentProps } from "react";
import { FieldError } from "./action-form";
import { Field, Input, Select, Textarea } from "./ui";

type Base = { label: string; name: string; required?: boolean; hint?: string };

// An explicit id keeps labels right when two forms on a page share a field name.
export function TextField({ label, name, required, hint, id, ...props }: Base & ComponentProps<"input">) {
  return (
    <Field label={label} htmlFor={id ?? name} required={required} hint={hint}>
      <Input id={id ?? name} name={name} {...props} />
      <FieldError name={name} />
    </Field>
  );
}

export function SelectField({ label, name, required, hint, children, id, ...props }: Base & ComponentProps<"select">) {
  return (
    <Field label={label} htmlFor={id ?? name} required={required} hint={hint}>
      <Select id={id ?? name} name={name} {...props}>{children}</Select>
      <FieldError name={name} />
    </Field>
  );
}

export function TextareaField({ label, name, required, hint, id, ...props }: Base & ComponentProps<"textarea">) {
  return (
    <Field label={label} htmlFor={id ?? name} required={required} hint={hint}>
      <Textarea id={id ?? name} name={name} {...props} />
      <FieldError name={name} />
    </Field>
  );
}
