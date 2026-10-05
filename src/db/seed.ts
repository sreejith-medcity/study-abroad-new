/* Sample data for local development. Every person, university and figure here is fictional. */
import "dotenv/config";
import { BACKGROUND_QUESTIONS } from "../lib/background";
import { branchCodeFrom, formatStudentId } from "../lib/medcity-id";
import { AGENT_CONSENT } from "../lib/agents";
import { LIVING_FUNDS } from "./living-funds";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { DOCUMENT_TYPES, STATUS_SEED } from "./statuses";
import { DOCUMENTATION_TYPES, REJECTION_REASONS, STAGE_REQUIREMENTS } from "./documentation-seed";
import { syncChecklist } from "./documentation-sync";
import { PARTNER_ROLES } from "@/lib/permissions";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

const PASSWORD = "Password@123";

async function main() {
  console.log("Resetting data...");
  await db.execute(sql`TRUNCATE resources, wallet_entries, payout_requests, commissions, commission_rules, enquiry_notes, enquiries, audit_logs, outbound_messages, notifications, documents, comments, status_history,
    applications, edit_requests, work_experience, test_scores, academic_records, students, programs, universities,
    countries, status_definitions, document_types, users, organizations RESTART IDENTITY CASCADE`);
  await db.execute(sql`DROP SEQUENCE IF EXISTS application_ack_seq`);
  await db.execute(sql`CREATE SEQUENCE application_ack_seq START 144401`);

  const hash = await bcrypt.hash(PASSWORD, 10);

  // Organisations
  const [hq] = await db.insert(schema.organizations).values({ idCode: "INT", name: "Medcity International Overseas Corporation", type: "HQ", tier: "PLATINUM", city: "Kochi", counsellorSeats: 50 }).returning();
  const [kottayam] = await db.insert(schema.organizations).values({ idCode: "KOT", name: "Medcity Kottayam", type: "BRANCH", tier: "ELITE", city: "Kottayam", counsellorSeats: 8 }).returning();
  const [kochi] = await db.insert(schema.organizations).values({ idCode: "KOC", name: "Medcity Kochi", type: "BRANCH", tier: "GOLD", city: "Kochi", counsellorSeats: 5 }).returning();
  const [thrissur] = await db.insert(schema.organizations).values({ idCode: "HOR", name: "Horizon Consultants, Thrissur", type: "SUB_AGENT", tier: "SILVER", city: "Thrissur", counsellorSeats: 3 }).returning();
  // The sub-agent sits under Kottayam, which is who recruited them.
  await db.update(schema.organizations).set({ parentOrgId: kottayam.id }).where(eq(schema.organizations.id, thrissur.id));

  // Users
  const u = async (name: string, email: string, role: schema.Role, orgId: string, deskLabel?: string, phone?: string) =>
    (await db.insert(schema.users).values({ name, email, role, orgId, deskLabel, phone, passwordHash: hash }).returning())[0];

  const superEmail = process.env.SUPER_ADMIN_EMAIL ?? "sreejith@miak.in";
  await u("Sreejith", superEmail, "SUPER_ADMIN", hq.id, "Platform owner");
  const admin = await u("Anita Menon", "admin@medcityoverseas.test", "ADMIN", hq.id, "UK Desk", "+91 90000 00001");
  const officerDe = await u("Rahul Nair", "germany.desk@medcityoverseas.test", "ADMIN", hq.id, "Germany Desk", "+91 90000 00002");
  const officerNurse = await u("Divya Pillai", "nursing.desk@medcityoverseas.test", "ADMIN", hq.id, "Nursing Desk", "+91 90000 00003");
  await u("Meera Thomas", "ops@medcityoverseas.test", "OPS_MANAGER", hq.id, "Operations", "+91 90000 00004");
  const docsTeam = await u("Nithin Jose", "documentation@medcityoverseas.test", "DOCUMENTATION", hq.id, "Documentation");
  await u("Management View", "management@medcityoverseas.test", "MANAGEMENT", hq.id);
  await u("Kottayam Branch Head", "kottayam@medcity.test", "PARTNER", kottayam.id);
  const ukDocs = await u("UK Documentation", "uk.docs@medcity.test", "COUNSELLOR", kottayam.id, "UK Documentation");
  const deDocs = await u("Germany Counsellor", "germany@medcity.test", "COUNSELLOR", kottayam.id, "Germany");
  const partnerKochi = await u("Kochi Branch Head", "kochi@medcity.test", "PARTNER", kochi.id);
  const partnerTsr = await u("Horizon Owner", "owner@horizon.test", "PARTNER", thrissur.id);

  await db.update(schema.organizations).set({ relationshipManagerId: admin.id }).where(sql`type <> 'HQ'`);
  // One branch with its public enquiry form open, so the QR panel has something to show.
  await db
    .update(schema.organizations)
    .set({ publicSlug: "kottayam-7bq4", publicFormEnabled: true })
    .where(eq(schema.organizations.id, kottayam.id));

  // Status dictionary
  const statusIds: Record<string, string> = {};
  for (const [pw, list] of Object.entries(STATUS_SEED)) {
    const rows = await db
      .insert(schema.statusDefinitions)
      .values(list.map((s, i) => ({ ...s, pathway: pw as schema.Pathway, sortOrder: (i + 1) * 10 })))
      .returning();
    for (const r of rows) statusIds[`${pw}.${r.code}`] = r.id;
  }
  await db.insert(schema.documentTypes).values([...DOCUMENT_TYPES, ...DOCUMENTATION_TYPES]);
  await db.insert(schema.rejectionReasons).values(REJECTION_REASONS.map((r, i) => ({ ...r, sortOrder: (i + 1) * 10 })));

  // Catalogue
  const countryRows = await db
    .insert(schema.countries)
    .values([
      { code: "GB", name: "United Kingdom", currency: "GBP" },
      { code: "IE", name: "Ireland", currency: "EUR" },
      { code: "AU", name: "Australia", currency: "AUD" },
      { code: "DE", name: "Germany", currency: "EUR" },
      { code: "MT", name: "Malta", currency: "EUR" },
      { code: "CA", name: "Canada", currency: "CAD" },
      // The rest of the destinations KC Overseas covers, so the catalogue can
      // carry them without a code change each time.
      { code: "US", name: "United States", currency: "USD" },
      { code: "NZ", name: "New Zealand", currency: "NZD" },
      { code: "NL", name: "Netherlands", currency: "EUR" },
      { code: "FR", name: "France", currency: "EUR" },
      { code: "IT", name: "Italy", currency: "EUR" },
      { code: "SE", name: "Sweden", currency: "SEK" },
      { code: "CH", name: "Switzerland", currency: "CHF" },
      { code: "FI", name: "Finland", currency: "EUR" },
      { code: "PT", name: "Portugal", currency: "EUR" },
      { code: "ES", name: "Spain", currency: "EUR" },
    ].map((c) => (LIVING_FUNDS[c.code] ? { ...c, visaLivingFunds: LIVING_FUNDS[c.code].amount, visaLivingNote: LIVING_FUNDS[c.code].note, visaLivingSource: LIVING_FUNDS[c.code].source, visaLivingChecked: "2026-09-22" } : c)))
    .returning();
  const c = Object.fromEntries(countryRows.map((r) => [r.code, r.id]));

  // The nine stage lists, and what each destination adds on top of them.
  await db.insert(schema.documentRequirements).values(
    STAGE_REQUIREMENTS.map((r, i) => ({
      stage: r.stage,
      typeCode: r.typeCode,
      source: r.country ? ("DESTINATION" as const) : ("ALWAYS" as const),
      countryId: r.country ? (c[r.country] ?? null) : null,
      required: r.required !== false,
      owedBy: r.owedBy ?? ("STUDENT" as const),
      validityMonths: r.validityMonths ?? null,
      guidance: r.guidance ?? null,
      sortOrder: (i + 1) * 10,
    })),
  );

  // Fictional people; the links are the governments' own pages.
  await db.insert(schema.teamContacts).values([
    { area: "UK admissions", name: "Sample Admissions Officer", title: "Admissions, United Kingdom", phone: "+91 90000 00001", email: "uk.admissions@medcityoverseas.test", whatsapp: true, level: 1, hours: "Mon to Sat, 9.30 to 6 IST" },
    { area: "UK admissions", name: "Sample Team Lead", title: "Head of admissions", phone: "+91 90000 00002", email: "admissions.lead@medcityoverseas.test", level: 2 },
  ]);
  await db.insert(schema.quickLinks).values([
    { label: "UK Student visa", url: "https://www.gov.uk/student-visa", note: "UKVI's own guidance", sortOrder: 10 },
    { label: "Australian Student visa (subclass 500)", url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500", note: "Department of Home Affairs", sortOrder: 20 },
  ]);

  const uni = async (name: string, city: string, code: string, isPublic = true) =>
    (await db.insert(schema.universities).values({ name, city, countryId: c[code], isPublic }).returning())[0];

  const westbridge = await uni("University of Westbridge", "Leeds", "GB");
  const northgate = await uni("Northgate University", "Birmingham", "GB");
  const galway = await uni("Atlantic Technological Institute", "Galway", "IE");
  const harbour = await uni("Harbour City University", "Sydney", "AU");
  const klinikum = await uni("Rhein-Main Klinikverbund (training partner)", "Frankfurt", "DE", false);
  const pflege = await uni("Bayern Pflegeschule Network", "Munich", "DE", false);
  const nmc = await uni("NHS Trust recruitment partner (sample)", "Manchester", "GB", false);
  const valletta = await uni("Valletta Institute of Arts", "Valletta", "MT");

  const baseDocs = ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"];
  const programRows = await db
    .insert(schema.programs)
    .values([
      { name: "BSc (Hons) Nursing (Adult)", universityId: westbridge.id, level: "UG", studyArea: "Nursing", durationMonths: 36, applicationFee: 0, tuitionPerYear: 19450, initialDeposit: 1000, intakeMonths: [1, 9], minIelts: 7, maxBacklogs: 5, maxGapYears: 5, requiredDocs: ["PASSPORT", "MARKSHEET_12", "ENGLISH_TEST", "SOP"] },
      { name: "MSc Nursing (Adult)", universityId: westbridge.id, level: "PG", studyArea: "Nursing", durationMonths: 24, applicationFee: 0, tuitionPerYear: 20950, initialDeposit: 1000, intakeMonths: [1, 9], minIelts: 7, maxBacklogs: 5, maxGapYears: 3, requiredDocs: baseDocs },
      { name: "MSc Digital Marketing", universityId: northgate.id, level: "PG", studyArea: "Business", durationMonths: 12, applicationFee: 0, tuitionPerYear: 16500, initialDeposit: 3000, intakeMonths: [1, 5, 9], minIelts: 6.5, minPte: 58, maxBacklogs: 8, maxGapYears: 5, moiAccepted: true, requiredDocs: baseDocs },
      { name: "MSc Artificial Intelligence", universityId: northgate.id, level: "PG", studyArea: "Computing", durationMonths: 16, applicationFee: 0, tuitionPerYear: 18900, initialDeposit: 4000, intakeMonths: [1, 9], minIelts: 6.5, minPte: 58, maxBacklogs: 5, maxGapYears: 3, requiredDocs: [...baseDocs, "LOR"] },
      { name: "MSc Computer Science: Adaptive Cybersecurity", universityId: galway.id, level: "PG", studyArea: "Computing", durationMonths: 12, tuitionPerYear: 17500, applicationFee: 50, intakeMonths: [9], minIelts: 6.5, maxBacklogs: 3, maxGapYears: 2, requiredDocs: [...baseDocs, "CV"] },
      { name: "Master of Nursing Practice (Pre-registration)", universityId: harbour.id, level: "PG", studyArea: "Nursing", durationMonths: 24, tuitionPerYear: 42000, applicationFee: 100, intakeMonths: [2, 7], minIelts: 7, maxBacklogs: 4, maxGapYears: 5, requiredDocs: [...baseDocs, "NURSING_LICENSE"] },
      { name: "Postgraduate Diploma in Beauty Therapy", universityId: valletta.id, level: "PG_DIPLOMA", studyArea: "Arts", durationMonths: 12, applicationFee: 0, tuitionPerYear: 9800, intakeMonths: [2, 10], minIelts: 5.5, moiAccepted: true, maxGapYears: 10, requiredDocs: ["PASSPORT", "MARKSHEET_12", "SOP"] },
      { name: "Ausbildung Pflegefachmann/-frau (Nursing)", universityId: klinikum.id, pathway: "AUSBILDUNG", level: "VOCATIONAL", studyArea: "Nursing", durationMonths: 36, applicationFee: 0, tuitionPerYear: 0, intakeMonths: [4, 10], minGermanLevel: "B1", maxGapYears: 10, requiredDocs: ["PASSPORT", "MARKSHEET_12", "GERMAN_CERTIFICATE", "CV"] },
      { name: "Ausbildung Kaufmann im Gesundheitswesen", universityId: pflege.id, pathway: "AUSBILDUNG", level: "VOCATIONAL", studyArea: "Healthcare admin", durationMonths: 36, applicationFee: 0, tuitionPerYear: 0, intakeMonths: [8], minGermanLevel: "B2", requiredDocs: ["PASSPORT", "MARKSHEET_12", "GERMAN_CERTIFICATE", "CV"] },
      { name: "Registered Nurse (NMC) international recruitment", universityId: nmc.id, pathway: "NURSING", level: "REGISTRATION", studyArea: "Nursing", durationMonths: 24, applicationFee: 0, tuitionPerYear: 0, intakeMonths: [1, 4, 7, 10], minOetGrade: "B", requiredDocs: ["PASSPORT", "DEGREE_CERTIFICATE", "NURSING_LICENSE", "ENGLISH_TEST", "CV"] },
    ])
    .returning();
  const prog = (name: string) => programRows.find((p) => p.name === name)!;

  // Students
  const uploads = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
  const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

  type StudentSeed = {
    first: string; last: string; org: typeof kottayam; assigned: typeof ukDocs; creator: typeof ukDocs;
    pathway: schema.Pathway; country: string; dob: string; passportExpiry: string; backlogs: number; gap: number;
    tests: { test: string; overall: string; isMock?: boolean; source?: string }[]; docs: string[];
    apps: { program: string; status: string; month: number; year: number; officer?: typeof admin; deadline?: string }[];
  };

  const seeds: StudentSeed[] = [
    { first: "Fathima", last: "Rahman", org: kottayam, assigned: ukDocs, creator: ukDocs, pathway: "DEGREE", country: "United Kingdom", dob: "2002-07-09", passportExpiry: "2027-02-14", backlogs: 2, gap: 2, tests: [{ test: "IELTS", overall: "7.0" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST"],
      apps: [{ program: "MSc Nursing (Adult)", status: "PENDING_PARTNER", month: 1, year: 2027, officer: admin }, { program: "BSc (Hons) Nursing (Adult)", status: "CASE_CLOSED", month: 9, year: 2026, officer: admin }] },
    { first: "Arathi", last: "Krishnan", org: kottayam, assigned: ukDocs, creator: ukDocs, pathway: "DEGREE", country: "Australia", dob: "1999-03-22", passportExpiry: "2032-05-01", backlogs: 0, gap: 3, tests: [{ test: "IELTS", overall: "7.5" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP", "NURSING_LICENSE"],
      apps: [{ program: "Master of Nursing Practice (Pre-registration)", status: "ON_HOLD_INTAKE", month: 2, year: 2027, officer: admin, deadline: "2026-10-21" }] },
    { first: "Jibin", last: "Thomas", org: kottayam, assigned: ukDocs, creator: ukDocs, pathway: "DEGREE", country: "United Kingdom", dob: "1998-11-02", passportExpiry: "2031-08-19", backlogs: 4, gap: 4, tests: [{ test: "PTE", overall: "61" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"],
      apps: [{ program: "MSc Digital Marketing", status: "CONDITIONAL_OFFER", month: 1, year: 2027, officer: admin }, { program: "MSc Artificial Intelligence", status: "SUBMITTED", month: 1, year: 2027, officer: admin }, { program: "MSc Artificial Intelligence", status: "CLOSED_NOT_QUALIFIED", month: 9, year: 2026, officer: admin }, { program: "MSc Digital Marketing", status: "ENROLLED", month: 9, year: 2026, officer: admin }] },
    { first: "Aswin", last: "Anil", org: kottayam, assigned: deDocs, creator: deDocs, pathway: "DEGREE", country: "Ireland", dob: "2000-01-15", passportExpiry: "2030-01-10", backlogs: 1, gap: 1, tests: [{ test: "IELTS", overall: "6.5" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS"],
      apps: [{ program: "MSc Computer Science: Adaptive Cybersecurity", status: "ASSESSMENT", month: 9, year: 2027, deadline: "2027-07-04" }] },
    { first: "Akshara", last: "Anilkumar", org: kottayam, assigned: deDocs, creator: deDocs, pathway: "AUSBILDUNG", country: "Germany", dob: "2004-05-30", passportExpiry: "2033-03-03", backlogs: 0, gap: 1, tests: [{ test: "GERMAN", overall: "B1" }, { test: "GERMAN", overall: "B2", isMock: true, source: "lms" }], docs: ["PASSPORT", "MARKSHEET_12", "GERMAN_CERTIFICATE", "CV"],
      apps: [{ program: "Ausbildung Pflegefachmann/-frau (Nursing)", status: "EMPLOYER_INTERVIEW", month: 4, year: 2027, officer: officerDe }, { program: "Ausbildung Pflegefachmann/-frau (Nursing)", status: "JOINED", month: 10, year: 2026, officer: officerDe }] },
    { first: "Rihan", last: "Ebrahim", org: kottayam, assigned: deDocs, creator: deDocs, pathway: "AUSBILDUNG", country: "Germany", dob: "2003-09-12", passportExpiry: "2034-06-20", backlogs: 0, gap: 2, tests: [{ test: "GERMAN", overall: "A2" }], docs: ["PASSPORT", "MARKSHEET_12"],
      apps: [{ program: "Ausbildung Pflegefachmann/-frau (Nursing)", status: "LANGUAGE_PENDING", month: 10, year: 2027, officer: officerDe }] },
    { first: "Simi", last: "Joseph", org: kottayam, assigned: ukDocs, creator: ukDocs, pathway: "NURSING", country: "United Kingdom", dob: "1995-12-01", passportExpiry: "2029-11-11", backlogs: 0, gap: 0, tests: [{ test: "OET", overall: "B" }], docs: ["PASSPORT", "DEGREE_CERTIFICATE", "NURSING_LICENSE", "ENGLISH_TEST", "CV"],
      apps: [{ program: "Registered Nurse (NMC) international recruitment", status: "BOARD_APPLICATION", month: 1, year: 2027, officer: officerNurse }, { program: "Registered Nurse (NMC) international recruitment", status: "DEPLOYED", month: 9, year: 2026, officer: officerNurse }] },
    { first: "Anto", last: "Mathew", org: kochi, assigned: partnerKochi, creator: partnerKochi, pathway: "DEGREE", country: "United Kingdom", dob: "2001-04-04", passportExpiry: "2031-04-04", backlogs: 3, gap: 1, tests: [{ test: "IELTS", overall: "6.0" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"],
      apps: [{ program: "BSc (Hons) Nursing (Adult)", status: "VISA_RECEIVED", month: 9, year: 2026, officer: admin }, { program: "MSc Digital Marketing", status: "UNCONDITIONAL_OFFER", month: 1, year: 2027, officer: admin }] },
    { first: "Aleesha", last: "Varghese", org: kochi, assigned: partnerKochi, creator: partnerKochi, pathway: "DEGREE", country: "Malta", dob: "2002-02-18", passportExpiry: "2035-02-18", backlogs: 0, gap: 2, tests: [], docs: ["PASSPORT"],
      apps: [{ program: "Postgraduate Diploma in Beauty Therapy", status: "PENDING_PARTNER", month: 2, year: 2027, officer: admin }] },
    { first: "Medhuna", last: "Suresh", org: thrissur, assigned: partnerTsr, creator: partnerTsr, pathway: "DEGREE", country: "United Kingdom", dob: "2000-08-08", passportExpiry: "2030-08-08", backlogs: 1, gap: 2, tests: [{ test: "IELTS", overall: "7.0" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"],
      apps: [{ program: "BSc (Hons) Nursing (Adult)", status: "SUBMITTED", month: 1, year: 2027, officer: admin }] },
  ];

  const months = (d: number) => new Date(Date.now() - d * 86400000);
  let dayOffset = 30;

  // The seed mints its own Medcity IDs rather than calling the server minter,
  // which is server-only and cannot be imported here. Same shape, same counter
  // rows, so a seeded database and a real one number students identically.
  const serials = new Map<string, number>();
  const seededId = (org: { id: string; idCode: string | null }, when: Date) => {
    const key = `${org.id}:${when.getFullYear()}`;
    const next = (serials.get(key) ?? 0) + 1;
    serials.set(key, next);
    return formatStudentId(org.idCode ?? branchCodeFrom("Medcity"), when.getFullYear(), next);
  };

  // Sample trail so the audit log is not empty on a fresh install.
  const trail: (typeof schema.auditLogs.$inferInsert)[] = [];
  let firstStudentId = "";
  let lastAppId = "";
  const logged = (actorId: string, action: string, entityType: string, entityId: string, createdAt: Date, meta?: Record<string, unknown>) =>
    trail.push({ actorId, action, entityType, entityId, meta, createdAt });

  for (const s of seeds) {
    const [st] = await db
      .insert(schema.students)
      .values({
        orgId: s.org.id, assignedToId: s.assigned.id, createdById: s.creator.id,
        firstName: s.first, lastName: s.last,
        email: `${s.first}.${s.last}`.toLowerCase() + "@example.com",
        phone: `+91 98${String(Math.floor(10000000 + Math.random() * 89999999))}`,
        preferredCountry: s.country, preferredPathway: s.pathway,
        dateOfBirth: new Date(s.dob), gender: ["Fathima", "Arathi", "Akshara", "Simi", "Aleesha", "Medhuna"].includes(s.first) ? "Female" : "Male",
        maritalStatus: "Single", addressLine1: "Sample House, Sample Road", city: s.org.city ?? "Kochi", state: "Kerala", pincode: "686001",
        passportNumber: `Z${Math.floor(1000000 + Math.random() * 8999999)}`, passportIssue: new Date("2023-01-01"), passportExpiry: new Date(s.passportExpiry),
        passportIssueCountry: "India", cityOfBirth: s.org.city ?? "Kochi",
        backlogs: s.backlogs, gapYears: s.gap,
        background: Object.fromEntries(BACKGROUND_QUESTIONS.map((q) => [q.key, { answer: false, details: null }])),
        consentAt: months(dayOffset), consentText: "I agree to Medcity Overseas processing my data to apply to institutions and employers on my behalf.",
        profileLocked: s.apps.some((a) => a.status !== "ASSESSMENT"),
        medcityId: seededId(s.org, months(dayOffset)),
        createdAt: months(dayOffset),
      })
      .returning();
    if (!firstStudentId) firstStudentId = st.id;
    await db.insert(schema.studentContacts).values({ studentId: st.id, relation: "Father", name: `${s.last} (father)`, phone: "+91 94470 00000", emergency: true });
    logged(s.creator.id, "student.create", "student", st.id, months(dayOffset), { consent: true });
    dayOffset -= 3;

    await db.insert(schema.academicRecords).values([
      { studentId: st.id, level: "SCHOOL", institution: "Sample Higher Secondary School", course: "Science", gradingSystem: "percentage", score: 82, yearCompleted: 2019 },
      ...(s.pathway !== "AUSBILDUNG" ? [{ studentId: st.id, level: "UG" as const, institution: "Sample College of Kerala", course: "BSc", gradingSystem: "percentage", score: 68, yearCompleted: 2023 }] : []),
    ]);
    if (s.tests.length) await db.insert(schema.testScores).values(s.tests.map((t) => ({ studentId: st.id, ...t })));

    for (const code of s.docs) {
      const key = `students/${st.id}/${code.toLowerCase()}.pdf`;
      await mkdir(path.join(uploads, path.dirname(key)), { recursive: true });
      await writeFile(path.join(uploads, key), tinyPdf);
      const [doc] = await db.insert(schema.documents).values({ studentId: st.id, typeCode: code, fileName: `${s.first}_${code.toLowerCase()}.pdf`, storageKey: key, mimeType: "application/pdf", sizeBytes: tinyPdf.length, uploadedById: s.creator.id }).returning();
      logged(s.creator.id, "document.upload", "document", doc.id, months(dayOffset + 1), { typeCode: code });
    }

    for (const a of s.apps) {
      const pw = prog(a.program).pathway;
      const statusId = statusIds[`${pw}.${a.status}`];
      if (!statusId) throw new Error(`Unknown status ${pw}.${a.status}`);
      const ack = await db.execute<{ n: string }>(sql`SELECT nextval('application_ack_seq')::text AS n`);
      const created = months(Math.max(1, dayOffset + Math.floor(Math.random() * 5)));
      const [app] = await db
        .insert(schema.applications)
        .values({
          ackNo: `${ack[0].n}/26-27`, studentId: st.id, programId: prog(a.program).id, orgId: s.org.id,
          intakeMonth: a.month, intakeYear: a.year, statusId, officerId: a.officer?.id, createdById: s.creator.id,
          deadline: a.deadline ? new Date(a.deadline) : null, createdAt: created, statusChangedAt: created,
        })
        .returning();
      if (a.deadline) {
        await db.insert(schema.applicationDeadlines).values([
          { applicationId: app.id, type: "APPLICATION", dueOn: a.deadline, createdById: admin.id },
          // One due within the week, so the dashboards have something to show on a fresh seed.
          { applicationId: app.id, type: "PAYMENT", dueOn: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), note: "Tuition deposit", createdById: admin.id },
        ]);
      }
      // Two rows when the application has moved on, so "days to offer" means something.
      const firstStatusId = statusIds[`${pw}.${pw === "DEGREE" ? "ASSESSMENT" : pw === "AUSBILDUNG" ? "LANGUAGE_PENDING" : "CREDENTIAL_CHECK"}`] ?? statusId;
      await db.insert(schema.statusHistory).values({ applicationId: app.id, toStatusId: firstStatusId, changedById: s.creator.id, createdAt: created });
      if (firstStatusId !== statusId) {
        const movedAt = new Date(Math.min(Date.now(), created.getTime() + (12 + Math.floor(Math.random() * 30)) * 86400000));
        await db.insert(schema.statusHistory).values({
          applicationId: app.id,
          fromStatusId: firstStatusId,
          toStatusId: statusId,
          changedById: a.officer?.id ?? s.creator.id,
          createdAt: movedAt,
        });
      }
      lastAppId = app.id;
      logged(s.creator.id, "application.create", "application", app.id, created, { programId: prog(a.program).id, intake: `${a.month}/${a.year}` });
      if (a.status !== "ASSESSMENT") {
        logged(a.officer?.id ?? admin.id, "application.status", "application", app.id, created, { from: "ASSESSMENT", to: a.status });
      }
      if (a.status === "PENDING_PARTNER") {
        await db.insert(schema.comments).values([
          { applicationId: app.id, channel: "TEAM", authorId: a.officer?.id ?? admin.id, body: "Dear team,\n\nPlease share a course and university specific SOP. Mention the study gap explanation in the SOP.\n\nRegards", createdAt: months(1) },
          { applicationId: app.id, channel: "STUDENT", authorId: s.creator.id, body: `Hi ${s.first}, please send a clear photo of the back page of your passport.`, createdAt: months(1) },
          { applicationId: app.id, channel: "STUDENT", source: "WHATSAPP", authorLabel: `${s.first} (WhatsApp)`, body: "Sure, sending it tonight.", createdAt: new Date() },
        ]);
      }
    }
  }

  // The counters are left where the seeded IDs ended, so the next student
  // registered on a seeded database carries on from the last seeded number.
  for (const [key, used] of serials) {
    const [scope, year] = key.split(":");
    await db.insert(schema.idCounters).values({ scope, year: Number(year), used });
  }

  trail.push(
    { actorId: admin.id, action: "programs.import", entityType: "program", entityId: "*", meta: { created: 12, updated: 0, skipped: 0 }, createdAt: months(21) },
    { actorId: admin.id, action: "partner.invite", entityType: "organization", entityId: thrissur.id, meta: { ownerEmail: "owner@horizon.test" }, createdAt: months(18) },
    { actorId: admin.id, action: "passport.reveal", entityType: "student", entityId: firstStudentId, meta: {}, createdAt: months(4) },
    { actorId: docsTeam.id, action: "document.classify", entityType: "student", entityId: firstStudentId, meta: { typeCode: "PASSPORT" }, createdAt: months(3) },
    { actorId: null, action: "whatsapp.inbound", entityType: "application", entityId: lastAppId, meta: { type: "text" }, createdAt: months(1) },
  );
  // Enquiries: the stage before a student file exists.
  const days = (n: number) => new Date(Date.now() + n * 86400000);
  const enquirySeed: {
    name: string; phone: string; email?: string; city: string;
    source: schema.EnquirySource; stage: schema.EnquiryStage;
    country?: string; pathway?: schema.Pathway; intake?: [number, number];
    budget?: number; owner: string; org: { id: string }; next?: number; note: string; lost?: string;
  }[] = [
    { name: "Nandana Prakash", phone: "+91 98470 11001", email: "nandana.prakash@example.com", city: "Kottayam", source: "WALK_IN", stage: "NEW", country: "United Kingdom", pathway: "DEGREE", intake: [9, 2027], budget: 18, owner: ukDocs.id, org: kottayam, next: 1, note: "Walked in with her father. BSc Nursing final year, wants a UK masters." },
    { name: "Abhijith Menon", phone: "+91 98470 11002", city: "Changanassery", source: "PHONE", stage: "CONTACTED", country: "Germany", pathway: "AUSBILDUNG", intake: [4, 2027], budget: 6, owner: deDocs.id, org: kottayam, next: 3, note: "Plus two done, asked about Ausbildung. Explained the A2 requirement." },
    { name: "Sneha Rajan", phone: "+91 98470 11003", email: "sneha.rajan@example.com", city: "Kochi", source: "WEBSITE", stage: "QUALIFIED", country: "Ireland", pathway: "DEGREE", intake: [1, 2027], budget: 22, owner: partnerKochi.id, org: kochi, next: -2, note: "Filled the website form. IELTS 7.0 already, shortlisting universities." },
    { name: "Fahad Rahman", phone: "+91 98470 11004", city: "Thrissur", source: "REFERRAL", stage: "COUNSELLING", country: "Germany", pathway: "NURSING", intake: [6, 2027], budget: 8, owner: partnerTsr.id, org: thrissur, next: 5, note: "Referred by a former student. GNM with two years in a Thrissur hospital." },
    { name: "Meera Suresh", phone: "+91 98470 11005", email: "meera.suresh@example.com", city: "Pala", source: "EVENT", stage: "CONTACTED", country: "Australia", pathway: "DEGREE", intake: [2, 2027], budget: 25, owner: ukDocs.id, org: kottayam, note: "Met at the Pala seminar. Wants to compare Australia and Ireland." },
    { name: "Vishnu Pillai", phone: "+91 98470 11006", city: "Kottayam", source: "SOCIAL", stage: "LOST", country: "United Kingdom", pathway: "DEGREE", owner: ukDocs.id, org: kottayam, note: "Instagram enquiry, wanted a full scholarship.", lost: "Budget below what the UK route needs" },
  ];

  for (const q of enquirySeed) {
    const [row] = await db
      .insert(schema.enquiries)
      .values({
        orgId: q.org.id,
        createdById: q.owner,
        assignedToId: q.owner,
        name: q.name,
        phone: q.phone,
        email: q.email,
        city: q.city,
        source: q.source,
        stage: q.stage,
        interestCountry: q.country,
        interestPathway: q.pathway,
        intakeMonth: q.intake?.[0],
        intakeYear: q.intake?.[1],
        budgetLakhs: q.budget,
        notes: q.note,
        nextFollowUpAt: q.next === undefined ? null : days(q.next),
        lastContactedAt: q.stage === "NEW" ? null : months(2),
        lostReason: q.lost,
        createdAt: months(Math.floor(Math.random() * 20) + 2),
      })
      .returning();
    await db.insert(schema.enquiryNotes).values({ enquiryId: row.id, authorId: q.owner, body: q.note, stageAfter: q.stage === "NEW" ? null : q.stage });
    if (q.lost) {
      await db.insert(schema.enquiryNotes).values({ enquiryId: row.id, authorId: q.owner, body: `Closed as lost: ${q.lost}`, stageAfter: "LOST" });
    }
    trail.push({ actorId: q.owner, action: "enquiry.create", entityType: "enquiry", entityId: row.id, meta: { source: q.source }, createdAt: row.createdAt });
  }

  // The roads Medcity reaches universities by. Medcity's own agreements count
  // as a route like any other, so every application carries one.
  const vendorRows = await db
    .insert(schema.vendors)
    .values([
      { name: "Medcity Direct", code: "MD", colour: "#0F766E", isDirect: true, currency: "INR", payableOn: "ENROLMENT_CONFIRMED" as const, daysToPay: 45, notes: "Our own agreements with universities", termsConfirmedAt: new Date() },
      { name: "KC Overseas", code: "KC", colour: "#4338CA", currency: "INR", payableOn: "VISA_APPROVED" as const, daysToPay: 60, contactName: "Partner desk", contactEmail: "partners@example.com", portalUrl: "https://example.com/kc", termsConfirmedAt: new Date() },
      { name: "StudentOps360", code: "SO", colour: "#B45309", currency: "INR", payableOn: "ENROLMENT_CONFIRMED" as const, daysToPay: 90, contactName: "Agent support", contactEmail: "support@example.com", portalUrl: "https://example.com/so" },
    ])
    .returning();
  const vendorBy = new Map(vendorRows.map((x) => [x.code, x]));
  // A handful of live courses reachable more than one way, so the comparison
  // on a program page has something to compare.
  const routeTargets = await db
    .select({ id: schema.programs.id, countryId: schema.universities.countryId })
    .from(schema.programs)
    .innerJoin(schema.universities, eq(schema.universities.id, schema.programs.universityId))
    .where(eq(schema.programs.status, "LIVE"))
    .limit(40);
  if (routeTargets.length) {
    await db.insert(schema.programRoutes).values(
      routeTargets.flatMap((t, i) => [
        { programId: t.id, vendorId: vendorBy.get("KC")!.id, basis: "PERCENT_TUITION" as const, percentOfTuition: 9, offerTatDays: 5, vendorCourseCode: `KC-${1000 + i}`, extraDocuments: "Their application form, a counsellor declaration", confirmedAt: new Date() },
        ...(i % 2 === 0
          ? [{ programId: t.id, vendorId: vendorBy.get("MD")!.id, basis: "PERCENT_TUITION" as const, percentOfTuition: 12, offerTatDays: 9, confirmedAt: new Date() }]
          : []),
        ...(i % 3 === 0
          ? [{ programId: t.id, vendorId: vendorBy.get("SO")!.id, basis: "FLAT" as const, flatAmount: 120000, currency: "INR", offerTatDays: 1, interviewRequired: true, extraDocuments: "Their profile form", confirmedAt: new Date() }]
          : []),
      ]),
    );
  }

  // The hand-over, as it actually runs: the branch builds the file, the desk
  // picks the road and lodges it, and whatever the vendor says is typed in by
  // hand. Seeded across the sample applications so every step is visible.
  const deskApps = await db
    .select({ id: schema.applications.id, programId: schema.applications.programId, group: schema.statusDefinitions.group, createdAt: schema.applications.createdAt })
    .from(schema.applications)
    .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, schema.applications.statusId))
    .orderBy(asc(schema.applications.createdAt));
  const routesByProgram = new Map<string, string[]>();
  for (const r of await db.select({ id: schema.programRoutes.id, programId: schema.programRoutes.programId }).from(schema.programRoutes)) {
    routesByProgram.set(r.programId, [...(routesByProgram.get(r.programId) ?? []), r.id]);
  }
  let lodgedCount = 0;
  for (const [i, a] of deskApps.entries()) {
    const routeId = (routesByProgram.get(a.programId) ?? [])[0] ?? null;
    if (a.group === "NEW") continue;
    if (a.group === "PENDING_PARTNER") {
      await db
        .update(schema.applications)
        .set({ deskStage: "READY", handedOverAt: months(3), handedOverById: ukDocs.id, handoverNote: i % 2 === 0 ? "Student wants September if there is still room." : null })
        .where(eq(schema.applications.id, a.id));
      continue;
    }
    if (!routeId) {
      await db.update(schema.applications).set({ deskStage: "READY", handedOverAt: months(6), handedOverById: ukDocs.id }).where(eq(schema.applications.id, a.id));
      continue;
    }
    // One left at each of the two middle steps, so the desk screen is not all
    // one thing: one chosen but not lodged, one sent back to the branch.
    if (lodgedCount === 1) {
      await db
        .update(schema.applications)
        .set({ deskStage: "CHOSEN", routeId, routeChosenById: docsTeam.id, routeChosenAt: months(2), handedOverAt: months(4), handedOverById: ukDocs.id })
        .where(eq(schema.applications.id, a.id));
      lodgedCount += 1;
      continue;
    }
    if (lodgedCount === 2) {
      await db
        .update(schema.applications)
        .set({ deskStage: "RETURNED", handedOverAt: months(9), handedOverById: ukDocs.id, returnedAt: months(5), returnedById: docsTeam.id, returnReason: "The bank statement covers five months. KC wants six ending within 28 days." })
        .where(eq(schema.applications.id, a.id));
      lodgedCount += 1;
      continue;
    }
    const lodgedOn = months(22);
    await db
      .update(schema.applications)
      .set({
        deskStage: "SUBMITTED",
        routeId,
        routeChosenById: docsTeam.id,
        routeChosenAt: months(24),
        handedOverAt: months(26),
        handedOverById: ukDocs.id,
        submittedToVendorAt: lodgedOn,
        submittedById: docsTeam.id,
        vendorReference: `KC/2026/${4100 + i}`,
      })
      .where(eq(schema.applications.id, a.id));
    const updates: (typeof schema.vendorUpdates.$inferInsert)[] = [
      { applicationId: a.id, outcome: "ACKNOWLEDGED", happenedOn: months(21).toISOString().slice(0, 10), note: "Received in their portal, assessment started.", recordedById: docsTeam.id, createdAt: months(21) },
    ];
    if (a.group === "OFFER" || a.group === "SUCCESS") {
      updates.push({
        applicationId: a.id,
        outcome: "OFFER_ISSUED",
        happenedOn: months(16).toISOString().slice(0, 10),
        note: "Conditional offer issued, English and the final transcript outstanding.",
        recordedById: docsTeam.id,
        createdAt: months(15),
      });
    } else if (lodgedCount === 0) {
      updates.push({
        applicationId: a.id,
        outcome: "DOCUMENTS_ASKED",
        happenedOn: months(18).toISOString().slice(0, 10),
        note: "They want the degree certificate attested.",
        recordedById: docsTeam.id,
        createdAt: months(18),
      });
    }
    await db.insert(schema.vendorUpdates).values(updates);
    lodgedCount += 1;
  }

  // Commission rules, then the commission each finished placement earns.
  const ruleRows = await db
    .insert(schema.commissionRules)
    .values([
      { name: "UK universities", countryId: c.GB, basis: "PERCENT_TUITION" as const, percentOfTuition: 15, currency: "GBP", partnerSharePercent: 50, notes: "Standard UK agreement" },
      { name: "Ireland universities", countryId: c.IE, basis: "PERCENT_TUITION" as const, percentOfTuition: 12, currency: "EUR", partnerSharePercent: 50 },
      { name: "Australia universities", countryId: c.AU, basis: "PERCENT_TUITION" as const, percentOfTuition: 14, currency: "AUD", partnerSharePercent: 45 },
      { name: "Germany Ausbildung placement", countryId: c.DE, basis: "FLAT" as const, flatAmount: 150000, currency: "INR", partnerSharePercent: 40, notes: "Flat fee per candidate who joins" },
      { name: "Malta colleges", countryId: c.MT, basis: "PERCENT_TUITION" as const, percentOfTuition: 18, currency: "EUR", partnerSharePercent: 55 },
      { name: "NHS nurse recruitment", universityId: nmc.id, basis: "FLAT" as const, flatAmount: 225000, currency: "INR", partnerSharePercent: 40, notes: "Flat fee per nurse who starts. Beats the UK country rule." },
    ])
    .returning();
  const ruleByCountry = new Map(ruleRows.filter((r) => r.countryId).map((r) => [r.countryId, r]));
  const ruleByUniversity = new Map(ruleRows.filter((r) => r.universityId).map((r) => [r.universityId, r]));

  const earning = await db
    .select({
      id: schema.applications.id,
      orgId: schema.applications.orgId,
      tuition: schema.programs.tuitionPerYear,
      countryId: schema.universities.countryId,
      universityId: schema.universities.id,
      currency: schema.countries.currency,
      code: schema.statusDefinitions.code,
    })
    .from(schema.applications)
    .innerJoin(schema.programs, sql`${schema.programs.id} = ${schema.applications.programId}`)
    .innerJoin(schema.universities, sql`${schema.universities.id} = ${schema.programs.universityId}`)
    .innerJoin(schema.countries, sql`${schema.countries.id} = ${schema.universities.countryId}`)
    .innerJoin(schema.statusDefinitions, sql`${schema.statusDefinitions.id} = ${schema.applications.statusId}`);

  for (const app of earning) {
    if (!["VISA_RECEIVED", "ENROLLED", "JOINED", "DEPLOYED"].includes(app.code)) continue;
    // A university rule beats the country rule, the same way findRule scores them.
    const rule = ruleByUniversity.get(app.universityId) ?? ruleByCountry.get(app.countryId);
    if (!rule) continue;
    const gross = rule.basis === "FLAT" ? (rule.flatAmount ?? 0) : Math.round(((app.tuition ?? 0) * (rule.percentOfTuition ?? 0)) / 100);
    if (gross <= 0) continue;
    const partner = Math.round((gross * rule.partnerSharePercent) / 100);
    const currency = rule.basis === "FLAT" ? rule.currency : app.currency;
    // The oldest one is already settled, so a wallet has something in it.
    const settled = app.code === "VISA_RECEIVED";
    const partnerInr = currency === "INR" ? partner : Math.round(partner * (currency === "GBP" ? 112 : currency === "EUR" ? 96 : 58));
    const [commission] = await db
      .insert(schema.commissions)
      .values({
        applicationId: app.id,
        orgId: app.orgId,
        ruleId: rule.id,
        currency,
        grossAmount: gross,
        partnerAmount: partner,
        partnerAmountInr: partnerInr,
        status: settled ? "SETTLED" : "EXPECTED",
        invoiceRef: settled ? "MIO/26-27/0001" : null,
        invoicedAt: settled ? months(3) : null,
        receivedAt: settled ? months(2) : null,
        settledAt: settled ? months(1) : null,
      })
      .returning();
    if (settled) {
      await db.insert(schema.walletEntries).values({
        orgId: app.orgId,
        kind: "COMMISSION",
        amountInr: partnerInr,
        commissionId: commission.id,
        reference: "MIO/26-27/0001",
        note: "Commission share credited",
        createdById: admin.id,
        createdAt: months(1),
      });
      await db.insert(schema.walletEntries).values({
        orgId: app.orgId,
        kind: "BONUS",
        amountInr: 25000,
        note: "Elite tier bonus for the September intake",
        createdById: admin.id,
        createdAt: months(1),
      });
      trail.push({ actorId: admin.id, action: "commission.status", entityType: "commission", entityId: commission.id, meta: { from: "RECEIVED", to: "SETTLED" }, createdAt: months(1) });
    }
  }

  // Learning library: a few starters so the shelf is not bare.
  await db.insert(schema.resources).values([
    {
      title: "UK student visa: document checklist",
      summary: "Everything a student needs before the visa appointment, in the order the caseworker expects it.",
      kind: "GUIDE" as const,
      countryId: c.GB,
      pathway: "DEGREE" as const,
      url: "https://www.gov.uk/student-visa",
      audience: [...PARTNER_ROLES],
      pinned: true,
      createdById: admin.id,
    },
    {
      title: "Statement of purpose: structure that works",
      summary: "The five paragraphs we ask for, with the study gap and finance sections spelled out.",
      kind: "TEMPLATE" as const,
      audience: [...PARTNER_ROLES],
      pinned: true,
      createdById: admin.id,
    },
    {
      title: "Ausbildung: German level and timeline",
      summary: "A2 to B1 expectations, when interviews happen, and what the employer decides.",
      kind: "TRAINING" as const,
      countryId: c.DE,
      pathway: "AUSBILDUNG" as const,
      audience: [...PARTNER_ROLES],
      createdById: officerDe.id,
    },
    {
      title: "Data protection: handling passports and marksheets",
      summary: "What we may store, who may see a full passport number, and how long documents are kept.",
      kind: "POLICY" as const,
      audience: [...PARTNER_ROLES, "ADMIN", "MANAGEMENT"],
      createdById: admin.id,
    },
    {
      title: "Nurse registration: NMC and NCLEX in plain words",
      summary: "The order of CBT, OET or IELTS, and the board application, with realistic timelines.",
      kind: "FAQ" as const,
      pathway: "NURSING" as const,
      audience: [...PARTNER_ROLES],
      createdById: officerNurse.id,
    },
    {
      title: "Counter posters for the September intake",
      summary: "Print-ready posters and WhatsApp cards for branch counters.",
      kind: "MARKETING" as const,
      audience: ["PARTNER"],
      createdById: admin.id,
    },
  ]);

  // One student with portal access, so the portal can be seen without an invite.
  const portalStudent = await db.query.students.findFirst({ where: eq(schema.students.firstName, "Fathima") });
  if (portalStudent) {
    await db.insert(schema.users).values({
      name: `${portalStudent.firstName} ${portalStudent.lastName}`,
      email: portalStudent.email!,
      phone: portalStudent.phone,
      passwordHash: hash,
      role: "STUDENT",
      orgId: portalStudent.orgId,
      studentId: portalStudent.id,
      locale: "ml",
    });
    trail.push({ actorId: ukDocs.id, action: "portal.invite", entityType: "student", entityId: portalStudent.id, meta: { email: portalStudent.email }, createdAt: months(2) });

    // And one parent reading the same file, so the family view can be seen too.
    const [parentAccount] = await db
      .insert(schema.users)
      .values({
        name: `${portalStudent.lastName} (father)`,
        email: `father.${portalStudent.firstName}`.toLowerCase() + "@example.com",
        phone: "+91 94470 00000",
        passwordHash: hash,
        role: "PARENT",
        orgId: portalStudent.orgId,
        studentId: portalStudent.id,
        locale: "ml",
      })
      .returning();
    await db.insert(schema.studentGuardians).values({
      studentId: portalStudent.id,
      userId: parentAccount.id,
      relation: "Father",
      seesMoney: true,
      addedById: ukDocs.id,
      studentToldAt: months(2),
      createdAt: months(2),
    });
    trail.push({ actorId: ukDocs.id, action: "guardian.add", entityType: "student", entityId: portalStudent.id, meta: { email: parentAccount.email, relation: "Father" }, createdAt: months(2) });
  }

  // The documentation spine: every student gets the list their stage, destination
  // and route ask for, and a few are part way through it so the queue, the gate
  // and the expiry flag can all be seen on a fresh install.
  const allStudents = await db.query.students.findMany({
    with: { applications: { with: { status: { columns: { group: true } } }, orderBy: asc(schema.applications.createdAt) } },
  });
  const STAGE_BY_GROUP: Record<string, schema.JourneyStage> = {
    NEW: "PROFILE",
    IN_PROGRESS: "APPLICATION",
    PENDING_PARTNER: "APPLICATION",
    OFFER: "OFFER",
    HOLD: "APPLICATION",
    SUCCESS: "DEPARTURE",
    CLOSED: "ARRIVED",
  };
  for (const student of allStudents) {
    const groups = student.applications.map((a) => a.status.group);
    // The furthest any of their applications has reached, not whichever row the
    // database happened to hand back first.
    const order: schema.JourneyStage[] = ["PROFILE", "SHORTLIST", "APPLICATION", "OFFER", "DEPOSIT", "CONFIRMATION", "VISA", "DEPARTURE", "ARRIVED"];
    const open = groups.filter((g) => g !== "CLOSED");
    const reached = (open.length ? open : groups).map((g) => STAGE_BY_GROUP[g] ?? "APPLICATION");
    const stage: schema.JourneyStage = reached.length ? reached.reduce((far, s) => (order.indexOf(s) > order.indexOf(far) ? s : far)) : "PROFILE";
    await db.update(schema.students).set({ journeyStage: stage, stageEnteredAt: months(12) }).where(eq(schema.students.id, student.id));
    await syncChecklist(student.id);
  }

  // A worked example on the first student: paper in hand, paper asked for, one
  // sent back with a reason, and a test report that runs out before the course.
  const worked = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.studentId, firstStudentId) });
  const item = (code: string) => worked.find((i) => i.typeCode === code);
  const accept = async (code: string, validTo?: string) => {
    const row = item(code);
    if (!row) return;
    await db
      .update(schema.checklistItems)
      .set({ state: "ACCEPTED", validTo: validTo ?? null, decidedAt: months(20), decidedById: docsTeam.id, version: 1 })
      .where(eq(schema.checklistItems.id, row.id));
  };
  await accept("PASSPORT", "2031-03-18");
  await accept("PHOTOGRAPH");
  await accept("MARKSHEET_10");
  await accept("MARKSHEET_12");
  await accept("CV");
  // An English test whose two years run out inside the course: accepted, and still
  // a problem, which is exactly what the gate has to say out loud.
  await accept("ENGLISH_TEST", new Date(Date.now() + 41 * 86400000).toISOString().slice(0, 10));
  const asked = item("SOP");
  if (asked) {
    await db
      .update(schema.checklistItems)
      .set({ state: "ASKED", askedAt: months(4), askedById: ukDocs.id, askedChannel: "WhatsApp", dueOn: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) })
      .where(eq(schema.checklistItems.id, asked.id));
  }
  const back = item("LOR");
  if (back) {
    await db
      .update(schema.checklistItems)
      .set({ state: "REJECTED", reasonCode: "period_short", reason: "Only one letter is in; the university asks for two.", decidedAt: months(2), decidedById: docsTeam.id, version: 1 })
      .where(eq(schema.checklistItems.id, back.id));
    await db.insert(schema.checklistFiles).values({ itemId: back.id, version: 1, outcome: "REJECTED", reasonCode: "period_short", reason: "Only one letter is in; the university asks for two.", uploadedById: ukDocs.id, decidedAt: months(2), decidedById: docsTeam.id });
  }
  // Two files waiting on the documentation team, so the queue is not empty.
  const waiting = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.typeCode, "MARKSHEET_12"), limit: 3 });
  for (const w of waiting.slice(1)) {
    await db.update(schema.checklistItems).set({ state: "UPLOADED", version: 1, updatedAt: months(2) }).where(eq(schema.checklistItems.id, w.id));
    await db.insert(schema.checklistFiles).values({ itemId: w.id, version: 1, uploadedById: ukDocs.id, uploadedAt: months(2) });
  }

  // A few conversations and tasks, so My day, the timeline and the board are not
  // empty on a fresh install.
  const boardStudents = await db
    .select({ id: schema.students.id, orgId: schema.students.orgId, assignedToId: schema.students.assignedToId, firstName: schema.students.firstName })
    .from(schema.students)
    .orderBy(asc(schema.students.createdAt));
  const contactSeeds = [
    { outcome: "REACHED" as const, channel: "CALL" as const, note: "Talked through the two Dundee options. Wants to decide with her father this weekend.", nextDays: 4, next: "Call back after they have talked" },
    { outcome: "NO_ANSWER" as const, channel: "CALL" as const, note: null, nextDays: 1, next: "Try again in the evening" },
    { outcome: "WILL_SEND" as const, channel: "WHATSAPP" as const, note: "Says the bank statement will come by Friday.", nextDays: 3, next: "Chase the bank statement" },
    { outcome: "WANTS_TIME" as const, channel: "VISIT" as const, note: "Came in with both parents. Worried about the funds requirement.", nextDays: 10, next: "Follow up on the loan" },
    { outcome: "NEEDS_COUNSELLING" as const, channel: "CALL" as const, note: "Wants to compare Ireland against the UK before applying.", nextDays: 2, next: "Sit down on destinations" },
  ];
  for (const [i, student] of boardStudents.entries()) {
    const seedRow = contactSeeds[i % contactSeeds.length];
    const by = student.assignedToId ?? ukDocs.id;
    const happenedAt = months(2 + (i % 9));
    const nextOn = new Date(Date.now() + (seedRow.nextDays - (i % 3)) * 86400000).toISOString().slice(0, 10);
    const [logged] = await db
      .insert(schema.contactLog)
      .values({
        orgId: student.orgId,
        studentId: student.id,
        channel: seedRow.channel,
        inbound: i % 4 === 0,
        outcome: seedRow.outcome,
        note: seedRow.note,
        byId: by,
        happenedAt,
        nextActionOn: nextOn,
        nextActionNote: seedRow.next,
      })
      .returning({ id: schema.contactLog.id });
    const [task] = await db
      .insert(schema.tasks)
      .values({
        orgId: student.orgId,
        studentId: student.id,
        kind: "CALL",
        title: seedRow.next,
        detail: seedRow.note,
        dueOn: nextOn,
        assignedToId: by,
        createdById: by,
        source: `${seedRow.channel === "WHATSAPP" ? "WhatsApp" : seedRow.channel === "VISIT" ? "Visit" : "Call"} on ${happenedAt.toISOString().slice(0, 10)}`,
        autoKey: `call-follow-up:${logged.id}`,
        createdAt: happenedAt,
      })
      .returning({ id: schema.tasks.id });
    await db.update(schema.contactLog).set({ taskId: task.id }).where(eq(schema.contactLog.id, logged.id));
  }
  // One overdue and one finished, so the day reads like a real one.
  const firstTwo = await db.select({ id: schema.tasks.id }).from(schema.tasks).orderBy(asc(schema.tasks.createdAt)).limit(2);
  if (firstTwo[0]) await db.update(schema.tasks).set({ dueOn: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) }).where(eq(schema.tasks.id, firstTwo[0].id));
  if (firstTwo[1]) await db.update(schema.tasks).set({ doneAt: months(1), doneById: ukDocs.id, doneNote: "Sent the clinic list on WhatsApp." }).where(eq(schema.tasks.id, firstTwo[1].id));

  // Rate cards and a few income lines, so the sheet, the departure board and the
  // leakage report all read like a real branch rather than an empty one. The
  // figures are made up for the sample data, which is what the "Not recorded"
  // lines beside them are there to make obvious.
  const rateRows = await db
    .insert(schema.rateCards)
    .values([
      { kind: "SERVICE_FEE" as const, amount: 35000, payer: "STUDENT" as const, branchSharePercent: 60, activeFrom: "2026-04-01", note: "Standard handling fee", setById: admin.id },
      { kind: "TICKET" as const, amount: 3000, payer: "PROVIDER" as const, branchSharePercent: 50, activeFrom: "2026-04-01", note: "What the agent passes back per ticket", setById: admin.id },
      { kind: "SIM" as const, amount: 800, payer: "PROVIDER" as const, branchSharePercent: 100, activeFrom: "2026-04-01", setById: admin.id },
      { kind: "FOREX" as const, percentOfSale: 0.5, payer: "PROVIDER" as const, branchSharePercent: 50, activeFrom: "2026-04-01", note: "Half a percent of the amount transferred", setById: admin.id },
      { kind: "INSURANCE" as const, amount: 1500, payer: "PROVIDER" as const, branchSharePercent: 50, activeFrom: "2026-04-01", setById: admin.id },
      { kind: "LOAN_REFERRAL" as const, percentOfSale: 0.75, payer: "PROVIDER" as const, branchSharePercent: 40, activeFrom: "2026-04-01", setById: admin.id },
    ])
    .returning();
  const rateBy = new Map(rateRows.map((r) => [r.kind, r]));

  // Every student gets a service fee; those who are leaving get a few of the
  // departure lines, and deliberately not all of them, so the leakage report has
  // something to report.
  for (const [i, student] of boardStudents.entries()) {
    const fee = rateBy.get("SERVICE_FEE")!;
    await db.insert(schema.incomeLines).values({
      orgId: student.orgId,
      studentId: student.id,
      kind: "SERVICE_FEE",
      payer: "STUDENT",
      currency: "INR",
      expectedAmount: fee.amount,
      receivedAmount: i % 3 === 0 ? fee.amount : null,
      receivedOn: i % 3 === 0 ? months(30).toISOString().slice(0, 10) : null,
      state: i % 3 === 0 ? "RECEIVED" : "EXPECTED",
      branchSharePercent: fee.branchSharePercent,
      rateCardId: fee.id,
      createdById: admin.id,
    });
    if (i % 2 === 0) {
      const ticket = rateBy.get("TICKET")!;
      await db.insert(schema.incomeLines).values({
        orgId: student.orgId,
        studentId: student.id,
        kind: "TICKET",
        payer: "PROVIDER",
        providerName: "Sample Travel",
        currency: "INR",
        expectedAmount: ticket.amount,
        state: "EXPECTED",
        branchSharePercent: ticket.branchSharePercent,
        rateCardId: ticket.id,
        createdById: admin.id,
      });
    }
    if (i % 4 === 0) {
      // One with no amount at all, which is what "Not recorded" is for.
      await db.insert(schema.incomeLines).values({
        orgId: student.orgId,
        studentId: student.id,
        kind: "FOREX",
        payer: "PROVIDER",
        currency: "INR",
        state: "EXPECTED",
        note: "Amount transferred not known yet",
        createdById: admin.id,
      });
    }
  }
  // Each placement's commission gets a line that reads the commission row.
  const placements = await db
    .select({ id: schema.commissions.id, orgId: schema.commissions.orgId, applicationId: schema.commissions.applicationId, studentId: schema.applications.studentId })
    .from(schema.commissions)
    .innerJoin(schema.applications, eq(schema.applications.id, schema.commissions.applicationId));
  if (placements.length) {
    await db.insert(schema.incomeLines).values(
      placements.map((p) => ({
        orgId: p.orgId,
        studentId: p.studentId,
        applicationId: p.applicationId,
        kind: "COMMISSION" as const,
        payer: "VENDOR" as const,
        commissionId: p.id,
        createdById: admin.id,
      })),
    );
  }

  // One invoice raised, sent and part paid, so the queue, the list, the ageing
  // report and the document all have something real on them.
  // The company that raises the invoices. Fictional details; the LUT is what
  // decides whether a vendor abroad is invoiced zero-rated.
  const [billing] = await db
    .insert(schema.billingCompanies)
    .values({
      orgId: hq.id,
      legalName: "Medcity International Overseas Corporation",
      address: "Sample Tower, Sample Road\nKottayam, Kerala 686001",
      state: "Kerala",
      pan: "AAAAA0000A",
      gstin: "32AAAAA0000A1Z5",
      lutNumber: "AD320426000000X",
      lutValidUntil: "2027-03-31",
      bankAccountName: "Medcity International Overseas Corporation",
      bankAccountNumber: "00000000000000",
      ifsc: "SAMP0000001",
      isDefault: true,
    })
    .returning();
  const invoiceable = await db
    .select({ lineId: schema.incomeLines.id, vendorId: schema.programRoutes.vendorId, gross: schema.commissions.grossAmount, currency: schema.commissions.currency, student: schema.students.firstName, lastName: schema.students.lastName })
    .from(schema.incomeLines)
    .innerJoin(schema.applications, eq(schema.applications.id, schema.incomeLines.applicationId))
    .innerJoin(schema.programRoutes, eq(schema.programRoutes.id, schema.applications.routeId))
    .innerJoin(schema.commissions, eq(schema.commissions.id, schema.incomeLines.commissionId))
    .innerJoin(schema.students, eq(schema.students.id, schema.incomeLines.studentId))
    .limit(3);
  if (billing && invoiceable.length) {
    const vendorId = invoiceable[0].vendorId;
    const mine = invoiceable.filter((x) => x.vendorId === vendorId && x.currency === invoiceable[0].currency);
    const net = mine.reduce((sum, x) => sum + x.gross, 0);
    const raisedOn = months(40).toISOString().slice(0, 10);
    const [invoice] = await db
      .insert(schema.vendorInvoices)
      .values({
        number: `MIO/26-27/0001`,
        vendorId,
        billingCompanyId: billing.id,
        currency: invoiceable[0].currency,
        total: net,
        rupeeTotal: invoiceable[0].currency === "INR" ? net : null,
        rateUsed: invoiceable[0].currency === "INR" ? 1 : null,
        taxTreatment: "Export of service, zero-rated under LUT",
        taxPercent: 0,
        taxAmount: 0,
        state: "PART_PAID",
        raisedOn,
        dueOn: new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10),
        sentAt: months(39),
        sentById: admin.id,
        sentTo: "partners@example.com",
        receivedAmount: Math.round(net / 2),
        note: "Against your statement of last month",
        createdById: admin.id,
        createdAt: months(40),
      })
      .returning();
    await db.insert(schema.vendorInvoiceLines).values(
      mine.map((x) => ({ invoiceId: invoice.id, incomeLineId: x.lineId, amount: x.gross, description: `${x.student} ${x.lastName}` })),
    );
    await db
      .update(schema.incomeLines)
      .set({ invoiceId: invoice.id, invoicedAmount: sql`coalesce(${schema.incomeLines.expectedAmount}, 0)`, state: "INVOICED" })
      .where(inArray(schema.incomeLines.id, mine.map((x) => x.lineId)));
    await db.insert(schema.invoicePayments).values({
      invoiceId: invoice.id,
      amount: Math.round(net / 2),
      currency: invoiceable[0].currency,
      rupeeAmount: invoiceable[0].currency === "INR" ? Math.round(net / 2) : null,
      rateUsed: invoiceable[0].currency === "INR" ? 1 : null,
      receivedOn: months(20).toISOString().slice(0, 10),
      reference: "UTR0099123456",
      note: "Half now, the rest with the next statement",
      recordedById: admin.id,
    });
  }

  // ---------- The sub-agent module ----------
  // An agreement to accept, a rate to be paid under, two applications waiting to
  // be looked at, and one referral the desk has not passed on yet, so the whole
  // module can be seen on a fresh install without setting it up by hand.
  const [mou] = await db
    .insert(schema.mouVersions)
    .values({
      version: "2026.1",
      title: "Memorandum of Understanding",
      effectiveFrom: "2026-04-01",
      active: true,
      createdById: admin.id,
      body: [
        "1. What this is",
        "This memorandum sets out how Medcity International Overseas Corporation (\"Medcity\") and the sub-agent named in the portal work together. It is a working agreement, not a partnership, an employment contract or an agency in law.",
        "2. What the sub-agent does",
        "The sub-agent introduces students who want to study, train or register as nurses abroad. Before passing on anybody's details the sub-agent tells that person their details are going to Medcity and obtains their agreement. The sub-agent does not counsel, apply, collect documents or take money from a student on Medcity's behalf.",
        "3. What Medcity does",
        "Medcity counsels the student, chooses and applies to institutions, handles the documents and the visa file, and keeps the sub-agent told of the stage each referral has reached.",
        "4. Money",
        "Medcity pays the sub-agent at the rate shown on the sub-agent's own screen in the portal, per student who goes. A referral fee is earned only once Medcity has itself been paid for that student, and is credited to the sub-agent's wallet at that point. Withdrawals are made to the bank account on file, after any minimum shown in the portal, and are subject to tax deducted at source where the law requires it.",
        "5. What is not paid for",
        "A student who does not go, withdraws, is refused a visa, or is refunded earns nothing. Where Medcity is not paid, the sub-agent is not paid.",
        "6. Honesty",
        "Neither side promises a visa, an offer or a place to any student. The sub-agent does not describe themselves as Medcity, use its name on their own documents without being asked to, or quote fees or timelines Medcity has not given them in writing.",
        "7. The student's data",
        "Both sides hold a student's personal details only for the purpose of their application, keep them to themselves, and hand them back or delete them when asked and when the law allows.",
        "8. Ending it",
        "Either side may end this arrangement by telling the other, in writing, at any time. Referrals already made are seen through, and anything already earned is still paid.",
        "9. Changes",
        "Medcity may publish a new version. A new version is shown in the portal and asked for before the next withdrawal; it does not change what was agreed under an earlier one.",
      ].join("\n\n"),
    })
    .returning();
  await db.insert(schema.mouAcceptances).values({
    orgId: thrissur.id,
    mouVersionId: mou.id,
    acceptedById: partnerTsr.id,
    acceptedName: "Horizon Owner",
    ipAddress: "203.0.113.7",
    userAgent: "Seeded",
    createdAt: months(17),
  });
  await db.insert(schema.agentRates).values({
    orgId: null,
    kind: "SHARE_OF_COMMISSION",
    percent: 10,
    activeFrom: "2026-04-01",
    note: "The platform default, as a share of the commission Medcity received",
    createdById: admin.id,
  });
  await db.insert(schema.agentApplications).values([
    {
      contactName: "Shyam Varghese",
      firmName: "Varghese Career Guidance",
      email: "shyam@example.com",
      phone: "+91 94470 11111",
      city: "Pathanamthitta",
      state: "Kerala",
      aboutThem: "I run a small guidance centre. Around twenty nursing students a year ask me about Germany and the UK and I have nobody to send them to.",
      referredByOrgId: kottayam.id,
      consentAt: months(4),
      consentText: AGENT_CONSENT,
      createdAt: months(4),
    },
    {
      contactName: "Reena Thomas",
      email: "reena@example.com",
      phone: "+91 94470 22222",
      city: "Kannur",
      state: "Kerala",
      aboutThem: "Former IELTS trainer. Students keep asking me about Ausbildung and I would rather hand them to somebody who does it properly.",
      status: "REVIEWING",
      reviewedById: admin.id,
      consentAt: months(2),
      consentText: AGENT_CONSENT,
      createdAt: months(2),
    },
  ]);
  // One referral still with the head office, waiting for a branch.
  const [referral] = await db
    .insert(schema.enquiries)
    .values({
      orgId: hq.id,
      createdById: partnerTsr.id,
      submittedByOrgId: thrissur.id,
      name: "Devika Nair",
      phone: "+91 94470 33333",
      email: "devika.nair@example.com",
      city: "Thrissur",
      source: "REFERRAL",
      stage: "NEW",
      interestCountry: "Germany",
      interestPathway: "AUSBILDUNG",
      notes: "Std. 12 science, wants Ausbildung. No German yet.",
      nextFollowUpAt: new Date(Date.now() + 86400000),
      createdAt: months(1),
    })
    .returning();
  await db.insert(schema.enquiryNotes).values({
    enquiryId: referral.id,
    authorId: partnerTsr.id,
    body: "Referred by Horizon Consultants, Thrissur. The sub-agent confirmed the person agreed to being referred.",
    stageAfter: "NEW",
    createdAt: months(1),
  });

  await db.insert(schema.auditLogs).values(trail);

  await db.insert(schema.notifications).values([
    { userId: ukDocs.id, title: "Action needed on 2 applications", body: "Pending from partner", href: "/applications?group=PENDING_PARTNER" },
    { userId: admin.id, title: "New application submitted", body: "Aswin Anil: MSc Computer Science", href: "/admin/queue" },
  ]);

  console.log("Seed complete.\n");
  console.log(`All users share the password: ${PASSWORD}`);
  console.log(`  ${superEmail}${" ".repeat(Math.max(1, 33 - superEmail.length))}Super admin (platform owner)`);
  console.log("  admin@medcityoverseas.test       Medcity Overseas admin (UK desk)");
  console.log("  germany.desk@medcityoverseas.test Medcity Overseas admin (Germany desk)");
  console.log("  ops@medcityoverseas.test          Ops manager (desk + partners + accounts)");
  console.log("  documentation@medcityoverseas.test Documentation team (files, no status changes)");
  console.log("  management@medcityoverseas.test  Management (read-only)");
  console.log("  kottayam@medcity.test             Partner owner, Medcity Kottayam");
  console.log("  uk.docs@medcity.test              Counsellor, Medcity Kottayam");
  console.log("  owner@horizon.test                Sub-agent owner");
  console.log("  fathima.rahman@example.com        Student portal (Malayalam by default)");
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
