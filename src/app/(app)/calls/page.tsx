import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { dayText, istDay } from "@/lib/journal";
import {
  CALLING_ROLES,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABEL,
  REASON_LABEL,
  parseQueueKey,
  readsTeamQueue,
  telHref,
  whatsappHref,
  type CallReason,
} from "@/lib/calling";
import { CHANNEL_LABEL, OUTCOME_LABEL } from "@/lib/crm";
import { STAGE_LABEL } from "@/server/enquiries";
import { callCounters, mayCall, queueFor, recentContacts, recordFor, teamFor, type QueueItem } from "@/server/calling";
import { syncFollowUpsOwnedBy } from "@/server/enquiry-tasks";
import { lostReasonList } from "@/server/lost-reasons";
import { Alert, Button, Card, CardHeader, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import type { EnquiryStage } from "@/db/schema";
import { logCallAction } from "./actions";

export const metadata = { title: "Calling mode" };
export const dynamic = "force-dynamic";

const REASON_TONE: Record<CallReason, "bad" | "warn" | "info"> = { NEVER_CONTACTED: "info", OVERDUE: "bad", DUE_TODAY: "warn" };
const recordHref = (q: Pick<QueueItem, "kind" | "id">) => (q.kind === "ENQUIRY" ? `/enquiries/${q.id}` : `/students/${q.id}`);
const stageText = (q: QueueItem) => (q.kind === "ENQUIRY" ? STAGE_LABEL[q.stage as EnquiryStage] ?? q.stage : q.stage.charAt(0) + q.stage.slice(1).toLowerCase());

/**
 * Calling mode: one person at a time, the most urgent first. Whoever has not
 * been spoken to yet, then the follow-ups that are late, then today's. Each
 * outcome writes the contact history, sets the next follow-up and opens the
 * next person. A branch head can also read the team's queues.
 */
export default async function CallsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string; skip?: string; team?: string; open?: string }> }) {
  const user = await requireUser([...CALLING_ROLES]);
  const sp = await searchParams;
  const today = istDay();
  const teamView = sp.team === "1" && readsTeamQueue(user.role);
  const skip = (sp.skip ?? "").split(",").filter((k) => parseQueueKey(k)).slice(-200);

  if (teamView) return <TeamView user={user} today={today} done={sp.done} error={sp.error} />;

  // Follow-up dates set before enquiries kept tasks still reach this desk.
  await syncFollowUpsOwnedBy([user.id]);
  const [queue, counters] = await Promise.all([queueFor([user.id], today), callCounters([user.id], today)]);
  const ready = queue.filter((q) => !skip.includes(q.key));

  // A record named in the address opens first: a branch head picking one from
  // the team queue, or a counsellor coming back to one they skipped.
  const asked = sp.open ? parseQueueKey(sp.open) : null;
  let current: QueueItem | undefined = ready[0];
  if (asked) {
    const owner = await openable(user, asked);
    if (owner) current = owner;
  }
  const [history, reasons] = await Promise.all([
    current ? recentContacts(current.kind, current.id) : Promise.resolve([]),
    // Only an enquiry is closed as lost by a call, and only with a reason from the list.
    current?.kind === "ENQUIRY" ? lostReasonList({ activeOnly: true }) : Promise.resolve([]),
  ]);
  const mine = counters.get(user.id) ?? { calls: 0, connected: 0 };
  const upNext = ready.filter((q) => q.key !== current?.key);
  const nextSkip = current ? [...skip, current.key].join(",") : skip.join(",");

  return (
    <>
      <PageHeader
        title="Calling mode"
        subtitle="Your calls, most urgent first: people not contacted yet, then follow-ups that are late, then today's. Log what came of each call and the next one opens."
        actions={
          readsTeamQueue(user.role) ? (
            <LinkButton href="/calls?team=1" variant="secondary" size="sm">Team queue</LinkButton>
          ) : undefined
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-call-counters>
        <Stat label="Calls made today" value={<span data-counter="calls">{mine.calls}</span>} />
        <Stat label="Connected today" value={<span data-counter="connected">{mine.connected}</span>} tone="good" />
        <Stat label="Left in your queue" value={<span data-counter="left">{ready.length}</span>} tone="warn" />
        <Stat label="Not contacted yet" value={ready.filter((q) => q.reason === "NEVER_CONTACTED").length} tone="info" />
      </div>
      {sp.done && (
        <div className="mb-3">
          <Alert tone="ok" title="Logged">{sp.done}.</Alert>
        </div>
      )}
      {sp.error && (
        <div className="mb-3">
          <Alert tone="bad">{sp.error}</Alert>
        </div>
      )}

      {!current ? (
        <EmptyState title="Queue clear">
          Nothing is due right now. New enquiries and follow-ups appear here as they fall due.
          {skip.length > 0 && (
            <>
              {" "}
              <Link href="/calls" className="font-medium text-brand-600 hover:underline">Show the ones you skipped</Link>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card data-call-card={current.key}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span data-call-name>{current.name}</span>
                  <Chip tone="neutral">{current.kind === "ENQUIRY" ? "Enquiry" : "Student"}</Chip>
                  <Chip tone="brand">{stageText(current)}</Chip>
                  <Chip tone={REASON_TONE[current.reason]}>{REASON_LABEL[current.reason]}</Chip>
                </span>
              }
            />
            <div className="space-y-4 p-4 pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={telHref(current.phone)} className="inline-flex items-center rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700" data-call-tel>
                  Call {current.phone}
                </a>
                {current.whatsapp && (
                  <a href={whatsappHref(current.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-lg border border-line-strong px-4 py-2.5 font-medium hover:bg-surface-2" data-call-whatsapp>
                    WhatsApp
                  </a>
                )}
                <Link href={recordHref(current)} className="text-sm font-medium text-brand-600 hover:underline">
                  Open the {current.kind === "ENQUIRY" ? "enquiry" : "student file"}
                </Link>
              </div>
              <dl className="grid gap-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-muted">Follow-up </dt><dd className="inline">{current.dueOn ? dayText(current.dueOn) : "Not set"}</dd></div>
                <div><dt className="inline text-muted">Last call </dt><dd className="inline">{current.lastCallAt ? fmtDateTime(current.lastCallAt) : "Never"}</dd></div>
              </dl>
              <form action={logCallAction} className="space-y-3 border-t border-line pt-4">
                <input type="hidden" name="key" value={current.key} />
                <input type="hidden" name="skip" value={skip.join(",")} />
                {/* A branch head making a call picked from the team queue goes back to it afterwards. */}
                <input type="hidden" name="team" value={current.ownerId !== user.id && readsTeamQueue(user.role) ? "1" : ""} />
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
                  <Input name="note" placeholder="What was said (optional)" aria-label="What was said" maxLength={1000} />
                  <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                    Call back on
                    <Input type="date" name="callbackOn" min={today} className="mt-1" aria-label="Call back on" />
                  </label>
                </div>
                {current.kind === "ENQUIRY" && (
                  <label className="block text-2xs font-semibold uppercase tracking-wider text-muted">
                    Lost reason, for not interested or already enrolled elsewhere
                    <Select name="lostReasonId" defaultValue="" className="mt-1" aria-label="Lost reason" data-call-lost-reason>
                      <option value="">Pick one if the call closes the enquiry</option>
                      {reasons.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </Select>
                  </label>
                )}
                <p className="text-xs text-muted">
                  The date is used for Call back later; left empty, that is tomorrow. Every other outcome sets its own next step.
                  {current.kind === "ENQUIRY" ? " Connected, not interested and Already enrolled elsewhere close the enquiry as lost, with the reason picked above." : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {CALL_OUTCOMES.map((o) => (
                    <Button key={o} type="submit" name="outcome" value={o} variant={o === "INTERESTED" ? "primary" : o === "WRONG_NUMBER" || o === "ENROLLED_ELSEWHERE" || o === "NOT_INTERESTED" ? "quiet" : "secondary"} size="sm" data-outcome={o}>
                      {CALL_OUTCOME_LABEL[o]}
                    </Button>
                  ))}
                </div>
                <Link href={`/calls?skip=${encodeURIComponent(nextSkip)}`} className="inline-block text-xs text-brand-600 hover:underline" data-call-skip>
                  Skip for now
                </Link>
              </form>
            </div>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Recent conversations" />
              {history.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted">Nothing logged yet.</p>
              ) : (
                <ul className="divide-y divide-line px-4 pb-2">
                  {history.map((h) => (
                    <li key={h.id} className="py-2 text-sm">
                      <span className="text-xs text-muted">{CHANNEL_LABEL[h.channel]} · {fmtDateTime(h.at)}{h.by ? ` · ${h.by}` : ""}</span>
                      <div>{OUTCOME_LABEL[h.outcome]}{h.note ? `: ${h.note}` : ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title={`Up next (${upNext.length})`} />
              {upNext.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted">Nobody else is waiting.</p>
              ) : (
                <ul className="divide-y divide-line px-4 pb-2" data-up-next>
                  {upNext.slice(0, 8).map((q) => (
                    <li key={q.key} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate" data-up-next-name>{q.name}</span>
                      <span className="shrink-0 text-xs text-muted">{REASON_LABEL[q.reason]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/** A record named in the address, if this person may call it. */
async function openable(user: { id: string; role: string; orgId: string }, asked: { kind: "ENQUIRY" | "STUDENT"; id: string }) {
  const record = await recordFor(asked.kind, asked.id);
  if (!record || !mayCall(user, record)) return null;
  const [full] = await queueFor([record.ownerId], istDay(), asked);
  return full ?? null;
}

/** The branch head's view: each person's counters and what is waiting in their queue. */
async function TeamView({ user, today, done, error }: { user: { id: string; role: string; orgId: string }; today: string; done?: string; error?: string }) {
  const team = await teamFor(user);
  const ids = team.map((t) => t.id);
  await syncFollowUpsOwnedBy(ids);
  const [queue, counters] = await Promise.all([queueFor(ids, today), callCounters(ids, today)]);
  const byOwner = new Map<string, QueueItem[]>();
  for (const q of queue) byOwner.set(q.ownerId, [...(byOwner.get(q.ownerId) ?? []), q]);
  const total = [...counters.values()].reduce((a, c) => ({ calls: a.calls + c.calls, connected: a.connected + c.connected }), { calls: 0, connected: 0 });

  return (
    <>
      <PageHeader
        title="Team queue"
        subtitle="Everybody at the branch who works a calling queue: what they have logged today and who is waiting for a call."
        actions={
          <>
            <LinkButton href="/reports/leaderboard" variant="secondary" size="sm">Counsellor leaderboard</LinkButton>
            <LinkButton href="/calls" variant="secondary" size="sm">My queue</LinkButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls made today" value={total.calls} />
        <Stat label="Connected today" value={total.connected} tone="good" />
        <Stat label="Waiting across the team" value={queue.length} tone="warn" />
        <Stat label="Overdue" value={queue.filter((q) => q.reason === "OVERDUE").length} tone="stop" />
      </div>
      {done && (
        <div className="mb-3">
          <Alert tone="ok" title="Logged">{done}.</Alert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      <Card className="mb-5">
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th className="text-right">Calls today</Th>
              <Th className="text-right">Connected</Th>
              <Th className="text-right">Not contacted</Th>
              <Th className="text-right">Overdue</Th>
              <Th className="text-right">Due today</Th>
            </tr>
          </thead>
          <tbody>
            {team.map((p) => {
              const c = counters.get(p.id) ?? { calls: 0, connected: 0 };
              const q = byOwner.get(p.id) ?? [];
              const n = (r: CallReason) => q.filter((x) => x.reason === r).length;
              return (
                <tr key={p.id} data-team-row={p.id}>
                  <Td>
                    <span className="font-medium">{p.name}</span>
                    {p.id === user.id && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </Td>
                  <Td className="text-right tabular">{c.calls}</Td>
                  <Td className="text-right tabular">{c.connected}</Td>
                  <Td className="text-right tabular">{n("NEVER_CONTACTED")}</Td>
                  <Td className="text-right tabular">{n("OVERDUE")}</Td>
                  <Td className="text-right tabular">{n("DUE_TODAY")}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {queue.length === 0 ? (
        <EmptyState title="Nobody is waiting">Every queue at the branch is clear for today.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {team
            .filter((p) => (byOwner.get(p.id) ?? []).length > 0)
            .map((p) => {
              const q = byOwner.get(p.id) ?? [];
              return (
                <Card key={p.id} data-team-queue={p.id}>
                  <CardHeader title={p.name} subtitle={`${q.length} waiting`} />
                  <ul className="divide-y divide-line px-4 pb-2">
                    {q.slice(0, 12).map((item) => (
                      <li key={item.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <Link href={recordHref(item)} className="min-w-0 flex-1 truncate font-medium text-brand-600 hover:underline">{item.name}</Link>
                        <Chip tone={REASON_TONE[item.reason]}>{REASON_LABEL[item.reason]}</Chip>
                        <span className="text-xs text-muted">{item.kind === "ENQUIRY" ? "Enquiry" : "Student"}{item.dueOn ? ` · ${dayText(item.dueOn)}` : ""}</span>
                        <Link href={`/calls?open=${encodeURIComponent(item.key)}`} className="text-xs font-medium text-brand-600 hover:underline">Call</Link>
                      </li>
                    ))}
                  </ul>
                  {q.length > 12 && <p className="px-4 pb-3 text-xs text-muted">And {q.length - 12} more.</p>}
                </Card>
              );
            })}
        </div>
      )}
    </>
  );
}
