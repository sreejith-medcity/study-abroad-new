import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/** Staff and partners share one dashboard; a student has their own portal. */
export default async function Home() {
  const user = await requireUser();
  redirect(user.role === "STUDENT" ? "/portal" : "/dashboard");
}
