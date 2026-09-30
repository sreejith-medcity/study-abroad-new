/**
 * The submission pack, described rather than built: the sheet at the front of the
 * folder, and the names the files carry inside it.
 *
 * Pure, so the wording can be tested without a database and without storage. The
 * gathering itself lives in the server module beside it.
 */

import { fmtDate } from "./format";

export type PackContents = {
  application: {
    id: string;
    ackNo: string;
    intake: string;
    course: string;
    university: string;
    campus: string | null;
    country: string;
    status: string;
    vendor: { name: string; code: string; extraDocuments: string | null; interviewRequired: boolean } | null;
  };
  student: { id: string; name: string; branch: string; passportNumber: string | null; dateOfBirth: Date | null };
  /** Accepted documents, in the order they belong in a folder somebody reads. */
  files: { itemId: string; documentId: string | null; label: string; stage: string; version: number; validTo: string | null; acceptedOn: Date | null; fileName: string | null; storageKey: string | null; mimeType: string | null }[];
  /** Required paper that is not in hand, named rather than hidden. */
  missing: { label: string; why: string; owedBy: string }[];
  /** Accepted, but with a date that does not reach the course start. */
  expiring: { label: string; validTo: string | null }[];
};


/** A file name a stranger opening the folder can read, in the order it belongs. */
export function packFileName(index: number, label: string, original: string | null) {
  const ext = (original?.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".pdf").toLowerCase();
  const tidy = label.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${String(index + 1).padStart(2, "0")} ${tidy}${ext}`;
}

/** The sheet at the front of the folder, so nobody has to guess what is in it. */
export function coverSheet(contents: PackContents, builtBy: string, today = new Date()) {
  const a = contents.application;
  const lines: string[] = [
    `${a.university} — ${a.course}`,
    `Application ${a.ackNo}, ${a.intake} intake`,
    "",
    `Student        ${contents.student.name}`,
    `Branch         ${contents.student.branch}`,
    `Date of birth  ${contents.student.dateOfBirth ? fmtDate(contents.student.dateOfBirth) : "Not recorded"}`,
    `Passport       ${contents.student.passportNumber ?? "Not recorded"}`,
    `Campus         ${a.campus ?? "Not recorded"}`,
    `Destination    ${a.country}`,
    `Sent through   ${a.vendor ? `${a.vendor.name} (${a.vendor.code})` : "Medcity Overseas, direct to the university"}`,
    `Status         ${a.status}`,
    `Packed on      ${fmtDate(today)} by ${builtBy}`,
    "",
    `In this folder (${contents.files.length})`,
    "",
  ];
  contents.files.forEach((f, i) => {
    const parts = [packFileName(i, f.label, f.fileName), f.label, f.stage, `version ${f.version || 1}`];
    if (f.acceptedOn) parts.push(`accepted ${fmtDate(f.acceptedOn)}`);
    if (f.validTo) parts.push(`valid to ${fmtDate(f.validTo)}`);
    lines.push(`  ${parts.join("  ·  ")}`);
  });
  if (a.vendor?.extraDocuments) {
    lines.push("", `What ${a.vendor.name} asks for beyond the university's own list`, "", `  ${a.vendor.extraDocuments}`);
  }
  if (a.vendor?.interviewRequired) {
    lines.push("", "  An interview is part of this route.");
  }
  if (contents.expiring.length) {
    lines.push("", "In the folder, but running out too early", "");
    for (const e of contents.expiring) lines.push(`  ${e.label}  ·  valid to ${e.validTo ? fmtDate(e.validTo) : "not recorded"}`);
    lines.push("", "  These count as missing until they are renewed, whatever is in the folder.");
  }
  // Anything already listed above is not also reported as absent: a document that
  // is in the folder and out of date is one problem, not two.
  const inFolder = new Set(contents.files.map((f) => f.label));
  const absent = contents.missing.filter((m) => !inFolder.has(m.label));
  if (absent.length) {
    lines.push("", "Not in this folder, and still required", "");
    for (const m of absent) lines.push(`  ${m.label}  ·  ${m.why}  ·  owed by ${m.owedBy.toLowerCase()}`);
  } else if (!contents.expiring.length) {
    lines.push("", "Nothing required is missing.");
  }
  lines.push("", "Medcity Overseas");
  return lines.join("\n");
}

/** What the download is called on the team's own computer. */
export const packName = (contents: PackContents) =>
  `${contents.student.name} ${contents.application.ackNo} ${contents.application.university}`.replace(/[^\p{L}\p{N} .-]+/gu, " ").replace(/\s+/g, " ").trim() + ".zip";
