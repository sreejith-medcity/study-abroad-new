"use server";

import { revalidatePath } from "next/cache";
import { isLocale, type Locale } from "@/lib/i18n";
import { requireGuardian, setFamilyLocale } from "@/server/family";

/**
 * The only action a parent has. The family view reads and changes nothing
 * else: no uploads, no messages, no corrections. Anything that needs changing
 * goes through the student or the branch, which is the point of the view.
 */
export async function setFamilyLocaleAction(formData: FormData) {
  const { session } = await requireGuardian();
  const locale = String(formData.get("locale"));
  if (!isLocale(locale)) return;
  await setFamilyLocale(locale as Locale, session.id);
  revalidatePath("/family", "layout");
}
