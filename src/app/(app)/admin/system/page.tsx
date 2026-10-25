import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, isSuperAdmin } from "@/lib/permissions";
import { agoText, buildSystemReport, countLabel, everyText, fmtBytes, indiaTime, resultText, type SystemSnapshot } from "@/lib/system-report";
import { systemSnapshot } from "@/server/system";
import { Alert, Card, CardHeader, Chip, DataList, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { IconShield } from "@/components/icons";
import { CopyReport } from "./copy-report";
import { RunNow } from "./run-now";

export const metadata = { title: "System" };
export const dynamic = "force-dynamic";

/**
 * Is the portal well? One screen for the owner after the move to the VPS: the
 * release that is running, the database and its counts, where the documents
 * are and whether the disk takes a write, the five scheduled jobs and the
 * health answer the monitors read. Everything is counted fresh on each open,
 * and the whole screen can be copied as text to paste into a message.
 *
 * Open to the three admin roles; only the super admin may run a job by hand.
 */
export default async function SystemPage() {
  const user = await requireUser([...ADMIN_ROLES]);
  const snapshot = await systemSnapshot();
  const report = buildSystemReport(snapshot);
  const canRun = isSuperAdmin(user);

  const problems = [
    !snapshot.database.reachable && "the database cannot be reached",
    snapshot.database.migrations && snapshot.database.migrations.status !== "in-step" && "the database and this build are not in step",
    !snapshot.documents.writable && "the document store refuses a write",
    snapshot.documents.sample && snapshot.documents.sample.present < snapshot.documents.sample.checked && "some documents are missing from the disk",
    snapshot.jobs.some((j) => !j.healthy) && "a scheduled job is overdue",
    !snapshot.health.ok && "/api/health is not ok",
  ].filter((p): p is string => typeof p === "string");

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <IconShield className="size-4" /> Platform
          </span>
        }
        title="System"
        subtitle="Whether the portal is well: the release, the database, the documents, the scheduled jobs and the health check, counted fresh each time this opens."
      />

      <Alert tone={problems.length ? "warn" : "ok"} title={problems.length ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to look at` : "Everything checked is well"}>
        {problems.length ? `Found: ${problems.join("; ")}. ` : "The database answers, the documents can be written, the jobs have run on time and the health check says ok. "}
        Taken {indiaTime(snapshot.takenAt)}. Copy the report below and paste it when asking for help; it holds no password.
      </Alert>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Version" value={snapshot.release.version} />
        <Stat label="Database" value={snapshot.database.reachable ? "Reachable" : "Down"} tone={snapshot.database.reachable ? "good" : "stop"} />
        <Stat label="Documents" value={snapshot.documents.writable ? "Writable" : "Read-only"} tone={snapshot.documents.writable ? "good" : "stop"} />
        <Stat label="Health" value={snapshot.health.ok ? "ok" : "Not ok"} tone={snapshot.health.ok ? "good" : "stop"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ReleaseCard release={snapshot.release} />
        <DatabaseCard database={snapshot.database} />
        <DocumentsCard documents={snapshot.documents} />
        <HealthCard health={snapshot.health} clock={snapshot.clock} />
      </div>

      <JobsCard jobs={snapshot.jobs} failures={snapshot.failures} canRun={canRun} />

      <Card className="mt-4">
        <CardHeader title="Copy report" subtitle="The whole of this screen as plain text, to paste into a message. It names hosts and folders, never a password or a key." />
        <div className="p-4">
          <CopyReport text={report} />
        </div>
      </Card>
    </>
  );
}

function ReleaseCard({ release }: { release: SystemSnapshot["release"] }) {
  return (
    <Card>
      <CardHeader
        title="Release"
        subtitle="What is running, as the build stamped it."
        action={
          <Link href="/whats-new" className="text-sm font-medium text-brand-600 hover:underline">
            What's new
          </Link>
        }
      />
      <DataList
        rows={[
          { label: "Version", value: release.version },
          { label: "Built", value: release.builtAt ? indiaTime(release.builtAt) : "Not recorded (a run without a build)" },
          { label: "Commit", value: release.commit ? <code className="font-mono text-sm">{release.commit}</code> : "Not recorded" },
        ]}
      />
    </Card>
  );
}

function DatabaseCard({ database }: { database: SystemSnapshot["database"] }) {
  const m = database.migrations;
  return (
    <Card>
      <CardHeader
        title="Database"
        subtitle={database.host ? `Postgres on ${database.host}` : "Postgres"}
        action={<Chip tone={database.reachable ? "ok" : "bad"}>{database.reachable ? "Reachable" : "Not reachable"}</Chip>}
      />
      {!database.reachable ? (
        <div className="p-4">
          <Alert tone="bad" title="The database did not answer">
            {database.error ?? "No detail was given."}
          </Alert>
        </div>
      ) : (
        <>
          <DataList
            rows={[
              { label: "Postgres version", value: database.serverVersion ?? "Not recorded" },
              { label: "Size on disk", value: fmtBytes(database.sizeBytes) },
              ...Object.entries(database.counts ?? {}).map(([key, n]) => ({ label: countLabel(key), value: n })),
            ]}
          />
          {m && (
            <div className="border-t border-line px-4 py-3" data-migrations={m.status}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Migrations</span>
                <Chip tone={m.status === "in-step" ? "ok" : "warn"}>
                  {m.recorded ?? 0} recorded, {m.known} in this build
                </Chip>
              </div>
              <p className="mt-1 text-sm text-muted">{m.message}</p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function DocumentsCard({ documents }: { documents: SystemSnapshot["documents"] }) {
  const disk = documents.disk;
  const usedPct = disk && disk.totalBytes > 0 ? Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100) : null;
  const sample = documents.sample;
  const missing = sample ? sample.checked - sample.present : 0;
  return (
    <Card>
      <CardHeader
        title="Documents"
        subtitle={documents.mode === "supabase" ? "Stored in Supabase Storage." : "Stored in a folder on the server's disk."}
        action={<Chip tone={documents.writable ? "ok" : "bad"}>{documents.writable ? "Writable" : "Refuses a write"}</Chip>}
      />
      <DataList
        rows={[
          { label: "Storage", value: documents.mode === "supabase" ? "Supabase Storage" : "Disk" },
          ...(documents.folder ? [{ label: "Folder", value: <code className="font-mono text-sm break-all">{documents.folder}</code> }] : []),
          {
            label: "Write test",
            value: documents.writable ? "A file was written and removed" : `Failed: ${documents.writeError ?? "no detail"}`,
            tone: documents.writable ? ("ok" as const) : ("bad" as const),
          },
          ...(documents.mode === "disk"
            ? [
                {
                  label: "Free space",
                  value: disk ? `${fmtBytes(disk.freeBytes)} free of ${fmtBytes(disk.totalBytes)}${usedPct != null ? ` (${usedPct}% used)` : ""}` : "Not recorded",
                  tone: usedPct != null && usedPct >= 90 ? ("warn" as const) : undefined,
                },
              ]
            : []),
          ...(sample
            ? [
                {
                  label: "Files on disk",
                  value: `${sample.present} of the latest ${sample.checked} documents`,
                  tone: missing > 0 ? ("bad" as const) : ("ok" as const),
                },
              ]
            : []),
        ]}
      />
      {sample && (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">
          {missing > 0
            ? `${missing} of the sampled documents are not where the database says. This is a sample of the newest ${sample.checked}, not the whole set; the move script's count says how many are missing overall.`
            : `Every one of the newest ${sample.checked} documents is where the database says. This is a sample, not the whole set.`}
        </p>
      )}
    </Card>
  );
}

function HealthCard({ health, clock }: { health: SystemSnapshot["health"]; clock: SystemSnapshot["clock"] }) {
  return (
    <Card>
      <CardHeader title="Health" subtitle="The same answer /api/health gives the monitors, and the server's clock." action={<Chip tone={health.ok ? "ok" : "bad"}>{health.ok ? "ok" : "Not ok"}</Chip>} />
      <DataList
        rows={[
          { label: "/api/health", value: health.ok ? `{"ok":true} in ${health.ms} ms` : `Not ok in ${health.ms} ms${health.message ? `: ${health.message}` : ""}`, tone: health.ok ? ("ok" as const) : ("bad" as const) },
          ...(health.users != null ? [{ label: "Users counted", value: health.users }] : []),
          ...(health.storage ? [{ label: "Storage backend", value: health.storage }] : []),
          { label: "Server clock, UTC", value: <span className="tabular">{clock.utc}</span> },
          { label: "Server clock, India", value: <span className="tabular">{clock.india}</span> },
        ]}
      />
    </Card>
  );
}

function JobsCard({ jobs, failures, canRun }: { jobs: SystemSnapshot["jobs"]; failures: SystemSnapshot["failures"]; canRun: boolean }) {
  const overdue = jobs.filter((j) => !j.healthy).length;
  return (
    <Card className="mt-4">
      <CardHeader
        title="Scheduled jobs"
        subtitle={
          canRun
            ? "Called by GitHub Actions on a schedule. Run now runs the job here, this minute, and records it as started by hand."
            : "Called by GitHub Actions on a schedule. A super admin can run one by hand from this screen."
        }
        action={<Chip tone={overdue === 0 ? "ok" : "warn"}>{overdue === 0 ? "All on time" : `${overdue} overdue`}</Chip>}
      />
      <Table tableClassName="min-w-[760px]">
        <thead>
          <tr>
            <Th>Job</Th>
            <Th>Last scheduled run</Th>
            <Th>Outcome</Th>
            <Th>Standing</Th>
            {canRun && <Th>By hand</Th>}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.job} data-job={j.job}>
              <Td>
                <div className="font-medium">{j.label}</div>
                <div className="text-xs text-muted">{everyText(j.everyMinutes)}</div>
              </Td>
              <Td>
                {j.lastRanAt ? (
                  <>
                    <div>{agoText(j.minutesAgo)}</div>
                    <div className="text-xs text-muted">{indiaTime(j.lastRanAt)}</div>
                  </>
                ) : (
                  <span className="text-muted">Has never run</span>
                )}
              </Td>
              <Td className="max-w-[260px] text-sm text-muted">
                <div className="break-words">{resultText(j.lastResult) || (j.lastRanAt ? "Nothing to do" : "")}</div>
                {j.lastManualAt && (
                  <div className="mt-1 text-xs" data-manual-run>
                    Run by hand {indiaTime(j.lastManualAt)}
                    {resultText(j.lastManualResult) ? `: ${resultText(j.lastManualResult)}` : ""}
                  </div>
                )}
              </Td>
              <Td>
                <Chip tone={j.healthy ? "ok" : "warn"}>{j.healthy ? "On time" : "Overdue"}</Chip>
              </Td>
              {canRun && (
                <Td>
                  <RunNow job={j.job} />
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="border-t border-line">
        <div className="px-4 py-3">
          <span className="text-sm font-medium">Last failures</span>
          <span className="ml-2 text-sm text-muted">
            {failures.length === 0 ? "None recorded." : "The most recent few. A job that failed once and has run since is nothing to act on."}
          </span>
        </div>
        {failures.map((f, i) => (
          <div key={i} className="border-t border-line px-4 py-3 text-sm">
            <span className="font-medium">{f.action}</span> <span className="text-muted">{indiaTime(f.at)}</span>
            <p className="mt-0.5 break-words text-muted">{f.error}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
