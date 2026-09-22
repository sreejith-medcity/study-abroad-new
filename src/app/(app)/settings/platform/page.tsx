import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { canManageSettings } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { getSettings, fxRates, signInPoints, tierTargets } from "@/server/settings";
import { Alert, Card, CardHeader } from "@/components/ui";
import { PlatformForm } from "../forms";
import { ArtworkPanel } from "../artwork";
import { PaymentSettingsForm } from "./payments";

export const metadata = { title: "Platform settings" };

export default async function PlatformSettingsPage() {
  const user = await requireUser();
  if (!canManageSettings(user)) {
    return <Alert tone="bad">Only a super admin can open platform settings.</Alert>;
  }

  const settings = await getSettings();
  const pay = await db.query.paymentSettings.findFirst({ where: eq(schema.paymentSettings.id, "app") });
  const envKeys = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  const base = (process.env.PUBLIC_BASE_URL ?? "https://doc.medcityoverseas.com").replace(/\/$/, "");
  const editor = settings.updatedById
    ? await db.query.users.findFirst({ where: eq(schema.users.id, settings.updatedById) })
    : null;

  return (
    <>
      <ArtworkPanel
        logo={Boolean(settings.logoKey)}
        favicon={Boolean(settings.faviconKey)}
        version={`${settings.logoKey ?? "none"}-${settings.faviconKey ?? "none"}`}
      />

      <Card id="payments">
        <CardHeader title="Online payments" subtitle="Razorpay, for application fees in the currency the program records. International currencies must be enabled on the Razorpay account." />
        <div className="space-y-3 p-4 pt-0">
          <PaymentSettingsForm keyId={pay?.razorpayKeyId ?? null} secretSet={!!pay?.razorpayKeySecretEnc} webhookSet={!!pay?.razorpayWebhookSecretEnc || !!process.env.RAZORPAY_WEBHOOK_SECRET} enabled={pay?.enabled ?? false} envKeys={envKeys} />
          <p className="text-xs text-muted">
            In the Razorpay dashboard, add a webhook to <span className="font-mono text-ink-soft">{base}/api/razorpay/webhook</span> for payment.captured, order.paid and payment.failed, with the same webhook secret.
          </p>
        </div>
      </Card>

      <Card>
      <CardHeader
        title="Platform settings"
        subtitle="These values drive every screen, so a change here is felt right across the portal."
        action={
          editor ? (
            <span className="text-xs text-muted">
              Last changed by {editor.name}, {fmtDateTime(settings.updatedAt)}
            </span>
          ) : undefined
        }
      />
      <div className="p-4">
        <PlatformForm
          settings={{
            portalName: settings.portalName,
            organisationName: settings.organisationName,
            brandColor: settings.brandColor,
            deepColor: settings.deepColor,
            accentColor: settings.accentColor,
            infoColor: settings.infoColor,
            signInHeadline: settings.signInHeadline,
            signInPoints: signInPoints(settings),
            slaNewDays: settings.slaNewDays,
            slaPendingPartnerDays: settings.slaPendingPartnerDays,
            slaInProgressDays: settings.slaInProgressDays,
            slaOfferDays: settings.slaOfferDays,
            slaHoldDays: settings.slaHoldDays,
            followUpDays: settings.followUpDays,
            enquiryStaleDays: settings.enquiryStaleDays,
            tierTargets: tierTargets(settings),
            fxRates: fxRates(settings),
            supportEmail: settings.supportEmail,
            supportPhone: settings.supportPhone,
            supportHours: settings.supportHours,
          }}
        />
        </div>
      </Card>
    </>
  );
}
