import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { aiAllowance, aiConfig } from "@/server/ai";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AssistantChat } from "./chat";

export const metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const user = await requireUser([...APP_ROLES]);
  const cfg = await aiConfig();
  const on = !!cfg && cfg.enabled && cfg.features.assistant;
  const allowance = on ? await aiAllowance(user, cfg!) : null;
  return (
    <>
      <PageHeader title="Assistant" subtitle="Questions about programs and the process, answered from Medcity's catalogue. It cannot see your students or commission, and it says so when a figure is not recorded." />
      <Card className="max-w-3xl">
        {on ? (
          <AssistantChat left={allowance?.limit == null ? null : allowance.left} />
        ) : (
          <EmptyState title="The assistant is not switched on">The platform owner switches it on in Settings, Platform.</EmptyState>
        )}
      </Card>
      <p className="mt-3 max-w-3xl text-xs text-muted">Questions are sent to an AI service to be answered. Do not type a student&apos;s passport number or other personal details.</p>
    </>
  );
}
