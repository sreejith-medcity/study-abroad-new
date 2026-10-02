import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { isSuperAdmin } from "@/lib/permissions";
import { KEY_HEADER, MAX_ATTEMPTS, OUTBOUND_KINDS, SIGNATURE_HEADER, SIGNATURE_WINDOW_SECONDS, TIMESTAMP_HEADER } from "@/lib/crm-link";
import { integrationCounts, integrationEvents, integrationKeyList, needsAPerson, readEventFilters } from "@/server/crm-link";
import { getSettings } from "@/server/settings";
import { Alert, Card, CardHeader, Chip, EmptyState, PageHeader, Select, Stat, Table, Td, Th, Toolbar, cn } from "@/components/ui";
import { IconFlow, IconKey } from "@/components/icons";
import { DrainNowButton, IgnoreButton, KeyRowActions, NewKeyForm, ResolveForm, RetryButton, TargetForm, TestEventForm } from "@/components/crm-link-forms";
import type { IntegrationStatus } from "@/db/schema";

export const metadata = { title: "The CRM link" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "activity", label: "Activity" },
  { key: "attention", label: "Needs a person" },
  { key: "keys", label: "Keys" },
  { key: "sending", label: "Sending" },
  { key: "api", label: "For the vendor" },
] as const;

const STATUS_TONE: Record<IntegrationStatus, "neutral" | "info" | "ok" | "warn" | "bad"> = {
  PENDING: "info",
  SENT: "ok",
  RECEIVED: "ok",
  FAILED: "bad",
  NEEDS_A_PERSON: "warn",
  RESOLVED: "neutral",
  IGNORED: "neutral",
};

/**
 * The link to Medcity's own CRM, as the desk sees it.
 *
 * An integration nobody can see is an integration nobody can fix, so every
 * exchange is here, both directions, whether it worked or not, with what was
 * sent and what came back. The tab that matters is "Needs a person": a field the
 * portal would not overwrite, or a send that gave up, waiting for somebody.
 */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["SUPER_ADMIN", "OPS_MANAGER"]);
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "activity";
  const counts = await integrationCounts();
  const settings = await getSettings();
  const superAdmin = isSuperAdmin(user);

  return (
    <>
      <PageHeader
        title="The CRM link"
        subtitle="Medcity's own CRM registers students here and reads what happened to them. Nothing in the portal assumes the CRM's shape: it states what it accepts, and the CRM's build meets it."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Came in" value={counts.inbound} />
        <Stat label="Went out" value={counts.outbound} />
        <Stat label="Waiting to send" value={counts.waiting} tone="info" />
        <Stat label="Failed" value={counts.failed} tone="stop" />
        <Stat label="Needs a person" value={counts.needsAPerson} tone="warn" href="/admin/integrations?tab=attention" />
      </div>

      <div className="mb-4 flex gap-6 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/integrations?tab=${t.key}`}
            className={cn("-mb-px whitespace-nowrap border-b-2 py-2 font-medium", t.key === tab ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
            {t.key === "attention" && counts.needsAPerson > 0 ? ` (${counts.needsAPerson})` : ""}
          </Link>
        ))}
      </div>

      {!settings.crmWebhookEnabled && (
        <Alert tone="info" title="Nothing is being sent out">
          The portal is answering whatever the CRM calls, but sending nothing back until a URL is set and switched on under Sending.
        </Alert>
      )}

      {tab === "activity" && <Activity filters={readEventFilters(sp)} />}
      {tab === "attention" && <Attention />}
      {tab === "keys" && <Keys superAdmin={superAdmin} />}
      {tab === "sending" && <Sending settings={settings} superAdmin={superAdmin} />}
      {tab === "api" && <ForTheVendor />}
    </>
  );
}

// ---------- Activity ----------

async function Activity({ filters }: { filters: ReturnType<typeof readEventFilters> }) {
  const rows = await integrationEvents(filters);
  return (
    <>
      <Toolbar className="mb-4">
        <form className="grid gap-2.5 sm:grid-cols-3">
          <input type="hidden" name="tab" value="activity" />
          <Select name="direction" aria-label="Direction" defaultValue={filters.direction ?? ""}>
            <option value="">Both ways</option>
            <option value="IN">Came in</option>
            <option value="OUT">Went out</option>
          </Select>
          <Select name="status" aria-label="Status" defaultValue={filters.status ?? ""}>
            <option value="">Any state</option>
            {(Object.keys(STATUS_TONE) as IntegrationStatus[]).map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
          <button className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium hover:bg-surface-2">Filter</button>
        </form>
      </Toolbar>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Nothing yet" icon={<IconFlow className="size-5" />}>
            Every call either way lands here, whether it worked or not. Make a key under Keys and give it to the vendor.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <Table tableClassName="min-w-[900px]">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th>State</Th>
                <Th>Answer</Th>
                <Th>Sent or received</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap tabular text-[13px] text-muted">{fmtDateTime(r.createdAt)}</Td>
                  <Td>
                    <Chip tone={r.direction === "IN" ? "info" : "neutral"}>{r.direction === "IN" ? "In" : "Out"}</Chip>
                    <span className="ml-1.5 font-medium text-ink">{r.kind}</span>
                    {r.keyName && <span className="block text-xs text-muted">{r.keyName}</span>}
                    {r.entityId && (
                      <span className="block text-xs text-muted">
                        {r.entityType === "student" ? (
                          <Link href={`/students/${r.entityId}/profile`} className="text-brand-600 hover:underline">
                            the student
                          </Link>
                        ) : (
                          `${r.entityType} ${r.entityId.slice(0, 8)}`
                        )}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Chip tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, " ").toLowerCase()}</Chip>
                    {r.attempts > 1 && <span className="block text-xs text-muted">{r.attempts} attempts</span>}
                    {r.nextAttemptAt && <span className="block text-xs text-muted">again {fmtDateTime(r.nextAttemptAt)}</span>}
                  </Td>
                  <Td className="text-[13px]">
                    {r.responseStatus ?? <span className="text-muted">none</span>}
                    {r.error && <span className="block max-w-[14rem] text-xs text-stop-700">{r.error}</span>}
                  </Td>
                  <Td>
                    <pre className="max-h-24 max-w-[22rem] overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-soft">
                      {JSON.stringify(r.payload, null, 1).slice(0, 600)}
                    </pre>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

// ---------- Needs a person ----------

async function Attention() {
  const rows = await needsAPerson();
  return rows.length === 0 ? (
    <Card>
      <EmptyState title="Nothing waiting" icon={<IconFlow className="size-5" />}>
        Two things land here: a field the CRM tried to change where the portal&apos;s copy is newer, and a send that gave up after {MAX_ATTEMPTS} attempts.
      </EmptyState>
    </Card>
  ) : (
    <Card>
      <CardHeader title="Waiting for somebody" subtitle={`${rows.length}`} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Chip tone={r.direction === "IN" ? "info" : "neutral"}>{r.direction === "IN" ? "In" : "Out"}</Chip>
              <span className="font-medium text-ink">{r.kind}</span>
              <span className="text-xs text-muted tabular">{fmtDateTime(r.createdAt)}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {r.direction === "OUT" && <RetryButton eventId={r.id} />}
                <ResolveForm eventId={r.id} />
                <IgnoreButton eventId={r.id} />
              </div>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{r.needsAPersonBecause ?? r.error}</p>
            {r.entityType === "student" && r.entityId && (
              <Link href={`/students/${r.entityId}/profile`} className="mt-1 inline-block text-[13px] font-medium text-brand-600 hover:underline">
                Open the student
              </Link>
            )}
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-soft">
              {JSON.stringify(r.payload, null, 1).slice(0, 900)}
            </pre>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Keys ----------

async function Keys({ superAdmin }: { superAdmin: boolean }) {
  const keys = await integrationKeyList();
  return (
    <Card>
      <CardHeader
        title="Keys"
        subtitle="One per thing that calls the portal. The secret is shown once and kept hashed, so nobody here can read it back."
        action={superAdmin ? <NewKeyForm /> : undefined}
      />
      {keys.length === 0 ? (
        <EmptyState title="No keys yet" icon={<IconKey className="size-5" />}>
          Until there is a key, nothing can call the portal. Make one and give the vendor the key id and the secret.
        </EmptyState>
      ) : (
        <Table tableClassName="min-w-[760px]">
          <thead>
            <tr>
              <Th>What for</Th>
              <Th>Key id</Th>
              <Th>How it proves itself</Th>
              <Th>May</Th>
              <Th>Last used</Th>
              {superAdmin && <Th />}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <Td>
                  <span className={k.revokedAt ? "text-muted line-through" : "font-medium"}>{k.name}</span>
                  <span className="block text-xs text-muted">made {fmtDate(k.createdAt)} by {k.createdBy?.name ?? "unknown"}</span>
                </Td>
                <Td className="font-mono text-[12px]">{k.keyId}</Td>
                <Td>
                  {k.revokedAt ? (
                    <Chip tone="bad">Revoked {fmtDate(k.revokedAt)}</Chip>
                  ) : k.signatureRequired ? (
                    <Chip tone="ok">A signature</Chip>
                  ) : (
                    <Chip tone="warn">A bearer token</Chip>
                  )}
                </Td>
                <Td className="text-[13px] text-muted">{k.scopes.length === 0 ? "Everything" : k.scopes.join(", ")}</Td>
                <Td className="whitespace-nowrap text-[13px] text-muted">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "Never"}</Td>
                {superAdmin && <Td>{!k.revokedAt && <KeyRowActions keyId={k.id} signing={k.signatureRequired} canSign={!!k.secretBox} />}</Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------- Sending ----------

async function Sending({ settings, superAdmin }: { settings: Awaited<ReturnType<typeof getSettings>>; superAdmin: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-4">
        <h2 className="mb-1 font-semibold text-ink">Where events go</h2>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          Settings rather than code, on purpose: when the vendor says what shape they want, this changes without a deploy. A counsellor moving a student does not
          wait on their server, so events are queued here and sent on a schedule, with retries.
        </p>
        {superAdmin ? (
          <TargetForm url={settings.crmWebhookUrl} enabled={settings.crmWebhookEnabled} kinds={settings.crmWebhookKinds} hasSecret={!!settings.crmWebhookSecretBox} />
        ) : (
          <dl className="space-y-2 text-[13px]">
            <div>
              <dt className="text-muted">Post to</dt>
              <dd className="break-all font-medium">{settings.crmWebhookUrl ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-muted">Sending</dt>
              <dd className="font-medium">{settings.crmWebhookEnabled ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt className="text-muted">Kinds</dt>
              <dd className="font-medium">{settings.crmWebhookKinds.length === 0 ? "None" : settings.crmWebhookKinds.join(", ")}</dd>
            </div>
          </dl>
        )}
      </Card>

      <div className="space-y-5">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-ink">Try it</h2>
          {superAdmin ? <TestEventForm /> : <p className="text-[13px] text-muted">A super admin sends the test event.</p>}
          <div className="mt-3 border-t border-line pt-3">
            <DrainNowButton />
            <p className="mt-1.5 text-[12px] text-muted">
              The queue is drained by a scheduler calling <code>POST /api/cron/crm</code> with the cron secret. This button does the same thing now.
            </p>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-ink">What can be sent</h2>
          <dl className="space-y-1.5 text-[12.5px]">
            {(Object.keys(OUTBOUND_KINDS) as (keyof typeof OUTBOUND_KINDS)[]).map((k) => (
              <div key={k}>
                <dt className="font-medium text-ink">{k}</dt>
                <dd className="text-muted">{OUTBOUND_KINDS[k]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            A send that times out or gets a 500 is tried again after a growing wait, up to {MAX_ATTEMPTS} times. A refusal the CRM meant, such as a 400, is not
            retried at all: the same bad payload six times is noise, and somebody has to look at it.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------- For the vendor ----------

const CURL = `curl -X POST https://doc.medcityoverseas.com/api/crm/students \\
  -H "${KEY_HEADER}: mck_xxxxxxxxxxxx" \\
  -H "authorization: Bearer mcs_xxxxxxxxxxxxxxxxxxxx" \\
  -H "idempotency-key: your-own-id-for-this-call" \\
  -H "content-type: application/json" \\
  -d '{
    "crmId": "CRM-4821",
    "updatedAt": "2026-10-02T09:15:00Z",
    "branch": "KOT",
    "firstName": "Meera",
    "lastName": "Nair",
    "phone": "+91 9447000000",
    "email": "meera@example.com",
    "dateOfBirth": "2004-03-11"
  }'`;

/**
 * The contract, written down on the screen the desk can send the vendor to.
 *
 * Kept here rather than in a document because a document goes stale and this
 * cannot: the header names, the signing order and the window all come from the
 * same constants the code checks against.
 */
function ForTheVendor() {
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">What the portal accepts</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Three endpoints. Send this page to whoever is building the CRM; everything on it is read from the code that enforces it, so it cannot go out of date.
        </p>

        <dl className="mt-4 space-y-4 text-[13px]">
          <div>
            <dt className="font-mono font-semibold text-ink">POST /api/crm/students</dt>
            <dd className="mt-1 leading-relaxed text-ink-soft">
              Registers a student, or updates one already here. <code>crmId</code> and <code>updatedAt</code> are required. <code>branch</code> is required for
              somebody new, and is a branch&apos;s ID code such as <code>KOT</code>. Answers with the portal&apos;s own id, the Medcity ID, which fields were
              written, and which were left alone.
            </dd>
          </div>
          <div>
            <dt className="font-mono font-semibold text-ink">GET /api/crm/students?crmId=…</dt>
            <dd className="mt-1 leading-relaxed text-ink-soft">
              Also takes <code>medcityId</code>, <code>email</code> or <code>phone</code>. Answers with where the student is, what their applications are doing
              and what is still wanted from them. Not their documents, not internal notes, not commission.
            </dd>
          </div>
          <div>
            <dt className="font-mono font-semibold text-ink">POST /api/crm/enquiries</dt>
            <dd className="mt-1 leading-relaxed text-ink-soft">
              A lead, before anybody has decided it is a student. The same <code>crmId</code> twice does nothing, because a lead is something a counsellor is
              already working.
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">Which edit wins</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          The later one. <code>updatedAt</code> is your own last-changed time for that record, and it is required: without it there is no way to tell which edit
          is later, and a message from last week would undo a correction a counsellor made this morning. Where your copy is the older one, nothing is written,
          and the answer lists every field that was left alone with both values in it, so you can show your own user the same thing. A blank from you never
          clears a value the portal holds: deleting by omission is how an integration empties a database.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">Proving who you are</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Every request carries <code>{KEY_HEADER}</code> with the key id. Then either the secret as <code>authorization: Bearer …</code>, which is simpler to
          start on, or a signature, which is better and is what to use once you are live.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          To sign: take the method, the path, the timestamp and the exact body you are sending, join them with newlines in that order, and HMAC-SHA256 them under
          the secret, hex encoded. Send it as <code>{SIGNATURE_HEADER}</code> with <code>{TIMESTAMP_HEADER}</code> set to seconds since the epoch. A timestamp
          more than {SIGNATURE_WINDOW_SECONDS} seconds out is refused, so a signature copied off the wire is no use later.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11.5px] leading-relaxed text-ink-soft">
          {`METHOD\\npath\\ntimestamp\\nbody`}
        </pre>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">Retrying safely</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Send <code>idempotency-key</code> with anything of your own on every write. Repeating it hands back the first answer rather than doing the work twice,
          so a retry after a timeout cannot register the same student twice. The answer carries <code>x-medcity-replay: 1</code> when that is what happened.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">One to copy</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11.5px] leading-relaxed text-ink-soft">{CURL}</pre>
      </Card>
    </div>
  );
}
