import { desc, gte, ne, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Chip, EmptyState, Table, Td, Th } from "@/components/ui";

const LABEL: Record<string, { text: string; tone: "warn" | "bad" }> = {
  wrong_password: { text: "Wrong password", tone: "bad" },
  unknown_email: { text: "Unknown email", tone: "warn" },
  inactive: { text: "Account switched off", tone: "warn" },
  throttled: { text: "Blocked, too many tries", tone: "bad" },
};

/**
 * Failed sign-in attempts across the whole platform over the last week. A run of
 * these against one address, or a spread of unknown emails from one caller, is
 * what a password-guessing attempt looks like from the inside.
 */
export async function FailedSignIns() {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const rows = await db
    .select()
    .from(schema.signInEvents)
    .where(and(ne(schema.signInEvents.outcome, "success"), gte(schema.signInEvents.createdAt, weekAgo)))
    .orderBy(desc(schema.signInEvents.createdAt))
    .limit(20);

  const addresses = new Set(rows.map((r) => r.ipAddress).filter(Boolean));

  return (
    <Card className="mb-4">
      <CardHeader
        title="Failed sign-ins this week"
        subtitle="Wrong passwords, unknown emails and attempts that hit the rate limit."
        action={
          rows.length > 0 ? (
            <Chip tone={rows.length >= 20 ? "bad" : "warn"}>
              {rows.length}
              {rows.length >= 20 ? "+" : ""} from {addresses.size || "unknown"}{" "}
              {addresses.size === 1 ? "address" : "addresses"}
            </Chip>
          ) : (
            <Chip tone="ok">All clear</Chip>
          )
        }
      />
      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No failed sign-ins">Every attempt in the last seven days succeeded.</EmptyState>
        </div>
      ) : (
        <Table tableClassName="min-w-[640px]">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Email tried</Th>
              <Th>What happened</Th>
              <Th>Address</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meaning = LABEL[r.outcome] ?? { text: r.outcome, tone: "warn" as const };
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                  <Td className="break-all">{r.email}</Td>
                  <Td>
                    <Chip tone={meaning.tone}>{meaning.text}</Chip>
                  </Td>
                  <Td className="tabular text-muted">{r.ipAddress ?? "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
