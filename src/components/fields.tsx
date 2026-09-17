"use client";

import type { ComponentProps } from "react";
import { FieldError } from "./action-form";
import { Field, Input, Select, Textarea } from "./ui";

type Base = { label: string; name: string; required?: boolean; hint?: string };

export function TextField({ label, name, required, hint, ...props }: Base & ComponentProps<"input">) {
  return (
    <Field label={label} htmlFor={name} required={required} hint={hint}>
      <Input id={name} name={name} {...props} />
      <FieldError name={name} />
    </Field>
  );
}

export function SelectField({ label, name, required, hint, children, ...props }: Base & ComponentProps<"select">) {
  return (
    <Field label={label} htmlFor={name} required={required} hint={hint}>
      <Select id={name} name={name} {...props}>{children}</Select>
      <FieldError name={name} />
    </Field>
  );
}

export function TextareaField({ label, name, required, hint, ...props }: Base & ComponentProps<"textarea">) {
  return (
    <Field label={label} htmlFor={name} required={required} hint={hint}>
      <Textarea id={name} name={name} {...props} />
      <FieldError name={name} />
    </Field>
  );
}
