import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export async function paymentList(orgId?: string, limit = 50) {
  const p = schema.payments;
  return db
    .select({
      id: p.id,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      purpose: p.purpose,
      orderId: p.razorpayOrderId,
      paymentId: p.razorpayPaymentId,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      orgName: schema.organizations.name,
      ackNo: schema.applications.ackNo,
      studentId: schema.applications.studentId,
      applicationId: p.applicationId,
    })
    .from(p)
    .innerJoin(schema.organizations, eq(p.orgId, schema.organizations.id))
    .leftJoin(schema.applications, eq(p.applicationId, schema.applications.id))
    .where(orgId ? eq(p.orgId, orgId) : undefined)
    .orderBy(desc(p.createdAt))
    .limit(limit);
}
