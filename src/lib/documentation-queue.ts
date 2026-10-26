/**
 * The documentation queue, one row per student.
 *
 * The desk picks up a student's file, not a document: seven uploads from one
 * student are one file to open, and a list of 145 documents reads as 145
 * people waiting. So the per-document rows the database returns are folded
 * here into one row per student, with that student's waiting documents under
 * it. Pure, so the order a student lands in can be tested without a browser.
 */

import type { JourneyStage } from "@/db/schema";
import { claimHeld, oldestFirst, stageRank, visaFirstOrder } from "./journey";

export type QueueSort = "OLDEST" | "VISA_FIRST";

/** What the grouping needs from a queue row. The page's rows carry more. */
export type QueueGroupRow = {
  id: string;
  studentId: string;
  studentName: string;
  branch: string;
  stage: JourneyStage;
  dueOn: string | null;
  uploadedAt: Date | null;
  vendorCode: string | null;
  vendorColour: string | null;
  claimedById: string | null;
  claimedAt: Date | null;
  claimedByName: string | null;
};

export type QueueRoute = { code: string; colour: string | null };

/** Who holds how many of a student's waiting documents. */
export type QueueHolder = { id: string; name: string | null; count: number };

export type StudentQueueGroup<T extends QueueGroupRow> = {
  studentId: string;
  studentName: string;
  branch: string;
  /** When the document that has waited longest was sent in. */
  oldestUploadedAt: Date | null;
  /** The earliest date any of the documents is wanted by. */
  soonestDueOn: string | null;
  /** The furthest stage any of the waiting documents sits at. */
  stage: JourneyStage;
  /** Every route the waiting documents are on, in the order they first appear. */
  routes: QueueRoute[];
  /** The waiting documents, in the order the desk should take them. */
  items: T[];
  /** Claims still held, most documents first; lapsed claims do not count. */
  holders: QueueHolder[];
};

export type GroupOptions = {
  /** The person looking, so their own claims lead and read as "you". */
  viewerId?: string;
  /** Put the viewer's own claimed documents first under each student. */
  mineFirst?: boolean;
  today?: Date;
};

/**
 * Oldest first; a document with no time recorded goes last rather than first.
 * The same rule the visa-first order falls back to, from lib/journey.ts, so
 * the two sorts cannot place an unrecorded time differently.
 */
const oldestOrder = (a: QueueGroupRow, b: QueueGroupRow) => oldestFirst(a, b);

/**
 * Folds per-document rows into one group per student and orders the groups.
 *
 * Oldest first means the student whose longest-waiting document has waited
 * longest comes first. Visa stage first means each student is placed by their
 * most pressing document under the visa-first rule, and oldest breaks ties, so
 * the queue of students agrees with the queue of documents it is made from.
 */
export function groupQueue<T extends QueueGroupRow>(rows: T[], sort: QueueSort, options: GroupOptions = {}): StudentQueueGroup<T>[] {
  const today = options.today ?? new Date();
  const byStudent = new Map<string, T[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId);
    if (list) list.push(row);
    else byStudent.set(row.studentId, [row]);
  }

  const itemOrder = (a: T, b: T) => (sort === "VISA_FIRST" ? visaFirstOrder(a, b, today) : oldestOrder(a, b));
  const groups: StudentQueueGroup<T>[] = [];
  for (const items of byStudent.values()) {
    items.sort(itemOrder);
    if (options.mineFirst && options.viewerId) {
      const mine = options.viewerId;
      // A stable partition: the viewer's own claims first, each half keeping its order.
      items.sort((a, b) => Number(b.claimedById === mine) - Number(a.claimedById === mine));
    }
    const first = items[0];
    let oldest: Date | null = null;
    let soonest: string | null = null;
    let stage = first.stage;
    const routes: QueueRoute[] = [];
    const held = new Map<string, QueueHolder>();
    for (const item of items) {
      if (item.uploadedAt && (!oldest || item.uploadedAt.getTime() < oldest.getTime())) oldest = item.uploadedAt;
      if (item.dueOn && (!soonest || item.dueOn < soonest)) soonest = item.dueOn;
      if (stageRank(item.stage) > stageRank(stage)) stage = item.stage;
      if (item.vendorCode && !routes.some((r) => r.code === item.vendorCode)) routes.push({ code: item.vendorCode, colour: item.vendorColour });
      if (item.claimedById && claimHeld(item.claimedAt, today)) {
        const holder = held.get(item.claimedById);
        if (holder) holder.count += 1;
        else held.set(item.claimedById, { id: item.claimedById, name: item.claimedByName, count: 1 });
      }
    }
    const holders = [...held.values()].sort((a, b) => {
      // The viewer's own count reads first, then whoever holds the most.
      if (options.viewerId && (a.id === options.viewerId) !== (b.id === options.viewerId)) return a.id === options.viewerId ? -1 : 1;
      return b.count - a.count || (a.name ?? "").localeCompare(b.name ?? "");
    });
    groups.push({ studentId: first.studentId, studentName: first.studentName, branch: first.branch, oldestUploadedAt: oldest, soonestDueOn: soonest, stage, routes, items, holders });
  }

  // The group's lead document decides where the student lands. Under the
  // visa-first rule that is the item the sort put first; under oldest first it
  // is the longest-waiting one, which is the same thing.
  const lead = (g: StudentQueueGroup<T>): T => {
    if (!options.mineFirst) return g.items[0];
    return [...g.items].sort(itemOrder)[0];
  };
  groups.sort((a, b) => {
    const byLead = itemOrder(lead(a), lead(b));
    if (byLead !== 0) return byLead;
    return oldestOrder(lead(a), lead(b)) || a.studentName.localeCompare(b.studentName);
  });
  return groups;
}

/* ---------------- Paging ---------------- */

/** Students per page of the queue. */
export const QUEUE_PAGE = 60;

/**
 * The furthest page the address may ask for. Far past any real queue, and
 * small enough that the offset stays an exact whole number Postgres reads as
 * a bigint: ?page=1e20 used to reach the database as "offset 6e+21" and fail.
 */
export const QUEUE_PAGE_MAX = 100_000;

/** The page asked for in the address, or the first; nonsense reads as the first. */
export function queuePageNumber(raw: string | string[] | undefined): number {
  const n = Math.floor(Number(Array.isArray(raw) ? raw[0] : raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, QUEUE_PAGE_MAX) : 1;
}

/**
 * Where the links at the foot of the page go: the page before, when there is
 * one, and the page after, when this one was full. The first page carries no
 * number in the address, so the plain queue and page 1 are the same link.
 */
export function queuePaging(page: number, hasNext: boolean): { previous: number | null; next: number | null } {
  return { previous: page > 1 ? page - 1 : null, next: hasNext ? page + 1 : null };
}

/** "3 documents" or "1 document". */
export const documentCount = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

/**
 * "2 with you, 1 with Anjali", or "None claimed" when nobody holds any of them.
 * The viewer is "you"; a holder whose name is missing is "somebody".
 */
export function holdersText(holders: QueueHolder[], viewerId?: string): string {
  if (holders.length === 0) return "None claimed";
  return holders.map((h) => `${h.count} with ${h.id === viewerId ? "you" : (h.name ?? "somebody")}`).join(", ");
}
