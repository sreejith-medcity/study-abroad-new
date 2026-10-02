import { createHmac, timingSafeEqual } from "node:crypto";
import { SIGNATURE_HEADER, SIGNATURE_WINDOW_SECONDS, TIMESTAMP_HEADER } from "./crm-link";

/**
 * Signing and checking a request from Medcity's own CRM.
 *
 * Apart from crm-link.ts because this needs node:crypto, and that file is read
 * by the browser. Still pure and still unit-tested: a signing scheme nobody can
 * test against is a signing scheme that works on one side only.
 */

/**
 * What gets signed: the method, the path, the timestamp and the body, joined by
 * newlines. Stated here so the vendor's implementation and ours cannot disagree
 * about the order, which is where every signing integration goes wrong first.
 */
export function canonicalString(method: string, path: string, timestamp: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, body].join("\n");
}

export function sign(secret: string, method: string, path: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(canonicalString(method, path, timestamp, body)).digest("hex");
}

export type SignatureCheck = { ok: true } | { ok: false; why: string };

/**
 * Whether a signature holds. Compared in constant time, and the timestamp has to
 * be recent, so a signature somebody copied off the wire last week is no use.
 */
export function verifySignature(
  secret: string,
  given: string | null,
  method: string,
  path: string,
  timestamp: string | null,
  body: string,
  now: Date = new Date(),
): SignatureCheck {
  if (!given) return { ok: false, why: `No ${SIGNATURE_HEADER} on the request` };
  if (!timestamp) return { ok: false, why: `No ${TIMESTAMP_HEADER} on the request` };
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, why: `${TIMESTAMP_HEADER} must be seconds since the epoch` };
  const drift = Math.abs(Math.floor(now.getTime() / 1000) - sent);
  if (drift > SIGNATURE_WINDOW_SECONDS) return { ok: false, why: `The timestamp is ${drift} seconds out; the window is ${SIGNATURE_WINDOW_SECONDS}` };

  const expected = sign(secret, method, path, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim().toLowerCase());
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, why: "The signature does not match the body" };
  return { ok: true };
}
