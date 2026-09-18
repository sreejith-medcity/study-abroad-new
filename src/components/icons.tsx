import type { SVGProps } from "react";

/** One icon set, drawn on a 24px grid with a 1.6 stroke so weights match. */
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

type P = SVGProps<SVGSVGElement>;

export const IconDashboard = (p: P) => (
  <svg {...base} {...p}><path d="M4 13h6V4H4zM14 9h6V4h-6zM14 20h6v-7h-6zM4 20h6v-3H4z" /></svg>
);
export const IconStudents = (p: P) => (
  <svg {...base} {...p}><path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="7" r="3" /><path d="M17 11a3 3 0 1 0-1.5-5.6M21 19v-1a3.7 3.7 0 0 0-2.4-3.4" /></svg>
);
export const IconApplications = (p: P) => (
  <svg {...base} {...p}><path d="M8 3h8l4 4v14H8zM16 3v4h4" /><path d="M11 12h6M11 16h6M11 8h2" /><path d="M4 7v14h4" /></svg>
);
export const IconSearch = (p: P) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
);
export const IconQueue = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="4" width="5.5" height="16" rx="1.4" /><rect x="10.2" y="4" width="5.5" height="10" rx="1.4" /><rect x="17.5" y="4" width="3.5" height="13" rx="1.4" /></svg>
);
export const IconWallet = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M16.5 14.5h.01" /></svg>
);
export const IconCommission = (p: P) => (
  <svg {...base} {...p}><path d="M7 17 17 7M8.5 8.5h.01M15.5 15.5h.01" /><rect x="3" y="3" width="18" height="18" rx="4" /></svg>
);
export const IconEnquiry = (p: P) => (
  <svg {...base} {...p}><path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" /><path d="M12 13v.01M12 7.5a1.8 1.8 0 0 1 1.2 3.1c-.5.4-1.2.8-1.2 1.4" /></svg>
);
export const IconLearning = (p: P) => (
  <svg {...base} {...p}><path d="m12 4 9 4.5-9 4.5L3 8.5z" /><path d="M7 11v5c0 1.7 2.2 3 5 3s5-1.3 5-3v-5M21 8.5V14" /></svg>
);
export const IconPrograms = (p: P) => (
  <svg {...base} {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M9 7.5h7M9 11h7" /></svg>
);
export const IconPartners = (p: P) => (
  <svg {...base} {...p}><path d="M3 21V9l6-4 6 4v12" /><path d="M15 21V12h6v9M7 21v-4h4v4M7.5 12h3" /></svg>
);
export const IconFlow = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="4" width="7" height="5" rx="1.5" /><rect x="14" y="15" width="7" height="5" rx="1.5" /><path d="M6.5 9v5.5a2 2 0 0 0 2 2H14" /></svg>
);
export const IconInsights = (p: P) => (
  <svg {...base} {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const IconBell = (p: P) => (
  <svg {...base} {...p}><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" /><path d="M13.7 19.5a2 2 0 0 1-3.4 0" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} {...p}><path d="m4.5 12.5 4.5 4.5L19.5 6.5" /></svg>
);
export const IconAlert = (p: P) => (
  <svg {...base} {...p}><path d="M12 4.5 2.8 20h18.4z" /><path d="M12 10v4.5M12 17.4v.01" /></svg>
);
export const IconClock = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconDoc = (p: P) => (
  <svg {...base} {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>
);
export const IconChat = (p: P) => (
  <svg {...base} {...p}><path d="M20 14a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" /><path d="M8.5 9h7M8.5 12.5h4" /></svg>
);
export const IconMenu = (p: P) => (
  <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base} {...p}><path d="M15 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" /><path d="m17 9 3 3-3 3M20 12h-8" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconExport = (p: P) => (
  <svg {...base} {...p}><path d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5" /><path d="M5 17v1.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V17" /></svg>
);
export const IconGlobe = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.1 0 17M12 3.5c-2.5 2.4-2.5 14.1 0 17" /></svg>
);
export const IconSpark = (p: P) => (
  <svg {...base} {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base} {...p}><path d="M12 3l7 3v5.5c0 4.2-2.8 7.8-7 9.5-4.2-1.7-7-5.3-7-9.5V6z" /><path d="m9 12 2 2 4-4" /></svg>
);

export const IconSettings = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1z" /></svg>
);

export const IconKey = (p: P) => (
  <svg {...base} {...p}><path d="M15.5 8.5a3.5 3.5 0 1 1-3.4 4.36L11 14h-1.5v1.5H8v1.5H5.5A1.5 1.5 0 0 1 4 15.5v-1.6a1.5 1.5 0 0 1 .44-1.06l7.7-7.7A3.5 3.5 0 0 1 15.5 8.5Z" /><circle cx="16" cy="8" r=".8" fill="currentColor" stroke="none" /></svg>
);

export const IconBuilding = (p: P) => (
  <svg {...base} {...p}><path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M14 10h4a2 2 0 0 1 2 2v9M3 21h18M8 8h2M8 12h2M8 16h2M17 14h1M17 18h1" /></svg>
);
