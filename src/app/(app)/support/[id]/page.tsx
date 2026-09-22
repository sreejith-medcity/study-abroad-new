import Link from "next/link";
import { RichText } from "@/components/rich-text";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { CATEGORY_LABEL, TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "@/lib/tickets";
import { ticketForUser } from "@/server/ticket-access";
import { setTicketStatusAction } from "@/server/tickets";
import { Button, Card, Chip, PageHeader, cn } from "@/components/ui";
import { ReplyForm } from "@/components/ticket-forms";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const { id } = await params;
  const found = await ticketForUser(user, id);
  if (!found) notFound();
  const ticket = await db.query.tickets.findFirst({
    where: eq(schema.tickets.id, id),
    with: { org: { columns: { name: true } }, owner: { columns: { name: true } }, messages: { with: { author: { columns: { name: true, role: true, orgId: true } } }, orderBy: asc(schema.ticketMessages.createdAt) } },
  });
  if (!ticket) notFound();
  const staff = isStaff(user);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/support" className="text-[13px] font-medium text-brand-600 hover:underline">← Help desk</Link>}
        title={ticket.subject}
        subtitle={`${CATEGORY_LABEL[ticket.category]}${staff ? ` · ${ticket.org.name}` : ""} · opened ${fmtDateTime(ticket.createdAt)}${ticket.owner ? ` · with ${ticket.owner.name}` : ""}`}
        actions={<Chip tone={TICKET_STATUS_TONE[ticket.status]}>{staff && ticket.status === "WAITING_PARTNER" ? "Waiting on the partner" : staff && ticket.status === "OPEN" ? "Waiting on the team" : TICKET_STATUS_LABEL[ticket.status]}</Chip>}
      />
      <Card className="mx-auto max-w-3xl">
        <ul className="space-y-3 p-4">
          {ticket.messages.map((m) => {
            const fromTeam = m.author ? !["PARTNER", "COUNSELLOR"].includes(m.author.role) : false;
            return (
              <li key={m.id} className={cn("flex", fromTeam ? "justify-start" : "justify-end")}>
                <div className={cn("max-w-[85%] rounded-lg px-3 py-2", fromTeam ? "bg-brand-50" : "bg-slate-100")}>
                  <p className="text-xs font-semibold">{m.author?.name ?? "Former user"}{fromTeam && <span className="font-normal text-brand-700"> · Overseas team</span>}</p>
                  <RichText text={m.body} className="text-[13px]" />
                  <p className="mt-1 text-[11px] text-muted">{fmtDateTime(m.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="space-y-3 border-t border-line p-4">
          <ReplyForm ticketId={ticket.id} />
          {staff && (
            <form action={setTicketStatusAction} className="flex justify-end">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <input type="hidden" name="status" value={ticket.status === "RESOLVED" ? "OPEN" : "RESOLVED"} />
              <Button type="submit" variant="secondary" size="sm">{ticket.status === "RESOLVED" ? "Reopen" : "Mark resolved"}</Button>
            </form>
          )}
        </div>
      </Card>
    </>
  );
}
