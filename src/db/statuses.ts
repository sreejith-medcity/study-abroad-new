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
  /**
   * Where it sits in the list. Left out, the seed numbers the list by position
   * (10, 20, 30). Given, it is used as is: the Ausbildung chain carries its own
   * numbers so that statuses added after the first release slot in between the
   * rows a live database already has, without renumbering those rows.
   */
  sortOrder?: number;
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

/*
 * The Ausbildung chain follows Medcity's written process: counsellor,
 * documentation, language and interview preparation, placement, visa, travel
 * desk. The first nine codes were there from the start and applications point
 * at them, so they keep their codes and labels; the rest were added so the desk
 * can record every step the guide names. The numbers are explicit so the new
 * rows slot between the old ones on a live database (see StatusSeed.sortOrder).
 * The new rows have no Malayalam yet: the portal falls back to the English.
 */
const AUSBILDUNG: StatusSeed[] = [
  { code: "LANGUAGE_PENDING", label: "German A2 / B1 pending", studentLabel: "Complete your German level", studentLabelMl: "ജർമൻ ഭാഷാ നിലവാരം പൂർത്തിയാക്കുക", group: "NEW", sortOrder: 10 },
  // Counsellor: step 3 of the guide.
  { code: "DOCUMENT_COLLECTION", label: "Document collection by the counsellor", studentLabel: "Send us your documents", group: "NEW", sortOrder: 22 },
  // Documentation department: steps 4 and 6.
  { code: "MENTOR_ASSIGNED", label: "Mentor assigned", studentLabel: "Your mentor has been assigned", group: "IN_PROGRESS", isMilestone: true, sortOrder: 24 },
  { code: "DOCUMENT_PREPARATION", label: "Document preparation and translation", studentLabel: "Preparing and translating your documents", group: "IN_PROGRESS", sortOrder: 26 },
  { code: "PROFILE_CV", label: "German CV and profile in progress", studentLabel: "Preparing your profile", studentLabelMl: "നിങ്ങളുടെ പ്രൊഫൈൽ തയ്യാറാക്കുന്നു", group: "IN_PROGRESS", sortOrder: 30 },
  // Student mentor (language specialist): steps 7 and 8.
  { code: "LANGUAGE_ASSESSMENT", label: "Language assessment and interview preparation", studentLabel: "Language assessment and interview practice", group: "IN_PROGRESS", sortOrder: 33 },
  { code: "MOCK_INTERVIEW_PASSED", label: "Mock interview passed: ready for employers", studentLabel: "Ready for employer interviews", group: "IN_PROGRESS", isMilestone: true, sortOrder: 36 },
  // Profile submission to employers: step 9.
  { code: "EMPLOYER_MATCHING", label: "Employer matching", studentLabel: "Finding employers", studentLabelMl: "തൊഴിലുടമകളെ കണ്ടെത്തുന്നു", group: "IN_PROGRESS", sortOrder: 40 },
  { code: "PROFILE_SUBMITTED", label: "Profile submitted to German employers", studentLabel: "Your profile is with employers", group: "IN_PROGRESS", isMilestone: true, sortOrder: 43 },
  { code: "EMPLOYER_SHORTLISTED", label: "Employer shortlisted the candidate", studentLabel: "An employer has shortlisted you", group: "IN_PROGRESS", isMilestone: true, sortOrder: 46 },
  // Placement team: steps 10 and 11.
  { code: "EMPLOYER_INTERVIEW", label: "Employer interview scheduled", studentLabel: "Interview with employer", studentLabelMl: "തൊഴിലുടമയുമായി അഭിമുഖം", group: "IN_PROGRESS", isMilestone: true, sortOrder: 50 },
  { code: "CONTRACT_SIGNED", label: "Training contract signed", studentLabel: "Contract signed", studentLabelMl: "കരാർ ഒപ്പിട്ടു", group: "OFFER", isMilestone: true, sortOrder: 60 },
  { code: "RECOGNITION", label: "Recognition / approval in progress", studentLabel: "Approval in progress", studentLabelMl: "അംഗീകാര നടപടികൾ നടക്കുന്നു", group: "IN_PROGRESS", sortOrder: 70 },
  // Visa team: steps 12 to 15.
  { code: "PRE_VISA_DOCUMENTS", label: "Pre-visa documentation", studentLabel: "Preparing your visa file", group: "IN_PROGRESS", sortOrder: 75 },
  { code: "VISA_FILED", label: "Visa filed (VFS)", studentLabel: "Visa applied", studentLabelMl: "വിസയ്ക്ക് അപേക്ഷിച്ചു", group: "IN_PROGRESS", isMilestone: true, sortOrder: 80 },
  { code: "VISA_PROCESSING", label: "Visa processing", studentLabel: "Your visa is being processed", group: "IN_PROGRESS", sortOrder: 85 },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", studentLabelMl: "വിസ ലഭിച്ചു", group: "SUCCESS", isMilestone: true, sortOrder: 90 },
  // Travel desk: steps 16 to 19.
  { code: "PRE_DEPARTURE", label: "Pre-departure process", studentLabel: "Getting you ready to travel", group: "SUCCESS", isMilestone: true, sortOrder: 95 },
  { code: "JOINED", label: "Joined employer", studentLabel: "Started training", studentLabelMl: "പരിശീലനം ആരംഭിച്ചു", group: "SUCCESS", isMilestone: true, sortOrder: 100 },
  { code: "HAPPY_CALL", label: "Destination Germany: happy call", studentLabel: "Settled in Germany", group: "SUCCESS", sortOrder: 105 },
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

/*
 * FSJ and BFD share Medcity's written FSJ / BFD process (src/lib/fsj.ts): one
 * chain of statuses, one per step or decision, recorded for each of the two
 * pathways so each keeps its own name on the volunteer start. Codes the
 * dashboards already count (VISA_FILED, VISA_RECEIVED, PRE_DEPARTURE, JOINED,
 * HAPPY_CALL) are reused with the FSJ / BFD wording, so a visa here counts as
 * a visa everywhere. No Malayalam yet: the portal falls back to the English.
 */
const fsjChain = (programme: "FSJ" | "BFD"): StatusSeed[] => [
  // Counsellor department: steps 2 and 3.
  { code: "REGISTRATION", label: "Registration and agreement", studentLabel: "Registering with us", group: "NEW", sortOrder: 10 },
  { code: "DOCUMENT_COLLECTION", label: "Document collection and profile verification", studentLabel: "Send us your documents", group: "NEW", sortOrder: 22 },
  // Documentation department: steps 4 to 7.
  { code: "DOCUMENT_CROSS_CHECK", label: "With the documentation team: document cross-check", studentLabel: "Our documentation team is checking your documents", group: "IN_PROGRESS", isMilestone: true, sortOrder: 24 },
  { code: "LANGUAGE_ASSESSMENT", label: "German language assessment", studentLabel: "Your German language assessment", group: "IN_PROGRESS", sortOrder: 30 },
  { code: "PAYMENT_CHECK", label: "Payment check: registration and application fee", studentLabel: "Checking your fees", group: "IN_PROGRESS", sortOrder: 34 },
  { code: "APPLICATION_ON_HOLD", label: "Application on hold: application fee pending", studentLabel: "Your application starts once the application fee is paid", group: "HOLD", sortOrder: 36 },
  { code: "LANGUAGE_IMPROVEMENT", label: "Language improvement classes, then re-assessment", studentLabel: "German improvement classes before your next assessment", group: "IN_PROGRESS", sortOrder: 38 },
  { code: "INTERVIEW_PREPARATION", label: "Application started: interview preparation", studentLabel: "Preparing you for employer interviews", group: "IN_PROGRESS", isMilestone: true, sortOrder: 40 },
  // Interview and employer stage: steps 8 to 10.
  { code: "INTERVIEW_SCHEDULED", label: "Employer interview scheduled", studentLabel: "Your interview with an employer is scheduled", group: "IN_PROGRESS", isMilestone: true, sortOrder: 50 },
  { code: "INTERVIEW_ATTENDED", label: "Interview attended: awaiting employer feedback", studentLabel: "Waiting for the employer's decision", group: "IN_PROGRESS", sortOrder: 54 },
  { code: "SECOND_ROUND", label: "Shortlisted: second-round interview", studentLabel: "Shortlisted for a second interview", group: "IN_PROGRESS", isMilestone: true, sortOrder: 56 },
  { code: "EMPLOYER_CONFIRMED", label: "Employer confirmed: offer letter awaited", studentLabel: "An employer has selected you", group: "OFFER", isMilestone: true, sortOrder: 60 },
  { code: "OFFER_RECEIVED", label: "Offer letter / contract issued", studentLabel: "Your offer letter has arrived", group: "OFFER", isMilestone: true, sortOrder: 62 },
  { code: "CONTRACT_SIGNED", label: "Contract signed and returned to the employer", studentLabel: "Contract signed", group: "OFFER", isMilestone: true, sortOrder: 64 },
  // Visa team: steps 11 to 15.
  { code: "VFS_SLOT_BOOKING", label: "Visa team: VFS slot booking", studentLabel: "Booking your visa appointment", group: "IN_PROGRESS", sortOrder: 70 },
  { code: "PRE_VISA_DOCUMENTS", label: "Visa document preparation", studentLabel: "Preparing your visa file", group: "IN_PROGRESS", sortOrder: 75 },
  { code: "VISA_RESUBMISSION", label: "Visa refused: correcting the file to resubmit", studentLabel: "We are correcting your visa file to submit it again", group: "IN_PROGRESS", sortOrder: 77 },
  { code: "VISA_FILED", label: "Visa submission at VFS", studentLabel: "Your visa appointment at VFS", group: "IN_PROGRESS", isMilestone: true, sortOrder: 80 },
  { code: "VISA_PROCESSING", label: "Visa processing", studentLabel: "The embassy is processing your visa", group: "IN_PROGRESS", sortOrder: 85 },
  { code: "VISA_RECEIVED", label: "Visa approved", studentLabel: "Visa approved", studentLabelMl: "വിസ ലഭിച്ചു", group: "SUCCESS", isMilestone: true, sortOrder: 90 },
  // Travel desk: steps 16 to 18.
  { code: "PRE_DEPARTURE", label: "Pre-departure process", studentLabel: "Getting you ready to travel", group: "SUCCESS", isMilestone: true, sortOrder: 95 },
  { code: "JOINED", label: `Departed: started as ${programme === "FSJ" ? "an FSJ" : "a BFD"} volunteer`, studentLabel: "Started your volunteer service in Germany", group: "SUCCESS", isMilestone: true, sortOrder: 100 },
  { code: "HAPPY_CALL", label: "Post-arrival follow-up", studentLabel: "Settling in: we stay in touch", group: "SUCCESS", sortOrder: 105 },
];
const FSJ = fsjChain("FSJ");
const BFD = fsjChain("BFD");

export const STATUS_SEED: Record<Pathway, StatusSeed[]> = {
  DEGREE: [...DEGREE.slice(0, 1), COMMON[0], ...DEGREE.slice(1), ...COMMON.slice(1)],
  AUSBILDUNG: [...AUSBILDUNG.slice(0, 1), COMMON[0], ...AUSBILDUNG.slice(1), ...COMMON.slice(1)],
  NURSING: [...NURSING.slice(0, 1), COMMON[0], ...NURSING.slice(1), ...COMMON.slice(1)],
  FSJ: [...FSJ.slice(0, 1), COMMON[0], ...FSJ.slice(1), ...COMMON.slice(1)],
  BFD: [...BFD.slice(0, 1), COMMON[0], ...BFD.slice(1), ...COMMON.slice(1)],
};

export const DOCUMENT_TYPES = [
  { code: "PASSPORT", label: "Passport (front and back)", labelMl: "പാസ്പോർട്ട് (മുൻ, പിൻ പേജുകൾ)", uploadedBy: "partner", sortOrder: 10 },
  { code: "MARKSHEET_10", label: "Std. 10th marksheet", labelMl: "പത്താം ക്ലാസ് മാർക്ക് ഷീറ്റ്", uploadedBy: "partner", sortOrder: 20 },
  { code: "MARKSHEET_12", label: "Std. 12th marksheet", labelMl: "പ്ലസ് ടു മാർക്ക് ഷീറ്റ്", uploadedBy: "partner", sortOrder: 30 },
  { code: "DEGREE_MARKSHEETS", label: "Bachelor's individual marksheets", labelMl: "ബിരുദ മാർക്ക് ഷീറ്റുകൾ", uploadedBy: "partner", sortOrder: 40 },
  { code: "DEGREE_CERTIFICATE", label: "Degree / provisional certificate", labelMl: "ബിരുദ / പ്രൊവിഷണൽ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 50 },
  // A master's applicant has a master's transcript, and until these existed the
  // only place to put one was "Other".
  { code: "PG_MARKSHEETS", label: "Master's individual marksheets", labelMl: "ബിരുദാനന്തര ബിരുദ മാർക്ക് ഷീറ്റുകൾ", uploadedBy: "partner", sortOrder: 52 },
  { code: "PG_CERTIFICATE", label: "Master's degree certificate", labelMl: "ബിരുദാനന്തര ബിരുദ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 54 },
  { code: "DIPLOMA_CERTIFICATE", label: "Diploma certificate", labelMl: "ഡിപ്ലോമ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 56 },
  { code: "DIPLOMA_MARKSHEETS", label: "Diploma marksheets", labelMl: "ഡിപ്ലോമ മാർക്ക് ഷീറ്റുകൾ", uploadedBy: "partner", sortOrder: 58 },
  { code: "ENGLISH_TEST", label: "English test report (IELTS / PTE / OET)", labelMl: "ഇംഗ്ലീഷ് പരീക്ഷാ റിപ്പോർട്ട് (IELTS / PTE / OET)", uploadedBy: "partner", sortOrder: 60 },
  { code: "GERMAN_CERTIFICATE", label: "German language certificate", labelMl: "ജർമൻ ഭാഷാ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 65 },
  { code: "SOP", label: "Statement of purpose", labelMl: "സ്റ്റേറ്റ്മെന്റ് ഓഫ് പർപ്പസ്", uploadedBy: "partner", sortOrder: 70 },
  { code: "LOR", label: "Letter of recommendation", labelMl: "ശുപാർശ കത്ത്", uploadedBy: "partner", sortOrder: 80 },
  { code: "CV", label: "CV / resume", labelMl: "സി വി / റെസ്യൂമെ", uploadedBy: "partner", sortOrder: 90 },
  { code: "NURSING_LICENSE", label: "Nursing council registration", labelMl: "നഴ്സിങ് കൗൺസിൽ രജിസ്ട്രേഷൻ", uploadedBy: "partner", sortOrder: 95 },
  // Added once the real catalogue showed these are recurring gates for Indian
  // applicants rather than miscellany: APS for Germany, financial proof for the
  // German blocked account and the Canadian GIC, the Ausbildung training
  // contract, and credential evaluation for Canada.
  { code: "APS_CERTIFICATE", label: "APS certificate (Germany)", labelMl: "APS സർട്ടിഫിക്കറ്റ് (ജർമനി)", uploadedBy: "partner", sortOrder: 66 },
  { code: "FINANCIAL_PROOF", label: "Proof of funds (blocked account / GIC)", labelMl: "സാമ്പത്തിക തെളിവ് (ബ്ലോക്ക്ഡ് അക്കൗണ്ട് / GIC)", uploadedBy: "partner", sortOrder: 96 },
  { code: "TRAINING_CONTRACT", label: "Ausbildung training contract", labelMl: "ഔസ്ബിൽഡുങ് പരിശീലന കരാർ", uploadedBy: "team", sortOrder: 97 },
  { code: "CREDENTIAL_EVALUATION", label: "Credential evaluation (WES and similar)", labelMl: "ക്രെഡൻഷ്യൽ മൂല്യനിർണയം (WES)", uploadedBy: "partner", sortOrder: 98 },
  { code: "SCHOOL_LEAVING", label: "School leaving certificate", labelMl: "സ്കൂൾ വിടുതൽ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 35 },
  { code: "OFFER_LETTER", label: "Offer letter", labelMl: "ഓഫർ ലെറ്റർ", uploadedBy: "team", sortOrder: 200 },
  { code: "CAS_COE", label: "CAS / COE", labelMl: "CAS / COE", uploadedBy: "team", sortOrder: 210 },
  { code: "VISA", label: "Visa", labelMl: "വിസ", uploadedBy: "team", sortOrder: 220 },
  { code: "OTHER", label: "Something else (say what it is)", labelMl: "മറ്റൊന്ന് (എന്താണെന്ന് എഴുതുക)", uploadedBy: "partner", sortOrder: 999 },
];
