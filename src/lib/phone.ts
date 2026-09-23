/**
 * The last ten digits of a phone number, which is what two spellings of the
 * same Indian mobile have in common ("+91 98470 12345", "09847012345"). Null
 * when there are not ten digits to take.
 *
 * It is what identifies a student who has no email address: plenty of families
 * give a branch a mobile number and nothing else.
 */
export function phoneKey(v: string | null | undefined): string | null {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** The same ten digits, worked out in the database, so a match can be a query. */
export const PHONE_KEY_SQL = "right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)";
