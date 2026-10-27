import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { FSJ_FEE_PATHWAY } from "@/lib/fee-steps";
import { FEE_CHECK_AT, feeGate, type FeeFacts } from "@/lib/fsj";
import { FSJ_PAYMENT_STAGES, effectivePayments, fsjPlanPayments, type FsjPayments, type FsjPlanPayments } from "@/lib/fsj-fees";
import { documentationIds, notifyUsers } from "@/server/notify";

const { feeInstalments: fs, feeInvoices: fi } = schema;

/**
 * What the student's fee plan says about the FSJ / BFD payment stages: their
 * instalments on the FSJ / BFD steps and the invoices raised for them, each
 * with the day of its last receipt.
 */
export async function fsjPlanPaymentsFor(studentId: string): Promise<FsjPlanPayments> {
  const instalments = await db
    .select({ stepPathway: fs.stepPathway, stepKey: fs.stepKey, state: fs.state, invoiceId: fs.invoiceId })
    .from(fs)
    .where(and(eq(fs.studentId, studentId), eq(fs.stepPathway, FSJ_FEE_PATHWAY)));
  const ids = [...new Set(instalments.map((i) => i.invoiceId).filter((x): x is string => !!x))];
  const invoices = ids.length
    ? await db
        .select({
          id: fi.id,
          number: fi.number,
          state: fi.state,
          // Written out with table names: inside a one-table select drizzle
          // leaves column names bare, and a bare "id" here would be the receipt's.
          paidOn: sql<string | null>`(select to_char(max(r.received_on), 'YYYY-MM-DD') from fee_receipts r where r.invoice_id = "fee_invoices"."id")`,
        })
        .from(fi)
        .where(inArray(fi.id, ids))
    : [];
  return fsjPlanPayments(instalments, invoices);
}

/** The application's payment columns, as the FSJ / BFD tab marks them by hand. */
type MarkedColumns = {
  fsjRegistrationFeePaidOn: string | null;
  fsjApplicationFeePaidOn: string | null;
  fsjOfferPaymentOn?: string | null;
  fsjPreVisaPaymentOn?: string | null;
};

const markedFrom = (a: MarkedColumns): FsjPayments => ({
  registrationFeePaidOn: a.fsjRegistrationFeePaidOn,
  applicationFeePaidOn: a.fsjApplicationFeePaidOn,
  offerPaymentOn: a.fsjOfferPaymentOn ?? null,
  preVisaPaymentOn: a.fsjPreVisaPaymentOn ?? null,
});

/**
 * The registration and application fees for the fee gate: from the fee
 * invoices where the student's fee plan has them, otherwise as marked paid.
 */
export async function fsjFeeFacts(studentId: string, app: MarkedColumns): Promise<FeeFacts> {
  const eff = effectivePayments(markedFrom(app), await fsjPlanPaymentsFor(studentId));
  return { registrationFeePaidOn: eff.registrationFeePaidOn, applicationFeePaidOn: eff.applicationFeePaidOn };
}

/**
 * A fee invoice was paid in full. Where it was for the registration or the
 * application fee of an FSJ / BFD file waiting at the payment check, and both
 * fees are now in, the documentation team is told to start the application,
 * as when the fees are marked paid on the tab.
 */
export async function tellDeskIfFsjFeesIn(studentId: string, invoiceId: string) {
  try {
    const gateSteps = FSJ_PAYMENT_STAGES.filter((s) => s.key === "registration" || s.key === "application").map((s) => String(s.step));
    const tied = await db
      .select({ id: fs.id })
      .from(fs)
      .where(and(eq(fs.invoiceId, invoiceId), eq(fs.stepPathway, FSJ_FEE_PATHWAY), inArray(fs.stepKey, gateSteps)))
      .limit(1);
    if (!tied.length) return;
    const waiting = await db
      .select({
        registration: schema.applications.fsjRegistrationFeePaidOn,
        application: schema.applications.fsjApplicationFeePaidOn,
        first: schema.students.firstName,
        last: schema.students.lastName,
      })
      .from(schema.applications)
      .innerJoin(schema.programs, eq(schema.programs.id, schema.applications.programId))
      .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, schema.applications.statusId))
      .innerJoin(schema.students, eq(schema.students.id, schema.applications.studentId))
      .where(and(eq(schema.applications.studentId, studentId), inArray(schema.programs.pathway, ["FSJ", "BFD"]), inArray(schema.statusDefinitions.code, FEE_CHECK_AT)))
      .limit(1);
    const app = waiting[0];
    if (!app) return;
    const gate = feeGate(await fsjFeeFacts(studentId, { fsjRegistrationFeePaidOn: app.registration, fsjApplicationFeePaidOn: app.application }));
    if (!gate.clear) return;
    await notifyUsers(
      await documentationIds(),
      `${app.first} ${app.last}: fees received`,
      "The registration and application fee invoices are now paid. Run the payment check on step 6 to start the application.",
      `/students/${studentId}/fsj`,
    );
  } catch (e) {
    console.error("fsj: fees-received notice not sent", studentId, e);
  }
}
