/**
 * What an upload may be, and what to say when one does not arrive.
 *
 * Three sides have to agree about the size: the browser refuses a file before
 * sending it, the app refuses it again, and in production something sits in
 * front of the app and refuses it a third time without telling anybody why.
 * The numbers live here so they cannot drift apart, and the wording for that
 * third refusal lives here too, because it is the one nobody can read.
 */
export const MAX_UPLOAD_MB = 10;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const UPLOAD_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

export const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** Checked in the browser, so an oversize scan never leaves the laptop. */
export function sizeRefusal(file: File): string | null {
  if (file.size === 0) return "That file is empty. Choose the scan itself, not a shortcut to it.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${mb(file.size)} MB and the limit is ${MAX_UPLOAD_MB} MB. Scan it again at a lower quality, or split it, and upload it again.`;
  }
  return null;
}

/**
 * The answer came from something other than the app: the proxy in front of it,
 * or nothing at all. Said in plain words, because what the counsellor used to
 * get was a dead screen reading "an unexpected response was received from the
 * server", which is about as much help as silence.
 */
export function refusalFromStatus(status: number, sizeBytes: number): string {
  if (status === 0) return "The file never reached the server. Check the internet connection and try again.";
  if (status === 413) {
    return `The server refused the file because it is too large. This one is ${mb(sizeBytes)} MB. Scan it again at a lower quality, or split it, and upload it again.`;
  }
  if (status === 401 || status === 403) return "Your sign-in has run out. Reload the page, sign in again, and upload it again.";
  // A page of HTML where an answer was expected: nearly always a sign-in that
  // ran out, where something in the way sent the login screen back instead.
  if (status >= 200 && status < 400) return "The answer to that upload was not one this page could read, which usually means the sign-in ran out. Reload the page and try again.";
  if (status === 408 || status === 504) return "The upload took too long and the server gave up on it. Try again on a steadier connection, or with a smaller scan.";
  if (status === 502 || status === 503) return "The server was not taking uploads just then. Wait a moment and try again.";
  return `The server answered with error ${status} and the file was not saved. Try again, and if it keeps happening tell the Overseas desk.`;
}

/**
 * A learning resource is not a student document: the desk puts up slide decks,
 * handbooks and recorded sessions, so the list is wider and the limit higher.
 * Anything bigger than this belongs behind a link rather than on the server.
 */
export const MAX_RESOURCE_MB = 50;
export const MAX_RESOURCE_BYTES = MAX_RESOURCE_MB * 1024 * 1024;
export const RESOURCE_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];
export const RESOURCE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.mp4,.webm,.mov";

export function resourceRefusal(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_RESOURCE_BYTES) {
    return `That file is ${mb(file.size)} MB and the limit is ${MAX_RESOURCE_MB} MB. Put a long video on Drive or YouTube and paste the link instead.`;
  }
  return null;
}
