/* Sample data for local development. Every person, university and figure here is fictional. */
import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { DOCUMENT_TYPES, STATUS_SEED } from "./statuses";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

const PASSWORD = "Password@123";

async function main() {
  console.log("Resetting data...");
  await db.execute(sql`TRUNCATE audit_logs, outbound_messages, notifications, documents, comments, status_history,
    applications, edit_requests, work_experience, test_scores, academic_records, students, programs, universities,
    countries, status_definitions, document_types, users, organizations RESTART IDENTITY CASCADE`);
  await db.execute(sql`DROP SEQUENCE IF EXISTS application_ack_seq`);
  await db.execute(sql`CREATE SEQUENCE application_ack_seq START 144401`);

  const hash = await bcrypt.hash(PASSWORD, 10);

  // Organisations
  const [hq] = await db.insert(schema.organizations).values({ name: "Medcity International Overseas Corporation", type: "HQ", tier: "PLATINUM", city: "Kochi", counsellorSeats: 50 }).returning();
  const [kottayam] = await db.insert(schema.organizations).values({ name: "Medcity Kottayam", type: "BRANCH", tier: "ELITE", city: "Kottayam", counsellorSeats: 8 }).returning();
  const [kochi] = await db.insert(schema.organizations).values({ name: "Medcity Kochi", type: "BRANCH", tier: "GOLD", city: "Kochi", counsellorSeats: 5 }).returning();
  const [thrissur] = await db.insert(schema.organizations).values({ name: "Horizon Consultants, Thrissur", type: "SUB_AGENT", tier: "SILVER", city: "Thrissur", counsellorSeats: 3 }).returning();

  // Users
  const u = async (name: string, email: string, role: schema.Role, orgId: string, deskLabel?: string, phone?: string) =>
    (await db.insert(schema.users).values({ name, email, role, orgId, deskLabel, phone, passwordHash: hash }).returning())[0];

  const superEmail = process.env.SUPER_ADMIN_EMAIL ?? "sreejith@miak.in";
  await u("Sreejith", superEmail, "SUPER_ADMIN", hq.id, "Platform owner");
  const admin = await u("Anita Menon", "admin@medcityoverseas.test", "ADMIN", hq.id, "UK Desk", "+91 90000 00001");
  const officerDe = await u("Rahul Nair", "germany.desk@medcityoverseas.test", "ADMIN", hq.id, "Germany Desk", "+91 90000 00002");
  const officerNurse = await u("Divya Pillai", "nursing.desk@medcityoverseas.test", "ADMIN", hq.id, "Nursing Desk", "+91 90000 00003");
  await u("Management View", "management@medcityoverseas.test", "MANAGEMENT", hq.id);
  await u("Kottayam Branch Head", "kottayam@medcity.test", "PARTNER", kottayam.id);
  const ukDocs = await u("UK Documentation", "uk.docs@medcity.test", "COUNSELLOR", kottayam.id, "UK Documentation");
  const deDocs = await u("Germany Counsellor", "germany@medcity.test", "COUNSELLOR", kottayam.id, "Germany");
  const partnerKochi = await u("Kochi Branch Head", "kochi@medcity.test", "PARTNER", kochi.id);
  const partnerTsr = await u("Horizon Owner", "owner@horizon.test", "PARTNER", thrissur.id);

  await db.update(schema.organizations).set({ relationshipManagerId: admin.id }).where(sql`type <> 'HQ'`);

  // Status dictionary
  const statusIds: Record<string, string> = {};
  for (const [pw, list] of Object.entries(STATUS_SEED)) {
    const rows = await db
      .insert(schema.statusDefinitions)
      .values(list.map((s, i) => ({ ...s, pathway: pw as schema.Pathway, sortOrder: (i + 1) * 10 })))
      .returning();
    for (const r of rows) statusIds[`${pw}.${r.code}`] = r.id;
  }
  await db.insert(schema.documentTypes).values(DOCUMENT_TYPES);

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
    ])
    .returning();
  const c = Object.fromEntries(countryRows.map((r) => [r.code, r.id]));

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
      { name: "BSc (Hons) Nursing (Adult)", universityId: westbridge.id, level: "UG", studyArea: "Nursing", durationMonths: 36, tuitionPerYear: 19450, initialDeposit: 1000, intakeMonths: [1, 9], minIelts: 7, maxBacklogs: 5, maxGapYears: 5, requiredDocs: ["PASSPORT", "MARKSHEET_12", "ENGLISH_TEST", "SOP"] },
      { name: "MSc Nursing (Adult)", universityId: westbridge.id, level: "PG", studyArea: "Nursing", durationMonths: 24, tuitionPerYear: 20950, initialDeposit: 1000, intakeMonths: [1, 9], minIelts: 7, maxBacklogs: 5, maxGapYears: 3, requiredDocs: baseDocs },
      { name: "MSc Digital Marketing", universityId: northgate.id, level: "PG", studyArea: "Business", durationMonths: 12, tuitionPerYear: 16500, initialDeposit: 3000, intakeMonths: [1, 5, 9], minIelts: 6.5, minPte: 58, maxBacklogs: 8, maxGapYears: 5, moiAccepted: true, requiredDocs: baseDocs },
      { name: "MSc Artificial Intelligence", universityId: northgate.id, level: "PG", studyArea: "Computing", durationMonths: 16, tuitionPerYear: 18900, initialDeposit: 4000, intakeMonths: [1, 9], minIelts: 6.5, minPte: 58, maxBacklogs: 5, maxGapYears: 3, requiredDocs: [...baseDocs, "LOR"] },
      { name: "MSc Computer Science: Adaptive Cybersecurity", universityId: galway.id, level: "PG", studyArea: "Computing", durationMonths: 12, tuitionPerYear: 17500, applicationFee: 50, intakeMonths: [9], minIelts: 6.5, maxBacklogs: 3, maxGapYears: 2, requiredDocs: [...baseDocs, "CV"] },
      { name: "Master of Nursing Practice (Pre-registration)", universityId: harbour.id, level: "PG", studyArea: "Nursing", durationMonths: 24, tuitionPerYear: 42000, applicationFee: 100, intakeMonths: [2, 7], minIelts: 7, maxBacklogs: 4, maxGapYears: 5, requiredDocs: [...baseDocs, "NURSING_LICENSE"] },
      { name: "Postgraduate Diploma in Beauty Therapy", universityId: valletta.id, level: "PG_DIPLOMA", studyArea: "Arts", durationMonths: 12, tuitionPerYear: 9800, intakeMonths: [2, 10], minIelts: 5.5, moiAccepted: true, maxGapYears: 10, requiredDocs: ["PASSPORT", "MARKSHEET_12", "SOP"] },
      { name: "Ausbildung Pflegefachmann/-frau (Nursing)", universityId: klinikum.id, pathway: "AUSBILDUNG", level: "VOCATIONAL", studyArea: "Nursing", durationMonths: 36, tuitionPerYear: 0, intakeMonths: [4, 10], minGermanLevel: "B1", maxGapYears: 10, requiredDocs: ["PASSPORT", "MARKSHEET_12", "GERMAN_CERTIFICATE", "CV"] },
      { name: "Ausbildung Kaufmann im Gesundheitswesen", universityId: pflege.id, pathway: "AUSBILDUNG", level: "VOCATIONAL", studyArea: "Healthcare admin", durationMonths: 36, tuitionPerYear: 0, intakeMonths: [8], minGermanLevel: "B2", requiredDocs: ["PASSPORT", "MARKSHEET_12", "GERMAN_CERTIFICATE", "CV"] },
      { name: "Registered Nurse (NMC) international recruitment", universityId: nmc.id, pathway: "NURSING", level: "REGISTRATION", studyArea: "Nursing", durationMonths: 24, tuitionPerYear: 0, intakeMonths: [1, 4, 7, 10], minOetGrade: "B", requiredDocs: ["PASSPORT", "DEGREE_CERTIFICATE", "NURSING_LICENSE", "ENGLISH_TEST", "CV"] },
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
      apps: [{ program: "MSc Digital Marketing", status: "CONDITIONAL_OFFER", month: 1, year: 2027, officer: admin }, { program: "MSc Artificial Intelligence", status: "SUBMITTED", month: 1, year: 2027, officer: admin }, { program: "MSc Artificial Intelligence", status: "CLOSED_NOT_QUALIFIED", month: 9, year: 2026, officer: admin }] },
    { first: "Aswin", last: "Anil", org: kottayam, assigned: deDocs, creator: deDocs, pathway: "DEGREE", country: "Ireland", dob: "2000-01-15", passportExpiry: "2030-01-10", backlogs: 1, gap: 1, tests: [{ test: "IELTS", overall: "6.5" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS"],
      apps: [{ program: "MSc Computer Science: Adaptive Cybersecurity", status: "ASSESSMENT", month: 9, year: 2027, deadline: "2027-07-04" }] },
    { first: "Akshara", last: "Anilkumar", org: kottayam, assigned: deDocs, creator: deDocs, pathway: "AUSBILDUNG", country: "Germany", dob: "2004-05-30", passportExpiry: "2033-03-03", backlogs: 0, gap: 1, tests: [{ test: "GERMAN", overall: "B1" }, { test: "GERMAN", overall: "B2", isMock: true, source: "lms" }], docs: ["PASSPORT", "MARKSHEET_12", "GERMAN_CERTIFICATE", "CV"],
      apps: [{ program: "Ausbildung Pflegefachmann/-frau (Nursing)", status: "EMPLOYER_INTERVIEW", month: 4, year: 2027, officer: officerDe }] },
    { first: "Rihan", last: "Ebrahim", org: kottayam, assigned: deDocs, creator: deDocs, pathway: "AUSBILDUNG", country: "Germany", dob: "2003-09-12", passportExpiry: "2034-06-20", backlogs: 0, gap: 2, tests: [{ test: "GERMAN", overall: "A2" }], docs: ["PASSPORT", "MARKSHEET_12"],
      apps: [{ program: "Ausbildung Pflegefachmann/-frau (Nursing)", status: "LANGUAGE_PENDING", month: 10, year: 2027, officer: officerDe }] },
    { first: "Simi", last: "Joseph", org: kottayam, assigned: ukDocs, creator: ukDocs, pathway: "NURSING", country: "United Kingdom", dob: "1995-12-01", passportExpiry: "2029-11-11", backlogs: 0, gap: 0, tests: [{ test: "OET", overall: "B" }], docs: ["PASSPORT", "DEGREE_CERTIFICATE", "NURSING_LICENSE", "ENGLISH_TEST", "CV"],
      apps: [{ program: "Registered Nurse (NMC) international recruitment", status: "BOARD_APPLICATION", month: 1, year: 2027, officer: officerNurse }] },
    { first: "Anto", last: "Mathew", org: kochi, assigned: partnerKochi, creator: partnerKochi, pathway: "DEGREE", country: "United Kingdom", dob: "2001-04-04", passportExpiry: "2031-04-04", backlogs: 3, gap: 1, tests: [{ test: "IELTS", overall: "6.0" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"],
      apps: [{ program: "BSc (Hons) Nursing (Adult)", status: "VISA_RECEIVED", month: 9, year: 2026, officer: admin }, { program: "MSc Digital Marketing", status: "UNCONDITIONAL_OFFER", month: 1, year: 2027, officer: admin }] },
    { first: "Aleesha", last: "Varghese", org: kochi, assigned: partnerKochi, creator: partnerKochi, pathway: "DEGREE", country: "Malta", dob: "2002-02-18", passportExpiry: "2035-02-18", backlogs: 0, gap: 2, tests: [], docs: ["PASSPORT"],
      apps: [{ program: "Postgraduate Diploma in Beauty Therapy", status: "PENDING_PARTNER", month: 2, year: 2027, officer: admin }] },
    { first: "Medhuna", last: "Suresh", org: thrissur, assigned: partnerTsr, creator: partnerTsr, pathway: "DEGREE", country: "United Kingdom", dob: "2000-08-08", passportExpiry: "2030-08-08", backlogs: 1, gap: 2, tests: [{ test: "IELTS", overall: "7.0" }], docs: ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"],
      apps: [{ program: "BSc (Hons) Nursing (Adult)", status: "SUBMITTED", month: 1, year: 2027, officer: admin }] },
  ];

  const months = (d: number) => new Date(Date.now() - d * 86400000);
  let dayOffset = 30;

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
        consentAt: months(dayOffset), consentText: "I agree to Medcity Overseas processing my data to apply to institutions and employers on my behalf.",
        profileLocked: s.apps.some((a) => a.status !== "ASSESSMENT"),
        createdAt: months(dayOffset),
      })
      .returning();
    if (!firstStudentId) firstStudentId = st.id;
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
      await db.insert(schema.statusHistory).values({ applicationId: app.id, toStatusId: statusId, changedById: a.officer?.id ?? s.creator.id, createdAt: created });
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

  trail.push(
    { actorId: admin.id, action: "programs.import", entityType: "program", entityId: "*", meta: { created: 12, updated: 0, skipped: 0 }, createdAt: months(21) },
    { actorId: admin.id, action: "partner.invite", entityType: "organization", entityId: thrissur.id, meta: { ownerEmail: "owner@horizon.test" }, createdAt: months(18) },
    { actorId: admin.id, action: "passport.reveal", entityType: "student", entityId: firstStudentId, meta: {}, createdAt: months(4) },
    { actorId: null, action: "whatsapp.inbound", entityType: "application", entityId: lastAppId, meta: { type: "text" }, createdAt: months(1) },
  );
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
  console.log("  management@medcityoverseas.test  Management (read-only)");
  console.log("  kottayam@medcity.test             Partner owner, Medcity Kottayam");
  console.log("  uk.docs@medcity.test              Counsellor, Medcity Kottayam");
  console.log("  owner@horizon.test                Sub-agent owner");
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
