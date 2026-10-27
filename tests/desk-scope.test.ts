import { test } from "node:test";
import assert from "node:assert/strict";
import { deskReach, hearsOfHandovers, mayClaimDocument, opensHandedOverFiles, queueReachText, worksOwnFilesOnly } from "../src/lib/desk-scope";
import type { Override } from "../src/lib/capabilities";

test("a documentation officer works their own files; the team leader and the admins the whole desk", () => {
  assert.equal(deskReach("DOCUMENTATION"), "OWN_FILES");
  assert.equal(worksOwnFilesOnly("DOCUMENTATION"), true);
  for (const role of ["APPLICATION_TEAM_LEADER", "ADMIN", "OPS_MANAGER", "SUPER_ADMIN"]) {
    assert.equal(deskReach(role), "WHOLE_DESK", role);
    assert.equal(worksOwnFilesOnly(role), false, role);
  }
});

test("a handed-over file opens only to somebody on the documentation desk who runs the whole of it", () => {
  // The officer used to have every handed-over file; now they do not.
  assert.equal(opensHandedOverFiles("DOCUMENTATION"), false);
  assert.equal(opensHandedOverFiles("APPLICATION_TEAM_LEADER"), true);
  // An admin sees every student anyway: the hand-over is not what opens it.
  assert.equal(opensHandedOverFiles("ADMIN"), false);
  // A branch is never given the desk's files by a hand-over.
  assert.equal(opensHandedOverFiles("COUNSELLOR"), false);
});

test("Medcity can give one officer role the whole desk back, and take it off the team leader", () => {
  const give: Override[] = [{ role: "DOCUMENTATION", capability: "RUN_DOCUMENTATION_DESK", allowed: true }];
  assert.equal(deskReach("DOCUMENTATION", give), "WHOLE_DESK");
  assert.equal(opensHandedOverFiles("DOCUMENTATION", give), true);
  assert.equal(worksOwnFilesOnly("DOCUMENTATION", give), false);
  assert.equal(hearsOfHandovers("DOCUMENTATION", give), true);

  const take: Override[] = [{ role: "APPLICATION_TEAM_LEADER", capability: "RUN_DOCUMENTATION_DESK", allowed: false }];
  assert.equal(deskReach("APPLICATION_TEAM_LEADER", take), "OWN_FILES");
  assert.equal(worksOwnFilesOnly("APPLICATION_TEAM_LEADER", take), true);
  // Still hands out the unassigned files, so still hears of a hand-over.
  assert.equal(hearsOfHandovers("APPLICATION_TEAM_LEADER", take), true);
});

test("a hand-over is told to whoever runs the desk or hands its files out, not to every officer", () => {
  assert.equal(hearsOfHandovers("DOCUMENTATION"), false);
  for (const role of ["APPLICATION_TEAM_LEADER", "ADMIN", "OPS_MANAGER", "SUPER_ADMIN"]) assert.equal(hearsOfHandovers(role), true, role);
  assert.equal(hearsOfHandovers("COUNSELLOR"), false);
  assert.equal(hearsOfHandovers("PARTNER"), false);
});

test("an officer working their own files claims only on a file that is theirs; the pool is the team leader's", () => {
  // The pool: a document on somebody else's file.
  assert.equal(mayClaimDocument({ reach: "OWN_FILES", studentIsTheirs: false, heldByOther: false }), false);
  // Their own file: the officer on the application, or a document already given them.
  assert.equal(mayClaimDocument({ reach: "OWN_FILES", studentIsTheirs: true, heldByOther: false }), true);
  // Whoever runs the desk may claim anything waiting.
  assert.equal(mayClaimDocument({ reach: "WHOLE_DESK", studentIsTheirs: false, heldByOther: false }), true);
  // A claim somebody else still holds stays theirs, whoever asks.
  assert.equal(mayClaimDocument({ reach: "WHOLE_DESK", studentIsTheirs: true, heldByOther: true }), false);
  assert.equal(mayClaimDocument({ reach: "OWN_FILES", studentIsTheirs: true, heldByOther: true }), false);
});

test("the queue says whose documents are on it, without a long dash", () => {
  assert.match(queueReachText("OWN_FILES"), /Only your own files/);
  assert.match(queueReachText("OWN_FILES"), /team leader/);
  assert.match(queueReachText("WHOLE_DESK"), /One row per student/);
  for (const r of ["OWN_FILES", "WHOLE_DESK"] as const) assert.doesNotMatch(queueReachText(r), /\u2014/);
});
