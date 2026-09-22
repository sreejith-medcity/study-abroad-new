/**
 * The small formatting comments allow: **bold**, *italic*, lines starting
 * "- " or "1. " as lists, and web links. Parsed into a plain tree so it is
 * rendered as React elements, never as HTML.
 */
export type Inline = { t: "text" | "b" | "i" | "a"; v: string };
export type Block = { t: "p"; lines: Inline[][] } | { t: "ul" | "ol"; items: Inline[][] };

const LINK = /https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let rest = s;
  const re = new RegExp(`\\*\\*([^*\\n]+?)\\*\\*|\\*([^*\\n]+?)\\*|(${LINK.source})`);
  while (rest) {
    const m = re.exec(rest);
    if (!m) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "i", v: m[2] });
    else out.push({ t: "a", v: m[3] });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function parseRich(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const ul = /^\s*[-•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      const item = parseInline((ul ?? ol)![1]);
      if (last && last.t === kind) last.items.push(item);
      else blocks.push({ t: kind, items: [item] });
    } else if (line.trim() === "") {
      blocks.push({ t: "p", lines: [] });
    } else if (last && last.t === "p" && last.lines.length) {
      last.lines.push(parseInline(line));
    } else {
      blocks.push({ t: "p", lines: [parseInline(line)] });
    }
  }
  return blocks.filter((b) => b.t !== "p" || b.lines.length);
}

/** WhatsApp's own markers: *bold* and _italic_. */
export function toWhatsApp(text: string) {
  return text.replace(/\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*/g, (_, b, i) => (b !== undefined ? `*${b}*` : `_${i}_`));
}

/** Plain text for notifications and previews. */
export function toPlain(text: string) {
  return text.replace(/\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*/g, (_, b, i) => b ?? i);
}
