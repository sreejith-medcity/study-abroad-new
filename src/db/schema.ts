import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
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
  "CERTIFICATE",
]);
export const programStatus = pgEnum("program_status", ["DRAFT", "LIVE", "ARCHIVED"]);
/**
 * Whether a programme leads to post-study work rights in its own country.
 * This is the single thing Indian applicants ask about first, and getting it
 * wrong costs a student two years, so an unknown is recorded as unknown rather
 * than assumed eligible.
 */
export const workRights = pgEnum("work_rights", ["UNKNOWN", "ELIGIBLE", "INELIGIBLE"]);
export const statusGroup = pgEnum("status_group", [
  "NEW",
  "PENDING_PARTNER",
  "IN_PROGRESS",
  "OFFER",
  "SUCCESS",
  "HOLD",
  "CLOSED",
]);
export const offerType = pgEnum("offer_type", ["CONDITIONAL", "UNCONDITIONAL"]);
export const visaDecision = pgEnum("visa_decision", ["GRANTED", "REFUSED"]);
export const serviceType = pgEnum("service_type", ["EDUCATION_LOAN", "FOREX", "ACCOMMODATION", "INSURANCE", "FLIGHT", "OTHER"]);
export const serviceStatus = pgEnum("service_status", ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"]);
export const eventKind = pgEnum("event_kind", ["WEBINAR", "UNIVERSITY_VISIT", "TRAINING", "FAIR"]);
export const applicationPriority = pgEnum("application_priority", ["HIGH", "NORMAL", "LOW"]);
export const ticketCategory = pgEnum("ticket_category", ["APPLICATION", "COMMISSION", "CATALOGUE", "ACCESS", "OTHER"]);
export const ticketStatus = pgEnum("ticket_status", ["OPEN", "WAITING_PARTNER", "RESOLVED"]);
export const optionsStatus = pgEnum("options_status", ["REQUESTED", "OPTIONS_SENT", "APPLIED"]);
export const bulletinKind = pgEnum("bulletin_kind", ["UPDATE", "ANNOUNCEMENT", "WHATS_NEW"]);
export const deadlineType = pgEnum("deadline_type", ["APPLICATION", "PAYMENT", "CAS_REQUEST", "OFFER_ACCEPTANCE", "GS_SUBMISSION", "ENROLMENT", "VISA", "COURSE_START", "OTHER"]);
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

export type SignupQuestion = { id: string; label: string; kind: "text" | "choice" | "yesno"; options: string[]; required: boolean };

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
  addressLine: text("address_line"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  relationshipManagerId: text("relationship_manager_id"),
  /** The owner decides whether counsellors see commission figures and the wallet. */
  counsellorsSeeCommission: boolean("counsellors_see_commission").notNull().default(true),
  /** How the branch's students see the portal and the branch form. */
  portalName: text("portal_name"),
  portalColor: text("portal_color"),
  portalLogoKey: text("portal_logo_key"),
  portalLogoMimeType: text("portal_logo_mime_type"),
  /** WhatsApp messages the branch's students get: status milestones and team messages. */
  studentWhatsappMilestones: boolean("student_whatsapp_milestones").notNull().default(true),
  studentWhatsappMessages: boolean("student_whatsapp_messages").notNull().default(true),
  /** Extra questions on the branch's public enquiry form. */
  signupQuestions: jsonb("signup_questions").$type<SignupQuestion[]>().notNull().default(sql`'[]'::jsonb`),
  /** The branch's own test preparation page, at /prep/<public slug>. */
  prepPageEnabled: boolean("prep_page_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** The legal entities a partner invoices Medcity from, up to four. */
export const billingCompanies = pgTable(
  "billing_companies",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    legalName: text("legal_name").notNull(),
    address: text("address").notNull(),
    state: text("state").notNull(),
    pan: text("pan").notNull(),
    gstin: text("gstin"),
    lutNumber: text("lut_number"),
    lutValidUntil: date("lut_valid_until"),
    bankAccountName: text("bank_account_name").notNull(),
    bankAccountNumber: text("bank_account_number").notNull(),
    ifsc: text("ifsc").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("billing_companies_org_idx").on(t.orgId)],
);

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
    /** Raised to end every signed-in session for this account at once. */
    sessionVersion: integer("session_version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    // When this person last opened What's New, so newer items can be flagged.
    whatsNewSeenAt: timestamp("whats_new_seen_at", { withTimezone: true }),
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
  // What a student must show for living costs in the first year of a student
  // visa, as the government states it, in the local currency, with its wording
  // and the page it came from. Null where there is no single national figure.
  visaLivingFunds: integer("visa_living_funds"),
  visaLivingNote: text("visa_living_note"),
  visaLivingSource: text("visa_living_source"),
  visaLivingChecked: date("visa_living_checked"),
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
    website: text("website"),
    // The register's own identifier, a CRICOS provider code for Australia.
    externalCode: text("external_code"),
    // Rankings as published ("154", "=154", "601-650"), with the edition year.
    qsRank: text("qs_rank"),
    qsYear: integer("qs_year"),
    theRank: text("the_rank"),
    theYear: integer("the_year"),
    // The best position either ranking gives, for sorting: the top of a band.
    rankSort: integer("rank_sort"),
  },
  (t) => [uniqueIndex("universities_name_country_uq").on(t.name, t.countryId), uniqueIndex("universities_external_code_uq").on(t.externalCode)],
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
    // The campus that teaches this program. A university's own city is not
    // enough: Mohawk runs one program in Hamilton with PGWP and another in
    // Mississauga without it, and the two must never be confused.
    campus: text("campus"),
    level: studyLevel("level").notNull(),
    studyArea: text("study_area"),
    durationMonths: integer("duration_months"),
    tuitionPerYear: integer("tuition_per_year"),
    // Some registers publish the fee for the whole course rather than per year
    // (Australia's CRICOS does). It is kept as published, never divided into a
    // yearly figure the institution did not state.
    tuitionTotal: integer("tuition_total"),
    // Null means nobody has verified the fee yet. Zero means the institution
    // states there is no fee. The two must never be confused.
    applicationFee: integer("application_fee"),
    initialDeposit: integer("initial_deposit"),
    intakeMonths: integer("intake_months").array().notNull().default(sql`'{}'::integer[]`),
    // Structured requirements: used by the pre-submission check and eligibility search
    minIelts: real("min_ielts"),
    minPte: integer("min_pte"),
    minOetGrade: text("min_oet_grade"),
    minGermanLevel: text("min_german_level"),
    // More English tests an institution may accept instead of IELTS or PTE.
    minToefl: integer("min_toefl"),
    minDuolingo: integer("min_duolingo"),
    // Admission tests, only where the institution requires them.
    minGre: integer("min_gre"),
    minGmat: integer("min_gmat"),
    minSat: integer("min_sat"),
    // Minimum marks in the qualifying study, as a percentage: Std. 12th for a
    // bachelor's or diploma, the bachelor's for a master's, the master's for a PhD.
    minAcademicPercent: real("min_academic_percent"),
    maxBacklogs: integer("max_backlogs"),
    maxGapYears: integer("max_gap_years"),
    moiAccepted: boolean("moi_accepted").notNull().default(false),
    // Set only when a waiver is confirmed, in the words of whoever confirmed it
    // ("Waived for Medcity applicants until 30 June"). Null means none on record.
    feeWaiver: text("fee_waiver"),
    // The institution's own page for this program.
    programUrl: text("program_url"),
    // The lowest band IELTS accepts in any one skill, alongside the overall.
    minIeltsBand: real("min_ielts_band"),
    // Entry requirements in the institution's words, for what the fields cannot hold.
    entryRequirements: text("entry_requirements"),
    // Paid after the deposit to confirm a place, where the institution splits it.
    balanceDeposit: integer("balance_deposit"),
    // A typical scholarship, as the institution words it ("Up to 20% of tuition").
    typicalScholarship: text("typical_scholarship"),
    // Curated labels partners filter by (see PROGRAM_TAGS): faster offers, no interview, STEM...
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Post-study work: PGWP in Canada, STEM OPT in the US, the Graduate Route in
    // the UK. The note carries the institution's own wording, so a counsellor can
    // see why the flag says what it says.
    workRights: workRights("work_rights").notNull().default("UNKNOWN"),
    workRightsNote: text("work_rights_note"),
    // Where the row came from, and its code there (a CRICOS course code), so a
    // later release of the same register updates rows instead of duplicating them.
    source: text("source"),
    externalCode: text("external_code"),
    requiredDocs: text("required_docs").array().notNull().default(sql`'{}'::text[]`),
    status: programStatus("status").notNull().default("LIVE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("programs_name_idx").on(t.name), uniqueIndex("programs_external_code_uq").on(t.externalCode), index("programs_university_idx").on(t.universityId)],
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
    // Where letters reach the student now, when that is not the permanent address.
    mailingSameAsPermanent: boolean("mailing_same_as_permanent").notNull().default(true),
    mailingAddress: text("mailing_address"),
    otherCitizenship: text("other_citizenship"),
    livingInCountry: text("living_in_country"),
    /** Answers to the background questions institutions ask, keyed by question. */
    background: jsonb("background").$type<Record<string, { answer: boolean; details: string | null }>>().notNull().default(sql`'{}'::jsonb`),

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

/** Parents, guardians and emergency contacts. */
export const studentContacts = pgTable("student_contacts", {
  id: id(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  emergency: boolean("emergency").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("student_contacts_student_idx").on(t.studentId)]);

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

// ---------- Shortlist ----------

/**
 * Programs a counsellor is weighing up for one student, before any application
 * exists. Cheap to add and remove, and compared side by side on the student file.
 */
export const shortlists = pgTable(
  "shortlists",
  {
    id: id(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    programId: text("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    addedById: text("added_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("shortlists_student_program_uq").on(t.studentId, t.programId)],
);

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
    priority: applicationPriority("priority").notNull().default("NORMAL"),
    // The offer, as the institution issued it.
    offerType: offerType("offer_type"),
    offerDate: date("offer_date"),
    offerConditions: text("offer_conditions"),
    offerAcceptBy: date("offer_accept_by"),
    // Tuition deposit paid to secure the place, in the program's currency.
    depositAmount: integer("deposit_amount"),
    depositPaidOn: date("deposit_paid_on"),
    // The document the visa rests on: CAS (UK), I-20 (US), CoE (Australia), LOA (Canada).
    confirmationNumber: text("confirmation_number"),
    confirmationIssuedOn: date("confirmation_issued_on"),
    visaLodgedOn: date("visa_lodged_on"),
    visaDecision: visaDecision("visa_decision"),
    visaDecisionOn: date("visa_decision_on"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("applications_org_idx").on(t.orgId), index("applications_status_idx").on(t.statusId)],
);

/** Dated milestones on one application: pay by, request the CAS by, accept the offer by. */
export const applicationDeadlines = pgTable(
  "application_deadlines",
  {
    id: id(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: deadlineType("type").notNull(),
    dueOn: date("due_on").notNull(),
    note: text("note"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("application_deadlines_due_idx").on(t.dueOn), index("application_deadlines_app_idx").on(t.applicationId)],
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
  /** What a good one looks like, in the team's words; shown next to the upload. */
  guidance: text("guidance"),
  sampleFileName: text("sample_file_name"),
  sampleStorageKey: text("sample_storage_key"),
  sampleMimeType: text("sample_mime_type"),
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
  /** Shown in the student's portal. Files the student uploaded are always theirs to see. */
  sharedWithStudent: boolean("shared_with_student").notNull().default(false),
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
    billingCompanyId: text("billing_company_id").references(() => billingCompanies.id),
    createdAt: createdAt(),
  },
  (t) => [index("payout_requests_org_idx").on(t.orgId, t.status)],
);

// ---------- Settings ----------

/**
 * One row, id "app". Everything here used to be a constant in the code:
 * keeping it in the database means the team can change how the portal behaves
 * without a deploy, and the audit log records who changed what.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("app"),

  // What the portal calls itself, and how it looks
  portalName: text("portal_name").notNull().default("Medcity Overseas"),
  organisationName: text("organisation_name").notNull().default("Medcity International Overseas Corporation"),
  // The four brand colours: crimson, maroon, yellow and blue.
  brandColor: text("brand_color").notNull().default("#c01f53"),
  deepColor: text("deep_color").notNull().default("#631a33"),
  accentColor: text("accent_color").notNull().default("#f7ec22"),
  infoColor: text("info_color").notNull().default("#0466af"),
  // Uploaded artwork, served through /api/brand. Null falls back to the drawn mark.
  logoKey: text("logo_key"),
  logoMimeType: text("logo_mime_type"),
  faviconKey: text("favicon_key"),
  faviconMimeType: text("favicon_mime_type"),
  signInHeadline: text("sign_in_headline").notNull().default("The workspace behind every Medcity student going abroad."),
  signInPoints: text("sign_in_points").array().notNull().default(sql`'{}'::text[]`),

  // How long work may sit in each lane before it counts as late
  slaNewDays: integer("sla_new_days").notNull().default(2),
  slaPendingPartnerDays: integer("sla_pending_partner_days").notNull().default(5),
  slaInProgressDays: integer("sla_in_progress_days").notNull().default(7),
  slaOfferDays: integer("sla_offer_days").notNull().default(10),
  slaHoldDays: integer("sla_hold_days").notNull().default(60),

  // Partner tiers: visas in the last twelve months needed for each level
  tierTargets: jsonb("tier_targets").notNull().default(sql`'{"SILVER":10,"GOLD":20,"ELITE":50,"PLATINUM":50}'::jsonb`),

  // Enquiries
  followUpDays: integer("follow_up_days").notNull().default(1),
  enquiryStaleDays: integer("enquiry_stale_days").notNull().default(30),

  // Money: indicative rates, overwritten by the real figure at settlement
  fxRates: jsonb("fx_rates").notNull().default(sql`'{"GBP":112,"EUR":96,"AUD":58,"CAD":62,"USD":88}'::jsonb`),

  // Who a partner or student should contact
  supportEmail: text("support_email"),
  supportPhone: text("support_phone"),
  supportHours: text("support_hours"),

  updatedById: text("updated_by_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every sign in, successful or not: the security tab and the audit log read this. */
export const signInEvents = pgTable(
  "sign_in_events",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    outcome: text("outcome").notNull(), // success | wrong_password | unknown_email | inactive | throttled
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sign_in_events_user_idx").on(t.userId, t.createdAt)],
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

// ---------- Scholarships ----------

/**
 * Scholarships the Overseas team has verified on an institution's own page.
 * The amount is kept as the institution words it ("20% of first-year
 * tuition", "CAD 5,000"), and every entry carries the page it came from.
 */
export const scholarships = pgTable(
  "scholarships",
  {
    id: id(),
    universityId: text("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: text("amount").notNull(),
    // Empty means every level the university teaches.
    levels: studyLevel("levels").array().notNull().default(sql`'{}'`),
    eligibility: text("eligibility"),
    deadline: date("deadline"),
    url: text("url").notNull(),
    active: boolean("active").notNull().default(true),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scholarships_university_idx").on(t.universityId)],
);

/**
 * The last day to apply for one intake of one program, as the institution
 * publishes it. Kept per intake and year because deadlines move every cycle.
 */
export const programDeadlines = pgTable(
  "program_deadlines",
  {
    id: id(),
    programId: text("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    intakeMonth: integer("intake_month").notNull(),
    intakeYear: integer("intake_year").notNull(),
    deadline: date("deadline").notNull(),
    note: text("note"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("program_deadlines_intake_uq").on(t.programId, t.intakeYear, t.intakeMonth), index("program_deadlines_deadline_idx").on(t.deadline)],
);

/**
 * Help a student needs around the application: an education loan, forex,
 * accommodation, insurance, flights. A partner asks; the Overseas team works
 * it with a provider and records where it stands.
 */
export const serviceRequests = pgTable(
  "service_requests",
  {
    id: id(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    type: serviceType("type").notNull(),
    status: serviceStatus("status").notNull().default("NEW"),
    details: text("details").notNull(),
    provider: text("provider"),
    teamNote: text("team_note"),
    requestedById: text("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("service_requests_student_idx").on(t.studentId), index("service_requests_status_idx").on(t.status)],
);

/**
 * Webinars, university delegate visits, training sessions and fairs the
 * Overseas team runs for partners, some open to their students too.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    title: text("title").notNull(),
    kind: eventKind("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // Either a place (city and venue) or a link, or both for a hybrid session.
    location: text("location"),
    joinUrl: text("join_url"),
    universityId: text("university_id").references(() => universities.id, { onDelete: "set null" }),
    description: text("description"),
    openToStudents: boolean("open_to_students").notNull().default(false),
    capacity: integer("capacity"),
    published: boolean("published").notNull().default(true),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("events_starts_idx").on(t.startsAt)],
);

/** Who is coming: a partner's own seat (no student), or a student they registered. */
export const eventRegistrations = pgTable(
  "event_registrations",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: text("student_id").references(() => students.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("event_registrations_self_uq").on(t.eventId, t.userId).where(sql`${t.studentId} is null`),
    uniqueIndex("event_registrations_student_uq").on(t.eventId, t.studentId).where(sql`${t.studentId} is not null`),
  ],
);

/**
 * A partner's question to the Overseas team that is not about one student's
 * file: a commission query, a login problem, a catalogue correction.
 */
export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    raisedById: text("raised_by_id").references(() => users.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    category: ticketCategory("category").notNull(),
    status: ticketStatus("status").notNull().default("OPEN"),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("tickets_org_idx").on(t.orgId), index("tickets_status_idx").on(t.status)],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId)],
);

/**
 * A short course for partner staff: reading from the learning library, then a
 * quiz. Passing earns a certificate the branch can print.
 */
export const trainingCourses = pgTable("training_courses", {
  id: id(),
  title: text("title").notNull(),
  description: text("description"),
  // Learning-library items to read before the quiz, in order.
  resourceIds: text("resource_ids").array().notNull().default(sql`'{}'::text[]`),
  passMark: integer("pass_mark").notNull().default(70),
  published: boolean("published").notNull().default(false),
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const trainingQuestions = pgTable(
  "training_questions",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    options: text("options").array().notNull(),
    correctIndex: integer("correct_index").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("training_questions_course_idx").on(t.courseId)],
);

export const trainingAttempts = pgTable(
  "training_attempts",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    passed: boolean("passed").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("training_attempts_user_idx").on(t.userId, t.courseId)],
);

/**
 * A partner asks the Overseas team which programs suit a student; the team
 * answers with a list the partner can shortlist or apply to. The student may
 * not have a file yet, so the request carries enough of the profile to answer.
 */
export const optionRequests = pgTable(
  "option_requests",
  {
    id: id(),
    requestNo: text("request_no").notNull().unique(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    requestedById: text("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    studentId: text("student_id").references(() => students.id, { onDelete: "set null" }),
    studentName: text("student_name").notNull(),
    educationCountry: text("education_country"),
    highestLevel: text("highest_level"),
    destinations: text("destinations").array().notNull().default(sql`'{}'::text[]`),
    studyLevels: text("study_levels").array().notNull().default(sql`'{}'::text[]`),
    studyAreas: text("study_areas").array().notNull().default(sql`'{}'::text[]`),
    additionalInfo: text("additional_info"),
    status: optionsStatus("status").notNull().default("REQUESTED"),
    archived: boolean("archived").notNull().default(false),
    assignedToId: text("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("option_requests_org_idx").on(t.orgId)],
);

export const optionRequestPrograms = pgTable(
  "option_request_programs",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => optionRequests.id, { onDelete: "cascade" }),
    programId: text("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("option_request_programs_uq").on(t.requestId, t.programId)],
);

export const optionRequestFiles = pgTable("option_request_files", {
  id: id(),
  requestId: text("request_id")
    .notNull()
    .references(() => optionRequests.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const optionRequestMessages = pgTable("option_request_messages", {
  id: id(),
  requestId: text("request_id")
    .notNull()
    .references(() => optionRequests.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/**
 * What the Overseas team tells partners: important updates from institutions
 * and governments (tagged by country, university and intake), announcements
 * with an action, and What's New in the portal itself.
 */
export const bulletins = pgTable(
  "bulletins",
  {
    id: id(),
    kind: bulletinKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
    universityId: text("university_id").references(() => universities.id, { onDelete: "set null" }),
    intakes: text("intakes"),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    published: boolean("published").notNull().default(true),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("bulletins_kind_idx").on(t.kind, t.createdAt)],
);

/** The Overseas team's people partners may call, grouped by what they handle. */
export const teamContacts = pgTable("team_contacts", {
  id: id(),
  area: text("area").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  phone: text("phone"),
  email: text("email"),
  whatsapp: boolean("whatsapp").notNull().default(false),
  /** 1 is the first call; higher levels are where to escalate. */
  level: integer("level").notNull().default(1),
  hours: text("hours"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: createdAt(),
});

/** Incentive schemes for partners, with the dates they run and their terms. */
export const promotions = pgTable(
  "promotions",
  {
    id: id(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    terms: text("terms").notNull(),
    countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    published: boolean("published").notNull().default(true),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("promotions_dates_idx").on(t.endsOn)],
);

/** Test preparation courses Medcity runs, offered on each branch's own prep page. */
export const prepCourses = pgTable("prep_courses", {
  id: id(),
  test: text("test").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  mode: text("mode").notNull(),
  durationWeeks: integer("duration_weeks"),
  feeInr: integer("fee_inr"),
  published: boolean("published").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: createdAt(),
});

/** Links partners use often: institution portals, embassy pages, forms. */
export const quickLinks = pgTable("quick_links", {
  id: id(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: createdAt(),
});

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
    /** Answers to the branch's own questions, with each question as it was asked. */
    answers: jsonb("answers").$type<{ question: string; answer: string }[]>().notNull().default(sql`'[]'::jsonb`),
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
  scholarships: many(scholarships),
}));

export const scholarshipsRelations = relations(scholarships, ({ one }) => ({
  university: one(universities, { fields: [scholarships.universityId], references: [universities.id] }),
}));

export const programsRelations = relations(programs, ({ one, many }) => ({
  university: one(universities, { fields: [programs.universityId], references: [universities.id] }),
  applications: many(applications),
  deadlines: many(programDeadlines),
}));

export const serviceRequestsRelations = relations(serviceRequests, ({ one }) => ({
  student: one(students, { fields: [serviceRequests.studentId], references: [students.id] }),
  org: one(organizations, { fields: [serviceRequests.orgId], references: [organizations.id] }),
  requestedBy: one(users, { fields: [serviceRequests.requestedById], references: [users.id], relationName: "serviceRequester" }),
  owner: one(users, { fields: [serviceRequests.ownerId], references: [users.id], relationName: "serviceOwner" }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  university: one(universities, { fields: [events.universityId], references: [universities.id] }),
  registrations: many(eventRegistrations),
}));

export const eventRegistrationsRelations = relations(eventRegistrations, ({ one }) => ({
  event: one(events, { fields: [eventRegistrations.eventId], references: [events.id] }),
  user: one(users, { fields: [eventRegistrations.userId], references: [users.id] }),
  student: one(students, { fields: [eventRegistrations.studentId], references: [students.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  org: one(organizations, { fields: [tickets.orgId], references: [organizations.id] }),
  raisedBy: one(users, { fields: [tickets.raisedById], references: [users.id], relationName: "ticketRaiser" }),
  owner: one(users, { fields: [tickets.ownerId], references: [users.id], relationName: "ticketOwner" }),
  messages: many(ticketMessages),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketMessages.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketMessages.authorId], references: [users.id] }),
}));

export const trainingCoursesRelations = relations(trainingCourses, ({ many }) => ({
  questions: many(trainingQuestions),
  attempts: many(trainingAttempts),
}));

export const trainingQuestionsRelations = relations(trainingQuestions, ({ one }) => ({
  course: one(trainingCourses, { fields: [trainingQuestions.courseId], references: [trainingCourses.id] }),
}));

export const trainingAttemptsRelations = relations(trainingAttempts, ({ one }) => ({
  course: one(trainingCourses, { fields: [trainingAttempts.courseId], references: [trainingCourses.id] }),
  user: one(users, { fields: [trainingAttempts.userId], references: [users.id] }),
}));

export const optionRequestsRelations = relations(optionRequests, ({ one, many }) => ({
  org: one(organizations, { fields: [optionRequests.orgId], references: [organizations.id] }),
  requestedBy: one(users, { fields: [optionRequests.requestedById], references: [users.id], relationName: "optionRequester" }),
  assignedTo: one(users, { fields: [optionRequests.assignedToId], references: [users.id], relationName: "optionAssignee" }),
  student: one(students, { fields: [optionRequests.studentId], references: [students.id] }),
  programs: many(optionRequestPrograms),
  files: many(optionRequestFiles),
  messages: many(optionRequestMessages),
}));

export const optionRequestProgramsRelations = relations(optionRequestPrograms, ({ one }) => ({
  request: one(optionRequests, { fields: [optionRequestPrograms.requestId], references: [optionRequests.id] }),
  program: one(programs, { fields: [optionRequestPrograms.programId], references: [programs.id] }),
}));

export const optionRequestFilesRelations = relations(optionRequestFiles, ({ one }) => ({
  request: one(optionRequests, { fields: [optionRequestFiles.requestId], references: [optionRequests.id] }),
}));

export const optionRequestMessagesRelations = relations(optionRequestMessages, ({ one }) => ({
  request: one(optionRequests, { fields: [optionRequestMessages.requestId], references: [optionRequests.id] }),
  author: one(users, { fields: [optionRequestMessages.authorId], references: [users.id] }),
}));

export const bulletinsRelations = relations(bulletins, ({ one }) => ({
  university: one(universities, { fields: [bulletins.universityId], references: [universities.id] }),
  createdBy: one(users, { fields: [bulletins.createdById], references: [users.id] }),
}));

export const applicationDeadlinesRelations = relations(applicationDeadlines, ({ one }) => ({
  application: one(applications, { fields: [applicationDeadlines.applicationId], references: [applications.id] }),
}));

export const programDeadlinesRelations = relations(programDeadlines, ({ one }) => ({
  program: one(programs, { fields: [programDeadlines.programId], references: [programs.id] }),
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
  shortlist: many(shortlists),
}));

export const shortlistsRelations = relations(shortlists, ({ one }) => ({
  student: one(students, { fields: [shortlists.studentId], references: [students.id] }),
  program: one(programs, { fields: [shortlists.programId], references: [programs.id] }),
  addedBy: one(users, { fields: [shortlists.addedById], references: [users.id] }),
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
  deadlines: many(applicationDeadlines),
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
export type AppSettings = typeof appSettings.$inferSelect;
