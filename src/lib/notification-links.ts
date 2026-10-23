/**
 * Which student a notification link is about, if any.
 *
 * Every notice about a student links somewhere under /students/<id>, and that
 * page opens only for somebody who may see the student. Reading the id back
 * out of the link lets the portal ask that question once, where notices are
 * written and where they are followed, instead of at every place that sends
 * one.
 *
 * The screens under /students that are not a student (the register form and
 * the board) are not ids and give nothing back.
 */
const NOT_A_STUDENT = new Set(["new", "board"]);

export function studentIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /^\/students\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(href);
  if (!m) return null;
  return NOT_A_STUDENT.has(m[1]) ? null : m[1];
}
