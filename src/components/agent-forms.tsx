"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Button, Checkbox, Field, Input, Select } from "@/components/ui";
import { AGENT_CONSENT, FEE_KIND_LABEL } from "@/lib/agents";
import {
  acceptMouAction,
  approveAgentApplicationAction,
  assignReferralAction,
  cancelEarningAction,
  priceEarningAction,
  rejectAgentApplicationAction,
  saveAgentRateAction,
  saveAgentSettingsAction,
  saveMouAction,
  submitAgentApplicationAction,
  submitReferralAction,
} from "@/server/agent-actions";

/** Applying to become a sub-agent. No sign in, so the form is the whole of it. */
export function JoinForm({ branches }: { branches: { slug: string; name: string }[] }) {
  return (
    <ActionForm action={submitAgentApplicationAction} submitLabel="Send my application" pendingLabel="Sending…" resetOnSuccess>
      {/* A field nobody sees and a robot fills in. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Your name" name="contactName" required />
        <TextField label="Firm or agency name" name="firmName" hint="Leave it blank if you work in your own name." />
        <TextField label="Email" name="email" type="email" required hint="This becomes your sign-in." />
        <TextField label="Mobile" name="phone" required />
        <TextField label="Town or city" name="city" />
        <TextField label="State" name="state" />
      </div>
      <TextareaField
        label="Tell us about your work"
        name="aboutThem"
        rows={4}
        hint="Who do you already help go abroad, and where to? How many in a year? Anything you want us to know."
      />
      {branches.length > 0 && (
        <SelectField label="Which Medcity branch told you about this?" name="referredBy" hint="Optional. It helps us put you with the right people.">
          <option value="">Nobody in particular</option>
          {branches.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.name}
            </option>
          ))}
        </SelectField>
      )}
      <Checkbox name="consent" label={AGENT_CONSENT} />
    </ActionForm>
  );
}

/** A sub-agent sending a lead to Medcity. */
export function ReferForm() {
  return (
    <ActionForm action={submitReferralAction} submitLabel="Send the referral" pendingLabel="Sending…">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Their name" name="name" required />
        <TextField label="Mobile" name="phone" required />
        <TextField label="Email" name="email" type="email" hint="Optional." />
        <TextField label="Town or city" name="city" />
        <TextField label="Where they want to go" name="interestCountry" hint="A country, if they have said." />
        <SelectField label="What they are after" name="interestPathway">
          <option value="">Not sure yet</option>
          <option value="DEGREE">A degree</option>
          <option value="AUSBILDUNG">Ausbildung in Germany</option>
          <option value="NURSING">Nurse registration</option>
        </SelectField>
      </div>
      <TextareaField label="Anything we should know" name="notes" rows={3} hint="Their qualifications, their budget, when they want to go, who to ask for." />
      <Checkbox
        name="consent"
        label="I have told this person I am passing their details to Medcity Overseas, and they agreed."
      />
    </ActionForm>
  );
}

/**
 * Accepting the agreement.
 *
 * The typed name and the tick are both asked for, because pressing one button is
 * a weaker record than a person writing their own name. The page says plainly
 * what this is and is not.
 */
export function AcceptMouForm({ versionId, version }: { versionId: string; version: string }) {
  return (
    <ActionForm action={acceptMouAction} submitLabel={`Accept ${version}`} pendingLabel="Recording…">
      <input type="hidden" name="versionId" value={versionId} />
      <TextField label="Type your full name" name="typedName" required hint="As it appears on your PAN." />
      <Checkbox name="agree" label={`I have read ${version} of the agreement and I accept it on behalf of my firm.`} />
    </ActionForm>
  );
}

/** The desk approving an application, which is where the organisation is named. */
export function ApproveForm({
  applicationId,
  suggestedName,
  branches,
}: {
  applicationId: string;
  suggestedName: string;
  branches: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className="py-1 text-xs" onClick={() => setOpen(true)}>
        Approve
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Approve this sub-agent" description="This creates the organisation and its first login. The one-time password is shown once, to read out.">
        <ActionForm action={approveAgentApplicationAction} submitLabel="Create the sub-agent" pendingLabel="Setting them up…">
          <input type="hidden" name="applicationId" value={applicationId} />
          <TextField label="What they are called in the portal" name="orgName" required defaultValue={suggestedName} />
          <SelectField label="Under which branch" name="parentOrgId" hint="Who recruited them, and who their referrals go to first. It changes nothing about who may read what.">
            <option value="">Nobody in particular</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <TextareaField label="Note" name="note" rows={2} hint="Optional. What was agreed on the call." />
        </ActionForm>
      </Modal>
    </>
  );
}

export function RejectForm({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" className="py-1 text-xs text-stop-700" onClick={() => setOpen(true)}>
        Turn down
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Turn this application down" description="The reason is kept on the row so whoever rings them says the same thing.">
        <ActionForm action={rejectAgentApplicationAction} submitLabel="Turn it down" pendingLabel="Saving…">
          <input type="hidden" name="applicationId" value={applicationId} />
          <TextareaField label="Why" name="note" rows={3} required />
        </ActionForm>
      </Modal>
    </>
  );
}

/** The desk passing a referral to a branch. */
export function AssignReferral({ enquiryId, branches }: { enquiryId: string; branches: { id: string; name: string; city: string | null }[] }) {
  return (
    <ActionForm action={assignReferralAction} submitLabel="Give it to them" pendingLabel="Passing it on…">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <Field label="Branch" htmlFor={`to-${enquiryId}`} required>
        <Select id={`to-${enquiryId}`} name="orgId" className="py-1.5 text-[13px]">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.city ? `, ${b.city}` : ""}
            </option>
          ))}
        </Select>
      </Field>
    </ActionForm>
  );
}

/** A new version of the agreement. */
export function MouForm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New version
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="A new version of the agreement"
        description="Versions are added, never edited. A sub-agent accepted particular words on a particular day, and those words stay as they were."
        className="max-w-3xl"
      >
        <ActionForm action={saveMouAction} submitLabel="Save this version" pendingLabel="Saving…">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Version" name="version" required hint="2026.1, April 2026." />
            <TextField label="In force from" name="effectiveFrom" type="date" />
            <TextField label="Title" name="title" required defaultValue="Memorandum of Understanding" />
          </div>
          <TextareaField label="The agreement" name="body" rows={16} required hint="Paste it in. Blank lines separate paragraphs; nothing is reformatted." />
          <Checkbox name="publish" label="Publish it now, and ask every sub-agent to accept it" />
        </ActionForm>
      </Modal>
    </>
  );
}

/**
 * A referral rate. One kind at a time, because a rate carrying both a share and
 * a flat amount could not say which applied.
 */
export function RateForm({ agents }: { agents: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<"SHARE_OF_COMMISSION" | "FLAT_PER_ENROLMENT">("SHARE_OF_COMMISSION");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={saveAgentRateAction} submitLabel="Add this rate" pendingLabel="Saving…" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Who it is for" name="orgId" hint="Leave it on every sub-agent for the platform default.">
          <option value="">Every sub-agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
        <Field label="How they are paid" htmlFor="rate-kind" required>
          <Select id="rate-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {(Object.keys(FEE_KIND_LABEL) as (keyof typeof FEE_KIND_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {FEE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "SHARE_OF_COMMISSION" ? (
          <TextField label="Share" name="percent" type="number" step="0.01" min="0" max="100" required hint="A percentage of the commission Medcity received for that student." />
        ) : (
          <TextField label="Amount per enrolment" name="flatAmountInr" type="number" min="0" required hint="In rupees." />
        )}
        <TextField label="In force from" name="activeFrom" type="date" required defaultValue={today} />
      </div>
      <TextareaField label="Note" name="note" rows={2} hint="Optional. What was agreed, and with whom." />
    </ActionForm>
  );
}

/** Putting a figure on an earning the rate could not answer. */
export function PriceEarning({ earningId }: { earningId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" className="py-1 text-xs" onClick={() => setOpen(true)}>
        Set the amount
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="What this referral earned" description="For the cases a rate cannot answer: a commission in a currency with no exchange rate on file, or a figure agreed on the phone.">
        <ActionForm action={priceEarningAction} submitLabel="Save the amount" pendingLabel="Saving…">
          <input type="hidden" name="earningId" value={earningId} />
          <TextField label="Amount" name="amountInr" type="number" min="1" required hint="In rupees." />
          <TextareaField label="Note" name="note" rows={2} hint="How it was arrived at." />
        </ActionForm>
      </Modal>
    </>
  );
}

export function CancelEarning({ earningId }: { earningId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" className="py-1 text-xs text-stop-700" onClick={() => setOpen(true)}>
        Cancel it
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel this earning" description="The sub-agent reads the reason on their own screen, so write it for them.">
        <ActionForm action={cancelEarningAction} submitLabel="Cancel it" pendingLabel="Saving…">
          <input type="hidden" name="earningId" value={earningId} />
          <TextareaField label="Why" name="reason" rows={3} required />
        </ActionForm>
      </Modal>
    </>
  );
}

/** The three switches: the form, the agreement gate, and the floor on a withdrawal. */
export function AgentSettingsForm({
  signupOpen,
  requireMou,
  minimum,
}: {
  signupOpen: boolean;
  requireMou: boolean;
  minimum: number | null;
}) {
  return (
    <ActionForm action={saveAgentSettingsAction} submitLabel="Save" pendingLabel="Saving…">
      <Checkbox name="agentSignupOpen" defaultChecked={signupOpen} label="The application form answers" />
      <Checkbox
        name="requireMouBeforePortal"
        defaultChecked={requireMou}
        label="A sub-agent must accept the agreement before they can refer anybody"
      />
      <Field label="Smallest withdrawal" htmlFor="min-withdrawal" hint="In rupees. Leave it empty for no minimum, which is different from a minimum of nought.">
        <Input id="min-withdrawal" name="minWithdrawalInr" type="number" min="0" defaultValue={minimum ?? ""} placeholder="No minimum" />
      </Field>
    </ActionForm>
  );
}

/** Kept so the agreement body can be read before accepting, without a library. */
export function MouBody({ body }: { body: string }) {
  return (
    <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-line bg-surface p-4 text-[13.5px] leading-relaxed text-ink-soft">
      {body.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="mb-3 whitespace-pre-wrap last:mb-0">
          {para}
        </p>
      ))}
    </div>
  );
}


