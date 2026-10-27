/**
 * Which team a student's file goes to, from the pathways on it.
 *
 * The work divides by pathway before it divides by branch: an Ausbildung
 * student registered at Kannur is worked by the Ausbildung team, wherever that
 * team sits. A team says which pathways it carries, and a file that gets one of
 * them, and is not on a team yet, is put on that team.
 *
 * The pathways are read in the order they arrived on the file: the one chosen
 * at registration first, then each application's in the order they were made.
 * The first pathway exactly one live team carries decides it. A pathway no
 * team carries says nothing, and neither does one two live teams both carry:
 * that is a choice for a person, not for the portal, so the next pathway is
 * asked instead and, failing that, the file is left without a team.
 *
 * Pure, so the rule can be tested without a database.
 */

export type TeamPathwayLink = { teamId: string; pathway: string; active: boolean };

export function pickTeamForPathways(pathways: readonly (string | null | undefined)[], links: readonly TeamPathwayLink[]): string | null {
  const seen = new Set<string>();
  for (const p of pathways) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const teams = new Set(links.filter((l) => l.active && l.pathway === p).map((l) => l.teamId));
    if (teams.size === 1) return [...teams][0];
  }
  return null;
}

/**
 * Whether the portal may put this file on a team by itself.
 *
 * Only a file with no team, and only one nobody has ever chosen a team for by
 * hand. Somebody who took a student off the Ausbildung team meant it, and the
 * next application should not quietly put them back.
 */
export function mayPlaceOnTeam(student: { teamId: string | null }, setByHand: boolean): boolean {
  return !student.teamId && !setByHand;
}
