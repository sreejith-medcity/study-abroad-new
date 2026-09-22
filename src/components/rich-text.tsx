import { Fragment } from "react";
import { parseRich, type Inline } from "@/lib/rich-text";
import { cn } from "./ui";

function Line({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === "b" ? (
          <strong key={i} className="font-semibold">{p.v}</strong>
        ) : p.t === "i" ? (
          <em key={i}>{p.v}</em>
        ) : p.t === "a" ? (
          <a key={i} href={p.v} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-600 underline">{p.v}</a>
        ) : (
          <Fragment key={i}>{p.v}</Fragment>
        ),
      )}
    </>
  );
}

/** A comment or message with its bold, italics, lists and links. */
export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5 break-words", className)}>
      {parseRich(text).map((b, i) =>
        b.t === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Line parts={l} />
              </Fragment>
            ))}
          </p>
        ) : b.t === "ul" ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ul>
        ) : (
          <ol key={i} className="list-decimal space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ol>
        ),
      )}
    </div>
  );
}
