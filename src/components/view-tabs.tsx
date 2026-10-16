"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Button, Input, Select, cn } from "@/components/ui";
import { deleteViewAction, pinViewAction, saveViewAction, shareViewAction } from "@/server/view-actions";

export type TabView = {
  id: string;
  name: string;
  query: string;
  shared: "PRIVATE" | "ORG" | "EVERYONE";
  mine: boolean;
  ownerName: string | null;
  count: number | null;
  pinned: boolean;
};

const SHARED_LABEL = { PRIVATE: "Only you", ORG: "Your branch", EVERYONE: "Everybody" } as const;

/**
 * The saved ways of looking at a list, as a row of tabs above it.
 *
 * Everybody asks the same three or four questions of these lists every
 * morning, and until now they retyped the filters or kept a browser bookmark
 * nobody else could use. A view is that question with a name on it: it carries
 * its own count, it opens the list exactly as it was saved, and it can be
 * handed to the branch or to the whole desk.
 */
export function ViewTabs({ scope, views, canShareWithEverybody }: { scope: string; views: TabView[]; canShareWithEverybody: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const here = params.toString();
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);

  const active = views.find((v) => v.query === here);
  const onAll = here === "" || (!active && !here.includes("view_id"));
  const shown = views.filter((v) => v.pinned || v.id === active?.id);
  const rest = views.filter((v) => !v.pinned && v.id !== active?.id);
  // Only worth offering to save something that is actually a question.
  const worthSaving = here.length > 0 && !active;

  const tab = (on: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition",
      on ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-brand-700",
    );

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={pathname} className={tab(onAll)}>
          Everything
        </Link>
        {shown.map((v) => (
          <Link key={v.id} href={`${pathname}?${v.query}`} className={tab(v.id === active?.id)} title={v.ownerName ? `Shared by ${v.ownerName}` : undefined}>
            {v.name}
            {v.count !== null && (
              <span className={cn("tabular text-xs", v.id === active?.id ? "text-white/80" : "text-muted")}>{v.count}</span>
            )}
          </Link>
        ))}

        {worthSaving && (
          <button type="button" onClick={() => setSaving((x) => !x)} className="rounded-full border border-dashed border-line-strong px-3 py-1 text-[13px] text-muted hover:border-brand-300 hover:text-brand-700">
            {saving ? "Cancel" : "Save this view"}
          </button>
        )}
        {(rest.length > 0 || views.some((v) => v.mine)) && (
          <button type="button" onClick={() => setManaging((x) => !x)} className="rounded-full px-2 py-1 text-[13px] text-muted hover:text-brand-700">
            {managing ? "Done" : `All views${rest.length ? ` (${views.length})` : ""}`}
          </button>
        )}
      </div>

      {saving && (
        <div className="rounded-xl border border-line bg-surface p-3">
          <ActionForm action={saveViewAction} hideSubmit className="space-y-0">
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="query" value={here} />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="view-name" className="sr-only">What to call this view</label>
              <Input id="view-name" name="name" placeholder="My Germany files" className="w-56 py-1.5 text-[13px]" />
              <label htmlFor="view-shared" className="sr-only">Who else sees it</label>
              <Select id="view-shared" name="shared" defaultValue="PRIVATE" className="w-40 py-1.5 text-[13px]">
                <option value="PRIVATE">Only you</option>
                <option value="ORG">Your branch</option>
                {canShareWithEverybody && <option value="EVERYONE">Everybody</option>}
              </Select>
              <Button type="submit" variant="secondary" size="sm">Save</Button>
              <span className="text-xs text-muted">Saves the filters on screen now.</span>
            </div>
          </ActionForm>
        </div>
      )}

      {managing && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-[13px]">
          {views.length === 0 && <li className="px-3 py-2.5 text-muted">No views yet. Filter a list and save it.</li>}
          {views.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <Link href={`${pathname}?${v.query}`} className="font-medium text-brand-600 hover:underline">{v.name}</Link>
              <span className="text-xs text-muted">{SHARED_LABEL[v.shared]}</span>
              {v.ownerName && <span className="text-xs text-muted">by {v.ownerName}</span>}
              {v.count !== null && <span className="tabular text-xs text-muted">{v.count} now</span>}
              <div className="ml-auto flex items-center gap-3">
                {!v.mine && (
                  <form action={pinViewAction}>
                    <input type="hidden" name="viewId" value={v.id} />
                    <button className="text-xs text-brand-600 hover:underline">{v.pinned ? "Take off my tabs" : "Keep on my tabs"}</button>
                  </form>
                )}
                {v.mine && (
                  <form action={shareViewAction}>
                    <input type="hidden" name="viewId" value={v.id} />
                    <button className="text-xs text-brand-600 hover:underline">Share with: {SHARED_LABEL[v.shared]}</button>
                  </form>
                )}
                {v.mine && (
                  <form action={deleteViewAction}>
                    <input type="hidden" name="viewId" value={v.id} />
                    <button className="text-xs text-muted hover:text-stop-500">Delete</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
