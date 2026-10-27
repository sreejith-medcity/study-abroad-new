import { strict as assert } from "node:assert";
import test from "node:test";
import { mayPlaceOnTeam, pickTeamForPathways, type TeamPathwayLink } from "../src/lib/team-pathways";

const links: TeamPathwayLink[] = [
  { teamId: "ausbildung", pathway: "AUSBILDUNG", active: true },
  { teamId: "germany", pathway: "FSJ", active: true },
  { teamId: "germany", pathway: "BFD", active: true },
  { teamId: "uk", pathway: "DEGREE", active: true },
  { teamId: "europe", pathway: "DEGREE", active: true },
  { teamId: "old-nursing", pathway: "NURSING", active: false },
];

test("a pathway exactly one live team carries puts the file on that team", () => {
  assert.equal(pickTeamForPathways(["AUSBILDUNG"], links), "ausbildung");
  assert.equal(pickTeamForPathways(["BFD"], links), "germany", "a team can carry more than one pathway");
});

test("no pathway, or one nobody carries, leaves the file without a team", () => {
  assert.equal(pickTeamForPathways([], links), null);
  assert.equal(pickTeamForPathways([null, undefined, ""], links), null);
  assert.equal(pickTeamForPathways(["NCLEX"], links), null, "a pathway added later and not linked yet");
});

test("two live teams on one pathway is a person's choice, not the portal's", () => {
  assert.equal(pickTeamForPathways(["DEGREE"], links), null);
});

test("a retired team is never picked", () => {
  assert.equal(pickTeamForPathways(["NURSING"], links), null);
  assert.equal(
    pickTeamForPathways(["NURSING"], [...links, { teamId: "nursing", pathway: "NURSING", active: true }]),
    "nursing",
    "and does not count against the live one",
  );
});

test("the first pathway that decides it wins, in the order they reached the file", () => {
  assert.equal(pickTeamForPathways(["AUSBILDUNG", "FSJ"], links), "ausbildung");
  assert.equal(pickTeamForPathways(["FSJ", "AUSBILDUNG"], links), "germany");
  assert.equal(pickTeamForPathways(["DEGREE", "AUSBILDUNG"], links), "ausbildung", "an undecided pathway passes to the next");
});

test("a pathway added to the list later works once a team carries it", () => {
  assert.equal(pickTeamForPathways(["WEITERBILDUNG"], [...links, { teamId: "wb", pathway: "WEITERBILDUNG", active: true }]), "wb");
});

test("a team chosen by hand, or taken away by hand, is never overwritten", () => {
  assert.equal(mayPlaceOnTeam({ teamId: null }, false), true);
  assert.equal(mayPlaceOnTeam({ teamId: "uk" }, false), false);
  assert.equal(mayPlaceOnTeam({ teamId: null }, true), false);
});
