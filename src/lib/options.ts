export const OPTIONS_STATUS_LABEL = { REQUESTED: "Requested", OPTIONS_SENT: "Program options sent", APPLIED: "Applied" } as const;
export const OPTIONS_STATUS_TONE = { REQUESTED: "warn", OPTIONS_SENT: "info", APPLIED: "ok" } as const;
export const EDUCATION_LEVELS = ["Std. 12th", "Diploma", "Bachelor's", "Master's", "PhD"] as const;
export const MAX_CHOICES = 3;
/** "PO-260922-K7QM": readable on the phone, unique enough with the constraint behind it. */
export function newRequestNo(d = new Date()) {
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += abc[Math.floor(Math.random() * abc.length)];
  return `PO-${ymd}-${tail}`;
}
