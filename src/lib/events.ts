export const EVENT_KINDS = ["WEBINAR", "UNIVERSITY_VISIT", "TRAINING", "FAIR"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABEL: Record<EventKind, string> = { WEBINAR: "Webinar", UNIVERSITY_VISIT: "University visit", TRAINING: "Training", FAIR: "Education fair" };
