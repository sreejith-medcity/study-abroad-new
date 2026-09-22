import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { paymentList } from "@/server/payment-queries";
import { PaymentTable } from "@/components/payment-table";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Online payments" };

export default async function AdminPaymentsPage() {
  await requireUser([...ADMIN_ROLES]);
  const rows = await paymentList(undefined, 200);
  return (
    <>
      <PageHeader title="Online payments" subtitle="Application fees taken through Razorpay, newest first. Match them against Razorpay's settlement report." />
      <Card>
        {rows.length === 0 ? <EmptyState title="No online payments yet">Switch payments on in Settings, Platform.</EmptyState> : <PaymentTable rows={rows} showOrg />}
      </Card>
    </>
  );
}
