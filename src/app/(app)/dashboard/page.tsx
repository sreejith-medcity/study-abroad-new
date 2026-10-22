import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import TileDashboard from "./tiles";

export const metadata = { title: "Dashboard" };

/**
 * One dashboard, the same for everybody, scoped to what each person may see.
 *
 * There were seven of them, one per job, each drawing its own lanes, lists,
 * charts and leaderboards. What was asked for instead is a board of figures:
 * registrations, applications, offers, visas, refusals, documents still out,
 * deferrals, fees paid and unpaid, what is sitting with a branch or a
 * sub-agent, and what the work on the books is worth. Every tile opens the
 * list behind it, and the lists themselves live where the work is done.
 */
export default async function DashboardPage() {
  const user = await requireUser([...APP_ROLES]);
  return <TileDashboard user={user} />;
}
