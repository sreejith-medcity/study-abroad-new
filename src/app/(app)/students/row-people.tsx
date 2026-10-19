"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Select, cn } from "@/components/ui";
import { addPersonToFileAction, removePersonFromFileAction } from "./[id]/profile/team-actions";
import { SHARED_PART } from "@/lib/people-on-file";
import type { FormState } from "@/lib/form-state";

/**
 * A second person, and a third, from the list itself.
 *
 * A file belongs to one counsellor, which is what the dropdown beside this
 * sets: somebody has to be answerable for it. Two people sharing a student,
 * or one covering while the other is away, is just as ordinary, and until now
 * recording that meant opening the file, finding the profile tab, picking the
 * person and typing what they do. From a morning's list that is four moves
 * for something somebody wanted to say in one.
 *
 * So this adds them where the work is. What it writes is the same row the
 * profile tab writes, with a plain part, and the profile is still the place
 * to say that one of them is doing the visa and the other the documents.
 */
export function RowPeople({
  studentId,
  ownerId,
  people,
  canAdd,
  label,
}: {
  studentId: string;
  /** The counsellor the file belongs to, who is not also a second person. */
  ownerId: string;
  people: { id: string; name: string; part: string }[];
  canAdd: { id: string; name: string; deskLabel: string | null }[];
  label: string;
}) {
  // useActionState rather than a plain call, so the same form works before
  // the script has run: without it the browser posts it, with it the choice
  // posts itself and the refusal comes back in place.
  const [state, run, pending] = useActionState<FormState, FormData>(addPersonToFileAction, {});
  const [open, setOpen] = useState(false);
  const [scripted, setScripted] = useState(false);
  const field = useRef<HTMLSelectElement>(null);

  useEffect(() => setScripted(true), []);

  // Anybody already on the file, or carrying it, has nothing to add: the
  // counsellor it is assigned to is on it by definition, and offering to
  // share it with them reads as a mistake because it is one.
  const taken = new Set(people.map((p) => p.name));
  const offer = canAdd.filter((p) => p.id !== ownerId && !taken.has(p.deskLabel ?? p.name));

  function add() {
    const userId = field.current?.value;
    if (!userId) return;
    const data = new FormData();
    data.set("studentId", studentId);
    data.set("userId", userId);
    data.set("part", SHARED_PART);
    startTransition(() => {
      run(data);
      setOpen(false);
      if (field.current) field.current.value = "";
    });
  }

  return (
    // Held to a width, so a file with four people on it wraps inside the
    // column rather than widening it and pushing the end of the row off a
    // 1024-pixel screen.
    <div className="mt-1 max-w-48 space-y-1">
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {people.map((p) => (
            <li key={p.id}>
              <form action={removePersonFromFileAction} className="inline">
                <input type="hidden" name="personId" value={p.id} />
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-ink-soft ring-1 ring-inset ring-line">
                  {/* The part is worth the room only when somebody has said
                      something more particular than "also on it". */}
                  <span className="truncate" title={p.part === SHARED_PART ? p.name : `${p.name} · ${p.part}`}>
                    {p.part === SHARED_PART ? p.name : `${p.name} · ${p.part}`}
                  </span>
                  <button
                    type="submit"
                    aria-label={`Take ${p.name} off this file`}
                    title={`Take ${p.name} off this file`}
                    className="text-muted transition-colors hover:text-stop-500"
                  >
                    &times;
                  </button>
                </span>
              </form>
            </li>
          ))}
        </ul>
      )}

      {offer.length > 0 &&
        (open || !scripted ? (
          <form action={run} className="flex items-center gap-1.5">
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="part" value={SHARED_PART} />
            <label htmlFor={`share-${studentId}`} className="sr-only">
              {label}
            </label>
            <Select
              ref={field}
              id={`share-${studentId}`}
              name="userId"
              defaultValue=""
              className={cn("w-full min-w-0 py-1 text-xs", pending && "opacity-60")}
              disabled={pending}
              onChange={scripted ? add : undefined}
            >
              <option value="">Somebody else</option>
              {offer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.deskLabel ?? p.name}
                </option>
              ))}
            </Select>
            {/* Without the script this is an ordinary form and needs its
                button; with it, choosing a name is the whole move. */}
            {!scripted && (
              <button type="submit" className="text-2xs font-medium text-brand-700 hover:underline">
                Add
              </button>
            )}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-2xs font-medium text-brand-700 hover:underline"
          >
            {people.length > 0 ? "+ Somebody else" : "+ Share with somebody"}
          </button>
        ))}

      {state.error && <p className="text-2xs text-stop-500">{state.error}</p>}
    </div>
  );
}
