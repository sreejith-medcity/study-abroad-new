import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/** Every role now has its own dashboard, so home is the same address for all of them. */
export default async function Home() {
  await requireUser();
  redirect("/dashboard");
}
