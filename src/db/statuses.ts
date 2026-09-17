import type { Pathway, StatusGroup } from "./schema";

type StatusSeed = {
  code: string;
  label: string;
  studentLabel: string;
  group: StatusGroup;
  requiresReason?: boolean;
  isMilestone?: boolean;
};

/** Statuses available at any stage of every pathway. */
const COMMON: StatusSeed[] = [
  { code: "PENDING_PARTNER", label: "Pending from partner", studentLabel: "We need something from you", group: "PENDING_PARTNER" },
  { code: "ON_HOLD_INTAKE", label: "Application on hold: intake yet to open", studentLabel: "Waiting for the intake to open", group: "HOLD" },
  { code: "DEFERRED", label: "Deferred", studentLabel: "Moved to a later intake", group: "HOLD", requiresReason: true },
  { code: "CLOSED_NOT_QUALIFIED", label: "Case closed: student not qualified", studentLabel: "Application closed", group: "CLOSED", requiresReason: true },
  { code: "VISA_REJECTED", label: "Visa rejected", studentLabel: "Visa refused", group: "CLOSED", requiresReason: true, isMilestone: true },
  { code: "WITHDRAWN", label: "Withdrawn", studentLabel: "Application withdrawn", group: "CLOSED", requiresReason: true },
  { code: "CASE_CLOSED", label: "Case closed", studentLabel: "Application closed", group: "CLOSED", requiresReason: true },
];

const DEGREE: StatusSeed[] = [
  { code: "ASSESSMENT", label: "Assessment pending", studentLabel: "Application received", group: "NEW" },
  { code: "SUBMITTED", label: "Application submitted to the institution", studentLabel: "Submitted to university", group: "IN_PROGRESS", isMilestone: true },
  { code: "CONDITIONAL_OFFER", label: "Conditional offer received", studentLabel: "Conditional offer", group: "OFFER", isMilestone: true },
  { code: "UNCONDITIONAL_OFFER", label: "Unconditional offer received", studentLabel: "Unconditional offer", group: "OFFER", isMilestone: true },
  { code: "DEPOSIT_PAID", label: "Tuition deposit paid", studentLabel: "Deposit paid", group: "IN_PROGRESS" },
  { code: "CAS_COE", label: "CAS / COE issued", studentLabel: "CAS / COE issued", group: "IN_PROGRESS", isMilestone: true },
  { code: "VISA_FILED", label: "Visa filed", studentLabel: "Visa applied", group: "IN_PROGRESS" },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", group: "SUCCESS", isMilestone: true },
  { code: "ENROLLED", label: "Enrolled", studentLabel: "Enrolled", group: "SUCCESS", isMilestone: true },
];

const AUSBILDUNG: StatusSeed[] = [
  { code: "LANGUAGE_PENDING", label: "German A2 / B1 pending", studentLabel: "Complete your German level", group: "NEW" },
  { code: "PROFILE_CV", label: "German CV and profile in progress", studentLabel: "Preparing your profile", group: "IN_PROGRESS" },
  { code: "EMPLOYER_MATCHING", label: "Employer matching", studentLabel: "Finding employers", group: "IN_PROGRESS" },
  { code: "EMPLOYER_INTERVIEW", label: "Employer interview scheduled", studentLabel: "Interview with employer", group: "IN_PROGRESS", isMilestone: true },
  { code: "CONTRACT_SIGNED", label: "Training contract signed", studentLabel: "Contract signed", group: "OFFER", isMilestone: true },
  { code: "RECOGNITION", label: "Recognition / approval in progress", studentLabel: "Approval in progress", group: "IN_PROGRESS" },
  { code: "VISA_FILED", label: "Visa filed (VFS)", studentLabel: "Visa applied", group: "IN_PROGRESS", isMilestone: true },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", group: "SUCCESS", isMilestone: true },
  { code: "JOINED", label: "Joined employer", studentLabel: "Started training", group: "SUCCESS", isMilestone: true },
];

const NURSING: StatusSeed[] = [
  { code: "CREDENTIAL_CHECK", label: "Credential check", studentLabel: "Checking your qualifications", group: "NEW" },
  { code: "LANGUAGE_SCORE", label: "OET / IELTS score pending", studentLabel: "Language score needed", group: "PENDING_PARTNER" },
  { code: "BOARD_APPLICATION", label: "Board application (NMC / NCSBN / Anerkennung)", studentLabel: "Registration applied", group: "IN_PROGRESS", isMilestone: true },
  { code: "EXAM", label: "CBT / NCLEX / Kenntnisprüfung", studentLabel: "Licensing exam", group: "IN_PROGRESS" },
  { code: "REGISTRATION", label: "Registration / PIN received", studentLabel: "Registered", group: "OFFER", isMilestone: true },
  { code: "JOB_OFFER", label: "Job offer received", studentLabel: "Job offer", group: "OFFER", isMilestone: true },
  { code: "VISA_RECEIVED", label: "Visa received", studentLabel: "Visa approved", group: "SUCCESS", isMilestone: true },
  { code: "DEPLOYED", label: "Deployed", studentLabel: "Started work", group: "SUCCESS", isMilestone: true },
];

export const STATUS_SEED: Record<Pathway, StatusSeed[]> = {
  DEGREE: [...DEGREE.slice(0, 1), COMMON[0], ...DEGREE.slice(1), ...COMMON.slice(1)],
  AUSBILDUNG: [...AUSBILDUNG.slice(0, 1), COMMON[0], ...AUSBILDUNG.slice(1), ...COMMON.slice(1)],
  NURSING: [...NURSING.slice(0, 1), COMMON[0], ...NURSING.slice(1), ...COMMON.slice(1)],
};

export const DOCUMENT_TYPES = [
  { code: "PASSPORT", label: "Passport (front and back)", uploadedBy: "partner", sortOrder: 10 },
  { code: "MARKSHEET_10", label: "Std. 10th marksheet", uploadedBy: "partner", sortOrder: 20 },
  { code: "MARKSHEET_12", label: "Std. 12th marksheet", uploadedBy: "partner", sortOrder: 30 },
  { code: "DEGREE_MARKSHEETS", label: "Bachelor's individual marksheets", uploadedBy: "partner", sortOrder: 40 },
  { code: "DEGREE_CERTIFICATE", label: "Degree / provisional certificate", uploadedBy: "partner", sortOrder: 50 },
  { code: "ENGLISH_TEST", label: "English test report (IELTS / PTE / OET)", uploadedBy: "partner", sortOrder: 60 },
  { code: "GERMAN_CERTIFICATE", label: "German language certificate", uploadedBy: "partner", sortOrder: 65 },
  { code: "SOP", label: "Statement of purpose", uploadedBy: "partner", sortOrder: 70 },
  { code: "LOR", label: "Letter of recommendation", uploadedBy: "partner", sortOrder: 80 },
  { code: "CV", label: "CV / resume", uploadedBy: "partner", sortOrder: 90 },
  { code: "NURSING_LICENSE", label: "Nursing council registration", uploadedBy: "partner", sortOrder: 95 },
  { code: "OFFER_LETTER", label: "Offer letter", uploadedBy: "team", sortOrder: 200 },
  { code: "CAS_COE", label: "CAS / COE", uploadedBy: "team", sortOrder: 210 },
  { code: "VISA", label: "Visa", uploadedBy: "team", sortOrder: 220 },
  { code: "OTHER", label: "Other", uploadedBy: "partner", sortOrder: 999 },
];
