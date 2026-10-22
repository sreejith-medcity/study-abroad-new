import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, istDateTime } from "@/lib/format";
import { APP_ROLES, isAdmin } from "@/lib/permissions";
import { chargeMoney, toIstInput, MODULE_STATE_LABEL } from "@/lib/ausbildung";
import { getStudentForUser } from "@/server/queries";
import { chargingCountries, studentAusbildung } from "@/server/ausbildung";
import { commissionVisible } from "@/server/commission-visibility";
import { Alert, Card, CardHeader, Chip, cn } from "@/components/ui";
import { AusbildungForm, ModuleForm, RaiseServiceCharge, RecordPayment } from "./forms";
import { NclexCaseForm, NclexResultForm, NclexStepForm, NclexStepUpload } from "./nclex-forms";
import { NCLEX_STATES } from "@/lib/nclex";

export const metadata = { title: "Ausbildung, NCLEX-RN and service charge" };
export const dynamic = "force-dynamic";

/**
 * What an Ausbildung file, or a file bound for a country that collects a
 * service charge, carries on top of the rest: where the student stands in
 * German, the three fields they would train in and the three dates the whole
 * thing turns on, and the service charge, what came in and what is still out.
 *
 * The service charge is a line on the Income tab like any other money, so
 * there is one place it lives and one total. This shows it, and lets whoever
 * may record money do it from here, through the same actions.
 */
export default async function StudentAusbildungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [a, money, charging] = await Promise.all([studentAusbildung(id), commissionVisible(user), chargingCountries()]);
  const canMoney = money && (isAdmin(user) || user.role === "PARTNER");

  // The usual figure for this student's destination, where one is set: the
  // country they named or applied to, and for Ausbildung, Germany.
  const where = (a.destination ?? student.preferredCountry ?? "").toLowerCase();
  const usual =
    charging.find((c) => where.includes(c.name.toLowerCase()))?.serviceChargeInr ??
    (a.isAusbildung ? (charging.find((c) => c.name === "Germany")?.serviceChargeInr ?? null) : null);

  const p = a.profile;
  const upcoming = p?.interviewOn && p.interviewOn.getTime() > Date.now() - 86400000 && !p.contractReceivedOn;

  return (
    <div className="space-y-5">
      {a.isNursing && (
        <Card data-nclex>
          <CardHeader
            title="NCLEX-RN (USA)"
            subtitle={
              a.nclexCase
                ? `${a.nclex.finished} of ${a.nclex.total} steps done.${a.nclex.next ? ` Next: ${a.nclex.next.label}.` : " Every step done."}`
                : "Not on the USA placement yet. Completing the first step opens it."
            }
            action={
              <span className="flex flex-wrap gap-1.5">
                {a.nclexCase?.boardState && (
                  <Chip tone="info">{NCLEX_STATES.find((st) => st.code === a.nclexCase!.boardState)?.name ?? a.nclexCase.boardState}</Chip>
                )}
                {a.nclexCase?.result && <Chip tone={a.nclexCase.result === "PASS" ? "ok" : "bad"}>{a.nclexCase.result === "PASS" ? "Passed" : "Failed"}</Chip>}
              </span>
            }
          />
          {a.nclexCase && (
            <div className="space-y-4 border-b border-line p-4">
              <NclexCaseForm studentId={id} boardState={a.nclexCase.boardState} paymentLink={a.nclexCase.paymentLink} note={a.nclexCase.note} />
              {a.nclexCase.paymentLink && (
                <p className="text-xs text-muted">
                  Payment link on file:{" "}
                  <a href={a.nclexCase.paymentLink} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-brand-600 hover:underline">
                    {a.nclexCase.paymentLink}
                  </a>
                </p>
              )}
            </div>
          )}
          <ol className="divide-y divide-line">
            {a.nclex.steps.map((st, i) => {
              const row = a.nclexSteps.find((r) => r.step === st.key);
              const done = Boolean(row?.completed);
              const isNext = a.nclex.next?.key === st.key;
              return (
                <li key={st.key} data-nclex-step={st.key} className={cn("space-y-2 px-4 py-3", done && "bg-good-50/40", isNext && "bg-warn-50/50")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full text-2xs font-bold",
                        done ? "bg-good-500 text-white" : isNext ? "bg-warn-500 text-white" : "bg-surface-2 text-muted ring-1 ring-inset ring-line-strong",
                      )}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className="font-medium text-ink">{st.label}</span>
                    <Chip tone={done ? "ok" : "neutral"}>{done ? `Completed${row?.completedOn ? ` ${fmtDate(row.completedOn)}` : ""}` : "Pending"}</Chip>
                    {st.after && <span className="text-xs text-muted">after a {st.after === "PASS" ? "pass" : "fail"}</span>}
                  </div>
                  {st.hint && <p className="pl-8 text-xs text-muted">{st.hint}</p>}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-8">
                    <NclexStepForm studentId={id} step={st.key} label={st.label} completed={done} completedOn={row?.completedOn ?? null} />
                    {st.upload &&
                      (row?.documentId ? (
                        <a href={`/api/documents/${row.documentId}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:underline">
                          {row.fileName ?? "The file"}
                        </a>
                      ) : null)}
                    {st.upload && <NclexStepUpload studentId={id} step={st.key} label={st.label} />}
                  </div>
                  {st.key === "EXAM_RESULTS" && (
                    <div className="pl-8">
                      <NclexResultForm studentId={id} result={a.nclexCase?.result ?? null} resultOn={a.nclexCase?.resultOn ?? null} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {!a.isAusbildung && !a.goesToChargingCountry && !a.isNursing && (
        <Alert tone="info" title="Not an Ausbildung file">
          This student is not registered for Ausbildung and is not going to a country that collects a service charge. Their German record can still be kept
          here.
        </Alert>
      )}

      {a.isAusbildung && (
        <Card>
          <CardHeader
            title="Ausbildung"
            subtitle="The fields they would train in, and where the application has got to"
            action={
              <span className="flex flex-wrap gap-1.5">
                {p?.applicationSubmittedOn && <Chip tone="info">Applied {fmtDate(p.applicationSubmittedOn)}</Chip>}
                {upcoming && <Chip tone="warn">Interview {istDateTime(p!.interviewOn!)}</Chip>}
                {p?.contractReceivedOn && <Chip tone="ok">Contract {fmtDate(p.contractReceivedOn)}</Chip>}
              </span>
            }
          />
          <div className="p-4">
            <AusbildungForm
              studentId={id}
              profile={{
                preference1: p?.preference1 ?? null,
                preference2: p?.preference2 ?? null,
                preference3: p?.preference3 ?? null,
                applicationSubmittedOn: p?.applicationSubmittedOn ?? null,
                interview: toIstInput(p?.interviewOn),
                interviewWith: p?.interviewWith ?? null,
                contractReceivedOn: p?.contractReceivedOn ?? null,
                contractEmployer: p?.contractEmployer ?? null,
                note: p?.note ?? null,
              }}
            />
          </div>
        </Card>
      )}

      {(a.isAusbildung || !a.isNursing) && (
      <Card>
        <CardHeader
          title="German"
          subtitle={
            a.german.incomplete.length === 0
              ? "Every level finished."
              : a.german.done.length === 0
                ? `Not started: ${a.german.incomplete.join(", ")}.`
                : `Finished ${a.german.done.join(", ")}. Still to do: ${a.german.incomplete.join(", ")}.`
          }
        />
        <ul className="divide-y divide-line">
          {a.german.levels.map((l) => {
            const row = a.modules.find((m) => m.level === l.level);
            return (
              <li
                key={l.level}
                className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2", l.state === "COMPLETED" && "bg-good-50/40")}
                data-module={l.level}
              >
                <ModuleForm studentId={id} level={l.level} state={l.state} completedOn={row?.completedOn ?? null} />
                <Chip tone={l.state === "COMPLETED" ? "ok" : l.state === "IN_PROGRESS" ? "warn" : "neutral"}>
                  {MODULE_STATE_LABEL[l.state]}
                  {row?.completedOn ? ` on ${fmtDate(row.completedOn)}` : ""}
                </Chip>
              </li>
            );
          })}
        </ul>
      </Card>
      )}

      {(a.isAusbildung || a.goesToChargingCountry || a.nclexCase) &&
        (money ? (
          <Card>
            <CardHeader
              title="Service charge"
              subtitle={
                a.charge.any
                  ? a.charge.byCurrency
                      .map((b) => `${chargeMoney(b.received, b.currency)} received of ${chargeMoney(b.owed, b.currency)}, ${chargeMoney(Math.max(0, b.owed - b.received), b.currency)} pending`)
                      .join(" · ")
                  : "Not raised on this student yet."
              }
              action={
                <Link href={`/students/${id}/income`} className="text-sm font-medium text-brand-600 hover:underline">
                  Income tab
                </Link>
              }
            />
            {a.lines.length > 0 && (
              <ul className="divide-y divide-line">
                {a.lines.map((l) => {
                  const owed = l.invoiced ?? l.expected;
                  const pending = owed == null ? null : Math.max(0, owed - (l.received ?? 0));
                  return (
                    <li key={l.id} className="space-y-2 px-4 py-3" data-charge-line>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{owed == null ? "Amount not recorded" : chargeMoney(owed, l.currency)}</span>
                        <span className="text-muted">·</span>
                        <span>{l.received ? `${chargeMoney(l.received, l.currency)} received${l.receivedOn ? ` (last on ${fmtDate(l.receivedOn)})` : ""}` : "Nothing received"}</span>
                        {pending != null && (
                          <Chip tone={pending === 0 ? "ok" : "warn"}>{pending === 0 ? "Paid in full" : `${chargeMoney(pending, l.currency)} pending`}</Chip>
                        )}
                        {l.state === "WRITTEN_OFF" && <Chip tone="bad">Written off</Chip>}
                        {l.dueOn && pending !== 0 && <span className="text-xs text-muted">due {fmtDate(l.dueOn)}</span>}
                      </div>
                      {canMoney && l.state !== "WRITTEN_OFF" && pending !== 0 && <RecordPayment lineId={l.id} received={l.received} />}
                    </li>
                  );
                })}
              </ul>
            )}
            {canMoney && !a.charge.any && (
              <div className="border-t border-line p-4">
                <RaiseServiceCharge studentId={id} usual={usual} />
              </div>
            )}
            {!canMoney && !a.charge.any && <p className="border-t border-line px-4 py-3 text-sm text-muted">The branch owner or the Overseas team raises it.</p>}
          </Card>
        ) : (
          <Card className="p-4 text-sm text-muted">The service charge is kept off this screen for your role.</Card>
        ))}
    </div>
  );
}
