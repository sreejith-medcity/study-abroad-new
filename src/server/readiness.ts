import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readinessChecks, summarise, type Check, type ReadinessFacts } from "@/lib/readiness";
import { cronStandings } from "@/server/cron-runs";
import { getSettings } from "@/server/settings";

/**
 * Counting what is still unset.
 *
 * One query, deliberately. Twenty separate counts would be twenty round trips
 * on a page somebody opens to be reassured, and every one of these is a cheap
 * count over an indexed column.
 *
 * The judgements are not here: they are in lib/readiness.ts, so they can be
 * tested without a database and so the screen and any future report cannot come
 * to different conclusions about the same figures.
 */

/** The PAN the seed ships with. A real one never looks like this. */
const SAMPLE_PAN = "AAAAA0000A";

export async function readinessFacts(): Promise<ReadinessFacts> {
  const settings = await getSettings();
  const crons = await cronStandings();

  const [row] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from rate_cards) as rate_cards,
      (select count(*)::int from agent_rates) as agent_rates,
      (select count(*)::int from billing_companies) as billing_companies,
      (select count(*)::int from billing_companies where pan = ${SAMPLE_PAN}) as placeholder_billing_companies,
      -- A company with a GSTIN is one that exports under a LUT, so a missing or
      -- lapsed certificate changes the tax on a real invoice.
      (select count(*)::int from billing_companies
         where gstin is not null and gstin <> ''
           and (lut_number is null or lut_number = '' or lut_valid_until is null or lut_valid_until < current_date)) as companies_without_live_lut,
      (select count(*)::int from commission_rules where active) as commission_rules,
      -- A road to a course with neither a percentage nor a flat fee on it is a
      -- road whose commission nobody has written down. The vendor's own terms
      -- carry a default, so this is the route-level sheet rather than the vendor.
      (select count(*)::int from program_routes where percent_of_tuition is null and flat_amount is null) as routes_without_commission,
      -- A line nobody has put a figure on, and that has not been written off:
      -- it reads as "Not recorded" to whoever is owed it.
      (select count(*)::int from income_lines
         where state <> 'WRITTEN_OFF'
           and expected_amount is null and invoiced_amount is null and received_amount is null) as unpriced_income_lines,

      (select count(*)::int from document_requirements where active) as requirements,
      (select count(*)::int from document_requirements where active and (guidance_ml is null or guidance_ml = '')) as requirements_without_malayalam,
      (select count(*)::int from document_requirements where active and never_waive) as requirements_never_waived,
      (select count(*)::int from organizations where active and type <> 'HQ' and checks_own_documents) as branches_checking_own,
      (select count(*)::int from organizations where active and type <> 'HQ') as active_branches,
      (select count(*)::int from rejection_reasons where active) as rejection_reasons,
      (select count(*)::int from document_types where guidance is null or guidance = '') as document_types_without_guidance,

      (select count(*)::int from students where not archived) as students,
      (select count(*)::int from students where not archived and medcity_id is null) as students_without_medcity_id,
      (select count(*)::int from students where not archived and consent_at is null) as students_without_consent,
      (select count(*)::int from organizations where active and type <> 'HQ' and id_code is null) as branches_without_id_code,

      (select count(*)::int from organizations where active and type = 'SUB_AGENT') as sub_agents,
      (select count(*)::int from organizations o
         where o.active and o.type = 'SUB_AGENT'
           and not exists (
             select 1 from mou_acceptances a
             join mou_versions v on v.id = a.mou_version_id and v.active
             where a.org_id = o.id)) as sub_agents_without_mou,

      (select count(*)::int from integration_keys where active and revoked_at is null) as crm_keys,
      (select count(*)::int from integration_events where status = 'NEEDS_A_PERSON') as crm_needs_a_person,

      (select count(*)::int from programs where status = 'LIVE') as live_programs,
      (select count(*)::int from programs where status = 'DRAFT') as draft_programs,
      (select count(*)::int from users where active and (email like '%.test' or email like '%@example.com')) as demo_accounts,
      (select count(*)::int from mou_versions where active) as mou_versions_active
  `);

  const n = (key: string) => Number(row?.[key] ?? 0);

  return {
    rateCards: n("rate_cards"),
    agentRates: n("agent_rates"),
    billingCompanies: n("billing_companies"),
    placeholderBillingCompanies: n("placeholder_billing_companies"),
    companiesWithoutLiveLut: n("companies_without_live_lut"),
    commissionRules: n("commission_rules"),
    routesWithoutCommission: n("routes_without_commission"),
    unpricedIncomeLines: n("unpriced_income_lines"),

    requirements: n("requirements"),
    requirementsWithoutMalayalam: n("requirements_without_malayalam"),
    requirementsNeverWaived: n("requirements_never_waived"),
    branchesCheckingOwn: n("branches_checking_own"),
    activeBranches: n("active_branches"),
    rejectionReasons: n("rejection_reasons"),
    documentTypesWithoutGuidance: n("document_types_without_guidance"),

    students: n("students"),
    studentsWithoutMedcityId: n("students_without_medcity_id"),
    studentsWithoutConsent: n("students_without_consent"),
    branchesWithoutIdCode: n("branches_without_id_code"),

    subAgents: n("sub_agents"),
    mouPublished: n("mou_versions_active") > 0,
    subAgentsWithoutMou: n("sub_agents_without_mou"),
    minWithdrawalSet: settings.minWithdrawalInr != null,

    crmKeys: n("crm_keys"),
    crmSendingOn: settings.crmWebhookEnabled,
    crmNeedsAPerson: n("crm_needs_a_person"),

    // Read from the environment rather than the database, because that is where
    // they live. A secret shorter than the endpoints accept counts as unset.
    cronSecretSet: (process.env.CRON_SECRET ?? "").length >= 24,
    crons: crons.map((c) => ({ job: c.job, label: c.label, healthy: c.healthy, lastRanAt: c.lastRanAt })),

    livePrograms: n("live_programs"),
    draftPrograms: n("draft_programs"),
    demoAccounts: n("demo_accounts"),
    whatsappLive: process.env.WHATSAPP_PROVIDER === "meta" && !!process.env.WHATSAPP_TOKEN,
    storageOffDisk: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supportContactSet: !!settings.supportEmail || !!settings.supportPhone,
  };
}

export async function readiness(): Promise<{ checks: Check[]; summary: ReturnType<typeof summarise> }> {
  const checks = readinessChecks(await readinessFacts());
  return { checks, summary: summarise(checks) };
}
