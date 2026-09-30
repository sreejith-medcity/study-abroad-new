import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, intakeLabel } from "@/lib/format";
import { APP_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { packContents } from "@/server/pack";
import { Alert, Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { PackForm } from "./form";

export const metadata = { title: "Submission pack" };
export const dynamic = "force-dynamic";

export default async function PackPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ app?: string }> }) {
  const { id } = await params;
  const { app: chosen } = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return <EmptyState title="Read only">Management can read a student&rsquo;s list but not build packs from it.</EmptyState>;
  const student = await getStudentForUser(user, id);

  const apps = await db.query.applications.findMany({
    where: eq(schema.applications.studentId, id),
    with: { program: { columns: { name: true }, with: { university: { columns: { name: true } } } }, status: { columns: { label: true, group: true } }, route: { with: { vendor: { columns: { code: true, name: true, colour: true } } } } },
    orderBy: asc(schema.applications.createdAt),
  });
  if (apps.length === 0) {
    return (
      <EmptyState title="No application yet">
        A pack is built for one application, because what goes in it depends on the university and the route. Create the application first.
      </EmptyState>
    );
  }
  const application = apps.find((a) => a.id === chosen) ?? apps.find((a) => a.status.group !== "CLOSED") ?? apps[0];
  const contents = await packContents(application.id);
  const built = await db.query.submissionPacks.findMany({
    where: eq(schema.submissionPacks.applicationId, application.id),
    with: { builtBy: { columns: { name: true, deskLabel: true } } },
    orderBy: desc(schema.submissionPacks.createdAt),
    limit: 10,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Submission pack for ${student.firstName}`}
        subtitle="Everything accepted, gathered for the university or the vendor, with a sheet at the front listing what is in it and what is not."
        actions={<Link href={`/students/${id}/documentation`} className="text-[13px] font-medium text-brand-600 hover:underline">Back to the list</Link>}
      />

      {apps.length > 1 && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted">Application</span>
            {apps.map((a) => (
              <Link
                key={a.id}
                href={`/students/${id}/documentation/pack?app=${a.id}`}
                className={a.id === application.id ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}
              >
                {a.ackNo} · {a.program.university.name}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Application</p>
            <p className="font-semibold tabular">{application.ackNo}</p>
            <p className="text-xs text-muted">{intakeLabel(application.intakeMonth, application.intakeYear)} intake</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted">Course</p>
            <p className="font-semibold">{application.program.name}</p>
            <p className="text-xs text-muted">{application.program.university.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Sent through</p>
            {application.route?.vendor ? (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: application.route.vendor.colour }}>
                {application.route.vendor.code} · {application.route.vendor.name}
              </span>
            ) : (
              <p className="text-xs text-muted">No route recorded. The pack says so.</p>
            )}
          </div>
        </div>
      </Card>

      {contents && contents.missing.length > 0 && (
        <Alert tone="warn" title={`${contents.missing.length} required document${contents.missing.length === 1 ? "" : "s"} not in the pack`}>
          {contents.missing.map((m) => `${m.label} (${m.why.toLowerCase()}, owed by ${m.owedBy.toLowerCase()})`).join(", ")}. You can still build it; what is missing goes on the front sheet.
        </Alert>
      )}
      {contents && contents.expiring.length > 0 && (
        <Alert tone="bad" title="Something in the pack runs out too early">
          {contents.expiring.map((e) => `${e.label} (valid to ${e.validTo ? fmtDate(e.validTo) : "not recorded"})`).join(", ")}. Renew it before this goes anywhere.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={`What goes in (${contents?.files.length ?? 0})`}
          subtitle="Accepted documents only. Anything uploaded but not yet checked stays out, because sending an unchecked file is how a file comes back."
        />
        {!contents || contents.files.length === 0 ? (
          <p className="p-4 text-muted">Nothing has been accepted for this student yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>In the folder as</Th>
                <Th>Document</Th>
                <Th>Stage</Th>
                <Th>Version</Th>
                <Th>Accepted</Th>
                <Th>Valid to</Th>
              </tr>
            </thead>
            <tbody>
              {contents.files.map((f, i) => (
                <tr key={f.itemId}>
                  <Td className="font-mono text-xs">{`${String(i + 1).padStart(2, "0")} ${f.label}`}</Td>
                  <Td>{f.fileName ?? <span className="text-muted">No file on the row</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{f.stage}</Td>
                  <Td className="text-xs tabular">v{f.version || 1}</Td>
                  <Td className="whitespace-nowrap text-xs tabular">{f.acceptedOn ? fmtDate(f.acceptedOn) : "—"}</Td>
                  <Td className="whitespace-nowrap text-xs tabular">{f.validTo ? fmtDate(f.validTo) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {contents?.application.vendor?.extraDocuments && (
          <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
            {contents.application.vendor.name} asks for this beyond the university&rsquo;s own list: {contents.application.vendor.extraDocuments}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 font-semibold text-brand-700">Build it</h2>
        <p className="mb-3 text-xs text-muted">
          One zip: the front sheet, then the files, numbered so a stranger can read the folder. Nothing is stored, so the same link built next week gives the paperwork as it stands then.
        </p>
        <PackForm applicationId={application.id} disabled={!contents || contents.files.length === 0} />
      </Card>

      {built.length > 0 && (
        <Card>
          <CardHeader title="Built before" subtitle="Who packed this application, when, and what was missing at the time." />
          <ul className="divide-y divide-line">
            {built.map((b) => (
              <li key={b.id} className="px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{b.itemCount} document{b.itemCount === 1 ? "" : "s"}</Chip>
                  <span className="text-muted">{fmtDateTime(b.createdAt)} · {b.builtBy ? (b.builtBy.deskLabel ?? b.builtBy.name) : "unknown"}</span>
                  <a href={`/api/packs/${b.id}`} className="ml-auto font-medium text-brand-600 hover:underline">Download again</a>
                </div>
                {b.missing.length > 0 && <p className="mt-0.5 text-muted">Missing then: {b.missing.join(", ")}</p>}
                {b.note && <p className="mt-0.5 text-muted">{b.note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
