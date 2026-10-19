/**
 * How large the portal reads, per person.
 *
 * Everyone's eyes and screens differ, and a counsellor on a fourteen inch
 * laptop for nine hours wants something other than a branch head glancing at
 * a dashboard on a monitor. Rather than argue the point in one stylesheet,
 * each person sets their own, and it follows their sign-in rather than the
 * machine they happen to be at.
 *
 * It works by moving the document's own font size, which every size in the
 * portal is a multiple of, so the whole interface grows or shrinks together
 * rather than the words outgrowing the boxes they sit in. The CSS lives in
 * globals.css against [data-text="..."]; this file is the list, the wording
 * and the guard, so a stray value in the database cannot leave somebody with
 * no size at all.
 */
export const TEXT_SIZES = [
  {
    id: "compact",
    name: "Compact",
    note: "The portal as it read before. More on screen at once, in smaller print.",
    /** Shown in the picker, so the choice can be judged by looking. */
    sample: 0.9375,
  },
  {
    id: "normal",
    name: "Normal",
    note: "The everyday size. What a new account starts on.",
    sample: 1,
  },
  {
    id: "large",
    name: "Large",
    note: "A step up again, for a long day or a small laptop.",
    sample: 1.125,
  },
  {
    id: "largest",
    name: "Largest",
    note: "As large as the portal goes. Wide tables will scroll sideways.",
    sample: 1.25,
  },
] as const;

export type TextSizeId = (typeof TEXT_SIZES)[number]["id"];

const IDS = TEXT_SIZES.map((t) => t.id) as readonly string[];

/** Anything unrecognised falls back to the size everybody starts on. */
export function readTextSize(value: string | null | undefined): TextSizeId {
  return (IDS.includes(value ?? "") ? value : "normal") as TextSizeId;
}
