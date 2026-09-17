import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

export default async function Home() {
  const user = await requireUser();
  if (isAdmin(user)) redirect("/admin/queue");
  redirect("/dashboard");
}
