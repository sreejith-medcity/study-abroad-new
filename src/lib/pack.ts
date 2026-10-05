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
    /** The application's own number in the vendor's portal, where one has come back. */
    vendorReference: string | null;
    vendor: { name: string; code: string; extraDocuments: string | null; interviewRequired: boolean } | null;
  };
  student: { id: string; medcityId: string | null; name: string; branch: string; passportNumber: string | null; dateOfBirth: Date | null; surname: string; given: string };
  /** How the vendor on this road wants the pack, where one is chosen. */
  rules: PackRules;
  /** Accepted documents, in the order they belong in a folder somebody reads. */
  files: {
    itemId: string;
    documentId: string | null;
    label: string;
    stage: string;
    version: number;
    validTo: string | null;
    acceptedOn: Date | null;
    fileName: string | null;
    storageKey: string | null;
    mimeType: string | null;
    bytes: number | null;
    /** Put in deliberately although it has not been accepted, which the cover sheet says. */
    notYetAccepted?: boolean;
  }[];
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

/* ---------------- What each vendor wants a pack to look like ---------------- */

export type PackRules = {
  shape: "FOLDER" | "ONE_PDF";
  /** A pattern like SURNAME_GIVEN_TYPE. Null means the portal's own numbering. */
  naming: string | null;
  /** Megabytes the vendor's system accepts. Null means they have not said. */
  limitMb: number | null;
};

export const DEFAULT_PACK_RULES: PackRules = { shape: "FOLDER", naming: null, limitMb: null };

/** The two shapes a vendor's system takes, in the words the form uses. */
export const PACK_SHAPES: Record<PackRules["shape"], string> = {
  FOLDER: "A folder, one file per document",
  ONE_PDF: "One PDF with everything in it",
};

/** What a pattern may ask for, so the screen can say so rather than make people guess. */
export const NAMING_TOKENS = ["{SURNAME}", "{GIVEN}", "{TYPE}", "{ID}", "{N}"] as const;

const clean = (v: string) => v.replace(/[^\p{L}\p{N} _-]+/gu, "").replace(/\s+/g, " ").trim();

/**
 * One file's name, the way this vendor writes them.
 *
 * Case is taken from the pattern: a vendor who writes SURNAME in capitals gets
 * capitals, one who writes Surname gets what the student actually typed. That
 * is the whole difference between KC and Medcity Direct, and it is the kind of
 * thing a portal should carry rather than a person remember.
 *
 * So is the separator. A pattern with no spaces in it gets no spaces anywhere,
 * because a vendor who wrote underscores between the parts did not mean to
 * receive RAHMAN_FATHIMA_PASSPORT FRONT AND BACK.
 */
export function nameInPack(
  rules: PackRules,
  index: number,
  parts: { surname: string; given: string; type: string; medcityId: string | null },
  original: string | null,
): string {
  const ext = (original?.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".pdf").toLowerCase();
  if (!rules.naming) return packFileName(index, parts.type, original);

  const sep = / /.test(rules.naming) ? " " : rules.naming.includes("_") ? "_" : rules.naming.includes("-") ? "-" : " ";
  const value = (token: string, raw: string) => {
    const tidied = clean(raw).replace(/ /g, sep);
    if (token === token.toUpperCase()) return tidied.toUpperCase();
    if (token === token.toLowerCase()) return tidied.toLowerCase();
    return tidied;
  };

  const filled = rules.naming
    .replace(/\{SURNAME\}/gi, (t) => value(t, parts.surname))
    .replace(/\{GIVEN\}/gi, (t) => value(t, parts.given))
    .replace(/\{TYPE\}/gi, (t) => value(t, parts.type))
    .replace(/\{ID\}/gi, parts.medcityId ?? "")
    .replace(/\{N\}/gi, String(index + 1).padStart(2, "0"))
    .replace(/_{2,}/g, "_")
    .replace(/^[_\s-]+|[_\s-]+$/g, "");
  return `${filled || packFileName(index, parts.type, null).replace(/\.[a-z0-9]+$/i, "")}${ext}`;
}

/** What a file's name is built from, in one place so the screen and the pack agree. */
export const partsOf = (contents: PackContents, f: PackContents["files"][number]) => ({
  surname: contents.student.surname,
  given: contents.student.given,
  type: f.label,
  medcityId: contents.student.medcityId,
});

/** Whether what has been gathered fits what the vendor accepts. */
export function withinLimit(rules: PackRules, bytes: number): { ok: boolean; says: string } {
  if (rules.limitMb == null) return { ok: true, says: "" };
  const limit = rules.limitMb * 1024 * 1024;
  if (bytes <= limit) return { ok: true, says: "" };
  const over = Math.ceil((bytes - limit) / (1024 * 1024));
  return {
    ok: false,
    says: `This comes to ${Math.ceil(bytes / (1024 * 1024))} MB and the vendor accepts ${rules.limitMb} MB. Take out ${over} MB, or ask them to raise it.`,
  };
}

/** What the screen says the pack will be, before anybody builds it. */
export const packShapeText = (rules: PackRules) => PACK_SHAPES[rules.shape] ?? PACK_SHAPES.FOLDER;

/** The same thing on one line, for a list where the shape is one column among many. */
export const packRulesLine = (rules: PackRules) =>
  [packShapeText(rules), rules.naming, rules.limitMb ? `up to ${rules.limitMb} MB` : null].filter(Boolean).join(" · ");

/** The sheet at the front of the folder, so nobody has to guess what is in it. */
export function coverSheet(contents: PackContents, builtBy: string, today = new Date()) {
  const a = contents.application;
  const lines: string[] = [
    `${a.university} — ${a.course}`,
    `Application ${a.ackNo}, ${a.intake} intake`,
    "",
    `Student        ${contents.student.name}`,
    `Medcity ID     ${contents.student.medcityId ?? "Not recorded"}`,
    `Branch         ${contents.student.branch}`,
    `Date of birth  ${contents.student.dateOfBirth ? fmtDate(contents.student.dateOfBirth) : "Not recorded"}`,
    `Passport       ${contents.student.passportNumber ?? "Not recorded"}`,
    `Campus         ${a.campus ?? "Not recorded"}`,
    `Destination    ${a.country}`,
    `Sent through   ${a.vendor ? `${a.vendor.name} (${a.vendor.code})` : "Medcity Overseas, direct to the university"}`,
    `Their number   ${a.vendorReference ?? "Not recorded"}`,
    `Status         ${a.status}`,
    `Packed on      ${fmtDate(today)} by ${builtBy}`,
    "",
    `In this folder (${contents.files.length})`,
    "",
  ];
  // Named the way the pack itself names them, so the sheet and the folder agree.
  contents.files.forEach((f, i) => {
    const parts = [nameInPack(contents.rules, i, partsOf(contents, f), f.fileName), f.label, f.stage, `version ${f.version || 1}`];
    if (f.acceptedOn) parts.push(`accepted ${fmtDate(f.acceptedOn)}`);
    if (f.validTo) parts.push(`valid to ${fmtDate(f.validTo)}`);
    if (f.notYetAccepted) parts.push("NOT CHECKED, put in deliberately");
    lines.push(`  ${parts.join("  ·  ")}`);
  });
  if (contents.files.some((f) => f.notYetAccepted)) {
    lines.push("", "  Anything marked NOT CHECKED was added by hand before the desk accepted it.");
  }
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
  `${contents.student.name} ${contents.application.ackNo} ${contents.application.university}`.replace(/[^\p{L}\p{N} .-]+/gu, " ").replace(/\s+/g, " ").trim() +
  (contents.rules.shape === "ONE_PDF" ? ".pdf" : ".zip");
