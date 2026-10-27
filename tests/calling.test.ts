import { strict as assert } from "node:assert";
import test from "node:test";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_CONTACT,
  CALL_OUTCOME_LABEL,
  addDays,
  callReason,
  callsFromQueue,
  dialDigits,
  needsLostReason,
  orderQueue,
  parseQueueKey,
  planCall,
  queueKey,
  readsTeamQueue,
  telHref,
  whatsappHref,
  type QueueEntry,
} from "../src/lib/calling";
import { CONNECTED_OUTCOMES, isConnected, OUTCOME_LABEL, SUGGESTED_FOLLOW_UP } from "../src/lib/crm";
import { contactOutcome } from "../src/db/schema";

const today = "2026-10-26";

/* ---------------- Who needs a call ---------------- */

test("somebody never contacted needs a call whatever date is set against them", () => {
  assert.equal(callReason({ contacted: false, dueOn: null }, today), "NEVER_CONTACTED");
  assert.equal(callReason({ contacted: false, dueOn: "2026-11-30" }, today), "NEVER_CONTACTED");
  assert.equal(callReason({ contacted: false, dueOn: "2026-10-01" }, today), "NEVER_CONTACTED");
});

test("a follow-up from an earlier day is overdue, today's is due today, a later one is not in the queue", () => {
  assert.equal(callReason({ contacted: true, dueOn: "2026-10-25" }, today), "OVERDUE");
  assert.equal(callReason({ contacted: true, dueOn: today }, today), "DUE_TODAY");
  assert.equal(callReason({ contacted: true, dueOn: "2026-10-27" }, today), null);
  assert.equal(callReason({ contacted: true, dueOn: null }, today), null);
});

test("the queue opens on the uncontacted, then the overdue oldest first, then today's", () => {
  const e = (key: string, reason: QueueEntry["reason"], dueOn: string | null, kind: QueueEntry["kind"] = "ENQUIRY", createdAt = "2026-10-01T00:00:00Z"): QueueEntry => ({ key, reason, dueOn, kind, createdAt });
  const ordered = orderQueue([
    e("today", "DUE_TODAY", today),
    e("late-1", "OVERDUE", "2026-10-25"),
    e("late-5", "OVERDUE", "2026-10-21"),
    e("new-old", "NEVER_CONTACTED", null, "ENQUIRY", "2026-09-01T00:00:00Z"),
    e("new-fresh", "NEVER_CONTACTED", null, "ENQUIRY", "2026-10-25T00:00:00Z"),
  ]).map((x) => x.key);
  assert.deepEqual(ordered, ["new-fresh", "new-old", "late-5", "late-1", "today"]);
});

test("on the same footing an enquiry comes before a student, and the order is stable", () => {
  const base = { reason: "OVERDUE" as const, dueOn: "2026-10-20", createdAt: "2026-10-01T00:00:00Z" };
  const items: QueueEntry[] = [
    { ...base, key: "s:b", kind: "STUDENT" },
    { ...base, key: "e:z", kind: "ENQUIRY" },
    { ...base, key: "s:a", kind: "STUDENT" },
  ];
  assert.deepEqual(orderQueue(items).map((x) => x.key), ["e:z", "s:a", "s:b"]);
  assert.deepEqual(orderQueue([...items].reverse()).map((x) => x.key), ["e:z", "s:a", "s:b"]);
});

test("ordering does not change the list it was given", () => {
  const items: QueueEntry[] = [
    { key: "b", kind: "ENQUIRY", reason: "DUE_TODAY", dueOn: today, createdAt: "2026-10-01T00:00:00Z" },
    { key: "a", kind: "ENQUIRY", reason: "NEVER_CONTACTED", dueOn: null, createdAt: "2026-10-01T00:00:00Z" },
  ];
  orderQueue(items);
  assert.deepEqual(items.map((x) => x.key), ["b", "a"]);
});

/* ---------------- What an outcome does ---------------- */

test("there are seven outcomes, each with a label and an entry on the contact history", () => {
  assert.equal(CALL_OUTCOMES.length, 7);
  for (const o of CALL_OUTCOMES) {
    assert.ok(CALL_OUTCOME_LABEL[o], o);
    assert.ok((contactOutcome.enumValues as readonly string[]).includes(CALL_OUTCOME_CONTACT[o]), o);
  }
});

test("connected outcomes are counted as connected, and the unreachable ones are not", () => {
  assert.ok(isConnected(CALL_OUTCOME_CONTACT.INTERESTED));
  assert.ok(isConnected(CALL_OUTCOME_CONTACT.NOT_INTERESTED));
  assert.ok(isConnected(CALL_OUTCOME_CONTACT.CALL_BACK));
  assert.ok(isConnected(CALL_OUTCOME_CONTACT.ENROLLED_ELSEWHERE));
  assert.equal(isConnected(CALL_OUTCOME_CONTACT.NOT_REACHABLE), false);
  assert.equal(isConnected(CALL_OUTCOME_CONTACT.SWITCHED_OFF), false);
  assert.equal(isConnected(CALL_OUTCOME_CONTACT.WRONG_NUMBER), false);
});

test("interested qualifies a new or contacted enquiry and calls again in two days", () => {
  for (const stage of ["NEW", "CONTACTED"] as const) {
    const p = planCall("INTERESTED", { kind: "ENQUIRY", stage, today });
    assert.equal(p.stage, "QUALIFIED", stage);
    assert.equal(p.nextOn, "2026-10-28");
  }
  // Already further on: the stage is left where it is.
  assert.equal(planCall("INTERESTED", { kind: "ENQUIRY", stage: "COUNSELLING", today }).stage, null);
});

test("not interested and already enrolled elsewhere close an enquiry as lost, with the reason and no next call", () => {
  const n = planCall("NOT_INTERESTED", { kind: "ENQUIRY", stage: "CONTACTED", today });
  assert.equal(n.stage, "LOST");
  assert.equal(n.nextOn, null);
  assert.ok(n.lostReason);
  const e = planCall("ENROLLED_ELSEWHERE", { kind: "ENQUIRY", stage: "QUALIFIED", today });
  assert.equal(e.stage, "LOST");
  assert.equal(e.lostReason, "Already enrolled elsewhere");
  assert.equal(e.nextOn, null);
});

test("a registered student is not closed by one call: not interested is looked at again in a month", () => {
  const n = planCall("NOT_INTERESTED", { kind: "STUDENT", today });
  assert.equal(n.stage, null);
  assert.equal(n.nextOn, "2026-11-25");
  const e = planCall("ENROLLED_ELSEWHERE", { kind: "STUDENT", today });
  assert.equal(e.stage, null);
  assert.equal(e.nextOn, null);
});

test("call back later takes the day asked for, tomorrow when none was given, and never a day gone", () => {
  assert.equal(planCall("CALL_BACK", { kind: "ENQUIRY", stage: "CONTACTED", today, callbackOn: "2026-11-02" }).nextOn, "2026-11-02");
  assert.equal(planCall("CALL_BACK", { kind: "ENQUIRY", stage: "CONTACTED", today, callbackOn: null }).nextOn, "2026-10-27");
  assert.equal(planCall("CALL_BACK", { kind: "ENQUIRY", stage: "CONTACTED", today, callbackOn: "2026-10-20" }).nextOn, "2026-10-27");
  assert.equal(planCall("CALL_BACK", { kind: "ENQUIRY", stage: "CONTACTED", today, callbackOn: "not a day" }).nextOn, "2026-10-27");
  assert.equal(planCall("CALL_BACK", { kind: "ENQUIRY", stage: "CONTACTED", today, callbackOn: today }).nextOn, today);
  // Somebody spoke to a new enquiry, so it is contacted now.
  assert.equal(planCall("CALL_BACK", { kind: "ENQUIRY", stage: "NEW", today }).stage, "CONTACTED");
});

test("not reachable and switched off try again tomorrow and leave the stage alone", () => {
  for (const o of ["NOT_REACHABLE", "SWITCHED_OFF"] as const) {
    const p = planCall(o, { kind: "ENQUIRY", stage: "NEW", today });
    assert.equal(p.nextOn, "2026-10-27", o);
    assert.equal(p.stage, null, o);
  }
});

test("a wrong number sets no next call, since calling it again helps nobody", () => {
  const p = planCall("WRONG_NUMBER", { kind: "ENQUIRY", stage: "CONTACTED", today });
  assert.equal(p.nextOn, null);
  assert.equal(p.stage, null);
  assert.equal(p.lostReason, null);
});

test("a closed enquiry is never moved by a call", () => {
  for (const o of CALL_OUTCOMES) {
    assert.equal(planCall(o, { kind: "ENQUIRY", stage: "LOST", today }).stage, null, o);
    assert.equal(planCall(o, { kind: "ENQUIRY", stage: "CONVERTED", today }).stage, null, o);
  }
});

test("every next call falls on today or later", () => {
  for (const o of CALL_OUTCOMES)
    for (const kind of ["ENQUIRY", "STUDENT"] as const) {
      const p = planCall(o, { kind, stage: kind === "ENQUIRY" ? "CONTACTED" : null, today, callbackOn: "2020-01-01" });
      if (p.nextOn) assert.ok(p.nextOn >= today, `${o} ${kind}`);
    }
});

test("days are added across the end of a month and a year", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

/* ---------------- The new outcomes on the shared contact history ---------------- */

test("switched off and already enrolled elsewhere have labels and a sensible suggested follow-up", () => {
  assert.equal(OUTCOME_LABEL.SWITCHED_OFF, "Switched off");
  assert.equal(OUTCOME_LABEL.ENROLLED_ELSEWHERE, "Already enrolled elsewhere");
  assert.equal(SUGGESTED_FOLLOW_UP.SWITCHED_OFF, 1);
  assert.equal(SUGGESTED_FOLLOW_UP.ENROLLED_ELSEWHERE, null);
  assert.ok((CONNECTED_OUTCOMES as readonly string[]).includes("ENROLLED_ELSEWHERE"));
});

/* ---------------- Dialling and keys ---------------- */

test("a number is dialled with its country code, an Indian one where none was given", () => {
  assert.equal(dialDigits("+91 98470 11001"), "919847011001");
  assert.equal(dialDigits("98470 11001"), "919847011001");
  assert.equal(dialDigits("098470 11001"), "919847011001");
  assert.equal(dialDigits("+44 7700 900123"), "447700900123");
  assert.equal(telHref("98470 11001"), "tel:+919847011001");
  assert.equal(whatsappHref("+91 98470-11001"), "https://wa.me/919847011001");
});

test("a queue key carries the kind and the id, and nothing else gets through", () => {
  assert.equal(queueKey("ENQUIRY", "abc123"), "e:abc123");
  assert.deepEqual(parseQueueKey("s:abc_12-3"), { kind: "STUDENT", id: "abc_12-3" });
  assert.equal(parseQueueKey("x:abc"), null);
  assert.equal(parseQueueKey("e:"), null);
  assert.equal(parseQueueKey("e:a b"), null);
  assert.equal(parseQueueKey("e:abc,s:def"), null);
});

test("counsellors and branch heads work a queue; only the branch head reads the team's", () => {
  for (const r of ["PARTNER", "COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR"]) assert.ok(callsFromQueue(r), r);
  for (const r of ["ADMIN", "MANAGEMENT", "FINANCE", "DOCUMENTATION", "STUDENT", "DESK_COUNSELLOR"]) assert.equal(callsFromQueue(r), false, r);
  assert.ok(readsTeamQueue("PARTNER"));
  assert.equal(readsTeamQueue("COUNSELLOR"), false);
  assert.equal(readsTeamQueue("SENIOR_COUNSELLOR"), false);
});

/* ---------------- A call that closes an enquiry needs a lost reason ---------------- */

test("only the outcomes that close an open enquiry ask for a lost reason", () => {
  for (const stage of ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"] as const) {
    const asked = CALL_OUTCOMES.filter((o) => needsLostReason(o, { kind: "ENQUIRY", stage }));
    assert.deepEqual(asked, ["NOT_INTERESTED", "ENROLLED_ELSEWHERE"], stage);
  }
});

test("a student is never closed by a call, so no outcome asks a student for a lost reason", () => {
  for (const o of CALL_OUTCOMES) assert.equal(needsLostReason(o, { kind: "STUDENT", stage: null }), false, o);
});

test("an enquiry already closed, converted or merged is not closed again by a call", () => {
  for (const stage of ["LOST", "CONVERTED", "MERGED"] as const) {
    for (const o of CALL_OUTCOMES) assert.equal(needsLostReason(o, { kind: "ENQUIRY", stage }), false, `${stage} ${o}`);
  }
});
