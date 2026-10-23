import "server-only";
import ExcelJS from "exceljs";
import { kindLabel } from "@/lib/dashboard-kinds";
import { DEADLINE_LABEL } from "@/lib/deadline-types";
import { AGE_LABEL } from "@/lib/invoicing";
import { isStaff } from "@/lib/permissions";
import { commissionVisible } from "./commission-visibility";
import { dashboardTiles } from "./dashboard-tiles";
import { branchesCompared, destinations, journey, monthly, stages } from "./dashboard-charts";
import { deadlinesThisWeek, documentBoard, documentFigures, documentsToCome, followUps, officerLoad, pastServiceLevel, pipeline, placements, teamBoard, unassigned } from "./dashboard-work";
import { moneyFigures } from "./dashboard-money";
import { deskStanding } from "./documentation";
import { PERIODS, type Lens } from "./dashboard-lens";

/*
 * A dashboard as a workbook, for a meeting or a report.
 *
 * The same lens as the screen, so the file says exactly what the person was
 * looking at: their own role's dashboard or the one they were viewing as, the
 * branch or counsellor picked, and the period. The first sheet is the figures,
 * each with a line on what it counts; the rest are the lists behind them in
 * full, not the handful a screen has room for.
 *
 * Money is written as numbers in rupees with a rupee format, so a column can
 * be summed; nothing is converted that was not already converted on screen.
 */

const RUPEES = '"₹"#,##0';
const BRAND = "FFC01F53";

type Row = (string | number | Date | null | undefined)[];

function sheet(wb: ExcelJS.Workbook, name: string, head: string[], rows: Row[], widths?: number[], money: number[] = []) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(head);
  const top = ws.getRow(1);
  top.font = { bold: true, color: { argb: "FFFFFFFF" } };
  top.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  for (const r of rows) ws.addRow(r.map((v) => (v === undefined ? null : v)));
  head.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = widths?.[i] ?? Math.min(48, Math.max(12, h.length + 4));
    if (money.includes(i)) col.numFmt = RUPEES;
  });
  if (rows.length === 0) ws.addRow(["Nothing to list"]);
  return ws;
}

export async function dashboardWorkbook(lens: Lens) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Medcity Overseas portal";
  wb.created = new Date();
  const when = PERIODS.find(([k]) => k === lens.period)?.[1] ?? "All time";
  const scope =
    lens.kind === "counsellor"
      ? lens.person
        ? `${lens.person.name}'s own students`
        : "Every counsellor's students"
      : lens.kind === "finance"
        ? "The whole portal"
        : (lens.orgName ?? (isStaff(lens.user) ? "All branches and partners" : lens.user.orgName));

  // The cover: what this is, for whom and when.
  const cover: Row[] = [
    ["Dashboard", kindLabel(lens.kind)],
    ["Covering", scope],
    ["Period", when],
    ["Downloaded by", lens.user.name],
    ["Downloaded at", new Date()],
  ];
  const figures: Row[] = [];
  const add = (label: string, value: number | string | null, note = "") => figures.push([label, value, note]);

  if (lens.kind === "finance") {
    const m = await moneyFigures(lens);
    add("Earned, not invoiced", m.expected, "Commission still expected, in rupees");
    add("Ready to invoice (lines)", m.ready.lines, "Milestone reached, rate recorded");
    add("Ready to invoice (value)", m.ready.inr, "In rupees");
    add("Waiting on a milestone", m.ready.waiting);
    add("No rate recorded", m.ready.unpriced);
    add("Invoiced, not paid", m.outstanding.inr, `${m.outstanding.invoices} invoices, in rupees`);
    add("Past due", m.late.inr, `${m.late.invoices} invoices, in rupees`);
    add(lens.period === "all" ? "Received" : `Received, ${when.toLowerCase()}`, m.received.inr, "In rupees");
    add("Payouts asked for", m.payouts.n, `Worth ${m.payouts.inr} rupees`);
    add("Disputed invoices", m.disputed);
    add("Drafts", m.drafts);
    sheet(wb, "Cover", ["", ""], cover, [18, 40]);
    const ws = sheet(wb, "Figures", ["Figure", "Value", "What it counts"], figures, [30, 16, 50]);
    for (const r of [2, 4, 7, 8, 9]) ws.getRow(r).getCell(2).numFmt = RUPEES;
    sheet(wb, "Ageing", ["How late", "Invoices", "Owed (rupees)"], m.buckets.map((b) => [AGE_LABEL[b.bucket], b.count, b.inr]), [26, 12, 18], [2]);
    sheet(wb, "Money in by month", ["Month", "Received (rupees)"], m.months.map((p) => [p.key, p.value]), [14, 20], [1]);
    sheet(wb, "Latest payments", ["Received on", "Vendor", "Invoice", "Currency", "Amount", "In rupees"], m.latest.map((p) => [p.on, p.vendor, p.number, p.currency, p.amount, p.inr]), [14, 28, 18, 10, 14, 14], [5]);
    return wb;
  }

  if (lens.kind === "documentation") {
    const [f, board, owed, standing] = await Promise.all([documentFigures(lens), documentBoard(lens, 5000), documentsToCome(lens, 5000), deskStanding()]);
    add("Waiting for a check", f.waiting, "Uploaded, nobody has claimed it");
    add(f.mine ? "With me" : "Being checked", f.claimed);
    add("Asked, not in", f.asked);
    add("Sent back", f.sentBack);
    add("Past due", f.overdue);
    add("Accepted this week", f.acceptedWeek);
    add("Expiring in 60 days", f.expiring);
    add("Students owing", f.students);
    sheet(wb, "Cover", ["", ""], cover, [18, 40]);
    sheet(wb, "Figures", ["Figure", "Value", "What it counts"], figures, [30, 12, 44]);
    sheet(
      wb,
      "Documents",
      ["Stage", "Student", "Document", "Branch", "Days", "With", "Past due"],
      board.flatMap((c) => c.cards.map((d) => [c.label, d.student, d.document, d.branch, d.days, d.who ?? "", d.overdue ? "Yes" : ""])),
      [20, 24, 30, 24, 8, 20, 10],
    );
    sheet(wb, "Students owing", ["Student", "Asked", "In", "Still owed"], owed.rows.map((r) => [r.student, r.asked, r.in, r.owed]), [28, 10, 10, 12]);
    sheet(wb, "Who has what", ["Officer", "In hand", "Decided this week", "Sent back this week"], standing.map((o) => [o.name, o.carrying, o.decidedWeek, o.sentBackWeek]), [26, 10, 18, 20]);
    return wb;
  }

  // Leadership, the processing desk, a branch and a counsellor all count
  // students and applications, so they share the figures and the lists.
  const money = await commissionVisible(lens.user);
  const [t, steps, months, standing, compared, going, late] = await Promise.all([
    dashboardTiles(lens),
    journey(lens),
    monthly(lens),
    stages(lens),
    branchesCompared(lens, 500),
    destinations(lens, 50),
    pastServiceLevel(lens),
  ]);
  add("Total registrations", t.registrations.value, lens.period === "all" ? "Students on the books" : `Registered, ${when.toLowerCase()}`);
  add("Total applications", t.applications.value);
  add("Offers received", t.offers.value, "Counting those now further on");
  add("Visas received", t.visaReceived.value, "Visa in hand or further");
  add("Visas rejected", t.visaRejected.value, "Refused at least once");
  add("Pending documents", t.documents.items, `Across ${t.documents.students} students, now`);
  add("Deferrals", t.deferrals, "Now");
  add("Payments done", t.feesPaid, "Now");
  add("Payments pending", t.feesDue, "Now");
  add("Pending from branches", t.fromBranches.n, "Now");
  add("Pending from partners", t.fromSubAgents.n, "Now");
  add("Past service level", late, "Open files sat at a stage too long, now");
  if (t.revenue && money) {
    add("Revenue expected (rupees)", t.revenue.expected, "Now");
    add("Revenue received (rupees)", t.revenue.received, "Now");
  }
  sheet(wb, "Cover", ["", ""], cover, [18, 40]);
  const ws = sheet(wb, "Figures", ["Figure", "Value", "What it counts"], figures, [30, 14, 44]);
  if (t.revenue && money) for (const r of [figures.length, figures.length + 1]) ws.getRow(r).getCell(2).numFmt = RUPEES;

  const board = await pipeline(lens, 5000);
  sheet(
    wb,
    "Applications by stage",
    ["Stage", "Student", "Country", "University", "Course", "Branch", "Days at stage", "Past service level"],
    board.flatMap((c) => c.cards.map((a) => [c.label, a.student, a.country ?? "", a.university, a.program, a.branch, a.days, a.late ? "Yes" : ""])),
    [18, 24, 16, 30, 34, 24, 12, 16],
  );
  sheet(wb, "Journey", ["Step", "Students"], steps.map((s) => [s.label, s.value]), [16, 12]);
  sheet(wb, "Month by month", ["Month", "Registrations", "Applications"], months.map((m) => [`${m.label} ${m.year}`, m.registrations, m.applications]), [14, 14, 14]);
  sheet(wb, "Where applications stand", ["Stage", "Applications"], standing.map((s) => [s.label, s.value]), [22, 14]);
  sheet(wb, "Where students want to go", ["Country", "Students"], [...going.rows.map((r) => [r.label, r.value]), ["Not recorded", going.notRecorded]], [24, 12]);

  if (lens.kind === "leadership" || lens.kind === "desk") {
    if (compared.length) sheet(wb, "Branches compared", ["Branch", "Sub-agent", "Registered", "Applied", "Visas"], compared.map((b) => [b.name, b.subAgent ? "Yes" : "", b.registered, b.applied, b.visas]), [32, 10, 12, 12, 10]);
  }
  if (lens.kind === "desk") {
    const [load, week] = await Promise.all([officerLoad(lens), deadlinesThisWeek(lens, 5000)]);
    sheet(wb, "Who is carrying what", ["Officer", "Open files", "Past service level", "Oldest (days)"], load.map((o) => [o.name, o.open, o.late, o.oldest]), [24, 12, 18, 14]);
    sheet(wb, "Deadlines this week", ["Due", "Milestone", "Student", "University"], week.items.map((d) => [d.dueOn, DEADLINE_LABEL[d.type] ?? d.type, d.student, d.university]), [12, 22, 24, 30]);
  }
  if (lens.kind === "branch" || lens.kind === "counsellor" || lens.kind === "leadership") {
    const [owed, placed] = await Promise.all([documentsToCome(lens, 5000), placements(lens)]);
    sheet(wb, "Documents still to come", ["Student", "Asked", "In", "Still owed"], owed.rows.map((r) => [r.student, r.asked, r.in, r.owed]), [28, 10, 10, 12]);
    sheet(
      wb,
      "Placements",
      ["Pathway", "Figure", "Students"],
      [
        ["Ausbildung", "Students", placed.ausbildung.students],
        ["Ausbildung", "Interview coming up", placed.ausbildung.interview],
        ["Ausbildung", "Contract received", placed.ausbildung.contract],
        ["Ausbildung", "German not finished", placed.ausbildung.german],
        ["Ausbildung", "Service charge pending", placed.ausbildung.unpaid],
        ["NCLEX-RN (USA)", "Nursing students", placed.nclex.students],
        ["NCLEX-RN (USA)", "On the NCLEX process", placed.nclex.opened],
        ["NCLEX-RN (USA)", "Passed", placed.nclex.passed],
      ],
      [18, 26, 12],
    );
  }
  if (lens.kind === "branch") {
    const [people, loose] = await Promise.all([teamBoard(lens, 500), unassigned(lens)]);
    sheet(wb, "The team", ["Name", "Branch", "Students", "Applications", "Offers"], people.map((p) => [p.name, p.branch, p.students, p.applications, p.offers]), [26, 26, 12, 14, 10]);
    figures.push(["Not given to anyone", loose, "Students with no counsellor, now"]);
    ws.addRow(["Not given to anyone", loose, "Students with no counsellor, now"]);
  }
  if (lens.kind === "counsellor") {
    const tasks = await followUps(lens, 5000);
    sheet(wb, "Follow-ups", ["Due", "Follow-up", "Student"], tasks.rows.map((r) => [r.dueOn, r.title, r.student ?? ""]), [12, 40, 24]);
  }
  return wb;
}
