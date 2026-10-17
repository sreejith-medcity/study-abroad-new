"use client";

import type { ReactNode } from "react";
import { InlineSelect } from "@/components/inline-select";
import { reassignStudentAction } from "./actions";

/** Handing a student to somebody, from the list itself. */
export function RowAssign({ studentId, current, label, children }: { studentId: string; current: string; label: string; children: ReactNode }) {
  return (
    <InlineSelect action={reassignStudentAction} idName="studentId" id={studentId} name="assignedToId" value={current} label={label}>
      {children}
    </InlineSelect>
  );
}
