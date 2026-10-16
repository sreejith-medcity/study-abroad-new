"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input, Select, cn } from "@/components/ui";

/**
 * One filter bar for every list in the portal.
 *
 * What was here before was a grid of selects and an Apply button. It worked,
 * but it answered none of the three questions somebody actually has in front
 * of a filtered list: what is on, how do I take one off, and how do I get back
 * to everything. So the controls apply the moment they change, each one that
 * is on appears underneath as a chip you can take off on its own, and there is
 * one way back to the unfiltered list.
 *
 * The fields are described rather than written out, so a page declares what it
 * filters by once and the wording of a chip can never drift from the wording of
 * the control that set it.
 */
export type FilterField =
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[] }
  | { kind: "date"; name: string; label: string }
  | { kind: "search"; name: string; label: string; placeholder: string };

/**
 * Params the bar leaves alone: they say where you are, not what you asked.
 * A sort order is a question like any other, so clearing the filters clears
 * it too, which is what "Clear all" has to mean if a chip for it can be
 * taken off on its own.
 */
const KEEP = ["view", "tab"];

export function FilterBar({
  fields,
  keep,
  primary = 4,
  className,
  children,
}: {
  fields: FilterField[];
  /**
   * Extra params this page treats as where-you-are rather than what-you-asked,
   * on top of view and tab: the documentation queue's "mine" and its sort, for
   * instance, which are modes chosen above the bar and should survive clearing
   * the filters.
   */
  keep?: string[];
  /**
   * How many of the fields stay on the bar. The applications list filters by
   * sixteen things, and a row of sixteen controls is no more usable than the
   * grid it replaced, so the rest fold away. Anything folded that is switched
   * on still shows as a chip, and the fold opens itself rather than hiding a
   * filter somebody cannot see they have set.
   */
  primary?: number;
  className?: string;
  /** Anything the page wants to sit on the same row, to the right. */
  children?: React.ReactNode;
}) {
  const held = new Set([...KEEP, ...(keep ?? [])]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    // A new question starts at the first page of its answer.
    next.delete("page");
    const qs = next.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const set = (name: string, value: string) =>
    go((p) => {
      if (value) p.set(name, value);
      else p.delete(name);
    });

  // What is on now, in the order the page declared, so the chips read in the
  // same order as the controls above them.
  const on = fields
    .map((f) => {
      const value = params.get(f.name);
      if (!value) return null;
      const shown =
        f.kind === "select" ? (f.options.find((o) => o.value === value)?.label ?? value) : value;
      return { name: f.name, label: f.label, shown };
    })
    .filter((x): x is { name: string; label: string; shown: string } => x !== null);

  const kept = [...params.keys()].filter((k) => held.has(k));

  const head = fields.slice(0, primary);
  const rest = fields.slice(primary);
  const restOn = rest.filter((f) => params.get(f.name)).length;
  const [openRest, setOpenRest] = useState(false);
  const showRest = openRest || restOn > 0;

  return (
    <div className={cn("mb-4 rounded-xl border border-line bg-surface-2/70 p-3", pending && "opacity-70", className)}>
      <div className="flex flex-wrap items-end gap-2">
        {head.map((f) => (
          <Control key={f.name} field={f} value={params.get(f.name) ?? ""} onSet={set} />
        ))}
        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenRest((v) => !v)}
            aria-expanded={showRest}
            className="rounded-lg border border-line-strong px-2.5 py-2 text-[13px] font-medium text-ink-soft transition hover:border-brand-300 hover:text-brand-700"
          >
            {showRest ? "Fewer filters" : `More filters (${rest.length})`}
          </button>
        )}
        {children && <div className="ml-auto flex items-end gap-2">{children}</div>}
      </div>

      {showRest && rest.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-line pt-2.5">
          {rest.map((f) => (
            <Control key={f.name} field={f} value={params.get(f.name) ?? ""} onSet={set} />
          ))}
        </div>
      )}

      {on.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {on.length} {on.length === 1 ? "filter" : "filters"} on
          </span>
          {on.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => set(c.name, "")}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[12px] text-brand-700 transition hover:border-brand-400"
              aria-label={`Remove the ${c.label.toLowerCase()} filter`}
            >
              <span className="font-medium">{c.label}:</span> {c.shown}
              <span aria-hidden className="text-[13px] leading-none">&times;</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              go((p) => {
                for (const k of [...p.keys()]) if (!held.has(k)) p.delete(k);
              })
            }
            className="ml-1 text-[12px] font-medium text-muted underline underline-offset-2 hover:text-ink"
          >
            Clear {kept.length > 0 ? "the filters" : "all"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Typing is the one thing that must not go to the server on every keystroke,
 * so this box waits until the typing stops. Enter does not wait.
 */
function SearchBox({
  field,
  value,
  onDone,
}: {
  field: { name: string; label: string; placeholder: string };
  value: string;
  onDone: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const typed = useRef(false);

  // The page can change the value under us: a chip taken off, a saved view
  // opened. Follow it, unless this box is the thing that changed it.
  useEffect(() => {
    if (!typed.current) setText(value);
  }, [value]);

  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => {
      typed.current = false;
      onDone(text.trim());
    }, 400);
    return () => clearTimeout(t);
    // onDone is rebuilt each render; the text is what this waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <label className="min-w-0 flex-1 basis-56">
      <span className="mb-0.5 block text-[11px] font-medium text-muted">{field.label}</span>
      <Input
        name={field.name}
        value={text}
        placeholder={field.placeholder}
        aria-label={field.label}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          typed.current = false;
          onDone(text.trim());
        }}
      />
    </label>
  );
}

/** One control, told what it is by the field it was given. */
function Control({
  field,
  value,
  onSet,
}: {
  field: FilterField;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  if (field.kind === "search") {
    return <SearchBox field={field} value={value} onDone={(v) => onSet(field.name, v)} />;
  }
  return (
    <label className="min-w-0">
      <span className="mb-0.5 block text-[11px] font-medium text-muted">{field.label}</span>
      {field.kind === "date" ? (
        <Input
          type="date"
          name={field.name}
          value={value}
          onChange={(e) => onSet(field.name, e.target.value)}
          className="w-[9.5rem]"
          aria-label={field.label}
        />
      ) : (
        <Select
          name={field.name}
          value={value}
          onChange={(e) => onSet(field.name, e.target.value)}
          aria-label={field.label}
          className="w-auto min-w-[9rem]"
        >
          <option value="">Any</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </label>
  );
}
