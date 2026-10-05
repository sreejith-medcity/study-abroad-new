import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { acceptancesFor, mouStanding } from "@/server/agents";
import { Alert, Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { IconDoc } from "@/components/icons";
import { AcceptMouForm, MouBody } from "@/components/agent-forms";
import { PARTNER_ROLES } from "@/lib/permissions";

export const metadata = { title: "The agreement" };
export const dynamic = "force-dynamic";

/**
 * The agreement, as a partner reads it.
 *
 * What it says about itself matters as much as the text: this page records that
 * somebody accepted particular words on a particular day. It does not call that
 * a signature, because it is not one, and saying so would be the dishonest part.
 */
export default async function AgreementPage() {
  const user = await requireUser([...PARTNER_ROLES]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  const [standing, history] = await Promise.all([mouStanding(user.orgId), acceptancesFor(user.orgId)]);
  const canAccept = user.role === "PARTNER";

  return (
    <>
      <PageHeader
        title="The agreement"
        subtitle={`Between ${org?.name ?? user.orgName} and Medcity Overseas. Versions are added rather than edited, so what you accepted stays as it was.`}
      />

      {!standing.version ? (
        <Card>
          <EmptyState title="Nothing to accept" icon={<IconDoc className="size-5" />}>
            Medcity Overseas has not published an agreement yet. Nothing is being asked of you, and nothing is being held up by it.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              title={standing.version.title}
              subtitle={`${standing.version.version}${standing.version.effectiveFrom ? ` · in force from ${fmtDate(standing.version.effectiveFrom)}` : ""}`}
              action={standing.accepted ? <Chip tone="ok">Accepted</Chip> : <Chip tone="warn">Not accepted</Chip>}
            />
            <div className="p-4">
              <MouBody body={standing.version.body} />
            </div>
          </Card>

          <div className="space-y-4">
            {standing.accepted ? (
              <Card className="p-4">
                <h2 className="font-semibold text-ink">You have accepted this version</h2>
                <dl className="mt-2 space-y-1 text-[13px]">
                  <div>
                    <dt className="text-muted">Accepted by</dt>
                    <dd className="font-medium">{standing.acceptance!.acceptedName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Signed in as</dt>
                    <dd>{standing.acceptance!.acceptedBy?.email}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">On</dt>
                    <dd className="tabular">{fmtDateTime(standing.acceptance!.createdAt)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                  This is a record that somebody with your sign-in accepted these words on that day. It is not an electronic signature, and it does not replace a
                  document either side asks you to sign on paper.
                </p>
              </Card>
            ) : canAccept ? (
              <Card className="p-4">
                <h2 className="mb-1 font-semibold text-ink">Accept it</h2>
                <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
                  Read the whole thing first. Your name, your account and the date are kept against this version. Money cannot be withdrawn until this is done.
                </p>
                <AcceptMouForm versionId={standing.version.id} version={standing.version.version} />
              </Card>
            ) : (
              <Alert tone="warn" title="Only the owner can accept">
                Ask whoever runs your organisation to sign in and accept it. A counsellor's account cannot agree on the firm's behalf.
              </Alert>
            )}

            <Card>
              <CardHeader title="What you have accepted before" subtitle={`${history.length}`} />
              {history.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-muted">Nothing yet.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Version</Th>
                      <Th>By</Th>
                      <Th>On</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <Td className="font-medium">{h.version?.version}</Td>
                        <Td className="text-[13px]">{h.acceptedName}</Td>
                        <Td className="whitespace-nowrap tabular text-[13px]">{fmtDate(h.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
