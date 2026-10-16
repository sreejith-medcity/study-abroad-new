/**
 * The three surfaces the portal can be painted on. The CSS lives in
 * globals.css against [data-skin="..."]; this file is the list, the
 * wording and the guard, so a stray value in the database cannot leave
 * the app without a skin.
 */
export const SKINS = [
  {
    id: "soft",
    name: "Soft",
    note: "Opaque cards on a warm wash. The portal as it has always looked.",
  },
  {
    id: "glass",
    name: "Glass",
    note: "Translucent cards over a coloured field, blurred behind. Needs a recent browser.",
  },
  {
    id: "night",
    name: "Night",
    note: "The same layout after dark, for anybody working late.",
  },
] as const;

export type SkinId = (typeof SKINS)[number]["id"];

const IDS = SKINS.map((s) => s.id) as readonly string[];

/** Anything unrecognised falls back to the surface everybody started on. */
export function readSkin(value: string | null | undefined): SkinId {
  return (IDS.includes(value ?? "") ? value : "soft") as SkinId;
}
