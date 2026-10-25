import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Which release this build is, stamped in at build time so the portal can say
 * which version Hostinger is serving: the number from package.json, when the
 * build ran, and the commit it was built from where the build can see git.
 */
const release = (() => {
  const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;
  // The Docker build has no git and no .git directory, so the compose file
  // hands the commit in as a build argument instead. Anywhere else, ask git.
  let commit = (process.env.APP_COMMIT ?? "").trim();
  if (!commit) {
    try {
      commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      // No git where the build runs: the number and the time still say enough.
    }
  }
  return { APP_VERSION: version, APP_BUILT_AT: new Date().toISOString(), APP_COMMIT: commit };
})();

/**
 * Headers that apply to every response. The portal holds student passports and
 * commission figures, so the defaults are strict and the few places that need
 * something looser (the Google Fonts stylesheet, Supabase Storage) are named.
 */
// The browser now uploads documents straight to storage, so the one host it is
// allowed to send them to is named rather than left to the blanket https:.
const storageOrigin = (() => {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
})();

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Nothing in here should be indexed: it is all behind a sign-in.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inlines a bootstrap script and the brand palette is an inline style tag.
      // Razorpay Checkout loads its script and opens its payment window in a frame.
      "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      ["connect-src 'self' https:", storageOrigin].filter(Boolean).join(" "),
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: release,
  // The Docker image runs the standalone server Next emits. Left off
  // everywhere else so `next start` and the test suites behave as they always
  // have.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  // Server actions accept 1 MB by default. The program CSV import allows 5 MB and
  // the CRICOS register's course file is about 7 MB, so both need more room.
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    // Browsers ask for /favicon.ico on their own, whatever the page declares, so
    // that request has to reach the uploaded artwork too.
    return [{ source: "/favicon.ico", destination: "/api/brand/favicon" }];
  },
};

export default nextConfig;
