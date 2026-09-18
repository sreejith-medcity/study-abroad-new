import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Alert, Card, CardHeader, Chip, EmptyState, Table, Td, Th } from "@/components/ui";
import { PasswordForm, SignOutEverywhereForm } from "../forms";

export const metadata = { title: "Security settings" };

const OUTCOME: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  success: { label: "Signed in", tone: "ok" },
  wrong_password: { label: "Wrong password", tone: "bad" },
  unknown_email: { label: "Unknown email", tone: "warn" },
  inactive: { label: "Account off", tone: "warn" },
  throttled: { label: "Blocked, too many tries", tone: "bad" },
};

/** Turns a user agent string into something a person can read. */
function device(agent: string | null) {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : /Firefox\//.test(agent)
            ? "Firefox"
            : "Browser";
  const system = /iPhone|iPad/.test(agent)
    ? "iPhone or iPad"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "Mac"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const [row, events] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, user.id) }),
    // Same reasoning as the audit panel: an unreadable history must not cost
    // somebody the ability to change their password.
    db
      .select()
      .from(schema.signInEvents)
      .where(eq(schema.signInEvents.userId, user.id))
      .orderBy(desc(schema.signInEvents.createdAt))
      .limit(15)
      .catch(() => [] as (typeof schema.signInEvents.$inferSelect)[]),
  ]);

  const failures = events.filter((e) => e.outcome !== "success").length;

  return (
    <>
      <Card>
        <CardHeader title="Password" subtitle="Change it here whenever you like. Nobody at Medcity Overseas can read it." />
        <div className="p-4">
          {row?.passwordUpdatedAt ? (
            <p className="mb-3 text-xs text-muted">Last changed {fmtDateTime(row.passwordUpdatedAt)}.</p>
          ) : (
            <Alert tone="warn">This account is still on the password it was created with. Set your own below.</Alert>
          )}
          <PasswordForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Signed-in devices" subtitle="Sessions last twelve hours, then ask for the password again." />
        <div className="p-4">
          <SignOutEverywhereForm />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Recent sign-in activity"
          subtitle="The last fifteen attempts on your account, successful or not."
          action={failures > 0 ? <Chip tone="warn">{failures} failed</Chip> : undefined}
        />
        {events.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing recorded yet">Activity shows up here from your next sign-in.</EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Result</Th>
                <Th>Device</Th>
                <Th>Address</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const meaning = OUTCOME[e.outcome] ?? { label: e.outcome, tone: "neutral" as const };
                return (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</Td>
                    <Td>
                      <Chip tone={meaning.tone}>{meaning.label}</Chip>
                    </Td>
                    <Td>{device(e.userAgent)}</Td>
                    <Td className="tabular text-muted">{e.ipAddress ?? "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          See something you do not recognise? Change your password, sign out everywhere, and tell the Medcity Overseas team.
        </p>
      </Card>
    </>
  );
}
