import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { readLens } from "@/server/dashboard-lens";
import CommandCentre from "./command";
import Executive from "./executive";
import Finance from "./finance";
import Pipeline from "./pipeline";
import Documents from "./documents";

export const metadata = { title: "Dashboard" };

/**
 * One dashboard per job, drawn three ways.
 *
 * Leadership and finance get an executive summary, the processing desk a
 * command centre, and the documentation desk, a branch and a counsellor a
 * pipeline board of their own work. Which one a person gets is their role's,
 * in lib/dashboard-kinds.ts; the super admin and the ops manager can look at
 * any of the others, as that desk sees it.
 *
 * Every one of them is scoped the way the rest of the portal is: the desk
 * reads the whole of it, a branch its own, and a counsellor the students
 * assigned to them.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const lens = await readLens(user, sp);
  switch (lens.kind) {
    case "leadership":
      return <Executive lens={lens} sp={sp} />;
    case "finance":
      return <Finance lens={lens} sp={sp} />;
    case "desk":
      return <CommandCentre lens={lens} />;
    case "documentation":
      return <Documents lens={lens} />;
    default:
      return <Pipeline lens={lens} />;
  }
}
