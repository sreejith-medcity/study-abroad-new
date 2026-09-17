import "server-only";
import { and, count, desc, eq, gte, ilike, isNull, lte, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";

const { auditLogs: al, users: au } = schema;

export type AuditFilters = {
  q?: string;
  actor?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page?: string;
};

const FILTER_KEYS = ["q", "actor", "action", "entityType", "from", "to", "page"] as const;

/** Only the known filters, so framework params never end up in the log entry. */
export function readAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const out: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const raw = sp[key];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (val) out[key] = val;
  }
  return out as AuditFilters;
}

export function auditWhere(f: AuditFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.actor) conds.push(f.actor === "system" ? isNull(al.actorId) : eq(al.actorId, f.actor));
  if (f.action) conds.push(eq(al.action, f.action));
  if (f.entityType) conds.push(eq(al.entityType, f.entityType));
  if (f.from) conds.push(gte(al.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(al.createdAt, new Date(`${f.to}T23:59:59`)));
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(or(ilike(al.action, like), ilike(al.entityId, like), ilike(au.name, like), ilike(au.email, like)));
  }
  const kept = conds.filter(Boolean);
  return kept.length ? and(...kept) : undefined;
}

/** One row per audit entry with the actor resolved. Newest first. */
export function auditBase() {
  return db
    .select({
      id: al.id,
      action: al.action,
      entityType: al.entityType,
      entityId: al.entityId,
      meta: al.meta,
      createdAt: al.createdAt,
      actorId: al.actorId,
      actorName: au.name,
      actorEmail: au.email,
      actorRole: au.role,
    })
    .from(al)
    .leftJoin(au, eq(al.actorId, au.id))
    .$dynamic();
}

export async function auditCount(f: AuditFilters) {
  const [row] = await db
    .select({ total: count() })
    .from(al)
    .leftJoin(au, eq(al.actorId, au.id))
    .where(auditWhere(f));
  return row?.total ?? 0;
}

export function auditOrder() {
  return desc(al.createdAt);
}

/** Distinct values so the filters only offer actions that actually exist. */
export async function auditFacets() {
  const [actions, entityTypes, actors] = await Promise.all([
    db.selectDistinct({ action: al.action }).from(al).orderBy(al.action),
    db.selectDistinct({ entityType: al.entityType }).from(al).orderBy(al.entityType),
    db
      .selectDistinct({ id: au.id, name: au.name, email: au.email })
      .from(al)
      .innerJoin(au, eq(al.actorId, au.id))
      .orderBy(au.name),
  ]);
  return {
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entityType),
    actors,
  };
}

const ACTION_LABEL: Record<string, string> = {
  "application.status": "Status changed",
  "application.create": "Application created",
  "application.ask_partner": "Asked partner for items",
  "application.fee_paid": "Fee marked paid",
  "applications.export": "Applications exported",
  "document.upload": "Document uploaded",
  "document.delete": "Document deleted",
  "document.download": "Document downloaded",
  "document.classify": "Document reclassified",
  "organization.update": "Partner updated",
  "partner.invite": "Partner invited",
  "passport.reveal": "Passport number revealed",
  "program.status": "Program status set",
  "programs.import": "Programs imported",
  "status.update": "Status flow edited",
  "student.create": "Student created",
  "student.reassign": "Student reassigned",
  "student.archive": "Student archived",
  "student.unarchive": "Student restored",
  "student.delete": "Student deleted",
  "student.lock": "Profile locked",
  "student.unlock": "Profile unlocked",
  "student.edit_request": "Edit requested",
  "student.profile.update": "Profile updated",
  "student.profile.delete": "Profile row deleted",
  "user.create": "User created",
  "user.activate": "User activated",
  "user.deactivate": "User deactivated",
  "user.role_change": "Role changed",
  "user.password_reset": "Password reset by admin",
  "user.password_change": "Password changed",
  "whatsapp.inbound": "WhatsApp reply received",
  "audit.export": "Audit log exported",
};

export function actionLabel(action: string) {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, " ").replace(/^./, (ch) => ch.toUpperCase());
}

/** Sensitive-looking actions get a louder tone in the table. */
export function actionTone(action: string): "bad" | "warn" | "info" | "neutral" {
  if (/(delete|deactivate|reveal)/.test(action)) return "bad";
  if (/(role_change|password|lock|export|invite|create)/.test(action)) return "warn";
  if (/(status|import|update|classify)/.test(action)) return "info";
  return "neutral";
}

export function metaPairs(meta: unknown): [string, string][] {
  if (!meta || typeof meta !== "object") return [];
  return Object.entries(meta as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .slice(0, 8)
    .map(([k, v]) => [
      k.replace(/_/g, " "),
      typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120),
    ]);
}
