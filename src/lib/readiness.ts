/**
 * What is still unset before the portal carries real students.
 *
 * Pure: the facts are counted in the server module beside this, and the
 * judgements are made here, so the rules can be tested without a database and
 * so there is one answer rather than one per screen.
 *
 * Three severities, and the difference between them matters. NEEDED is something
 * that will mislead somebody or quietly lose work: an empty rate card makes a
 * referral read as worth nothing, a fictional billing company prints the wrong
 * entity on a real invoice. DECIDE is a real question with no wrong answer that
 * only Medcity can settle. LATER is work that improves the portal and breaks
 * nothing by being undone.
 */

export type Severity = "NEEDED" | "DECIDE" | "LATER";

export type Check = {
  key: string;
  /** Which part of the portal this belongs to, for grouping. */
  area: string;
  severity: Severity;
  /** What is being checked, as a statement that is either true or not. */
  what: string;
  ready: boolean;
  /** What is actually the case right now. Always shown, ready or not. */
  found: string;
  /** What to do about it. Empty when there is nothing to do. */
  fix: string;
  /** Where to go and do it. */
  href?: string;
};

/** Everything counted from the database, handed in rather than read here. */
export type ReadinessFacts = {
  // Money
  rateCards: number;
  agentRates: number;
  billingCompanies: number;
  /** Companies still carrying the placeholder PAN the seed ships. */
  placeholderBillingCompanies: number;
  /** Companies whose LUT has run out or was never recorded, where they have a GSTIN. */
  companiesWithoutLiveLut: number;
  commissionRules: number;
  routesWithoutCommission: number;
  unpricedIncomeLines: number;

  // Documentation
  requirements: number;
  requirementsWithoutMalayalam: number;
  rejectionReasons: number;
  documentTypesWithoutGuidance: number;

  // Students and the family side
  students: number;
  studentsWithoutMedcityId: number;
  studentsWithoutConsent: number;
  branchesWithoutIdCode: number;

  // Sub-agents
  subAgents: number;
  mouPublished: boolean;
  subAgentsWithoutMou: number;
  minWithdrawalSet: boolean;

  // The CRM link
  crmKeys: number;
  crmSendingOn: boolean;
  crmNeedsAPerson: number;

  // The schedulers
  cronSecretSet: boolean;
  /** One entry per job: whether it has run recently enough to believe it works. */
  crons: { job: string; label: string; healthy: boolean; lastRanAt: Date | null }[];

  // Catalogue and the rest
  livePrograms: number;
  draftPrograms: number;
  demoAccounts: number;
  whatsappLive: boolean;
  storageOffDisk: boolean;
  supportContactSet: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Every check, ready or not.
 *
 * Returned in full rather than filtered, because a list of only the problems
 * gives nobody the confidence that the rest was looked at.
 */
export function readinessChecks(f: ReadinessFacts): Check[] {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);

  // ---------- Money ----------
  add({
    key: "rate-cards",
    area: "Money",
    severity: "NEEDED",
    what: "At least one rate card, so a service has a price",
    ready: f.rateCards > 0,
    found: f.rateCards === 0 ? "None set" : plural(f.rateCards, "rate card"),
    fix: f.rateCards > 0 ? "" : "Until there is one, a completed service writes an income line with no amount, which reads as “Not recorded” and is counted as money left on the table.",
    href: "/admin/income?tab=rates",
  });
  add({
    key: "billing-company",
    area: "Money",
    severity: "NEEDED",
    what: "A real billing company, not the sample one",
    ready: f.billingCompanies > 0 && f.placeholderBillingCompanies === 0,
    found:
      f.billingCompanies === 0
        ? "None on record"
        : f.placeholderBillingCompanies > 0
          ? `${plural(f.placeholderBillingCompanies, "company", "companies")} still on the sample PAN`
          : plural(f.billingCompanies, "company", "companies"),
    fix:
      f.billingCompanies === 0
        ? "An invoice is raised by a company, and its GSTIN and LUT decide the tax. Nothing can be invoiced without one."
        : f.placeholderBillingCompanies > 0
          ? "The seeded company carries a made-up PAN and GSTIN. A real invoice would print the wrong entity."
          : "",
    href: "/settings/branch#billing",
  });
  add({
    key: "lut",
    area: "Money",
    severity: "NEEDED",
    what: "A live LUT where a company has a GSTIN",
    ready: f.companiesWithoutLiveLut === 0,
    found: f.companiesWithoutLiveLut === 0 ? "Every company with a GSTIN has one in date" : `${plural(f.companiesWithoutLiveLut, "company", "companies")} without one in date`,
    fix: f.companiesWithoutLiveLut === 0 ? "" : "Without a live LUT an export invoice is taxable rather than zero-rated, and the invoice says so. Check the date on the certificate.",
    href: "/settings/branch#billing",
  });
  add({
    key: "commission-rules",
    area: "Money",
    severity: "NEEDED",
    what: "Commission rules, so a placement accrues something",
    ready: f.commissionRules > 0,
    found: f.commissionRules === 0 ? "None set" : plural(f.commissionRules, "rule"),
    fix: f.commissionRules > 0 ? "" : "A student who enrols accrues no commission at all until a rule covers their program, university or country.",
    href: "/admin/commission?tab=rules",
  });
  add({
    key: "route-commission",
    area: "Money",
    severity: "LATER",
    what: "Every route carries the vendor's commission figures",
    ready: f.routesWithoutCommission === 0,
    found: f.routesWithoutCommission === 0 ? "All of them do" : `${plural(f.routesWithoutCommission, "route")} with neither a percentage nor a fee`,
    fix: f.routesWithoutCommission === 0 ? "" : "The commission that actually accrues comes from the rules, so this breaks nothing. It is what makes the expected share on a search result right.",
    href: "/admin/vendors",
  });
  if (f.unpricedIncomeLines > 0) {
    add({
      key: "unpriced-income",
      area: "Money",
      severity: "NEEDED",
      what: "No income line is left without a figure",
      ready: false,
      found: `${plural(f.unpricedIncomeLines, "line")} with no amount`,
      fix: "Each of these reads as “Not recorded” to whoever is owed it. Set them or write them off.",
      href: "/admin/income",
    });
  }

  // ---------- Documentation ----------
  add({
    key: "requirements",
    area: "Documentation",
    severity: "NEEDED",
    what: "The document requirements have been reviewed",
    ready: f.requirements > 0,
    found: f.requirements === 0 ? "None on file" : plural(f.requirements, "requirement"),
    fix: f.requirements > 0 ? "" : "Without them no student has a checklist, and every stage gate is clear because nothing is being asked for.",
    href: "/admin/documents",
  });
  add({
    key: "requirements-malayalam",
    area: "Documentation",
    severity: "LATER",
    what: "The rule text is in Malayalam as well as English",
    ready: f.requirementsWithoutMalayalam === 0,
    found: f.requirementsWithoutMalayalam === 0 ? "All of them are" : `${plural(f.requirementsWithoutMalayalam, "requirement")} with English only`,
    fix: f.requirementsWithoutMalayalam === 0 ? "" : "A Malayalam-reading student is shown the English rule for these. The portal does not translate it, on purpose.",
    href: "/admin/documents",
  });
  add({
    key: "rejection-reasons",
    area: "Documentation",
    severity: "NEEDED",
    what: "Reasons a document can be sent back",
    ready: f.rejectionReasons > 0,
    found: f.rejectionReasons === 0 ? "None active" : plural(f.rejectionReasons, "reason"),
    fix: f.rejectionReasons > 0 ? "" : "A rejection needs a reason the student can act on, and the list is what the team picks from. Nothing can be sent back without one.",
    href: "/admin/documents",
  });
  add({
    key: "document-guidance",
    area: "Documentation",
    severity: "LATER",
    what: "Each document type says what a good one looks like",
    ready: f.documentTypesWithoutGuidance === 0,
    found: f.documentTypesWithoutGuidance === 0 ? "All of them do" : `${plural(f.documentTypesWithoutGuidance, "type")} with no guidance`,
    fix: f.documentTypesWithoutGuidance === 0 ? "" : "Guidance and a sample are what stop the same document being sent back three times.",
    href: "/admin/documents",
  });

  // ---------- Students ----------
  add({
    key: "medcity-ids",
    area: "Students",
    severity: "NEEDED",
    what: "Every student carries a Medcity ID",
    ready: f.studentsWithoutMedcityId === 0,
    found: f.studentsWithoutMedcityId === 0 ? "All of them do" : `${plural(f.studentsWithoutMedcityId, "student")} without one`,
    fix: f.studentsWithoutMedcityId === 0 ? "" : "Open the student's file and press “Give one”, or run the backfill from part 45 again.",
    href: "/students",
  });
  add({
    key: "branch-codes",
    area: "Students",
    severity: "NEEDED",
    what: "Every branch has its letters for the Medcity ID",
    ready: f.branchesWithoutIdCode === 0,
    found: f.branchesWithoutIdCode === 0 ? "All of them do" : `${plural(f.branchesWithoutIdCode, "branch", "branches")} without a code`,
    fix: f.branchesWithoutIdCode === 0 ? "" : "A branch with no code cannot mint an ID for a student it registers.",
    href: "/admin/partners",
  });
  if (f.studentsWithoutConsent > 0) {
    add({
      key: "consent",
      area: "Students",
      severity: "DECIDE",
      what: "Every student has consent on file",
      ready: false,
      found: `${plural(f.studentsWithoutConsent, "student")} without it`,
      fix: "These predate the consent being recorded, or came in through an import. Decide whether to collect it again or to note where it was taken.",
      href: "/students",
    });
  }

  // ---------- Sub-agents ----------
  if (f.subAgents > 0 || f.mouPublished) {
    add({
      key: "mou",
      area: "Sub-agents",
      severity: "NEEDED",
      what: "An agreement is published",
      ready: f.mouPublished,
      found: f.mouPublished ? "One is being asked for" : "None published",
      fix: f.mouPublished
        ? ""
        : "The seeded memorandum is a plain-English draft written for this build, not legal advice. Replace it with the one your lawyer approves before anybody is asked to accept it.",
      href: "/admin/agents?tab=agreement",
    });
    add({
      key: "mou-accepted",
      area: "Sub-agents",
      severity: "LATER",
      what: "Every sub-agent has accepted it",
      ready: f.subAgentsWithoutMou === 0,
      found: f.subAgentsWithoutMou === 0 ? "All of them have" : `${plural(f.subAgentsWithoutMou, "sub-agent")} still to accept`,
      fix: f.subAgentsWithoutMou === 0 ? "" : "They cannot withdraw until they do, which is the condition doing its job rather than a fault.",
      href: "/admin/agents?tab=agreement",
    });
    add({
      key: "agent-rate",
      area: "Sub-agents",
      severity: "NEEDED",
      what: "A referral rate is set",
      ready: f.agentRates > 0,
      found: f.agentRates === 0 ? "None set" : plural(f.agentRates, "rate"),
      fix: f.agentRates > 0 ? "" : "Until there is one, a referral is credited with no figure and reads as “Not recorded” to the sub-agent.",
      href: "/admin/agents?tab=agents",
    });
    add({
      key: "min-withdrawal",
      area: "Sub-agents",
      severity: "DECIDE",
      what: "A smallest withdrawal is decided",
      ready: f.minWithdrawalSet,
      found: f.minWithdrawalSet ? "Set" : "No minimum",
      fix: f.minWithdrawalSet ? "" : "No minimum is a valid answer and is what happens by default. Set one if you would rather not make small transfers.",
      href: "/admin/agents?tab=agreement",
    });
  }

  // ---------- The schedulers ----------
  add({
    key: "cron-secret",
    area: "Schedulers",
    severity: "NEEDED",
    what: "A scheduler secret is set",
    ready: f.cronSecretSet,
    found: f.cronSecretSet ? "Set, and long enough" : "Not set, or shorter than 24 characters",
    fix: f.cronSecretSet ? "" : "All three scheduled endpoints answer 401 to everybody until it is set, which is deliberate: unset means off, not open.",
  });
  for (const cron of f.crons) {
    add({
      key: `cron-${cron.job}`,
      area: "Schedulers",
      severity: cron.job === "cricos" ? "LATER" : "NEEDED",
      what: `${cron.label} is being called`,
      ready: cron.healthy,
      found: cron.lastRanAt ? `Last ran ${cron.lastRanAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Has never run",
      fix: cron.healthy ? "" : "Point a scheduler at it. The README's “three scheduled jobs” section has the three ways of doing that.",
    });
  }

  // ---------- The CRM link ----------
  add({
    key: "crm-key",
    area: "The CRM link",
    severity: "LATER",
    what: "A key exists for Medcity's own CRM",
    ready: f.crmKeys > 0,
    found: f.crmKeys === 0 ? "None made" : plural(f.crmKeys, "key"),
    fix: f.crmKeys > 0 ? "" : "Not needed until their build is ready. When it is, make a key and send them the “For the vendor” page.",
    href: "/admin/integrations?tab=keys",
  });
  if (f.crmNeedsAPerson > 0) {
    add({
      key: "crm-attention",
      area: "The CRM link",
      severity: "NEEDED",
      what: "Nothing on the link is waiting for a person",
      ready: false,
      found: `${plural(f.crmNeedsAPerson, "row")} waiting`,
      fix: "Either a field the CRM tried to change where our copy is newer, or a send that gave up. Both need a decision.",
      href: "/admin/integrations?tab=attention",
    });
  }

  // ---------- The rest ----------
  add({
    key: "demo-accounts",
    area: "Before real students",
    severity: "NEEDED",
    what: "The sample accounts can no longer sign in",
    ready: f.demoAccounts === 0,
    found: f.demoAccounts === 0 ? "None left" : `${plural(f.demoAccounts, "account")} still active`,
    fix: f.demoAccounts === 0 ? "" : "They all share one password. Clear them on this page, or run npm run db:demo-off.",
    href: "/admin/go-live",
  });
  add({
    key: "storage",
    area: "Before real students",
    severity: "NEEDED",
    what: "Documents are stored off the app's disk",
    ready: f.storageOffDisk,
    found: f.storageOffDisk ? "Supabase Storage" : "The local disk",
    fix: f.storageOffDisk ? "" : "The host wipes the disk on each deploy, so every uploaded document would be lost. Set SUPABASE_URL and the service role key.",
  });
  add({
    key: "whatsapp",
    area: "Before real students",
    severity: "NEEDED",
    what: "WhatsApp messages actually send",
    ready: f.whatsappLive,
    found: f.whatsappLive ? "Through Meta" : "Printed to the console only",
    fix: f.whatsappLive ? "" : "Every message to a student, every document chase and every notice about a parent is written to the log and goes nowhere.",
  });
  add({
    key: "programs",
    area: "Before real students",
    severity: "NEEDED",
    what: "There are live programs to apply to",
    ready: f.livePrograms > 0,
    found: f.livePrograms === 0 ? "None live" : `${plural(f.livePrograms, "program")} live${f.draftPrograms > 0 ? `, ${f.draftPrograms} in draft` : ""}`,
    fix: f.livePrograms > 0 ? "" : "Nothing can be shortlisted or applied to until at least one program is published.",
    href: "/admin/programs",
  });
  if (f.draftPrograms > 0) {
    add({
      key: "drafts",
      area: "Before real students",
      severity: "LATER",
      what: "No program is left waiting in draft",
      ready: false,
      found: `${plural(f.draftPrograms, "program")} in draft`,
      fix: "Courses from the CRICOS register land as drafts on purpose. Nobody sees them until they are published.",
      href: "/admin/programs?status=DRAFT",
    });
  }
  add({
    key: "support-contact",
    area: "Before real students",
    severity: "LATER",
    what: "Somebody to contact is on record",
    ready: f.supportContactSet,
    found: f.supportContactSet ? "Set" : "Not set",
    fix: f.supportContactSet ? "" : "A partner or a student with a problem is shown nothing to ring.",
    href: "/settings/platform",
  });

  return out;
}

export type ReadinessSummary = { needed: number; decide: number; later: number; ready: number; total: number };

export function summarise(checks: Check[]): ReadinessSummary {
  const outstanding = checks.filter((c) => !c.ready);
  return {
    needed: outstanding.filter((c) => c.severity === "NEEDED").length,
    decide: outstanding.filter((c) => c.severity === "DECIDE").length,
    later: outstanding.filter((c) => c.severity === "LATER").length,
    ready: checks.length - outstanding.length,
    total: checks.length,
  };
}

/** The one line at the top: either go, or what is in the way. */
export function readinessHeadline(s: ReadinessSummary): string {
  if (s.needed === 0 && s.decide === 0 && s.later === 0) return "Everything on this list is done.";
  if (s.needed === 0) return `Nothing is in the way. ${s.decide + s.later} thing${s.decide + s.later === 1 ? "" : "s"} left that will not break anything.`;
  return `${s.needed} thing${s.needed === 1 ? "" : "s"} would mislead somebody or lose work if real students arrived today.`;
}

/** The order the groups are read in: the money first, because it is the one that costs. */
export const AREA_ORDER = ["Money", "Documentation", "Students", "Sub-agents", "Schedulers", "The CRM link", "Before real students"] as const;

export const SEVERITY_LABEL: Record<Severity, string> = {
  NEEDED: "Needed",
  DECIDE: "Yours to decide",
  LATER: "Can wait",
};
