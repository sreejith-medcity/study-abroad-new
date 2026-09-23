import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { EMAIL, PHONE, day, num, oneOf, text, yes, type Problems } from "@/lib/import-values";
import { createId } from "@/lib/id";
import { branchOwner, branchResolver, emptyResult, lineOf, phoneKey, staffByEmail, type ImportResult } from "./common";

export const STUDENT_COLUMNS = [
  "branch", "first_name", "last_name", "email", "phone", "counsellor_email", "consent",
  "date_of_birth", "gender", "marital_status", "nationality", "address_line1", "address_line2", "city", "state", "pincode",
  "passport_number", "passport_issue", "passport_expiry", "passport_issue_country", "city_of_birth",
  "backlogs", "gap_years", "preferred_country", "preferred_pathway",
  "twelfth_percent", "twelfth_year", "twelfth_institution",
  "bachelors_score", "bachelors_grading", "bachelors_institution", "bachelors_course", "bachelors_year",
  "ielts", "pte", "toefl", "duolingo", "oet", "german", "gre", "gmat",
] as const;

export const STUDENT_EXAMPLE = [
  "", "Anjali", "Menon", "anjali.menon@example.com", "+91 98470 12345", "", "yes",
  "2003-04-18", "Female", "Single", "India", "Kizhakkedathu House", "Near Market Road", "Kottayam", "Kerala", "686001",
  "", "", "", "", "",
  "0", "1", "United Kingdom", "DEGREE",
  "86", "2021", "St. Mary's Higher Secondary School",
  "7.8", "cgpa10", "CMS College Kottayam", "BSc Nursing", "2025",
  "6.5", "", "", "", "", "", "", "",
];

const CONSENT = "Consent confirmed by the branch when the student's details were uploaded in bulk.";
const TESTS = [["ielts", "IELTS"], ["pte", "PTE"], ["toefl", "TOEFL"], ["duolingo", "DUOLINGO"], ["oet", "OET"], ["german", "GERMAN"], ["gre", "GRE"], ["gmat", "GMAT"]] as const;

type Row = Record<string, string>;

/**
 * Students from a sheet. New students need consent confirmed in the file.
 *
 * A row is matched to a student already in the branch by email; where the row
 * has no email, by the last ten digits of the phone number and the student's
 * name together, because a family often shares one number and a brother is not
 * the same person. A student matched this way only has blank fields filled in:
 * nothing someone entered is overwritten, and a locked profile is left alone.
 * Qualifications and scores are added when that level or that score is not on
 * file yet. A CGPA stays a CGPA.
 *
 * A student with no email is created all the same, on the phone number alone.
 * The student portal needs an address, so the file says so and the profile
 * carries it until somebody adds one.
 */
export async function importStudents(user: SessionUser, rows: Row[], commit: boolean): Promise<ImportResult> {
  const out = emptyResult();
  const resolve = await branchResolver(user);
  const seen = new Set<string>();

  type Plan = {
    line: number;
    orgId: string;
    email: string | null;
    fields: Record<string, unknown>;
    counsellorEmail: string | null;
    consent: boolean;
    /** The last ten digits of the phone number, which is what identifies a student with no email. */
    phoneKey: string | null;
    academics: { level: "SCHOOL" | "UG"; institution: string | null; course: string | null; gradingSystem: string; score: number | null; yearCompleted: number | null }[];
    tests: { test: string; overall: string }[];
    label: string;
  };
  const plans: Plan[] = [];

  rows.forEach((r, i) => {
    const line = lineOf(i);
    const p: Problems = [];
    /** Values that could not be used but are not worth stopping the row for. */
    const ignored: string[] = [];
    const org = resolve(r.branch);
    if (typeof org === "string") p.push(org);
    const first = text(r.first_name, 80);
    const last = text(r.last_name, 80);
    const email = (r.email ?? "").trim().toLowerCase() || null;
    const phone = text(r.phone, 20);
    if (!first) p.push("first_name is required");
    if (!last) p.push("last_name is required");
    if (email && !EMAIL.test(email)) p.push("email: that is not an email address");
    if (phone && !PHONE.test(phone)) p.push("phone: use a mobile number with country code, like +91 98470 12345");
    if (!email && !phone) p.push("give an email or a phone number, so the student can be told apart from the next one");
    const digits = phoneKey(phone);
    // Without an email, the phone and the name together are the student.
    const id = email ?? (digits ? `${digits}|${(first ?? "").toLowerCase()} ${(last ?? "").toLowerCase()}` : null);
    const key = typeof org === "string" ? id : `${org.id}|${id}`;
    if (id && seen.has(key!)) p.push(`${email ?? phone} is in the file twice`);
    if (key) seen.add(key);

    const fields: Record<string, unknown> = {
      firstName: first,
      lastName: last,
      phone,
      dateOfBirth: day(r.date_of_birth, "date_of_birth", p),
      gender: text(r.gender, 20),
      maritalStatus: text(r.marital_status, 20),
      nationality: text(r.nationality, 60),
      addressLine1: text(r.address_line1),
      addressLine2: text(r.address_line2),
      city: text(r.city, 80),
      state: text(r.state, 80),
      pincode: text(r.pincode, 12),
      passportNumber: text(r.passport_number, 20)?.toUpperCase().replace(/\s/g, "") ?? null,
      passportIssue: day(r.passport_issue, "passport_issue", p),
      passportExpiry: day(r.passport_expiry, "passport_expiry", p),
      passportIssueCountry: text(r.passport_issue_country, 60),
      cityOfBirth: text(r.city_of_birth, 80),
      backlogs: num(r.backlogs, "backlogs", p, { int: true, min: 0, max: 99 }),
      gapYears: num(r.gap_years, "gap_years", p, { int: true, min: 0, max: 99 }),
      preferredCountry: text(r.preferred_country, 60),
      // A preference nobody can act on is not worth losing a student over: an
      // unrecognised value is left blank and said out loud, not held against the row.
      preferredPathway: (() => {
        const soft: Problems = [];
        const hit = oneOf(r.preferred_pathway, "preferred_pathway", schema.pathway.enumValues, soft, { degree: "DEGREE", ausbildung: "AUSBILDUNG", nursing: "NURSING" });
        if (soft.length) ignored.push(`preferred_pathway: "${String(r.preferred_pathway).trim()}" is not degree, Ausbildung or nursing, so it was left blank`);
        return hit;
      })(),
    };
    const pass = fields.passportNumber as string | null;
    if (pass && !/^[A-Z0-9]{6,12}$/.test(pass)) p.push("passport_number: letters and digits only");

    const academics: Plan["academics"] = [];
    const twelfth = num(r.twelfth_percent, "twelfth_percent", p, { min: 0, max: 100 });
    if (twelfth != null || text(r.twelfth_institution)) {
      academics.push({ level: "SCHOOL", institution: text(r.twelfth_institution, 150), course: null, gradingSystem: "percentage", score: twelfth, yearCompleted: num(r.twelfth_year, "twelfth_year", p, { int: true, min: 1970, max: 2100 }) });
    }
    const grading = oneOf(r.bachelors_grading, "bachelors_grading", ["PERCENTAGE", "CGPA10", "CGPA4"] as const, p, { percent: "PERCENTAGE", "%": "PERCENTAGE", "cgpa": "CGPA10", "gpa": "CGPA4" });
    const bScore = num(r.bachelors_score, "bachelors_score", p, { min: 0, max: 100 });
    if (bScore != null && !grading) p.push("bachelors_grading: say percentage, cgpa10 or cgpa4 so a CGPA is never read as a percentage");
    if (grading === "CGPA10" && bScore != null && bScore > 10) p.push("bachelors_score: a CGPA out of 10 cannot be above 10");
    if (grading === "CGPA4" && bScore != null && bScore > 4) p.push("bachelors_score: a GPA out of 4 cannot be above 4");
    if (bScore != null || text(r.bachelors_institution)) {
      academics.push({ level: "UG", institution: text(r.bachelors_institution, 150), course: text(r.bachelors_course, 150), gradingSystem: (grading ?? "PERCENTAGE").toLowerCase(), score: bScore, yearCompleted: num(r.bachelors_year, "bachelors_year", p, { int: true, min: 1970, max: 2100 }) });
    }
    for (const a of academics) if (!a.institution) p.push(`${a.level === "SCHOOL" ? "twelfth" : "bachelors"}_institution is needed with the marks`);

    const tests: Plan["tests"] = [];
    for (const [col, test] of TESTS) {
      const v = text(r[col], 10);
      if (v) tests.push({ test, overall: v });
    }

    if (p.length) {
      out.errors.push({ line, message: p.join("; ") });
      return;
    }
    for (const note of ignored) out.notes.push({ line, message: note });
    const o = org as { id: string; name: string };
    plans.push({
      line,
      orgId: o.id,
      email,
      phoneKey: digits,
      fields: { ...fields, ...(email ? { email } : {}) },
      counsellorEmail: text(r.counsellor_email)?.toLowerCase() ?? null,
      consent: yes(r.consent),
      academics,
      tests,
      label: `${first} ${last} · ${email ?? phone} · ${o.name}`,
    });
  });

  const orgIds = [...new Set(plans.map((x) => x.orgId))];
  const staff = await staffByEmail(orgIds);
  const emails = [...new Set(plans.map((x) => x.email).filter((x): x is string => !!x))];
  const phones = [...new Set(plans.map((x) => x.phoneKey).filter((x): x is string => !!x))];
  const digitsSql = sql`right(regexp_replace(${schema.students.phone}, '[^0-9]', '', 'g'), 10)`;
  const existing = orgIds.length && (emails.length || phones.length)
    ? await db.query.students.findMany({
        where: and(
          inArray(schema.students.orgId, orgIds),
          or(
            emails.length ? inArray(schema.students.email, emails) : undefined,
            phones.length ? sql`${digitsSql} in (${sql.join(phones.map((x) => sql`${x}`), sql`, `)})` : undefined,
          ),
        ),
        with: { academics: true, tests: true },
      })
    : [];
  const byEmail = new Map(existing.filter((s) => s.email).map((s) => [`${s.orgId}|${s.email!.toLowerCase()}`, s]));
  // Phone and name together, so two people on one family number stay two people.
  const byPhone = new Map<string, (typeof existing)[number]>();
  for (const s of existing) {
    const k = `${s.orgId}|${phoneKey(s.phone)}|${s.firstName.toLowerCase()} ${s.lastName.toLowerCase()}`;
    if (!byPhone.has(k)) byPhone.set(k, s);
  }
  const owners = new Map<string, string | null>();
  for (const id of orgIds) owners.set(id, (await branchOwner(id))?.id ?? null);

  const toCreate: { plan: Plan; assignedToId: string | null; id: string }[] = [];
  for (const plan of plans) {
    let assignedToId: string | null = null;
    if (plan.counsellorEmail) {
      const hit = staff.get(`${plan.orgId}|${plan.counsellorEmail}`);
      if (!hit) {
        out.errors.push({ line: plan.line, message: `counsellor_email: ${plan.counsellorEmail} is not an active person in this branch` });
        continue;
      }
      assignedToId = hit.id;
    }
    const current =
      (plan.email ? byEmail.get(`${plan.orgId}|${plan.email}`) : undefined) ??
      (plan.phoneKey ? byPhone.get(`${plan.orgId}|${plan.phoneKey}|${String(plan.fields.firstName).toLowerCase()} ${String(plan.fields.lastName).toLowerCase()}`) : undefined);
    if (!current) {
      if (!plan.consent) {
        out.errors.push({ line: plan.line, message: "consent: a new student needs \"yes\" to confirm the branch has their consent" });
        continue;
      }
      if (!plan.fields.phone) {
        out.errors.push({ line: plan.line, message: "phone is required for a new student" });
        continue;
      }
      if (!plan.email) out.notes.push({ line: plan.line, message: "no email, so the student is kept on their phone number and cannot use the student portal until an address is added" });
      out.created++;
      if (out.sample.length < 8) out.sample.push(`New: ${plan.label}`);
      if (commit) toCreate.push({ plan, id: createId(), assignedToId: assignedToId ?? (user.role === "COUNSELLOR" ? user.id : owners.get(plan.orgId) ?? null) });
      continue;
    }

    if (current.profileLocked) {
      out.skipped++;
      out.notes.push({ line: plan.line, message: `${plan.email ?? plan.fields.phone}: profile is locked because an application was submitted, so it was left as it is` });
      continue;
    }
    // Fill blanks only: a value already on file always wins.
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(plan.fields)) {
      if (v == null) continue;
      const have = current[k as keyof typeof current];
      if (have == null || have === "") set[k] = ["dateOfBirth", "passportIssue", "passportExpiry"].includes(k) ? new Date(v as string) : v;
    }
    if (set.email && byEmail.has(`${plan.orgId}|${plan.email}`) && byEmail.get(`${plan.orgId}|${plan.email}`)!.id !== current.id) {
      delete set.email;
      out.notes.push({ line: plan.line, message: `${plan.email} already belongs to somebody else in this branch, so it was left off` });
    }
    if (assignedToId && !current.assignedToId) set.assignedToId = assignedToId;
    const newAcademics = plan.academics.filter((a) => !current.academics.some((x) => x.level === a.level));
    const newTests = plan.tests.filter((t) => !current.tests.some((x) => x.test === t.test && x.overall === t.overall && !x.isMock));
    if (!Object.keys(set).length && !newAcademics.length && !newTests.length) {
      out.unchanged++;
      continue;
    }
    out.updated++;
    if (out.sample.length < 8) out.sample.push(`Fill in: ${plan.label} (${[...Object.keys(set), ...newAcademics.map((a) => (a.level === "SCHOOL" ? "12th marks" : "bachelor's")), ...newTests.map((t) => t.test)].join(", ")})`);
    if (!commit) continue;
    if (Object.keys(set).length) await db.update(schema.students).set({ ...set, updatedAt: new Date() }).where(eq(schema.students.id, current.id));
    if (newAcademics.length) await db.insert(schema.academicRecords).values(newAcademics.map((a) => ({ ...a, institution: a.institution!, studentId: current.id })));
    if (newTests.length) await db.insert(schema.testScores).values(newTests.map((t) => ({ ...t, studentId: current.id })));
    await audit(user.id, "student.profile.update", "student", current.id, { source: "bulk upload", fields: Object.keys(set) });
  }

  // New students go in batches, so a sheet of thousands stays within the host's request time.
  const asDate = (v: unknown) => (v ? new Date(v as string) : null);
  for (let i = 0; i < toCreate.length; i += 250) {
    const chunk = toCreate.slice(i, i + 250);
    const made = await db
      .insert(schema.students)
      .values(
        chunk.map(({ plan, assignedToId, id }) => {
          const f = plan.fields;
          const values = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null));
          return {
            ...(values as object),
            id,
            orgId: plan.orgId,
            email: plan.email,
            firstName: f.firstName as string,
            lastName: f.lastName as string,
            phone: f.phone as string,
            dateOfBirth: asDate(f.dateOfBirth),
            passportIssue: asDate(f.passportIssue),
            passportExpiry: asDate(f.passportExpiry),
            createdById: user.id,
            assignedToId,
            consentAt: new Date(),
            consentText: CONSENT,
            source: "import",
          } as typeof schema.students.$inferInsert;
        }),
      )
      .returning({ id: schema.students.id });
    const academics = chunk.flatMap(({ plan, id }) => plan.academics.map((a) => ({ ...a, institution: a.institution!, studentId: id })));
    const tests = chunk.flatMap(({ plan, id }) => plan.tests.map((t) => ({ ...t, studentId: id })));
    if (academics.length) await db.insert(schema.academicRecords).values(academics);
    if (tests.length) await db.insert(schema.testScores).values(tests);
    await db.insert(schema.auditLogs).values(made.map((m) => ({ actorId: user.id, action: "student.create", entityType: "student", entityId: m.id, meta: { source: "bulk upload" } })));
  }
  return out;
}
