import "server-only";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { fullName } from "@/lib/format";
import { STUDENT_WORK_ROLES } from "@/lib/permissions";
import type { MoveBranchOption } from "@/components/student-move-form";
import { filePeopleToTakeOff, planStudentMove, studentMoveSummary, taskTakerFor, type MovingStudent } from "@/lib/student-move";
import { notifyUsers } from "@/server/notify";
import { updateTracked, updateTrackedMany } from "@/server/record-history";
import { whoMayOpenStudent } from "@/server/scope";

/**
 * Moves one student, or every active student of a branch, to another branch,
 * in one transaction, so a refusal part way leaves nothing half moved. The
 * rules are in lib/student-move.ts; this reads what they need, applies the
 * plan and tells the people concerned.
 *
 * What moves: the student's branch and counsellor, the student's
 * applications that were the old branch's (the branch's application lists,
 * its notices and its commission from now on read the application's branch),
 * the enquiries the student came from that were the old branch's, and the
 * open tasks about them that sat with somebody at the old branch. The ledger
 * line and the version history are written by updateTracked as each record
 * changes, the same as any other move of ownership.
 *
 * What stays: who registered them, the sub-agent who referred them, the
 * Medcity ID (families have it written down), the team carrying the file,
 * the documents and history, and the money already on paper (fee invoices,
 * receipts, instalments, refunds, income lines), which the old branch
 * numbered and keeps in its books.
 */
export async function moveStudents(
  actor: { id: string },
  input: { fromOrgId: string; toOrgId: string; choice: string; counsellorId: string | null; studentId?: string },
): Promise<{ ok: string } | { error: string }> {
  const bulk = !input.studentId;
  const [from, to] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(schema.organizations.id, input.fromOrgId) }),
    input.toOrgId ? db.query.organizations.findFirst({ where: eq(schema.organizations.id, input.toOrgId) }) : Promise.resolve(undefined),
  ]);
  if (!from) return { error: "Branch not found." };

  const counsellor = input.counsellorId
    ? ((await db.query.users.findFirst({ where: eq(schema.users.id, input.counsellorId), columns: { id: true, name: true, deskLabel: true, orgId: true, role: true, active: true } })) ?? null)
    : null;
  const heads = to
    ? await db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(and(eq(schema.users.orgId, to.id), eq(schema.users.role, "PARTNER"), eq(schema.users.active, true)))
        .orderBy(asc(schema.users.name))
    : [];

  // The students, with whether their counsellor sits at the head office.
  const counsellorOf = alias(schema.users, "counsellor");
  const counsellorOrg = alias(schema.organizations, "counsellor_org");
  const st = schema.students;
  const rows = await db
    .select({ id: st.id, orgId: st.orgId, archived: st.archived, assignedToId: st.assignedToId, firstName: st.firstName, lastName: st.lastName, teamId: st.teamId, hqCounsellor: counsellorOrg.type })
    .from(st)
    .leftJoin(counsellorOf, eq(counsellorOf.id, st.assignedToId))
    .leftJoin(counsellorOrg, eq(counsellorOrg.id, counsellorOf.orgId))
    .where(bulk ? and(eq(st.orgId, from.id), eq(st.archived, false)) : eq(st.id, input.studentId!));
  const students: MovingStudent[] = rows.map((r) => ({ id: r.id, orgId: r.orgId, archived: r.archived, assignedToId: r.assignedToId, counsellorAtHeadOffice: r.hqCounsellor === "HQ" }));
  const archivedLeft = bulk
    ? (await db.select({ id: st.id }).from(st).where(and(eq(st.orgId, from.id), eq(st.archived, true)))).length
    : 0;

  const planned = planStudentMove({
    students,
    from: { id: from.id, name: from.name },
    to: to ? { id: to.id, name: to.name, type: to.type, active: to.active } : null,
    choice: input.choice,
    counsellor: counsellor ? { id: counsellor.id, name: counsellor.deskLabel ?? counsellor.name, orgId: counsellor.orgId, role: counsellor.role, active: counsellor.active } : null,
    targetHeads: heads.length,
    bulk,
  });
  if (!planned.ok) return { error: planned.error };
  const plan = planned.plan;
  const target = to!;
  const ids = plan.moves.map((m) => m.studentId);
  const after = new Map(plan.moves.map((m) => [m.studentId, m.to]));
  const head = heads[0] ?? null;
  const detail = `Moved from ${from.name} to ${target.name}`;

  const done = await db.transaction(async (tx) => {
    // The students, grouped by the counsellor each has afterwards, so a whole
    // branch is a handful of statements rather than one per student. Only
    // rows still at the old branch are touched; anything else means somebody
    // moved one of them in the meantime, and the whole move is undone.
    const byCounsellor = new Map<string | null, string[]>();
    for (const m of plan.moves) byCounsellor.set(m.to, [...(byCounsellor.get(m.to) ?? []), m.studentId]);
    let moved = 0;
    for (const [assignedToId, group] of byCounsellor) {
      const out = await updateTrackedMany(
        "student",
        and(inArray(st.id, group), eq(st.orgId, from.id))!,
        { orgId: target.id, assignedToId, updatedAt: new Date() },
        { by: actor.id, action: "student.move", tx, ledgerDetail: detail },
      );
      moved += out.length;
    }
    if (moved !== ids.length) throw new MovedMeanwhile();

    const apps = await updateTrackedMany(
      "application",
      and(inArray(schema.applications.studentId, ids), eq(schema.applications.orgId, from.id))!,
      { orgId: target.id, updatedAt: new Date() },
      { by: actor.id, action: "application.move", tx },
    );

    // The enquiries they came from, where the old branch held them. The owner
    // goes with the counsellor when the owner was somebody at the old branch.
    const owner = alias(schema.users, "enquiry_owner");
    const enquiries = await tx
      .select({ id: schema.enquiries.id, studentId: schema.enquiries.studentId, assignedToId: schema.enquiries.assignedToId, ownerOrg: owner.orgId })
      .from(schema.enquiries)
      .leftJoin(owner, eq(owner.id, schema.enquiries.assignedToId))
      .where(and(inArray(schema.enquiries.studentId, ids), eq(schema.enquiries.orgId, from.id)));
    for (const e of enquiries) {
      const assignedToId = e.ownerOrg === from.id ? (after.get(e.studentId!) ?? null) : e.assignedToId;
      await updateTracked("enquiry", e.id, { orgId: target.id, assignedToId, updatedAt: new Date() }, { by: actor.id, action: "enquiry.move", tx, ledgerDetail: detail });
    }

    // People on the files who could no longer open them.
    const onFile = await tx
      .select({ id: schema.studentPeople.id, studentId: schema.studentPeople.studentId, userId: schema.studentPeople.userId, userOrgId: schema.users.orgId })
      .from(schema.studentPeople)
      .innerJoin(schema.users, eq(schema.users.id, schema.studentPeople.userId))
      .where(inArray(schema.studentPeople.studentId, ids));
    const teamOf = new Map(rows.map((r) => [r.id, r.teamId]));
    const teamIds = [...new Set(rows.map((r) => r.teamId).filter((t): t is string => !!t))];
    const members = teamIds.length
      ? await tx
          .select({ teamId: schema.teamMembers.teamId, userId: schema.teamMembers.userId })
          .from(schema.teamMembers)
          .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
          .where(and(inArray(schema.teamMembers.teamId, teamIds), eq(schema.teams.active, true)))
      : [];
    const inTeam = new Set(members.map((m) => `${m.teamId}:${m.userId}`));
    const off = filePeopleToTakeOff(
      onFile.map((r) => ({ id: r.id, userOrgId: r.userOrgId, onTeam: inTeam.has(`${teamOf.get(r.studentId)}:${r.userId}`) })),
      from.id,
    );
    if (off.length) await tx.delete(schema.studentPeople).where(inArray(schema.studentPeople.id, off));

    // Open tasks about them, or about an enquiry that moved with them.
    const assignee = alias(schema.users, "task_assignee");
    const enquiryIds = enquiries.map((e) => e.id);
    const enquiryStudent = new Map(enquiries.map((e) => [e.id, e.studentId!]));
    const open = await tx
      .select({ id: schema.tasks.id, orgId: schema.tasks.orgId, studentId: schema.tasks.studentId, enquiryId: schema.tasks.enquiryId, assigneeOrg: assignee.orgId })
      .from(schema.tasks)
      .innerJoin(assignee, eq(assignee.id, schema.tasks.assignedToId))
      .where(
        and(
          isNull(schema.tasks.doneAt),
          or(inArray(schema.tasks.studentId, ids), enquiryIds.length ? inArray(schema.tasks.enquiryId, enquiryIds) : undefined),
        ),
      );
    let tasks = 0;
    let tasksLeft = 0;
    const takers = new Set<string>();
    for (const t of open) {
      const sid = t.studentId ?? (t.enquiryId ? enquiryStudent.get(t.enquiryId) : undefined) ?? null;
      const atOld = t.assigneeOrg === from.id;
      const taker = atOld ? taskTakerFor(sid ? (after.get(sid) ?? null) : null, head) : null;
      if (atOld && !taker) {
        tasksLeft++;
        continue;
      }
      await tx
        .update(schema.tasks)
        .set({ ...(taker ? { assignedToId: taker } : {}), ...(t.orgId === from.id ? { orgId: target.id } : {}), updatedAt: new Date() })
        .where(eq(schema.tasks.id, t.id));
      if (taker) {
        tasks++;
        takers.add(taker);
      }
    }

    const perStudentOff = new Map<string, number>();
    for (const r of onFile) if (off.includes(r.id)) perStudentOff.set(r.studentId, (perStudentOff.get(r.studentId) ?? 0) + 1);
    await tx.insert(schema.auditLogs).values(
      plan.moves.map((m) => ({
        actorId: actor.id,
        action: "student.move",
        entityType: "student",
        entityId: m.studentId,
        meta: {
          fromOrg: from.id,
          fromOrgName: from.name,
          toOrg: target.id,
          toOrgName: target.name,
          fromCounsellor: m.from,
          toCounsellor: m.to,
          via: bulk ? "branch" : "file",
          applications: apps.filter((a) => a.after.studentId === m.studentId).length,
          enquiries: enquiries.filter((e) => e.studentId === m.studentId).length,
          takenOffFile: perStudentOff.get(m.studentId) ?? 0,
        },
      })),
    );
    return { apps: apps.length, enquiries: enquiries.length, takenOff: off.length, tasks, tasksLeft, takers: [...takers] };
  }).catch((e) => {
    if (e instanceof MovedMeanwhile) return null;
    throw e;
  });
  if (!done) return { error: "Somebody changed one of these students while this was being done. Nothing was moved; try again." };

  // Notices. Whoever can open the file now gets the link; the others are
  // told without one, rather than sent to a page that would refuse them.
  const names = new Map(rows.map((r) => [r.id, fullName(r)]));
  const fromHeads = (
    await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.orgId, from.id), eq(schema.users.role, "PARTNER"), eq(schema.users.active, true)))
  ).map((u) => u.id);
  const toHeads = heads.map((h) => h.id);
  const notActor = (list: (string | null)[]) => [...new Set(list.filter((x): x is string => !!x && x !== actor.id))];
  if (!bulk) {
    const m = plan.moves[0];
    const name = names.get(m.studentId) ?? "A student";
    const href = `/students/${m.studentId}/profile`;
    const said = `${name} has moved from ${from.name} to ${target.name}.`;
    const newCounsellor = m.to && m.to !== m.from ? m.to : null;
    const others = notActor([m.from, ...fromHeads, ...toHeads]).filter((id) => id !== newCounsellor);
    const open = new Set(await whoMayOpenStudent(m.studentId, others));
    if (newCounsellor && newCounsellor !== actor.id) await notifyUsers([newCounsellor], "Student assigned to you", `${name}, moved from ${from.name} to ${target.name}`, href);
    await notifyUsers(others.filter((id) => open.has(id)), "Student moved to another branch", said, href);
    await notifyUsers(others.filter((id) => !open.has(id)), "Student moved to another branch", said);
  } else {
    if (plan.counsellorId && plan.counsellorId !== actor.id) {
      for (const m of plan.moves) await notifyUsers([plan.counsellorId], "Student assigned to you", `${names.get(m.studentId)}, moved from ${from.name} to ${target.name}`, `/students/${m.studentId}/profile`);
    }
    const n = plan.moves.length;
    const said = `${n} ${n === 1 ? "student has" : "students have"} moved from ${from.name} to ${target.name}.`;
    await notifyUsers(notActor(toHeads), `Students moved to ${target.name}`, said, "/students");
    const oldCounsellors = notActor(plan.moves.map((m) => (m.from !== m.to ? m.from : null)));
    await notifyUsers(notActor([...fromHeads, ...oldCounsellors]).filter((id) => !toHeads.includes(id)), `Students moved to ${target.name}`, said);
  }

  const takerName =
    done.takers.length === 1
      ? done.takers[0] === counsellor?.id
        ? (counsellor.deskLabel ?? counsellor.name)
        : (heads.find((h) => h.id === done.takers[0])?.name ?? null)
      : null;
  const unassigned = plan.moves.filter((m) => !m.to).length;
  return {
    ok: studentMoveSummary({
      studentName: bulk ? null : (names.get(plan.moves[0].studentId) ?? null),
      students: plan.moves.length,
      fromName: from.name,
      toName: target.name,
      counsellorName: plan.counsellorId ? (counsellor?.deskLabel ?? counsellor?.name ?? null) : null,
      unassigned,
      applications: done.apps,
      enquiries: done.enquiries,
      tasks: done.tasks,
      tasksTo: takerName,
      tasksLeft: done.tasksLeft,
      takenOffFiles: done.takenOff,
      archivedLeft,
    }),
  };
}

class MovedMeanwhile extends Error {}

/**
 * The branches a student could be moved to from this one, each with the
 * people there who can take a student and whether it has a head to hand out
 * the ones left unassigned: every open branch and sub-agent firm but this.
 */
export async function moveBranchOptions(exceptOrgId: string): Promise<MoveBranchOption[]> {
  const orgs = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, type: schema.organizations.type })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.active, true), ne(schema.organizations.type, "HQ"), ne(schema.organizations.id, exceptOrgId)))
    .orderBy(asc(schema.organizations.name));
  if (!orgs.length) return [];
  const people = await db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel, role: schema.users.role, orgId: schema.users.orgId })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, [...STUDENT_WORK_ROLES]), inArray(schema.users.orgId, orgs.map((o) => o.id))))
    .orderBy(asc(schema.users.name));
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type as "BRANCH" | "SUB_AGENT",
    hasHead: people.some((p) => p.orgId === o.id && p.role === "PARTNER"),
    people: people.filter((p) => p.orgId === o.id).map((p) => ({ id: p.id, name: p.name, deskLabel: p.deskLabel })),
  }));
}
