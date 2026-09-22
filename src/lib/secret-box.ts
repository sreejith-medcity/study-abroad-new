import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts a secret for storage with AES-256-GCM under a key derived from
 * AUTH_SECRET. Changing AUTH_SECRET makes stored secrets unreadable; they are
 * then entered again.
 */
function key(purpose: string) {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return createHash("sha256").update(`${purpose}:${s}`).digest();
}

export function seal(plain: string, purpose: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function open(sealed: string, purpose: string): string | null {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
