import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, PARTNER_ROLES, isAdmin, isStaff } from "@/lib/permissions";
import { getEnquiryForUser } from "@/server/enquiries";
import { ledgerFor } from "@/server/ledger";
import { nameBook, versionsOf } from "@/server/record-history";
import { RecordHistory } from "@/components/record-history";
import { OwnershipTimeline } from "@/components/ownership-timeline";
import { PageHeader } from "@/components/ui";
import { SubTabs } from "@/components/tabs";

export const metadata = { title: "Enquiry history" };
export const dynamic = "force-dynamic";

/** One enquiry's history: every saved change, field by field, and who has owned it. */
export default async function EnquiryHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; done?: string; why?: string }> }) {
  const user = await requireUser([...PARTNER_ROLES, ...ADMIN_ROLES]);
  const { id } = await params;
  const sp = await searchParams;
  // The same rule as the enquiry itself: somebody who may not open it gets "not found".
  const enquiry = await getEnquiryForUser(user, id);
  const [versions, entries] = await Promise.all([versionsOf("enquiry", id), ledgerFor("enquiry", id)]);
  const names = await nameBook(versions);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/enquiries" className="text-sm font-medium text-brand-600 hover:underline">
            ← All enquiries
          </Link>
        }
        title={enquiry.name}
        subtitle="Every change saved to this enquiry, and who has owned it"
      />
      <div className="mb-4">
        <SubTabs
          label="Enquiry"
          tabs={[
            { href: `/enquiries/${id}`, label: "Enquiry" },
            { href: `/enquiries/${id}/history`, label: "History" },
          ]}
        />
      </div>
      <div className="space-y-4">
        <RecordHistory
          entity="enquiry"
          versions={versions}
          names={names}
          canRestore
          fullPassport={false}
          back={`/enquiries/${id}/history`}
          a={sp.a}
          b={sp.b}
          done={sp.done}
          why={sp.why}
          started={{ at: enquiry.createdAt, by: enquiry.createdBy?.name ?? null }}
        />
        <OwnershipTimeline entries={entries} owner={enquiry.assignedTo?.name ?? "nobody"} admin={isStaff(user) && isAdmin(user)} />
      </div>
    </>
  );
}
