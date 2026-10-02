import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

/** Staff and partners share one dashboard; a student and a parent each have their own view. */
export default async function Home() {
  const user = await requireUser();
  redirect(homeFor(user.role));
}
