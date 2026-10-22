import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { inr } from "@/lib/money";
import { dashboardTiles } from "@/server/dashboard-tiles";
import { StatTiles, type StatTile } from "@/components/stat-tiles";
import { DashboardHero, LinkButton } from "@/components/ui";
import {
  IconAlert,
  IconApplications,
  IconBuilding,
  IconCheck,
  IconClock,
  IconCommission,
  IconDoc,
  IconGlobe,
  IconPartners,
  IconQueue,
  IconSearch,
  IconStudents,
  IconWallet,
} from "@/components/icons";

/** The greeting at the top, so the screen says hello before it says numbers. */
function partOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The dashboard: the figures, and nothing else.
 *
 * It used to be a different screen per job, each with its own lanes, lists,
 * charts and leaderboards, and the complaint about all of them was the same
 * one: too much to read before the one number you came for. So this is the
 * eleven figures that were asked for by name, as a board, and every tile is
 * the way into the list behind it. The lists it used to draw are all still
 * in the portal, under Applications, Documentation, Deadlines and the work
 * queue, which is where somebody goes when they want to work rather than to
 * look.
 *
 * The same board for everybody, scoped to what they may see: the Overseas
 * desk reads the whole of it, a branch reads its own, a sub-agent reads its
 * own. Two of the tiles cannot mean the same thing to both, and those are
 * the only ones that change.
 */
export default async function TileDashboard({ user }: { user: SessionUser }) {
  const t = await dashboardTiles(user);
  const staff = isStaff(user);

  const waiting: StatTile[] = staff
    ? [
        {
          label: "Pending from branches",
          value: t.fromBranches,
          note: "Waiting on one of our branches",
          tone: "warn",
          icon: <IconBuilding />,
          href: "/applications?group=PENDING_PARTNER&orgType=BRANCH",
        },
        {
          label: "Pending from partners",
          value: t.fromSubAgents,
          note: "Waiting on a sub-agent",
          tone: "warn",
          icon: <IconPartners />,
          href: "/applications?group=PENDING_PARTNER&orgType=SUB_AGENT",
        },
      ]
    : [
        // A branch sees its own files and a sub-agent sees its own, so the
        // desk's two tiles are one question to them: what is the desk waiting
        // on you for.
        {
          label: "Waiting on you",
          value: t.fromBranches + t.fromSubAgents,
          note: "The desk has asked and is waiting",
          tone: "warn",
          icon: <IconBuilding />,
          href: "/applications?group=PENDING_PARTNER",
        },
      ];

  const tiles: StatTile[] = [
    { label: "Total registrations", value: t.registrations, note: "Students on the books", tone: "brand", icon: <IconStudents />, href: "/students" },
    { label: "Total applications", value: t.applications, note: "Every application ever made", tone: "info", icon: <IconApplications />, href: "/applications" },
    { label: "Offers received", value: t.offers, note: "Applications that got an offer", tone: "good", icon: <IconCheck />, href: "/applications?kpi=offers" },
    { label: "Visas received", value: t.visaReceived, note: "Visa in hand or further", tone: "good", icon: <IconGlobe />, href: "/applications?kpi=visa_received" },
    { label: "Visas rejected", value: t.visaRejected, note: "Refused at least once", tone: "stop", icon: <IconAlert />, href: "/applications?kpi=visa_rejected" },
    {
      label: "Pending documents",
      value: t.documents.items,
      note: t.documents.items === 0 ? "Nothing outstanding" : `Across ${t.documents.students} ${t.documents.students === 1 ? "student" : "students"}`,
      tone: "warn",
      icon: <IconDoc />,
      href: "/documentation",
    },
    { label: "Deferrals", value: t.deferrals, note: "Moved to a later intake", tone: "warn", icon: <IconClock />, href: "/applications?kpi=deferrals" },
    { label: "Payments done", value: t.feesPaid, note: "Tuition fee paid", tone: "good", icon: <IconCheck />, href: "/applications?kpi=payments" },
    { label: "Payments pending", value: t.feesDue, note: "Fee due and not paid", tone: "stop", icon: <IconWallet />, href: "/applications?kpi=fees_due" },
    ...waiting,
    ...(t.revenue
      ? [
          {
            label: "Total revenue expected",
            value: inr(t.revenue.expected),
            note: t.revenue.received > 0 ? `${inr(t.revenue.received)} already in` : "Nothing received yet",
            tone: "gold" as const,
            icon: <IconCommission />,
            href: staff ? "/admin/commission?status=EXPECTED" : "/commission",
          },
        ]
      : []),
  ];

  return (
    <>
      <DashboardHero
        eyebrow={staff ? "Medcity Overseas" : user.orgName}
        title={`${partOfDay()}, ${user.name.split(" ")[0]}`}
        subtitle="Where everything stands. Every figure opens the list behind it."
        actions={
          <>
            <LinkButton href="/search" variant="secondary">
              <IconSearch className="size-4" /> Search programs
            </LinkButton>
            <LinkButton href={staff ? "/admin/queue" : "/students"}>
              <IconQueue className="size-4" /> {staff ? "Open work queue" : "Open students"}
            </LinkButton>
          </>
        }
      />
      <StatTiles tiles={tiles} />
    </>
  );
}
