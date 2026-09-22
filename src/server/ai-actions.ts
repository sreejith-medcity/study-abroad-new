"use server";

import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { LEVEL_LABEL, intakesText, tuitionText } from "@/lib/catalogue";
import { ADMIN_ROLES, APP_ROLES, HQ_ROLES } from "@/lib/permissions";
import { readUpload } from "@/server/storage";
import { INTERVIEW_KINDS, type InterviewKind } from "@/lib/interview";
import { aiAllowance, aiConfig, callClaude, recordAiUsage, replyText, type ClaudeMessage, type ClaudeTool } from "@/server/ai";

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type AssistantReply = { ok: true; text: string; left: number | null } | { ok: false; error: string };

const SYSTEM = `You are the assistant inside Medcity Overseas's partner portal, used by education counsellors in Kerala who send students abroad (degrees, Ausbildung in Germany, nurse registration).
Rules you never break:
- Figures (fees, scores, deadlines, work rights) come only from the search_programs tool. If the catalogue does not record a figure, say "not recorded" and suggest asking the Overseas team on the help desk. Never estimate or recall one from memory.
- A whole-course fee is never turned into a yearly figure. A CGPA is never converted to a percentage.
- Visa and immigration rules change: give the general shape only and point to the government's own page for the current rule.
- You cannot see students' files, applications or commission. Say so if asked.
- Be brief and practical. Use short paragraphs or "- " lists, **bold** sparingly. When you mention a program, give its link exactly as the tool returned it.`;

const TOOLS: ClaudeTool[] = [
  {
    name: "search_programs",
    description: "Search Medcity's live program catalogue. Returns up to 8 programs with the figures the catalogue records; anything not recorded is marked so.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find in the program, university or study area" },
        country_code: { type: "string", description: "Two-letter destination code, such as GB, IE, DE, CA, AU, NZ, US" },
        level: { type: "string", enum: ["UG", "PG", "PG_DIPLOMA", "UG_DIPLOMA", "PHD", "VOCATIONAL", "REGISTRATION", "CERTIFICATE"] },
      },
    },
  },
];

async function searchPrograms(input: { query?: string; country_code?: string; level?: string }) {
  const { programs: p, universities: u, countries: c } = schema;
  const q = (input.query ?? "").trim().slice(0, 80);
  const rows = await db
    .select({ id: p.id, name: p.name, level: p.level, uni: u.name, country: c.name, currency: c.currency, perYear: p.tuitionPerYear, total: p.tuitionTotal, fee: p.applicationFee, ielts: p.minIelts, pte: p.minPte, intakes: p.intakeMonths, work: p.workRights, months: p.durationMonths })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(
      and(
        eq(p.status, "LIVE"),
        q ? or(ilike(p.name, `%${q}%`), ilike(u.name, `%${q}%`), ilike(p.studyArea, `%${q}%`)) : undefined,
        input.country_code ? eq(c.code, input.country_code.toUpperCase().slice(0, 2)) : undefined,
        input.level ? sql`${p.level} = ${input.level}` : undefined,
      ),
    )
    .orderBy(asc(c.name), asc(u.name), asc(p.name))
    .limit(8);
  if (!rows.length) return "No live programs match.";
  return rows
    .map((r) =>
      [
        `${r.name} at ${r.uni}, ${r.country} (${LEVEL_LABEL[r.level] ?? r.level})`,
        `link: /programs/${r.id}`,
        `tuition: ${r.perYear == null && r.total == null ? "not recorded" : tuitionText(r.perYear, r.total, r.currency)}`,
        `application fee: ${r.fee == null ? "not recorded" : r.fee === 0 ? "none" : `${r.currency} ${r.fee}`}`,
        `English: ${[r.ielts != null && `IELTS ${r.ielts}`, r.pte != null && `PTE ${r.pte}`].filter(Boolean).join(", ") || "not recorded"}`,
        `intakes: ${r.intakes.length ? intakesText(r.intakes) : "not recorded"}`,
        `duration: ${r.months ? `${r.months} months` : "not recorded"}`,
        `post-study work: ${r.work === "ELIGIBLE" ? "eligible (institution confirms)" : r.work === "INELIGIBLE" ? "not eligible" : "not confirmed"}`,
      ].join("; "),
    )
    .join("\n");
}

/** One turn of the assistant, with up to three catalogue searches behind it. */
export async function askAssistantAction(history: ChatTurn[]): Promise<AssistantReply> {
  const user = await requireUser([...APP_ROLES]);
  const cfg = await aiConfig();
  if (!cfg?.enabled || !cfg.features.assistant) return { ok: false, error: "The assistant is not switched on." };
  const allowance = await aiAllowance(user, cfg);
  if (allowance.left <= 0) return { ok: false, error: `Your branch has used this month's ${allowance.limit} AI requests. They reset on the 1st.` };
  const turns = history.filter((t) => t.text.trim()).slice(-12).map((t) => ({ role: t.role, content: t.text.slice(0, 4000) }) as ClaudeMessage);
  if (!turns.length || turns[turns.length - 1].role !== "user") return { ok: false, error: "Ask a question first." };
  const messages: ClaudeMessage[] = [...turns];
  let input = 0;
  let output = 0;
  try {
    for (let round = 0; round < 4; round++) {
      const reply = await callClaude(cfg, { system: SYSTEM, messages, tools: TOOLS, maxTokens: 900 });
      input += reply.usage?.input_tokens ?? 0;
      output += reply.usage?.output_tokens ?? 0;
      const calls = reply.content.filter((c) => c.type === "tool_use");
      if (reply.stop_reason !== "tool_use" || !calls.length || round === 3) {
        await recordAiUsage(user, "assistant", { input_tokens: input, output_tokens: output });
        const text = replyText(reply) || "I could not find an answer to that. Try the help desk.";
        return { ok: true, text, left: allowance.limit == null ? null : allowance.left - 1 };
      }
      messages.push({ role: "assistant", content: reply.content });
      const results = [];
      for (const c of calls) {
        if (c.type !== "tool_use") continue;
        const out = c.name === "search_programs" ? await searchPrograms(c.input as { query?: string }) : "Unknown tool.";
        results.push({ type: "tool_result" as const, tool_use_id: c.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    await audit(user.id, "ai.error", "ai", "assistant", { message: (e as Error).message });
    return { ok: false, error: `The AI service could not answer: ${(e as Error).message}` };
  }
  return { ok: false, error: "No answer." };
}

export type Line = { role: "interviewer" | "student"; text: string };
export type InterviewTurn = { ok: true; question?: string; feedback?: string; sessionId?: string; left: number | null } | { ok: false; error: string };

const QUESTIONS = 6;

/**
 * One step of a practice interview: the next question, or after six answers
 * the feedback, which is saved. Only the course, university, country and
 * intake go to the AI service, never the student's name or documents.
 */
export async function interviewTurnAction(input: { kind: string; applicationId: string | null; transcript: Line[] }): Promise<InterviewTurn> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const cfg = await aiConfig();
  if (!cfg?.enabled || !cfg.features.interview) return { ok: false, error: "Practice interviews are not switched on." };
  if (!(input.kind in INTERVIEW_KINDS)) return { ok: false, error: "Choose the kind of interview." };
  const allowance = await aiAllowance(user, cfg);
  if (allowance.left <= 0) return { ok: false, error: `Your branch has used this month's ${allowance.limit} AI requests. They reset on the 1st.` };

  let context = "No particular application.";
  let studentId: string | null = null;
  if (input.applicationId) {
    const app = await db.query.applications.findFirst({
      where: eq(schema.applications.id, input.applicationId),
      with: { program: { with: { university: { with: { country: true } } } } },
    });
    if (!app || (!(HQ_ROLES as readonly string[]).includes(user.role) && app.orgId !== user.orgId)) return { ok: false, error: "That application is not yours." };
    studentId = app.studentId;
    context = `${LEVEL_LABEL[app.program.level] ?? app.program.level}: ${app.program.name} at ${app.program.university.name}, ${app.program.university.country.name}, intake ${app.intakeMonth}/${app.intakeYear}.`;
  }
  const transcript = input.transcript.slice(0, QUESTIONS * 2).map((l) => ({ role: l.role, text: String(l.text).slice(0, 2000) }));
  const answers = transcript.filter((l) => l.role === "student").length;
  const kind = INTERVIEW_KINDS[input.kind as InterviewKind];
  const system = `You are playing the interviewer in a practice ${kind} for an Indian student. Application: ${context}
Ask one question at a time, the kind a real officer asks: why this course and university, the career plan, finances and who pays, study gaps, ties to India where the interview tests intent. Follow up on weak or vague answers. Keep each question to one or two sentences. Never give feedback until asked for it. Do not invent facts about the university; if you need one, ask the student.`;
  const asText = transcript.map((l) => `${l.role === "interviewer" ? "Interviewer" : "Student"}: ${l.text}`).join("\n");

  try {
    if (answers < QUESTIONS) {
      const reply = await callClaude(cfg, {
        system,
        messages: [{ role: "user", content: transcript.length ? `The interview so far:\n${asText}\n\nAsk the next question only.` : "Begin the interview. Ask the first question only." }],
        maxTokens: 200,
      });
      await recordAiUsage(user, "interview", reply.usage);
      return { ok: true, question: replyText(reply), left: allowance.limit == null ? null : allowance.left - 1 };
    }
    const reply = await callClaude(cfg, {
      system: `${system}\nThe interview is over. Now you are the coach.`,
      messages: [
        {
          role: "user",
          content: `The interview:\n${asText}\n\nGive feedback for the student and counsellor. Start with a one-line verdict. Then "- " lists under **Strong answers**, **Answers to work on** (quote the weak answer briefly and say how to answer better) and **Risks an officer would note**. End with a readiness score out of 5 for each of: course and university knowledge, career plan, finances, genuine intent, communication. No preamble.`,
        },
      ],
      maxTokens: 1200,
    });
    await recordAiUsage(user, "interview", reply.usage);
    const feedback = replyText(reply);
    const [row] = await db
      .insert(schema.interviewSessions)
      .values({ orgId: user.orgId, studentId, kind: input.kind, context, transcript, feedback, createdById: user.id })
      .returning({ id: schema.interviewSessions.id });
    await audit(user.id, "ai.interview", "interview_session", row.id, { kind: input.kind, studentId });
    return { ok: true, feedback, sessionId: row.id, left: allowance.limit == null ? null : allowance.left - 1 };
  } catch (e) {
    await audit(user.id, "ai.error", "ai", "interview", { message: (e as Error).message });
    return { ok: false, error: `The AI service could not answer: ${(e as Error).message}` };
  }
}

export type Extracted =
  | { ok: true; kind: "passport"; fields: { passportNumber: string | null; passportIssue: string | null; passportExpiry: string | null; passportIssueCountry: string | null; dateOfBirth: string | null; cityOfBirth: string | null }; left: number | null }
  | { ok: true; kind: "academic"; fields: { level: string | null; institution: string | null; course: string | null; gradingSystem: string | null; score: number | null; yearCompleted: number | null }; left: number | null }
  | { ok: true; kind: "test"; fields: { test: string | null; overall: string | null; takenOn: string | null }; left: number | null }
  | { ok: false; error: string };

const READERS: Record<string, { kind: "passport" | "academic" | "test"; ask: string }> = {
  PASSPORT: {
    kind: "passport",
    ask: `This is an Indian passport. Reply with JSON only: {"passportNumber": string|null, "passportIssue": "YYYY-MM-DD"|null, "passportExpiry": "YYYY-MM-DD"|null, "passportIssueCountry": string|null, "dateOfBirth": "YYYY-MM-DD"|null, "cityOfBirth": string|null}. Use null for anything you cannot read clearly. The issue country is the issuing country's name, not the place of issue.`,
  },
  MARKSHEET_12: { kind: "academic", ask: "" },
  DEGREE_MARKSHEETS: { kind: "academic", ask: "" },
  DEGREE_CERTIFICATE: { kind: "academic", ask: "" },
  ENGLISH_TEST: {
    kind: "test",
    ask: `This is an English test report. Reply with JSON only: {"test": "IELTS"|"PTE"|"OET"|"TOEFL"|"DUOLINGO"|null, "overall": string|null, "takenOn": "YYYY-MM-DD"|null}. "overall" is the overall band, score or grade exactly as printed. Use null for anything you cannot read clearly.`,
  },
};
const ACADEMIC_ASK = `This is an Indian marksheet or degree certificate. Reply with JSON only: {"level": "SCHOOL"|"UG_DIPLOMA"|"UG"|"PG_DIPLOMA"|"PG"|null, "institution": string|null, "course": string|null, "gradingSystem": "percentage"|"cgpa10"|"cgpa4"|null, "score": number|null, "yearCompleted": number|null}.
SCHOOL means Std. 12th. "score" is the aggregate exactly as printed: a percentage only if the document prints one, a CGPA only if it prints one. Never convert a CGPA to a percentage or work out a percentage from marks. If neither is printed, score and gradingSystem are null. Use null for anything you cannot read clearly.`;

function firstJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** Reads one uploaded document with the AI service and returns what it found, for a person to check and save. Nothing is saved here. */
export async function extractDocumentAction(documentId: string): Promise<Extracted> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const cfg = await aiConfig();
  if (!cfg?.enabled || !cfg.features.autofill) return { ok: false, error: "Reading documents is not switched on." };
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId), with: { student: { columns: { orgId: true } } } });
  if (!doc || (!(HQ_ROLES as readonly string[]).includes(user.role) && doc.student.orgId !== user.orgId)) return { ok: false, error: "That document is not yours." };
  const reader = READERS[doc.typeCode ?? ""];
  if (!reader) return { ok: false, error: "Only passports, Std. 12th and degree marksheets, and English test reports can be read." };
  const allowance = await aiAllowance(user, cfg);
  if (allowance.left <= 0) return { ok: false, error: `Your branch has used this month's ${allowance.limit} AI requests. They reset on the 1st.` };

  let bytes: Buffer;
  try {
    bytes = await readUpload(doc.storageKey);
  } catch {
    return { ok: false, error: "The file is missing from storage." };
  }
  const data = bytes.toString("base64");
  const block =
    doc.mimeType === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: doc.mimeType, data } } as const);
  let json: Record<string, unknown> | null = null;
  try {
    const reply = await callClaude(cfg, {
      system: "You read documents for an education consultancy and return exactly the fields asked for, as JSON, with null for anything unclear. You never guess.",
      messages: [{ role: "user", content: [block, { type: "text", text: reader.kind === "academic" ? ACADEMIC_ASK : reader.ask }] }],
      maxTokens: 400,
    });
    await recordAiUsage(user, "autofill", reply.usage);
    json = firstJson(replyText(reply));
  } catch (e) {
    await audit(user.id, "ai.error", "ai", "autofill", { message: (e as Error).message });
    return { ok: false, error: `The AI service could not read it: ${(e as Error).message}` };
  }
  await audit(user.id, "ai.autofill", "document", doc.id, { typeCode: doc.typeCode });
  if (!json) return { ok: false, error: "The document could not be read. Enter the details by hand." };
  const left = allowance.limit == null ? null : allowance.left - 1;
  if (reader.kind === "passport") {
    const num = str(json.passportNumber, 20)?.toUpperCase().replace(/\s/g, "") ?? null;
    return { ok: true, kind: "passport", left, fields: { passportNumber: num, passportIssue: day(json.passportIssue), passportExpiry: day(json.passportExpiry), passportIssueCountry: str(json.passportIssueCountry, 60), dateOfBirth: day(json.dateOfBirth), cityOfBirth: str(json.cityOfBirth, 80) } };
  }
  if (reader.kind === "test") {
    const test = str(json.test, 10);
    return { ok: true, kind: "test", left, fields: { test: test && ["IELTS", "PTE", "OET", "TOEFL", "DUOLINGO"].includes(test) ? test : null, overall: str(json.overall, 10), takenOn: day(json.takenOn) } };
  }
  const grading = str(json.gradingSystem, 12);
  const score = typeof json.score === "number" && json.score >= 0 && json.score <= 100 ? json.score : null;
  const year = typeof json.yearCompleted === "number" && json.yearCompleted > 1970 && json.yearCompleted < 2100 ? Math.round(json.yearCompleted) : null;
  const level = str(json.level, 12);
  return {
    ok: true,
    kind: "academic",
    left,
    fields: {
      level: level && ["SCHOOL", "UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG"].includes(level) ? level : null,
      institution: str(json.institution, 150),
      course: str(json.course, 150),
      gradingSystem: grading && ["percentage", "cgpa10", "cgpa4"].includes(grading) ? grading : null,
      score: grading ? score : null,
      yearCompleted: year,
    },
  };
}
