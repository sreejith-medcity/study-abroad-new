import { PageHeader } from "@/components/ui";
import { SubTabs } from "@/components/tabs";
import { requireFees } from "@/server/student-fees";
import { isAdmin } from "@/lib/permissions";

/**
 * Students' fees across every student the viewer may see: a branch its own,
 * a counsellor their own students', finance and the head office everybody's.
 */
export default async function FeesLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireFees();
  // Online payments (application fees through Razorpay) left the head
  // office's menu to keep Money at five; it opens from here for whoever may read it.
  const payments = isAdmin(user) || user.role === "FINANCE";
  return (
    <>
      <PageHeader title="Student fees" subtitle="Invoices to students, what came in, what is late and what went back. Amounts are whole rupees." />
      <div className="mb-4" data-print="hide">
        <SubTabs
          label="Student fees"
          tabs={[
            { href: "/fees", label: "Invoices" },
            { href: "/fees/ageing", label: "Ageing" },
            { href: "/fees/day-book", label: "Day book" },
            { href: "/fees/refunds", label: "Refunds" },
            { href: "/fees/plans", label: "Fee plans" },
            ...(payments ? [{ href: "/admin/payments", label: "Online payments" }] : []),
          ]}
        />
      </div>
      {children}
    </>
  );
}
