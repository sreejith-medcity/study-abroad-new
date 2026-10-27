import type { Pathway } from "@/db/schema";

/**
 * Every pathway, in the order the lists offer them, with the words for each.
 *
 * The database enum (src/db/schema.ts) is the truth; this copy exists because
 * the screens that offer a pathway run in the browser, where the schema is not
 * loaded. tests/new-pathways.test.ts checks the two lists agree, so a pathway
 * added to one and not the other fails the tests rather than a form.
 *
 * NCLEX is the USA nurse licensing route on its own pathway, with the 20-step
 * NCLEX-RN tab. NURSING stays for the other registration routes (the NMC, the
 * German Anerkennung) and for the NCLEX-RN files recorded before NCLEX was a
 * pathway, which keep their tab. Weiterbildung (German further training and
 * the nurse recognition adaptation) and CCM have provisional status lists until
 * Medcity's written guide for each arrives. AU_PAIR (a year with a host family
 * abroad, mostly Germany) is the Au pair department's pathway, also on a
 * provisional status list until its process guide arrives.
 *
 * DEGREE is the Study abroad department: a degree, diploma or foundation
 * course abroad. The stored value, the URLs and the import codes stay DEGREE;
 * only the words people read say "Study abroad".
 */
export const PATHWAYS = ["DEGREE", "AUSBILDUNG", "NURSING", "NCLEX", "WEITERBILDUNG", "CCM", "AU_PAIR", "FSJ", "BFD"] as const satisfies readonly Pathway[];

/** The short name, for chips, table cells and filters. */
export const PATHWAY_NAME: Record<Pathway, string> = {
  DEGREE: "Study abroad",
  AUSBILDUNG: "Ausbildung",
  NURSING: "Nurse registration",
  NCLEX: "NCLEX-RN",
  WEITERBILDUNG: "Weiterbildung",
  CCM: "CCM",
  AU_PAIR: "Au pair",
  FSJ: "FSJ (Germany)",
  BFD: "BFD (Germany)",
};

/** The longer words, for the pickers where a counsellor chooses one. */
export const PATHWAY_OPTION: Record<Pathway, string> = {
  DEGREE: "Study abroad (degree, diploma or foundation course)",
  AUSBILDUNG: "Ausbildung (Germany)",
  NURSING: "Nurse registration",
  NCLEX: "NCLEX-RN (USA nurse licensing)",
  WEITERBILDUNG: "Weiterbildung (Germany: further training and nurse recognition)",
  CCM: "CCM",
  AU_PAIR: "Au pair (a year with a host family abroad)",
  FSJ: "FSJ, Freiwilliges Soziales Jahr (Germany)",
  BFD: "BFD, Bundesfreiwilligendienst (Germany)",
};

/** The three pathways added after FSJ and BFD, for the option lists that name them after the older ones. */
export const NEW_PATHWAYS = ["NCLEX", "WEITERBILDUNG", "CCM"] as const satisfies readonly Pathway[];

/** Au pair, added after those three, with its own deploy file (deploy/au-pair-pathway.sql). */
export const AU_PAIR_PATHWAYS = ["AU_PAIR"] as const satisfies readonly Pathway[];

export const isPathway = (v: unknown): v is Pathway => typeof v === "string" && (PATHWAYS as readonly string[]).includes(v);

/** The short name of a pathway as stored, or the stored value itself for one this list does not know. */
export const pathwayName = (p: string): string => (isPathway(p) ? PATHWAY_NAME[p] : p);

/** The words a spreadsheet may use for a pathway, lower case, beside the codes themselves. */
export const PATHWAY_IMPORT_ALIASES: Record<string, Pathway> = {
  degree: "DEGREE",
  "study abroad": "DEGREE",
  "study-abroad": "DEGREE",
  ausbildung: "AUSBILDUNG",
  nursing: "NURSING",
  fsj: "FSJ",
  bfd: "BFD",
  nclex: "NCLEX",
  "nclex-rn": "NCLEX",
  "nclex rn": "NCLEX",
  weiterbildung: "WEITERBILDUNG",
  ccm: "CCM",
  "au pair": "AU_PAIR",
  aupair: "AU_PAIR",
  "au-pair": "AU_PAIR",
  au_pair: "AU_PAIR",
};
