/**
 * The release this build is, as next.config.ts stamped it at build time.
 * "dev" when running without a build, so a local run never claims a number.
 */
export const APP_VERSION = process.env.APP_VERSION || "dev";
export const APP_BUILT_AT = process.env.APP_BUILT_AT || null;
export const APP_COMMIT = process.env.APP_COMMIT || null;
