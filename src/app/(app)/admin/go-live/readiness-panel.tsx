import Link from "next/link";
import { AREA_ORDER, SEVERITY_LABEL, readinessHeadline, type Check, type Severity } from "@/lib/readiness";
import { readiness } from "@/server/readiness";
import { cronFailures } from "@/server/cron-runs";
import { fmtDateTime } from "@/lib/format";
import { Alert, Card, CardHeader, Chip, Stat, cn } from "@/components/ui";
import { IconCheck } from "@/components/icons";

/**
 * What is still unset, in one place.
 *
 * Everything is listed, the settled as well as the outstanding, because a list
 * of only the problems leaves nobody sure the rest was ever looked at. The
 * severity is the whole point of the screen: "Needed" is something that would
 * mislead a person or lose work, "Yours to decide" is a real question only
 * Medcity can answer, and "Can wait" breaks nothing by being left.
 */

const SEVERITY_TONE: Record<Severity, "bad" | "warn" | "info"> = { NEEDED: "bad", DECIDE: "warn", LATER: "info" };

function Row({ check }: { check: Check }) {
  return (
    <div className={cn("flex gap-3 border-t border-line px-4 py-3 first:border-t-0", check.ready && "opacity-70")}>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          check.ready ? "bg-good-50 text-good-700" : check.severity === "NEEDED" ? "bg-stop-50 text-stop-700" : "bg-warn-50 text-warn-700",
        )}
      >
        {check.ready ? <IconCheck className="size-3.5" /> : <span className="text-[11px] font-bold leading-none">!</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{check.what}</span>
          {!check.ready && <Chip tone={SEVERITY_TONE[check.severity]}>{SEVERITY_LABEL[check.severity]}</Chip>}
        </div>
        <p className="mt-0.5 text-[13px] text-muted">{check.found}</p>
        {!check.ready && check.fix && <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{check.fix}</p>}
      </div>
      {check.href && !check.ready && (
        <Link href={check.href} className="shrink-0 self-start text-[13px] font-medium text-brand-600 hover:underline">
          Open
        </Link>
      )}
    </div>
  );
}

export async function ReadinessPanel() {
  const [{ checks, summary }, failures] = await Promise.all([readiness(), cronFailures(3).catch(() => [])]);
  const areas = [...AREA_ORDER].filter((area) => checks.some((c) => c.area === area));
  // Anything an area name was never written for still has to appear somewhere.
  const stray = checks.filter((c) => !(AREA_ORDER as readonly string[]).includes(c.area));

  return (
    <>
      <Alert tone={summary.needed > 0 ? "warn" : "ok"} title={readinessHeadline(summary)}>
        Counted from what is actually in the portal, every time this page is opened. Nothing here changes anything: it is a list of
        what is still unset, with the way to each one.
      </Alert>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Needed" value={summary.needed} tone={summary.needed > 0 ? "stop" : "good"} />
        <Stat label="Yours to decide" value={summary.decide} tone="warn" />
        <Stat label="Can wait" value={summary.later} tone="info" />
        <Stat label="Done" value={`${summary.ready} of ${summary.total}`} tone="good" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {areas.map((area) => {
          const rows = checks.filter((c) => c.area === area);
          const outstanding = rows.filter((c) => !c.ready).length;
          return (
            <Card key={area}>
              <CardHeader
                title={area}
                action={<Chip tone={outstanding === 0 ? "ok" : "warn"}>{outstanding === 0 ? "All done" : `${outstanding} left`}</Chip>}
              />
              <div>
                {/* Outstanding first: the settled ones are there to be scanned past, not read. */}
                {[...rows].sort((a, b) => Number(a.ready) - Number(b.ready)).map((c) => (
                  <Row key={c.key} check={c} />
                ))}
              </div>
            </Card>
          );
        })}
        {stray.length > 0 && (
          <Card>
            <CardHeader title="Everything else" />
            <div>
              {stray.map((c) => (
                <Row key={c.key} check={c} />
              ))}
            </div>
          </Card>
        )}
      </div>

      {failures.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Scheduled jobs that failed" subtitle="The most recent few. A job that failed once and has run since is nothing to act on." />
          <div>
            {failures.map((f, i) => (
              <div key={i} className="border-t border-line px-4 py-3 text-[13px] first:border-t-0">
                <span className="font-medium">{f.action}</span> <span className="text-muted">{fmtDateTime(f.createdAt)}</span>
                <p className="mt-0.5 break-words text-muted">{String((f.meta as Record<string, unknown> | null)?.error ?? "")}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
