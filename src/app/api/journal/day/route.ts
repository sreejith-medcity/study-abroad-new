import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { istDay, readsJournalReport } from "@/lib/journal";
import { dayWorkbookFileName } from "@/lib/journal-day-export";
import { catchUp, consolidated } from "@/server/journal";
import { dayWorkbook } from "@/server/journal-day-export";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

/**
 * The consolidated day end report on screen, as an Excel workbook. Takes the
 * same address as the day view (day), under the same rules: only the report's
 * readers get it, and a day that is not a day or has not come yet falls back
 * to today, exactly as the page does. Every download is in the audit log.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!readsJournalReport(user.role)) return new Response("Not found", { status: 404 });
  const today = istDay();
  const asked = new URL(req.url).searchParams.get("day");
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  // The page closes a day past its cutoff on the way in, so the file says the same as the screen.
  await catchUp();
  const [report, settings] = await Promise.all([consolidated(day), getSettings()]);
  const wb = dayWorkbook(report, settings.organisationName, user.name);
  const buffer = await wb.xlsx.writeBuffer();
  await audit(user.id, "journal.export", "journal", day, { view: "day" });
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${dayWorkbookFileName(day)}"`,
      "Cache-Control": "no-store",
    },
  });
}
