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
export const role = pgEnum("role", ["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR", "STUDENT", "SUPER_ADMIN"]);
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

// ---------- Organisation and users ----------

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  type: orgType("type").notNull(),
  tier: tier("tier").notNull().default("SILVER"),
  city: text("city"),
  counsellorSeats: integer("counsellor_seats").notNull().default(3),
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

export type Role = (typeof role.enumValues)[number];
export type Pathway = (typeof pathway.enumValues)[number];
export type StatusGroup = (typeof statusGroup.enumValues)[number];
