import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { DOCUMENTATION_ROLES } from "@/lib/permissions";
import { syncChecklist } from "@/db/documentation-sync";
import { notifyUsers } from "@/server/notify";

/** What a desk person is doing on a file handed over at registration. */
export const DOCUMENTS_PART = "Documents";

/**
 * The officer carrying the fewest files, so a morning's registrations spread
 * across the desk instead of landing on whoever is alphabetically first.
 * Ties go to the name that sorts first, which keeps this predictable to test
 * and to explain.
 */
async function quietestOfficer() {
  const u = schema.users;
  const p = schema.studentPeople;
  const [row] = await db
    .select({ id: u.id, carrying: sql<number>`count(${p.id})`.mapWith(Number) })
    .from(u)
    .leftJoin(p, and(eq(p.userId, u.id), eq(p.part, DOCUMENTS_PART)))
    .where(and(eq(u.active, true), inArray(u.role, [...DOCUMENTATION_ROLES])))
    .groupBy(u.id, u.name)
    .orderBy(asc(sql`count(${p.id})`), asc(u.name))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Registering a candidate who came in as an enquiry hands the file to the
 * documentation desk.
 *
 * Until now registration closed the enquiry and stopped. The desk learned a
 * student existed when an application appeared, which can be weeks later, and
 * the document list did not exist until somebody opened the tab that builds
 * it. So the papers every student needs whatever they apply for, the ones the
 * Profile stage asks for, were chased late or not at all.
 *
 * Three things happen here, and each is written so running it twice changes
 * nothing: the list is opened, somebody at the desk is put on the file, and
 * the desk is told. The branch keeps the student: the counsellor who did the
 * counselling is still the assignment, and this is the desk working beside
 * them, which is what the people-on-file list has always meant.
 */
export async function handEnquiryToDocumentation(studentId: string, byId: string, studentName: string) {
  const { added } = await syncChecklist(studentId);

  const officerId = await quietestOfficer();
  if (officerId) {
    const already = await db.query.studentPeople.findFirst({
      where: and(eq(schema.studentPeople.studentId, studentId), eq(schema.studentPeople.userId, officerId)),
    });
    if (!already) {
      await db.insert(schema.studentPeople).values({ studentId, userId: officerId, part: DOCUMENTS_PART, addedById: byId });
      await audit(byId, "student.handover", "student", studentId, { to: officerId, part: DOCUMENTS_PART });
    }
  }

  // Everybody on the desk hears about it, not only the one it landed on: the
  // team leader is who notices when a registration is not being worked. The
  // officer it landed on is sent to the file. The rest of the desk cannot open
  // a file nobody has handed them, so they are sent to the desk's queue, where
  // it shows, rather than to a file that would refuse them.
  const desk = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, [...DOCUMENTATION_ROLES])));
  const body = added > 0 ? `${studentName}: ${added} document${added === 1 ? "" : "s"} to collect.` : studentName;
  if (officerId) await notifyUsers([officerId], "A registered student is ready for documents", body, `/students/${studentId}/documentation`);
  const rest = desk.map((d) => d.id).filter((id) => id !== officerId);
  if (rest.length) await notifyUsers(rest, "A registered student is ready for documents", body, "/documentation");
  return { added, officerId };
}
