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

/**
 * The digits an enquiry is matched on, for repeats and duplicates: the last
 * ten, as above, or every digit of a shorter number (a landline written
 * without its code). Null when there are too few digits to mean anybody.
 * The database side is right(digits, 10), which agrees with both.
 */
export function matchKey(v: string | null | undefined): string | null {
  const key = phoneKey(v);
  if (key) return key;
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}
