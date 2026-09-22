export const BULLETIN_KINDS = ["UPDATE", "ANNOUNCEMENT", "WHATS_NEW"] as const;
export type BulletinKind = (typeof BULLETIN_KINDS)[number];
export const BULLETIN_LABEL: Record<BulletinKind, string> = { UPDATE: "Important update", ANNOUNCEMENT: "Announcement", WHATS_NEW: "What's new in the portal" };
