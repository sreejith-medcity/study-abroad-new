import type { Pathway, StatusGroup } from "./schema";

type StatusSeed = {
  code: string;
  label: string;
  studentLabel: string;
  /** Shown in the student portal when the student reads in Malayalam. */
  studentLabelMl?: string;
  group: StatusGroup;
  requiresReason?: boolean;
  isMilestone?: boolean;
};

/** Statuses available at any stage of every pathway. */
const COMMON: StatusSeed[] = [
  { code: "PENDING_PARTNER", label: "Pending from partner", studentLabel: "We need something from you", studentLabelMl: "നിങ്ങളിൽ നിന്ന് ഒരു രേഖ വേണം", group: "PENDING_PARTNER" },
  { code: "ON_HOLD_INTAKE", label: "Application on hold: intake yet to open", studentLabel: "Waiting for the intake to open", studentLabelMl: "ഇൻടേക്ക് തുറക്കാൻ കാത്തിരിക്കുന്നു", group: "HOLD" },
  { code: "DEFERRED", label: "Deferred", studentLabel: "Moved to a later intake", studentLabelMl: "പിന്നീടുള്ള ഇൻടേക്കിലേക്ക് മാറ്റി", group: "HOLD", requiresReason: true },
  { code: "CLOSED_NOT_QUALIFIED", label: "Case closed: student not qualified", studentLabel: "Application closed", studentLabelMl: "അപേക്ഷ അവസാനിപ്പിച്ചു", group: "CLOSED", requiresReason: true },
  { code: "VISA_REJECTED", label: "Visa rejected", studentLabel: "Visa refused", studentLabelMl: "വിസ നിരസിച്ചു", group: "CLOSED", requiresReason: true, isMilestone: true },
  { code: "WITHDRAWN", label: "Withdrawn", studentLabel: "Application withdrawn", studentLabelMl: "അപേക്ഷ പിൻവലിച്ചു", group: "CLOSED", requiresReason: true },
  { code: "CASE_CLOSED", label: "Case closed", studentLabel: "Application closed", studentLabelMl: "അപേക്ഷ അവസാനിപ്പിച്ചു", group: "CLOSED", requiresReason: true },
];

const DEGREE: StatusSeed[] = [
  { code: "ASSESSMENT", label: "Assessment pending", studentLabel: "Application received", studentLabelMl: "അപേക്ഷ ലഭിച്ചു", group: "NEW" },
  { code: "SUBMITTED", label: "Application submitted to the institution", studentLabel: "Submitted to university", studentLabelMl: "സർവകലാശാലയ്ക്ക് അയച്ചു", group: "IN_PROGRESS", isMilestone: true },
  { code: "CONDITIONAL_OFFER", label: "Conditional offer received", studentLabel: "Conditional offer", studentLabelMl: "കണ്ടീഷണൽ ഓഫർ ലഭിച്ചു", group: "OFFER", isMilestone: true },
  { code: "UNCONDITIONAL_OFFER", label: "Unconditional offer received", studentLabel: "Unconditional offer", studentLabelMl: "അൺകണ്ടീഷണൽ ഓഫർ ലഭിച്ചു", group: "OFFER", isMilestone: true },
  { code: "DEPOSIT_PAID", label: "Tuition deposit paid", studentLabel: "Deposit paid", studentLabelMl: "ഫീസ് അടച്ചു", group: "IN_PROGRESS" },
  { code: "CAS_COE", label: "CAS / COE issued", studentLabel: "CAS / COE issued", studentLabelMl: "CAS / COE ലഭിച്ചു", group: "IN_PROGRESS", isMilestone: true },
  { code: "VISA_FILED", label: "Visa filed", studentLabel: "Visa applied", studentLabelMl: "വിസയ്ക്ക് അപേക്ഷിച്ചു", group: "IN_PROGRESS" },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", studentLabelMl: "വിസ ലഭിച്ചു", group: "SUCCESS", isMilestone: true },
  { code: "ENROLLED", label: "Enrolled", studentLabel: "Enrolled", studentLabelMl: "പ്രവേശനം ലഭിച്ചു", group: "SUCCESS", isMilestone: true },
];

const AUSBILDUNG: StatusSeed[] = [
  { code: "LANGUAGE_PENDING", label: "German A2 / B1 pending", studentLabel: "Complete your German level", studentLabelMl: "ജർമൻ ഭാഷാ നിലവാരം പൂർത്തിയാക്കുക", group: "NEW" },
  { code: "PROFILE_CV", label: "German CV and profile in progress", studentLabel: "Preparing your profile", studentLabelMl: "നിങ്ങളുടെ പ്രൊഫൈൽ തയ്യാറാക്കുന്നു", group: "IN_PROGRESS" },
  { code: "EMPLOYER_MATCHING", label: "Employer matching", studentLabel: "Finding employers", studentLabelMl: "തൊഴിലുടമകളെ കണ്ടെത്തുന്നു", group: "IN_PROGRESS" },
  { code: "EMPLOYER_INTERVIEW", label: "Employer interview scheduled", studentLabel: "Interview with employer", studentLabelMl: "തൊഴിലുടമയുമായി അഭിമുഖം", group: "IN_PROGRESS", isMilestone: true },
  { code: "CONTRACT_SIGNED", label: "Training contract signed", studentLabel: "Contract signed", studentLabelMl: "കരാർ ഒപ്പിട്ടു", group: "OFFER", isMilestone: true },
  { code: "RECOGNITION", label: "Recognition / approval in progress", studentLabel: "Approval in progress", studentLabelMl: "അംഗീകാര നടപടികൾ നടക്കുന്നു", group: "IN_PROGRESS" },
  { code: "VISA_FILED", label: "Visa filed (VFS)", studentLabel: "Visa applied", studentLabelMl: "വിസയ്ക്ക് അപേക്ഷിച്ചു", group: "IN_PROGRESS", isMilestone: true },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", studentLabelMl: "വിസ ലഭിച്ചു", group: "SUCCESS", isMilestone: true },
  { code: "JOINED", label: "Joined employer", studentLabel: "Started training", studentLabelMl: "പരിശീലനം ആരംഭിച്ചു", group: "SUCCESS", isMilestone: true },
];

const NURSING: StatusSeed[] = [
  { code: "CREDENTIAL_CHECK", label: "Credential check", studentLabel: "Checking your qualifications", studentLabelMl: "നിങ്ങളുടെ യോഗ്യതകൾ പരിശോധിക്കുന്നു", group: "NEW" },
  { code: "LANGUAGE_SCORE", label: "OET / IELTS score pending", studentLabel: "Language score needed", studentLabelMl: "ഭാഷാ പരീക്ഷയുടെ സ്കോർ വേണം", group: "PENDING_PARTNER" },
  { code: "BOARD_APPLICATION", label: "Board application (NMC / NCSBN / Anerkennung)", studentLabel: "Registration applied", studentLabelMl: "രജിസ്ട്രേഷന് അപേക്ഷിച്ചു", group: "IN_PROGRESS", isMilestone: true },
  { code: "EXAM", label: "CBT / NCLEX / Kenntnisprüfung", studentLabel: "Licensing exam", studentLabelMl: "ലൈസൻസ് പരീക്ഷ", group: "IN_PROGRESS" },
  { code: "REGISTRATION", label: "Registration / PIN received", studentLabel: "Registered", studentLabelMl: "രജിസ്ട്രേഷൻ ലഭിച്ചു", group: "OFFER", isMilestone: true },
  { code: "JOB_OFFER", label: "Job offer received", studentLabel: "Job offer", studentLabelMl: "ജോലി വാഗ്ദാനം ലഭിച്ചു", group: "OFFER", isMilestone: true },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", studentLabelMl: "വിസ ലഭിച്ചു", group: "SUCCESS", isMilestone: true },
  { code: "DEPLOYED", label: "Deployed", studentLabel: "Started work", studentLabelMl: "ജോലി ആരംഭിച്ചു", group: "SUCCESS", isMilestone: true },
];

export const STATUS_SEED: Record<Pathway, StatusSeed[]> = {
  DEGREE: [...DEGREE.slice(0, 1), COMMON[0], ...DEGREE.slice(1), ...COMMON.slice(1)],
  AUSBILDUNG: [...AUSBILDUNG.slice(0, 1), COMMON[0], ...AUSBILDUNG.slice(1), ...COMMON.slice(1)],
  NURSING: [...NURSING.slice(0, 1), COMMON[0], ...NURSING.slice(1), ...COMMON.slice(1)],
};

export const DOCUMENT_TYPES = [
  { code: "PASSPORT", label: "Passport (front and back)", labelMl: "പാസ്പോർട്ട് (മുൻ, പിൻ പേജുകൾ)", uploadedBy: "partner", sortOrder: 10 },
  { code: "MARKSHEET_10", label: "Std. 10th marksheet", labelMl: "പത്താം ക്ലാസ് മാർക്ക് ഷീറ്റ്", uploadedBy: "partner", sortOrder: 20 },
  { code: "MARKSHEET_12", label: "Std. 12th marksheet", labelMl: "പ്ലസ് ടു മാർക്ക് ഷീറ്റ്", uploadedBy: "partner", sortOrder: 30 },
  { code: "DEGREE_MARKSHEETS", label: "Bachelor's individual marksheets", labelMl: "ബിരുദ മാർക്ക് ഷീറ്റുകൾ", uploadedBy: "partner", sortOrder: 40 },
  { code: "DEGREE_CERTIFICATE", label: "Degree / provisional certificate", labelMl: "ബിരുദ / പ്രൊവിഷണൽ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 50 },
  { code: "ENGLISH_TEST", label: "English test report (IELTS / PTE / OET)", labelMl: "ഇംഗ്ലീഷ് പരീക്ഷാ റിപ്പോർട്ട് (IELTS / PTE / OET)", uploadedBy: "partner", sortOrder: 60 },
  { code: "GERMAN_CERTIFICATE", label: "German language certificate", labelMl: "ജർമൻ ഭാഷാ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 65 },
  { code: "SOP", label: "Statement of purpose", labelMl: "സ്റ്റേറ്റ്മെന്റ് ഓഫ് പർപ്പസ്", uploadedBy: "partner", sortOrder: 70 },
  { code: "LOR", label: "Letter of recommendation", labelMl: "ശുപാർശ കത്ത്", uploadedBy: "partner", sortOrder: 80 },
  { code: "CV", label: "CV / resume", labelMl: "സി വി / റെസ്യൂമെ", uploadedBy: "partner", sortOrder: 90 },
  { code: "NURSING_LICENSE", label: "Nursing council registration", labelMl: "നഴ്സിങ് കൗൺസിൽ രജിസ്ട്രേഷൻ", uploadedBy: "partner", sortOrder: 95 },
  { code: "OFFER_LETTER", label: "Offer letter", labelMl: "ഓഫർ ലെറ്റർ", uploadedBy: "team", sortOrder: 200 },
  { code: "CAS_COE", label: "CAS / COE", labelMl: "CAS / COE", uploadedBy: "team", sortOrder: 210 },
  { code: "VISA", label: "Visa", labelMl: "വിസ", uploadedBy: "team", sortOrder: 220 },
  { code: "OTHER", label: "Other", labelMl: "മറ്റുള്ളവ", uploadedBy: "partner", sortOrder: 999 },
];
