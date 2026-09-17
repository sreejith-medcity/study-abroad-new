import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin, isSuperAdmin } from "@/lib/permissions";
import { readFilters } from "@/server/queries";
import AdminDashboard from "./admin";
import ManagementDashboard from "./management";
import PartnerDashboard from "./partner";
import SuperAdminDashboard from "./super-admin";

export const metadata = { title: "Dashboard" };

/**
 * One address, five dashboards. Each role gets the view that matches the job:
 * the platform for a super admin, the desk for an admin, outcomes for
 * management, the branch for a partner owner, and their own work for a counsellor.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const f = readFilters(await searchParams);

  if (isSuperAdmin(user)) return <SuperAdminDashboard user={user} f={f} />;
  if (isAdmin(user)) return <AdminDashboard user={user} f={f} />;
  if (user.role === "MANAGEMENT") return <ManagementDashboard user={user} f={f} />;
  return <PartnerDashboard user={user} f={f} variant={user.role === "PARTNER" ? "owner" : "counsellor"} />;
}
