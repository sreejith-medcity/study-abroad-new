import { NextResponse } from "next/server";
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION } from "@/lib/version";

/**
 * Which release is running, for checking a deploy without signing in: the
 * number, when it was built and from which commit. Nothing else is said.
 */
export function GET() {
  return NextResponse.json({ version: APP_VERSION, builtAt: APP_BUILT_AT, commit: APP_COMMIT }, { headers: { "Cache-Control": "no-store" } });
}
