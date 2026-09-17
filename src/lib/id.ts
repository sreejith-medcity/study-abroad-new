import { randomBytes } from "crypto";

/** Short, URL-safe, sortable-enough random id. */
export function createId(): string {
  return Date.now().toString(36) + randomBytes(9).toString("base64url");
}
