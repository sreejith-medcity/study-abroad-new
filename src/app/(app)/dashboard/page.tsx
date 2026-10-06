import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin, isSuperAdmin } from "@/lib/permissions";
import { readFilters } from "@/server/queries";
import AdminDashboard from "./admin";
import DeskLeadDashboard from "./desk-lead";
import ManagementDashboard from "./management";
import PartnerDashboard from "./partner";
import SuperAdminDashboard from "./super-admin";

export const metadata = { title: "Dashboard" };

/**
 * One address, a dashboard per job. The platform for a super admin, the
 * applications board for an admin, the documentation desk for whoever runs it,
 * outcomes for management, the branch for a partner owner, and their own work
 * for a counsellor.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const f = readFilters(await searchParams);

  if (isSuperAdmin(user)) return <SuperAdminDashboard user={user} f={f} />;
  if (isAdmin(user)) return <AdminDashboard user={user} f={f} />;
  // Whoever runs the documentation desk gets the desk, not the applications
  // board: how the work is spread is the question a queue cannot answer.
  if (user.role === "APPLICATION_TEAM_LEADER") return <DeskLeadDashboard user={user} />;
  // The documentation team sees the same desk without the money lines.
  if (user.role === "DOCUMENTATION") return <AdminDashboard user={user} f={f} showMoney={false} />;
  if (user.role === "MANAGEMENT") return <ManagementDashboard user={user} f={f} />;
  return <PartnerDashboard user={user} f={f} variant={user.role === "PARTNER" ? "owner" : "counsellor"} />;
}
