"use client";

import { Fragment, createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/components/ui";
import { toast } from "@/components/toast";
import { assignGroups, moveConfirmText, parseAssignChoice, type AssignPerson, type WiderChoices } from "@/lib/assign-choice";
import { assignStudentAction, reassignStudentAction } from "./actions";

/**
 * The teams and the other branches, handed to the page once rather than to
 * each row. For a head office admin they are a group per team and per
 * branch on every row's dropdown; fifty rows each carrying their own copy
 * made the page several times the size it needed to be. Null for everybody
 * else, whose dropdown is exactly what it was.
 */
const Wider = createContext<WiderChoices | null>(null);

export function AssignChoicesProvider({ value, children }: { value: WiderChoices | null; children: ReactNode }) {
  return <Wider.Provider value={value}>{children}</Wider.Provider>;
}

/**
 * Handing a student to somebody, from the list or the student's file.
 *
 * Picking somebody files it straight away, as before. Picking somebody at
 * another branch moves the student there, which is a bigger thing than a
 * change of counsellor, so the row asks first in a line under the dropdown
 * and moves nobody until it is answered.
 *
 * The rows are drawn by the server with the groups every user had before;
 * the team and branch groups are added once the script has run, from the
 * shared list above, so the page's first markup stays small.
 */
export function RowAssign({
  studentId,
  studentName,
  orgId,
  orgName,
  current,
  label,
  branch,
  headOffice,
  roleLabels,
  grouped = true,
}: {
  studentId: string;
  studentName: string;
  orgId: string;
  orgName: string;
  current: string;
  label: string;
  branch: AssignPerson[];
  headOffice: AssignPerson[];
  roleLabels?: Record<string, string>;
  /** A branch's own list has no groups: it only ever offers its own people. */
  grouped?: boolean;
}) {
  const wider = useContext(Wider);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scripted, setScripted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState<{ value: string; branchName: string } | null>(null);
  const field = useRef<HTMLSelectElement>(null);

  useEffect(() => setScripted(true), []);

  const groups = assignGroups({
    orgId,
    orgName,
    branch,
    headOffice,
    roleLabel: roleLabels ? (r) => roleLabels[r] ?? r : undefined,
    wider: scripted ? wider : null,
  });

  // A team or a move leaves the counsellor as it was, so the dropdown goes
  // back to showing them; the team shows on the row, the move moves the row.
  const putBack = () => {
    if (field.current) field.current.value = current;
  };

  function send(value: string, confirmed = false) {
    const data = new FormData();
    data.set("studentId", studentId);
    data.set("assignedToId", value);
    if (confirmed) data.set("confirmed", "1");
    setSaved(false);
    start(async () => {
      const said = await assignStudentAction(data);
      const choice = parseAssignChoice(value);
      if (said.error) {
        toast(said.error, "bad");
        putBack();
        return;
      }
      if (choice && (choice.kind === "team" || choice.kind === "move")) {
        toast(said.ok ?? "Saved.");
        putBack();
        router.refresh();
      }
      setSaved(true);
    });
  }

  function onChange() {
    const value = field.current?.value ?? "";
    const choice = parseAssignChoice(value);
    if (choice?.kind === "move") {
      const group = groups.find((g) => g.kind === "move" && g.options.some((o) => o.value === value));
      setAsking({ value, branchName: group?.branchName ?? "another branch" });
      return;
    }
    setAsking(null);
    send(value);
  }

  return (
    <div>
      <form action={reassignStudentAction} className="flex items-center gap-1.5">
        <input type="hidden" name="studentId" value={studentId} />
        <Select
          ref={field}
          name="assignedToId"
          defaultValue={current}
          aria-label={label}
          className="min-w-32 py-1.5"
          disabled={pending || !!asking}
          onChange={scripted ? onChange : undefined}
        >
          <option value="">Unassigned</option>
          {groups.map((g) => {
            const options = g.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ));
            return grouped ? (
              <optgroup key={`${g.kind}:${g.label}`} label={g.label}>{options}</optgroup>
            ) : (
              <Fragment key={`${g.kind}:${g.label}`}>{options}</Fragment>
            );
          })}
        </Select>
        {scripted ? (
          <span className="w-11 shrink-0 text-2xs text-muted" aria-live="polite">
            {pending ? "Saving" : saved ? "Saved" : ""}
          </span>
        ) : (
          <Button variant="quiet" className="px-2 py-1" type="submit" aria-label={`Save ${label}`}>
            Save
          </Button>
        )}
      </form>
      {asking && (
        <div role="alertdialog" aria-label={`Move ${studentName}`} className="mt-1.5 max-w-xs rounded-lg border border-warn-500/30 bg-warn-50 px-3 py-2 text-xs">
          <p>{moveConfirmText(studentName, asking.branchName)}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              type="button"
              onClick={() => {
                const value = asking.value;
                setAsking(null);
                send(value, true);
              }}
            >
              Move
            </Button>
            <Button
              size="sm"
              variant="quiet"
              type="button"
              onClick={() => {
                setAsking(null);
                putBack();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
