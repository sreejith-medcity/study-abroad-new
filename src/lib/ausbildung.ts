/**
 * Plain helpers for Ausbildung and the service charge, shared by the server
 * and the screens.
 */

/** The German levels a student works through, in order. */
export const GERMAN_LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type GermanLevel = (typeof GERMAN_LEVELS)[number];
export type ModuleState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export const MODULE_STATE_LABEL: Record<ModuleState, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

/**
 * The fields Ausbildung places are usually in, offered as suggestions on the
 * three preferences. Suggestions only: anything can be typed.
 */
export const AUSBILDUNG_FIELDS = [
  "Nursing (Pflegefachmann/-frau)",
  "Elderly care (Altenpflege)",
  "Medical assistant (MFA)",
  "Dental assistant (ZFA)",
  "Hotel management (Hotelfachmann/-frau)",
  "Chef (Koch/Köchin)",
  "Restaurant services (Fachmann/-frau für Restaurants)",
  "Retail (Kaufmann/-frau im Einzelhandel)",
  "Logistics (Fachkraft für Lagerlogistik)",
  "Mechatronics (Mechatroniker/-in)",
  "Electrician (Elektroniker/-in)",
  "IT specialist (Fachinformatiker/-in)",
  "Industrial mechanic (Industriemechaniker/-in)",
  "Bakery (Bäcker/-in)",
];

/**
 * The German levels a student has finished and the ones still to do, from
 * whatever rows there are. A level with no row is not started.
 */
export function moduleStanding(rows: { level: string; state: ModuleState }[]) {
  const by = new Map(rows.map((r) => [r.level, r.state]));
  const levels = GERMAN_LEVELS.map((level) => ({ level, state: (by.get(level) ?? "NOT_STARTED") as ModuleState }));
  return {
    levels,
    done: levels.filter((l) => l.state === "COMPLETED").map((l) => l.level),
    incomplete: levels.filter((l) => l.state !== "COMPLETED").map((l) => l.level),
  };
}

/**
 * Money on these screens: rupees with the rupee sign, the way the branches
 * say it, and any other currency with its code.
 */
export function chargeMoney(amount: number, currency: string) {
  if (currency === "INR") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return `${currency} ${new Intl.NumberFormat("en-IN").format(amount)}`;
}

/** A Date as the "YYYY-MM-DDTHH:mm" a datetime-local box wants, in IST. */
export function toIstInput(d: Date | null | undefined) {
  if (!d) return "";
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16);
}
