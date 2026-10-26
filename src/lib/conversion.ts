/**
 * Who a student registered from an enquiry is given to.
 *
 * Pure, so the rule can be tested without a database and so the form's
 * default and the action's fallback cannot disagree.
 */

import { isCounsellor } from "./permissions";

export type EnquiryOwner = { id: string; role: string; orgId: string; active: boolean };

/**
 * The counsellor the new student is assigned to.
 *
 * Whoever is registering may pick somebody, and that choice stands. Left on
 * "Me / unassigned", the student goes to the counsellor the enquiry was
 * with: that is the person who has been ringing them, and the enquiry list
 * and the enquiry's own page both keep showing that counsellor against the
 * student. Before this, a branch head converting a counsellor's enquiry
 * landed the student unassigned and registered by the head, so the
 * counsellor could no longer open the file the enquiry pointed them to.
 *
 * The enquiry's owner is only used when they could be chosen on the form:
 * still active, at the branch the student belongs to, and a counsellor. A
 * head who owned the enquiry themselves, or an owner who has since moved
 * branch, does not count, and the rule falls back to what it always was: a
 * counsellor registering keeps the student, and anybody else leaves them
 * for the branch head to hand out.
 */
export function convertedStudentOwner(
  posted: string | null,
  registrar: { id: string; role: string },
  orgId: string,
  enquiryOwner: EnquiryOwner | null,
): string | null {
  if (posted) return posted;
  if (enquiryOwner && enquiryOwner.active && enquiryOwner.orgId === orgId && isCounsellor(enquiryOwner.role)) return enquiryOwner.id;
  return isCounsellor(registrar.role) ? registrar.id : null;
}
