export const PRIORITY_LABEL = { HIGH: "High priority", NORMAL: "Normal priority", LOW: "Low priority" } as const;
export type Priority = keyof typeof PRIORITY_LABEL;
