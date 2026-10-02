import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREA_ORDER,
  SEVERITY_LABEL,
  readinessChecks,
  readinessHeadline,
  summarise,
  type Check,
  type ReadinessFacts,
} from "../src/lib/readiness";

/** A portal with nothing left to do, which every test moves away from one fact at a time. */
const ready = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  rateCards: 3,
  agentRates: 1,
  billingCompanies: 1,
  placeholderBillingCompanies: 0,
  companiesWithoutLiveLut: 0,
  commissionRules: 4,
  routesWithoutCommission: 0,
  unpricedIncomeLines: 0,

  requirements: 51,
  requirementsWithoutMalayalam: 0,
  requirementsNeverWaived: 2,
  rejectionReasons: 6,
  documentTypesWithoutGuidance: 0,

  students: 12,
  studentsWithoutMedcityId: 0,
  studentsWithoutConsent: 0,
  branchesWithoutIdCode: 0,

  subAgents: 2,
  mouPublished: true,
  subAgentsWithoutMou: 0,
  minWithdrawalSet: true,

  crmKeys: 1,
  crmSendingOn: true,
  crmNeedsAPerson: 0,

  cronSecretSet: true,
  crons: [
    { job: "crm", label: "The CRM queue", healthy: true, lastRanAt: new Date("2026-10-02T09:00:00Z") },
    { job: "documents", label: "Documentation chasing", healthy: true, lastRanAt: new Date("2026-10-02T04:00:00Z") },
    { job: "cricos", label: "The CRICOS register", healthy: true, lastRanAt: new Date("2026-09-20T04:00:00Z") },
  ],

  livePrograms: 400,
  draftPrograms: 0,
  demoAccounts: 0,
  whatsappLive: true,
  storageOffDisk: true,
  supportContactSet: true,
  ...over,
});

const by = (checks: Check[], key: string) => {
  const found = checks.find((c) => c.key === key);
  assert.ok(found, `no check called ${key}`);
  return found;
};

test("a portal with everything set has nothing outstanding", () => {
  const checks = readinessChecks(ready());
  const outstanding = checks.filter((c) => !c.ready);
  assert.deepEqual(
    outstanding.map((c) => c.key),
    [],
  );
  assert.equal(summarise(checks).needed, 0);
  assert.equal(readinessHeadline(summarise(checks)), "Everything on this list is done.");
});

test("every check is in a named area and carries a key of its own", () => {
  const checks = readinessChecks(ready({ draftPrograms: 5, crmNeedsAPerson: 2 }));
  const keys = checks.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "two checks share a key");
  for (const c of checks) {
    assert.ok((AREA_ORDER as readonly string[]).includes(c.area), `${c.key} is in the unlisted area ${c.area}`);
    assert.ok(c.what.length > 0, `${c.key} says nothing`);
    assert.ok(c.found.length > 0, `${c.key} reports nothing found`);
    assert.ok(SEVERITY_LABEL[c.severity], `${c.key} has no severity label`);
  }
});

test("a check that is not ready says what to do about it", () => {
  const checks = readinessChecks(ready({ rateCards: 0, billingCompanies: 0, whatsappLive: false, cronSecretSet: false }));
  for (const c of checks.filter((x) => !x.ready)) assert.ok(c.fix.length > 0, `${c.key} is outstanding and offers no fix`);
});

test("a settled check offers no fix, so the screen is not full of advice about nothing", () => {
  for (const c of readinessChecks(ready()).filter((x) => x.ready)) assert.equal(c.fix, "", `${c.key} is done and still advises something`);
});

test("the sample billing company counts as not having one", () => {
  const checks = readinessChecks(ready({ billingCompanies: 1, placeholderBillingCompanies: 1 }));
  const c = by(checks, "billing-company");
  assert.equal(c.ready, false);
  assert.equal(c.severity, "NEEDED");
});

test("an expired LUT is raised, a company without a GSTIN is not", () => {
  assert.equal(by(readinessChecks(ready({ companiesWithoutLiveLut: 1 })), "lut").ready, false);
  assert.equal(by(readinessChecks(ready()), "lut").ready, true);
});

test("a scheduler that has never run is not healthy, and CRICOS is the one that can wait", () => {
  const checks = readinessChecks(
    ready({
      crons: [
        { job: "crm", label: "The CRM queue", healthy: false, lastRanAt: null },
        { job: "cricos", label: "The CRICOS register", healthy: false, lastRanAt: null },
      ],
    }),
  );
  const crm = by(checks, "cron-crm");
  assert.equal(crm.ready, false);
  assert.equal(crm.severity, "NEEDED");
  assert.equal(crm.found, "Has never run");
  assert.equal(by(checks, "cron-cricos").severity, "LATER");
});

test("the sub-agent checks appear once there is a sub-agent or an agreement, and not before", () => {
  assert.equal(
    readinessChecks(ready({ subAgents: 0, mouPublished: false })).some((c) => c.area === "Sub-agents"),
    false,
    "a portal with no sub-agents and no agreement is asked about neither",
  );
  assert.ok(readinessChecks(ready({ subAgents: 1, mouPublished: false })).some((c) => c.area === "Sub-agents"));
  // An agreement published with nobody signed up yet still has to be asked about:
  // it is the seeded draft until somebody replaces it.
  assert.ok(readinessChecks(ready({ subAgents: 0, mouPublished: true })).some((c) => c.area === "Sub-agents"));
});

test("drafts are only mentioned when there are drafts, and never as something in the way", () => {
  assert.equal(
    readinessChecks(ready()).some((c) => c.key === "drafts"),
    false,
  );
  assert.equal(by(readinessChecks(ready({ draftPrograms: 30 })), "drafts").severity, "LATER");
});

test("the headline separates what blocks from what does not", () => {
  const blocked = summarise(readinessChecks(ready({ livePrograms: 0, whatsappLive: false })));
  assert.equal(blocked.needed, 2);
  assert.match(readinessHeadline(blocked), /^2 things would mislead/);

  const nothingBlocking = summarise(readinessChecks(ready({ supportContactSet: false })));
  assert.equal(nothingBlocking.needed, 0);
  assert.match(readinessHeadline(nothingBlocking), /^Nothing is in the way\. 1 thing left/);
});

test("the count of what is done adds up to the whole list", () => {
  const checks = readinessChecks(ready({ rateCards: 0, draftPrograms: 2 }));
  const s = summarise(checks);
  assert.equal(s.total, checks.length);
  assert.equal(s.needed + s.decide + s.later + s.ready, s.total);
});
