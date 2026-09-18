import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/** Short, unambiguous codes: no vowels, no look-alike characters. */
const ALPHABET = "23456789bcdfghjkmnpqrstvwxz";

export function makeSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/medcity|consultants|overseas|international/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)[0];
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${(base || "branch").slice(0, 16)}-${suffix}`;
}

/** The branch behind a public link, or null when the link is closed or unknown. */
export async function orgForPublicSlug(slug: string) {
  const org = await db.query.organizations.findFirst({
    where: and(eq(schema.organizations.publicSlug, slug), eq(schema.organizations.publicFormEnabled, true), eq(schema.organizations.active, true)),
  });
  return org ?? null;
}

export function publicFormUrl(slug: string) {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://doc.medcityoverseas.com").replace(/\/$/, "");
  return `${base}/apply/${slug}`;
}
