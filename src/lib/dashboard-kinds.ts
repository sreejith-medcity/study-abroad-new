/**
 * Which dashboard each job opens on.
 *
 * Six of them, drawn three ways. Leadership and finance read a summary of
 * the business, the processing desk reads a command centre of the work in
 * hand, and the documentation desk, a branch and a counsellor read their
 * work as a board, stage by stage, the way it moves.
 *
 * Kept free of the database so the menu, the page and the suites can all ask
 * the same question and get the same answer.
 */
export const DASHBOARD_KINDS = [
  { key: "leadership", label: "Leadership", blurb: "The whole business at a glance" },
  { key: "desk", label: "Processing desk", blurb: "The work in hand and what is late" },
  { key: "documentation", label: "Documentation", blurb: "Documents waiting and who has them" },
  { key: "finance", label: "Finance", blurb: "What is owed, invoiced and in" },
  { key: "branch", label: "Branch head", blurb: "A branch's students and team" },
  { key: "counsellor", label: "Counsellor", blurb: "One person's own students" },
] as const;

export type DashboardKind = (typeof DASHBOARD_KINDS)[number]["key"];

const BY_ROLE: Record<string, DashboardKind> = {
  SUPER_ADMIN: "leadership",
  OPS_MANAGER: "leadership",
  MANAGEMENT: "leadership",
  ADMIN: "desk",
  APPLICATION_TEAM_LEADER: "desk",
  DOCUMENTATION: "documentation",
  FINANCE: "finance",
  PARTNER: "branch",
  // A senior counsellor runs a branch's students without running the branch,
  // so they read the branch's board, less the wallet and the team settings.
  SENIOR_COUNSELLOR: "branch",
  COUNSELLOR: "counsellor",
  TRAINEE_COUNSELLOR: "counsellor",
  SUB_AGENT_COUNSELLOR: "counsellor",
  DESK_COUNSELLOR: "counsellor",
};

/** The dashboard a role opens on. */
export function dashboardFor(role: string): DashboardKind {
  return BY_ROLE[role] ?? "counsellor";
}

/** Who may look at another job's dashboard, to see what that desk sees. */
export const VIEW_AS_ROLES = ["SUPER_ADMIN", "OPS_MANAGER"] as const;
export const mayViewAs = (role: string) => (VIEW_AS_ROLES as readonly string[]).includes(role);

export const isDashboardKind = (k: string | undefined): k is DashboardKind => DASHBOARD_KINDS.some((d) => d.key === k);

export const kindLabel = (k: DashboardKind) => DASHBOARD_KINDS.find((d) => d.key === k)?.label ?? k;
