"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Alert, Button, cn } from "@/components/ui";
import { LOCALE_LABEL, LOCALES } from "@/lib/i18n";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/lib/password";
import {
  changeOwnPasswordAction,
  saveBranchAction,
  savePlatformAction,
  saveProfileAction,
  signOutEverywhereAction,
} from "./actions";

export function ProfileForm({
  name,
  email,
  phone,
  deskLabel,
  locale,
  showDeskLabel,
}: {
  name: string;
  email: string;
  phone: string | null;
  deskLabel: string | null;
  locale: string;
  showDeskLabel: boolean;
}) {
  return (
    <ActionForm action={saveProfileAction} submitLabel="Save profile">
      <TextField label="Full name" name="name" defaultValue={name} required autoComplete="name" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Phone" name="phone" defaultValue={phone ?? ""} autoComplete="tel" placeholder="+91 " />
        <SelectField label="Language" name="locale" defaultValue={locale} hint="Used for the portal and your notifications.">
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABEL[l]}
            </option>
          ))}
        </SelectField>
      </div>
      {showDeskLabel && (
        <TextField
          label="Job title"
          name="deskLabel"
          defaultValue={deskLabel ?? ""}
          hint="Shown next to your name, for example UK desk or Documentation."
        />
      )}
      <p className="text-xs text-muted">
        Your sign-in email is <span className="font-medium text-ink-soft">{email}</span>. Ask a super admin or ops manager to
        change it.
      </p>
    </ActionForm>
  );
}

const METER = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"];

export function PasswordForm() {
  const [value, setValue] = useState("");
  const { score, label } = passwordStrength(value);
  return (
    <ActionForm action={changeOwnPasswordAction} submitLabel="Change password" resetOnSuccess>
      <TextField label="Current password" name="currentPassword" type="password" required autoComplete="current-password" />
      <TextField
        label="New password"
        name="newPassword"
        type="password"
        required
        autoComplete="new-password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase you will remember beats a jumble you will not.`}
      />
      {value.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex h-1.5 flex-1 gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cn("flex-1 rounded-full", i < score ? METER[score] : "bg-line")} />
            ))}
          </div>
          <span className="w-16 text-right text-xs text-muted">{label}</span>
        </div>
      )}
      <TextField label="Repeat new password" name="confirmPassword" type="password" required autoComplete="new-password" />
    </ActionForm>
  );
}

export function SignOutEverywhereForm() {
  return (
    <ActionForm action={signOutEverywhereAction} submitLabel="Sign out everywhere else" submitVariant="secondary">
      <p className="text-sm text-ink-soft">
        Ends every signed-in session for your account on other browsers and devices. Use this if you signed in on a shared
        computer, or if you think somebody else has your password. You stay signed in here.
      </p>
    </ActionForm>
  );
}

export function BranchForm({
  city,
  addressLine,
  contactPhone,
  contactEmail,
}: {
  city: string | null;
  addressLine: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}) {
  return (
    <ActionForm action={saveBranchAction} submitLabel="Save branch details">
      <TextField label="City" name="city" defaultValue={city ?? ""} />
      <TextField label="Address" name="addressLine" defaultValue={addressLine ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Contact phone" name="contactPhone" defaultValue={contactPhone ?? ""} />
        <TextField label="Contact email" name="contactEmail" type="email" defaultValue={contactEmail ?? ""} />
      </div>
      <p className="text-xs text-muted">Students see these details on your public enquiry form and in the student portal.</p>
    </ActionForm>
  );
}

export function PlatformForm({ settings }: { settings: PlatformValues }) {
  const [brand, setBrand] = useState(settings.brandColor);
  const [deep, setDeep] = useState(settings.deepColor);
  const [accent, setAccent] = useState(settings.accentColor);
  const [info, setInfo] = useState(settings.infoColor);
  return (
    <ActionForm action={savePlatformAction} submitLabel="Save platform settings">
      <Section title="Names and branding" hint="Applied across every screen, the sign-in page and the student portal.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Portal name" name="portalName" defaultValue={settings.portalName} required />
          <TextField label="Organisation name" name="organisationName" defaultValue={settings.organisationName} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ColorField label="Brand crimson" name="brandColor" value={brand} onChange={setBrand} />
          <ColorField label="Deep maroon" name="deepColor" value={deep} onChange={setDeep} />
          <ColorField label="Accent yellow" name="accentColor" value={accent} onChange={setAccent} />
          <ColorField label="Information blue" name="infoColor" value={info} onChange={setInfo} />
        </div>
        <Preview brand={brand} deep={deep} accent={accent} info={info} name={settings.portalName} />
      </Section>

      <Section title="Sign-in page" hint="The headline and the three lines beside the sign-in box.">
        <TextField label="Headline" name="signInHeadline" defaultValue={settings.signInHeadline} required />
        <TextareaField
          label="Points"
          name="signInPoints"
          rows={4}
          defaultValue={settings.signInPoints.join("\n")}
          hint="One per line, up to five."
        />
      </Section>

      <Section title="Service levels" hint="How many days a file may sit in a lane before the work queue calls it late.">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="New" name="slaNewDays" defaultValue={settings.slaNewDays} />
          <NumberField label="With partner" name="slaPendingPartnerDays" defaultValue={settings.slaPendingPartnerDays} />
          <NumberField label="In progress" name="slaInProgressDays" defaultValue={settings.slaInProgressDays} />
          <NumberField label="Offer" name="slaOfferDays" defaultValue={settings.slaOfferDays} />
          <NumberField label="On hold" name="slaHoldDays" defaultValue={settings.slaHoldDays} />
        </div>
      </Section>

      <Section title="Enquiries" hint="Defaults for follow-ups and for calling an enquiry stale.">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Follow up after (days)" name="followUpDays" defaultValue={settings.followUpDays} />
          <NumberField label="Stale after (days)" name="enquiryStaleDays" defaultValue={settings.enquiryStaleDays} />
        </div>
      </Section>

      <Section title="Partner tiers" hint="Successful placements in a year needed to reach each tier.">
        <div className="grid gap-3 sm:grid-cols-4">
          <NumberField label="Silver" name="tierSilver" defaultValue={settings.tierTargets.SILVER} />
          <NumberField label="Gold" name="tierGold" defaultValue={settings.tierTargets.GOLD} />
          <NumberField label="Elite" name="tierElite" defaultValue={settings.tierTargets.ELITE} />
          <NumberField label="Platinum" name="tierPlatinum" defaultValue={settings.tierTargets.PLATINUM} />
        </div>
      </Section>

      <Section title="Exchange rates" hint="Used to show foreign currency commission in rupees. One per line.">
        <TextareaField
          label="Rates against the rupee"
          name="fxRates"
          rows={5}
          defaultValue={Object.entries(settings.fxRates)
            .filter(([code]) => code !== "INR")
            .map(([code, rate]) => `${code} ${rate}`)
            .join("\n")}
          hint="For example GBP 112. Used for commission estimates and for the rough rupee figure shown under fees; a currency without a rate shows no rupee figure. Leave the box empty to keep the current rates."
        />
      </Section>

      <Section title="Support contact" hint="Shown on the sign-in page, the public enquiry form and the student portal.">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Email" name="supportEmail" type="email" defaultValue={settings.supportEmail ?? ""} />
          <TextField label="Phone" name="supportPhone" defaultValue={settings.supportPhone ?? ""} />
          <TextField label="Hours" name="supportHours" defaultValue={settings.supportHours ?? ""} placeholder="Mon to Sat, 9 to 6" />
        </div>
      </Section>
    </ActionForm>
  );
}

export type PlatformValues = {
  portalName: string;
  organisationName: string;
  brandColor: string;
  deepColor: string;
  accentColor: string;
  infoColor: string;
  signInHeadline: string;
  signInPoints: string[];
  slaNewDays: number;
  slaPendingPartnerDays: number;
  slaInProgressDays: number;
  slaOfferDays: number;
  slaHoldDays: number;
  followUpDays: number;
  enquiryStaleDays: number;
  tierTargets: Record<"SILVER" | "GOLD" | "ELITE" | "PLATINUM", number>;
  fxRates: Record<string, number>;
  supportEmail: string | null;
  supportPhone: string | null;
  supportHours: string | null;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-line bg-surface-2/40 p-4">
      <legend className="px-1 font-display text-sm font-semibold">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

function NumberField({ label, name, defaultValue }: { label: string; name: string; defaultValue: number }) {
  return <TextField label={label} name={name} type="number" min={0} defaultValue={String(defaultValue)} className="tabular" />;
}

function ColorField({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
        />
        <input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </span>
    </label>
  );
}

function Preview({ brand, deep, accent, info, name }: { brand: string; deep: string; accent: string; info: string; name: string }) {
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (![brand, deep, accent, info].every((c) => hex.test(c))) {
    return <Alert tone="warn">Use hex colours like #c01f53 so the preview can show them.</Alert>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div
        className="flex items-center gap-2 px-4 py-3 text-white"
        style={{ background: `linear-gradient(135deg, ${deep} 0%, ${brand} 100%)` }}
      >
        <span className="font-display text-sm font-semibold">{name || "Portal"}</span>
        <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold text-ink" style={{ background: accent }}>
          12
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 bg-surface px-4 py-3">
        <Button type="button" style={{ background: brand }} className="pointer-events-none">
          Primary button
        </Button>
        <span
          className="rounded-lg px-2.5 py-1 text-[13px] font-medium"
          style={{ background: `color-mix(in oklab, ${brand} 12%, white)`, color: `color-mix(in oklab, ${brand} 80%, black)` }}
        >
          Active tab
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ background: `color-mix(in oklab, ${info} 10%, white)`, color: `color-mix(in oklab, ${info} 75%, black)` }}
        >
          Information
        </span>
      </div>
    </div>
  );
}
