import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { getSettings } from "@/server/settings";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Certificate" };

/** A printable certificate for a passed attempt: its holder, their branch head and the Overseas team may open it. */
export default async function CertificatePage({ params }: { params: Promise<{ attemptId: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const { attemptId } = await params;
  const a = await db.query.trainingAttempts.findFirst({
    where: and(eq(schema.trainingAttempts.id, attemptId), eq(schema.trainingAttempts.passed, true)),
    with: { course: true, user: { columns: { id: true, name: true, orgId: true }, with: { org: { columns: { name: true } } } } },
  });
  if (!a) notFound();
  const allowed = a.user.id === user.id || isStaff(user) || (user.role === "PARTNER" && a.user.orgId === user.orgId);
  if (!allowed) notFound();
  const settings = await getSettings();
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(a.createdAt);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex justify-end" data-print="hide"><PrintButton /></div>
      <div className="rounded-xl border-4 border-double border-brand-600 bg-white px-10 py-14 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-brand-600">{settings.organisationName ?? settings.portalName}</p>
        <h1 className="mt-6 text-3xl font-semibold">Certificate of completion</h1>
        <p className="mt-8 text-[15px] text-muted">This certifies that</p>
        <p className="mt-2 text-2xl font-semibold">{a.user.name}</p>
        {a.user.org && <p className="text-[13px] text-muted">{a.user.org.name}</p>}
        <p className="mt-6 text-[15px] text-muted">has completed</p>
        <p className="mt-2 text-xl font-medium">{a.course.title}</p>
        <p className="mt-2 text-[13px] text-muted">with a score of {a.score}% (pass mark {a.course.passMark}%)</p>
        <p className="mt-10 text-[13px]">{date}</p>
        <p className="mt-1 text-[11px] text-muted">Reference {a.id}</p>
      </div>
    </div>
  );
}
