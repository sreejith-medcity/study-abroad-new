/**
 * How many people an organisation may have signed in at once, or null for no
 * limit.
 *
 * Seats came with the partner tiers: a sub-agent on Silver gets three
 * counsellors, on Gold five, and so on, because a sub-agent is a business
 * Medcity works with and the tier is part of the arrangement. They were
 * applied to Medcity's own branches as well, which is why a branch could not
 * add a fourth member: a branch is Medcity, staffed as Medcity decides, and
 * a commercial tier has no business capping it.
 *
 * So the limit is a sub-agent's only. The head office never had one.
 */
export function seatLimit(org: { type: string; counsellorSeats: number }): number | null {
  return org.type === "SUB_AGENT" ? org.counsellorSeats : null;
}

/** Whether one more person fits, given how many are already active. */
export function seatFree(org: { type: string; counsellorSeats: number }, active: number) {
  const limit = seatLimit(org);
  return limit === null || active < limit;
}
