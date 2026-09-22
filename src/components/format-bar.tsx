"use client";

/**
 * Buttons that add the comment formatting to a textarea: bold, italics, a
 * bulleted list and a numbered list. Works on the selection, or inserts a
 * placeholder to type over.
 */
export function FormatBar({ target }: { target: string }) {
  const apply = (kind: "b" | "i" | "ul" | "ol") => {
    const el = document.getElementById(target) as HTMLTextAreaElement | null;
    if (!el) return;
    const { selectionStart: a, selectionEnd: z, value } = el;
    const sel = value.slice(a, z);
    let insert: string;
    if (kind === "b" || kind === "i") {
      const mark = kind === "b" ? "**" : "*";
      insert = `${mark}${sel || (kind === "b" ? "bold" : "italic")}${mark}`;
    } else {
      const lines = (sel || "item").split("\n");
      insert = lines.map((l, i) => (kind === "ul" ? `- ${l}` : `${i + 1}. ${l}`)).join("\n");
      if (a > 0 && value[a - 1] !== "\n") insert = `\n${insert}`;
    }
    el.setRangeText(insert, a, z, "select");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };
  const btn = "rounded px-2 py-0.5 text-[13px] text-ink-soft hover:bg-surface-2";
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
      <button type="button" className={`${btn} font-bold`} onClick={() => apply("b")} aria-label="Bold">B</button>
      <button type="button" className={`${btn} italic`} onClick={() => apply("i")} aria-label="Italic">I</button>
      <button type="button" className={btn} onClick={() => apply("ul")} aria-label="Bulleted list">• List</button>
      <button type="button" className={btn} onClick={() => apply("ol")} aria-label="Numbered list">1. List</button>
    </div>
  );
}
