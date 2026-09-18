import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../lib/id";

const id = () => text("id").primaryKey().$defaultFn(createId);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Enums ----------

export const orgType = pgEnum("org_type", ["HQ", "BRANCH", "SUB_AGENT"]);
export const tier = pgEnum("tier", ["SILVER", "GOLD", "ELITE", "PLATINUM"]);
export const role = pgEnum("role", ["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR", "STUDENT", "SUPER_ADMIN", "OPS_MANAGER", "DOCUMENTATION"]);
export const pathway = pgEnum("pathway", ["DEGREE", "AUSBILDUNG", "NURSING"]);
export const studyLevel = pgEnum("study_level", [
  "SCHOOL",
  "UG_DIPLOMA",
  "UG",
  "PG_DIPLOMA",
  "PG",
  "PHD",
  "VOCATIONAL",
  "REGISTRATION",
]);
export const programStatus = pgEnum("program_status", ["DRAFT", "LIVE", "ARCHIVED"]);
export const statusGroup = pgEnum("status_group", [
  "NEW",
  "PENDING_PARTNER",
  "IN_PROGRESS",
  "OFFER",
  "SUCCESS",
  "HOLD",
  "CLOSED",
]);
export const feeStatus = pgEnum("fee_status", ["NOT_APPLICABLE", "DUE", "PAID"]);
export const commentChannel = pgEnum("comment_channel", ["TEAM", "STUDENT"]);
export const messageSource = pgEnum("message_source", ["WEB", "WHATSAPP", "SYSTEM"]);
export const editRequestStatus = pgEnum("edit_request_status", ["OPEN", "APPROVED", "REJECTED"]);
export const enquirySource = pgEnum("enquiry_source", [
  "WALK_IN",
  "PHONE",
  "WHATSAPP",
  "WEBSITE",
  "REFERRAL",
  "EVENT",
  "SOCIAL",
  "OTHER",
]);
export const enquiryStage = pgEnum("enquiry_stage", ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING", "CONVERTED", "LOST"]);
export const commissionBasis = pgEnum("commission_basis", ["PERCENT_TUITION", "FLAT"]);
export const commissionStatus = pgEnum("commission_status", [
  "EXPECTED",
  "INVOICED",
  "RECEIVED",
  "SETTLED",
  "WRITTEN_OFF",
]);
export const walletEntryKind = pgEnum("wallet_entry_kind", ["COMMISSION", "PAYOUT", "BONUS", "ADJUSTMENT"]);
export const payoutStatus = pgEnum("payout_status", ["REQUESTED", "APPROVED", "PAID", "REJECTED"]);
export const resourceKind = pgEnum("resource_kind", ["GUIDE", "TEMPLATE", "POLICY", "TRAINING", "MARKETING", "FAQ"]);

// ---------- Organisation and users ----------

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  type: orgType("type").notNull(),
  tier: tier("tier").notNull().default("SILVER"),
  city: text("city"),
  counsellorSeats: integer("counsellor_seats").notNull().default(3),
  /** Short code in the public enquiry link, printed on the branch QR code. */
  publicSlug: text("public_slug").unique(),
  publicFormEnabled: boolean("public_form_enabled").notNull().default(false),
  relationshipManagerId: text("relationship_manager_id"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    role: role("role").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    deskLabel: text("desk_label"),
    /** Set on STUDENT logins: the one student file this account may read. */
    studentId: text("student_id"),
    locale: text("locale").notNull().default("en"),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

// ---------- Catalogue ----------

export const countries = pgTable("countries", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
});

export const universities = pgTable(
  "universities",
  {
    id: id(),
    name: text("name").notNull(),
    city: text("city"),
    countryId: text("country_id")
      .notNull()
      .references(() => countries.id),
    isPublic: boolean("is_public").notNull().default(false),
  },
  (t) => [uniqueIndex("universities_name_country_uq").on(t.name, t.countryId)],
);

export const programs = pgTable(
  "programs",
  {
    id: id(),
    name: text("name").notNull(),
    universityId: text("university_id")
      .notNull()
      .references(() => universities.id),
    pathway: pathway("pathway").notNull().default("DEGREE"),
    level: studyLevel("level").notNull(),
    studyArea: text("study_area"),
    durationMonths: integer("duration_months"),
    tuitionPerYear: integer("tuition_per_year"),
    applicationFee: integer("application_fee").notNull().default(0),
    initialDeposit: integer("initial_deposit"),
    intakeMonths: integer("intake_months").array().notNull().default(sql`'{}'::integer[]`),
    // Structured requirements: used by the pre-submission check and eligibility search
    minIelts: real("min_ielts"),
    minPte: integer("min_pte"),
    minOetGrade: text("min_oet_grade"),
    minGermanLevel: text("min_german_level"),
    maxBacklogs: integer("max_backlogs"),
    maxGapYears: integer("max_gap_years"),
    moiAccepted: boolean("moi_accepted").notNull().default(false),
    requiredDocs: text("required_docs").array().notNull().default(sql`'{}'::text[]`),
    status: programStatus("status").notNull().default("LIVE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("programs_name_idx").on(t.name)],
);

// ---------- Status dictionary (per pathway) ----------

export const statusDefinitions = pgTable(
  "status_definitions",
  {
    id: id(),
    pathway: pathway("pathway").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    studentLabel: text("student_label").notNull(),
    /** The same wording in Malayalam, for the student portal. */
    studentLabelMl: text("student_label_ml"),
    group: statusGroup("group").notNull(),
    sortOrder: integer("sort_order").notNull(),
    requiresReason: boolean("requires_reason").notNull().default(false),
    isMilestone: boolean("is_milestone").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("status_pathway_code_uq").on(t.pathway, t.code)],
);

// ---------- Students ----------

export const students = pgTable(
  "students",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    createdById: text("created_by_id").references(() => users.id),
    assignedToId: text("assigned_to_id").references(() => users.id),
    userId: text("user_id").references(() => users.id),
    portalToken: text("portal_token").notNull().unique().$defaultFn(createId),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(true),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    preferredCountry: text("preferred_country"),
    preferredPathway: pathway("preferred_pathway"),

    dateOfBirth: timestamp("date_of_birth", { mode: "date" }),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    nationality: text("nationality").notNull().default("India"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),

    passportNumber: text("passport_number"),
    passportIssue: timestamp("passport_issue", { mode: "date" }),
    passportExpiry: timestamp("passport_expiry", { mode: "date" }),
    passportIssueCountry: text("passport_issue_country"),
    cityOfBirth: text("city_of_birth"),

    backlogs: integer("backlogs"),
    gapYears: integer("gap_years"),

    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentText: text("consent_text"),
    profileLocked: boolean("profile_locked").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    source: text("source").notNull().default("partner"), // partner | qr | crm
    crmLeadId: text("crm_lead_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("students_org_idx").on(t.orgId), index("students_email_idx").on(t.email)],
);

export const academicRecords = pgTable("academic_records", {
  id: id(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  level: studyLevel("level").notNull(),
  institution: text("institution").notNull(),
  course: text("course"),
  gradingSystem: text("grading_system"),
  score: real("score"),
  yearCompleted: integer("year_completed"),
});

export const testScores = pgTable("test_scores", {
  id: id(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  test: text("test").notNull(), // IELTS | PTE | OET | TOEFL | GERMAN
  overall: text("overall").notNull(),
  takenOn: timestamp("taken_on", { mode: "date" }),
  isMock: boolean("is_mock").notNull().default(false),
  source: text("source").notNull().default("manual"), // manual | lms
});

export const workExperience = pgTable("work_experience", {
  id: id(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  employer: text("employer").notNull(),
  title: text("title").notNull(),
  startDate: timestamp("start_date", { mode: "date" }).notNull(),
  endDate: timestamp("end_date", { mode: "date" }),
});

export const editRequests = pgTable("edit_requests", {
  id: id(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  section: text("section").notNull(),
  message: text("message").notNull(),
  status: editRequestStatus("status").notNull().default("OPEN"),
  requestedById: text("requested_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

// ---------- Applications ----------

export const applications = pgTable(
  "applications",
  {
    id: id(),
    ackNo: text("ack_no").notNull().unique(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    programId: text("program_id")
      .notNull()
      .references(() => programs.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    intakeMonth: integer("intake_month").notNull(),
    intakeYear: integer("intake_year").notNull(),
    statusId: text("status_id")
      .notNull()
      .references(() => statusDefinitions.id),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    officerId: text("officer_id").references(() => users.id),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    deadline: timestamp("deadline", { mode: "date" }),
    feeStatus: feeStatus("fee_status").notNull().default("NOT_APPLICABLE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_org_idx").on(t.orgId), index("applications_status_idx").on(t.statusId)],
);

export const statusHistory = pgTable("status_history", {
  id: id(),
  applicationId: text("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  fromStatusId: text("from_status_id").references(() => statusDefinitions.id),
  toStatusId: text("to_status_id")
    .notNull()
    .references(() => statusDefinitions.id),
  reason: text("reason"),
  changedById: text("changed_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const comments = pgTable("comments", {
  id: id(),
  applicationId: text("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  channel: commentChannel("channel").notNull(),
  body: text("body").notNull(),
  source: messageSource("source").notNull().default("WEB"),
  authorId: text("author_id").references(() => users.id),
  authorLabel: text("author_label"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Documents ----------

export const documentTypes = pgTable("document_types", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  labelMl: text("label_ml"),
  uploadedBy: text("uploaded_by").notNull().default("partner"), // partner | team
  sortOrder: integer("sort_order").notNull().default(100),
});

export const documents = pgTable("documents", {
  id: id(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  applicationId: text("application_id").references(() => applications.id),
  commentId: text("comment_id").references(() => comments.id),
  typeCode: text("type_code").references(() => documentTypes.code),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedById: text("uploaded_by_id").references(() => users.id),
  createdAt: createdAt(),
});

// ---------- Notifications, messaging and audit ----------

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

export const outboundMessages = pgTable("outbound_messages", {
  id: id(),
  channel: text("channel").notNull(), // whatsapp | email
  to: text("to").notNull(),
  template: text("template"),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"),
  providerId: text("provider_id"),
  error: text("error"),
  createdAt: createdAt(),
});

// ---------- Commission and wallet ----------

/**
 * What Medcity earns for a placement, and what the partner keeps of it.
 * The most specific live rule wins: program, then university, then country.
 */
export const commissionRules = pgTable(
  "commission_rules",
  {
    id: id(),
    name: text("name").notNull(),
    countryId: text("country_id").references(() => countries.id),
    universityId: text("university_id").references(() => universities.id),
    programId: text("program_id").references(() => programs.id),
    intakeYear: integer("intake_year"),
    basis: commissionBasis("basis").notNull().default("PERCENT_TUITION"),
    percentOfTuition: real("percent_of_tuition"),
    flatAmount: integer("flat_amount"),
    currency: text("currency").notNull().default("INR"),
    partnerSharePercent: real("partner_share_percent").notNull().default(50),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("commission_rules_scope_idx").on(t.universityId, t.programId)],
);

/** One row per application that reached a paying milestone. */
export const commissions = pgTable(
  "commissions",
  {
    id: id(),
    applicationId: text("application_id")
      .notNull()
      .unique()
      .references(() => applications.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    ruleId: text("rule_id").references(() => commissionRules.id),
    currency: text("currency").notNull().default("INR"),
    grossAmount: integer("gross_amount").notNull(),
    partnerAmount: integer("partner_amount").notNull(),
    partnerAmountInr: integer("partner_amount_inr"),
    status: commissionStatus("status").notNull().default("EXPECTED"),
    invoiceRef: text("invoice_ref"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("commissions_org_idx").on(t.orgId, t.status)],
);

/** The partner's running account with Medcity, in rupees. Credits are positive. */
export const walletEntries = pgTable(
  "wallet_entries",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: walletEntryKind("kind").notNull(),
    amountInr: integer("amount_inr").notNull(),
    commissionId: text("commission_id").references(() => commissions.id),
    payoutId: text("payout_id"),
    reference: text("reference"),
    note: text("note"),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("wallet_entries_org_idx").on(t.orgId, t.createdAt)],
);

export const payoutRequests = pgTable(
  "payout_requests",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    amountInr: integer("amount_inr").notNull(),
    status: payoutStatus("status").notNull().default("REQUESTED"),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => users.id),
    decidedById: text("decided_by_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reference: text("reference"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("payout_requests_org_idx").on(t.orgId, t.status)],
);

// ---------- Learning resources ----------

/**
 * The shared library: guides, templates, policies and training material.
 * A resource is either an uploaded file or a link, visible to the roles
 * listed in audience.
 */
export const resources = pgTable(
  "resources",
  {
    id: id(),
    title: text("title").notNull(),
    summary: text("summary"),
    kind: resourceKind("kind").notNull().default("GUIDE"),
    audience: text("audience").array().notNull().default(sql`'{}'::text[]`),
    pathway: pathway("pathway"),
    countryId: text("country_id").references(() => countries.id),
    url: text("url"),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    published: boolean("published").notNull().default(true),
    pinned: boolean("pinned").notNull().default(false),
    downloads: integer("downloads").notNull().default(0),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resources_kind_idx").on(t.kind, t.published)],
);

// ---------- Enquiries ----------

export const enquiries = pgTable(
  "enquiries",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    assignedToId: text("assigned_to_id").references(() => users.id),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    city: text("city"),
    source: enquirySource("source").notNull().default("WALK_IN"),
    stage: enquiryStage("stage").notNull().default("NEW"),
    interestCountry: text("interest_country"),
    interestPathway: pathway("interest_pathway"),
    intakeMonth: integer("intake_month"),
    intakeYear: integer("intake_year"),
    budgetLakhs: real("budget_lakhs"),
    notes: text("notes"),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    studentId: text("student_id").references(() => students.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("enquiries_org_idx").on(t.orgId, t.stage), index("enquiries_follow_up_idx").on(t.nextFollowUpAt)],
);

/** One row per contact attempt, so the follow-up history is never overwritten. */
export const enquiryNotes = pgTable(
  "enquiry_notes",
  {
    id: id(),
    enquiryId: text("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id),
    body: text("body").notNull(),
    stageAfter: enquiryStage("stage_after"),
    createdAt: createdAt(),
  },
  (t) => [index("enquiry_notes_idx").on(t.enquiryId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(), // e.g. student.reassign, passport.reveal
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);

// ---------- Relations ----------

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  users: many(users),
  students: many(students),
  applications: many(applications),
  relationshipManager: one(users, {
    fields: [organizations.relationshipManagerId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  org: one(organizations, { fields: [users.orgId], references: [organizations.id] }),
}));

export const countriesRelations = relations(countries, ({ many }) => ({
  universities: many(universities),
}));

export const universitiesRelations = relations(universities, ({ one, many }) => ({
  country: one(countries, { fields: [universities.countryId], references: [countries.id] }),
  programs: many(programs),
}));

export const programsRelations = relations(programs, ({ one, many }) => ({
  university: one(universities, { fields: [programs.universityId], references: [universities.id] }),
  applications: many(applications),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  org: one(organizations, { fields: [students.orgId], references: [organizations.id] }),
  assignedTo: one(users, { fields: [students.assignedToId], references: [users.id] }),
  createdBy: one(users, { fields: [students.createdById], references: [users.id] }),
  academics: many(academicRecords),
  tests: many(testScores),
  work: many(workExperience),
  applications: many(applications),
  documents: many(documents),
  editRequests: many(editRequests),
}));

export const academicRecordsRelations = relations(academicRecords, ({ one }) => ({
  student: one(students, { fields: [academicRecords.studentId], references: [students.id] }),
}));
export const testScoresRelations = relations(testScores, ({ one }) => ({
  student: one(students, { fields: [testScores.studentId], references: [students.id] }),
}));
export const workExperienceRelations = relations(workExperience, ({ one }) => ({
  student: one(students, { fields: [workExperience.studentId], references: [students.id] }),
}));
export const editRequestsRelations = relations(editRequests, ({ one }) => ({
  student: one(students, { fields: [editRequests.studentId], references: [students.id] }),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  student: one(students, { fields: [applications.studentId], references: [students.id] }),
  program: one(programs, { fields: [applications.programId], references: [programs.id] }),
  org: one(organizations, { fields: [applications.orgId], references: [organizations.id] }),
  status: one(statusDefinitions, { fields: [applications.statusId], references: [statusDefinitions.id] }),
  officer: one(users, { fields: [applications.officerId], references: [users.id] }),
  createdBy: one(users, { fields: [applications.createdById], references: [users.id] }),
  history: many(statusHistory),
  comments: many(comments),
  documents: many(documents),
}));

export const statusHistoryRelations = relations(statusHistory, ({ one }) => ({
  application: one(applications, { fields: [statusHistory.applicationId], references: [applications.id] }),
  fromStatus: one(statusDefinitions, {
    fields: [statusHistory.fromStatusId],
    references: [statusDefinitions.id],
  }),
  toStatus: one(statusDefinitions, {
    fields: [statusHistory.toStatusId],
    references: [statusDefinitions.id],
  }),
  changedBy: one(users, { fields: [statusHistory.changedById], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  application: one(applications, { fields: [comments.applicationId], references: [applications.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  attachments: many(documents),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  student: one(students, { fields: [documents.studentId], references: [students.id] }),
  application: one(applications, { fields: [documents.applicationId], references: [applications.id] }),
  comment: one(comments, { fields: [documents.commentId], references: [comments.id] }),
  type: one(documentTypes, { fields: [documents.typeCode], references: [documentTypes.code] }),
  uploadedBy: one(users, { fields: [documents.uploadedById], references: [users.id] }),
}));

export const resourcesRelations = relations(resources, ({ one }) => ({
  country: one(countries, { fields: [resources.countryId], references: [countries.id] }),
  createdBy: one(users, { fields: [resources.createdById], references: [users.id] }),
}));

export const commissionsRelations = relations(commissions, ({ one }) => ({
  application: one(applications, { fields: [commissions.applicationId], references: [applications.id] }),
  org: one(organizations, { fields: [commissions.orgId], references: [organizations.id] }),
  rule: one(commissionRules, { fields: [commissions.ruleId], references: [commissionRules.id] }),
}));

export const commissionRulesRelations = relations(commissionRules, ({ one, many }) => ({
  country: one(countries, { fields: [commissionRules.countryId], references: [countries.id] }),
  university: one(universities, { fields: [commissionRules.universityId], references: [universities.id] }),
  program: one(programs, { fields: [commissionRules.programId], references: [programs.id] }),
  commissions: many(commissions),
}));

export const walletEntriesRelations = relations(walletEntries, ({ one }) => ({
  org: one(organizations, { fields: [walletEntries.orgId], references: [organizations.id] }),
  commission: one(commissions, { fields: [walletEntries.commissionId], references: [commissions.id] }),
  createdBy: one(users, { fields: [walletEntries.createdById], references: [users.id] }),
}));

export const payoutRequestsRelations = relations(payoutRequests, ({ one }) => ({
  org: one(organizations, { fields: [payoutRequests.orgId], references: [organizations.id] }),
  requestedBy: one(users, { fields: [payoutRequests.requestedById], references: [users.id] }),
  decidedBy: one(users, { fields: [payoutRequests.decidedById], references: [users.id], relationName: "payoutDecider" }),
}));

export const enquiriesRelations = relations(enquiries, ({ one, many }) => ({
  org: one(organizations, { fields: [enquiries.orgId], references: [organizations.id] }),
  assignedTo: one(users, { fields: [enquiries.assignedToId], references: [users.id] }),
  createdBy: one(users, { fields: [enquiries.createdById], references: [users.id], relationName: "enquiryCreator" }),
  student: one(students, { fields: [enquiries.studentId], references: [students.id] }),
  notes: many(enquiryNotes),
}));

export const enquiryNotesRelations = relations(enquiryNotes, ({ one }) => ({
  enquiry: one(enquiries, { fields: [enquiryNotes.enquiryId], references: [enquiries.id] }),
  author: one(users, { fields: [enquiryNotes.authorId], references: [users.id] }),
}));

export type Role = (typeof role.enumValues)[number];
export type Pathway = (typeof pathway.enumValues)[number];
export type StatusGroup = (typeof statusGroup.enumValues)[number];
export type EnquiryStage = (typeof enquiryStage.enumValues)[number];
export type EnquirySource = (typeof enquirySource.enumValues)[number];
export type CommissionStatus = (typeof commissionStatus.enumValues)[number];
export type WalletEntryKind = (typeof walletEntryKind.enumValues)[number];
export type PayoutStatus = (typeof payoutStatus.enumValues)[number];
export type ResourceKind = (typeof resourceKind.enumValues)[number];
