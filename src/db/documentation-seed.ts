/**
 * What the nine stages ask for, as the Overseas team described it.
 *
 * This is the starting content, not a rule set frozen in code: every row lands
 * in document_requirements, where the team edits it, pauses it or adds to it.
 * Validity in months is only recorded where the requirement itself carries one
 * (a TB test is good for six months); where a document carries its own expiry,
 * the date is read off the document instead.
 */

import type { JourneyStage, OwedBy, Pathway } from "./schema";

/** Document types the documentation spine needs on top of the originals. */
export const DOCUMENTATION_TYPES = [
  { code: "PHOTOGRAPH", label: "Passport-size photograph", labelMl: "പാസ്പോർട്ട് സൈസ് ഫോട്ടോ", uploadedBy: "partner", sortOrder: 15 },
  { code: "TRANSCRIPT", label: "Consolidated transcript", labelMl: "കൺസോളിഡേറ്റഡ് ട്രാൻസ്ക്രിപ്റ്റ്", uploadedBy: "partner", sortOrder: 45 },
  { code: "BACKLOG_CERTIFICATE", label: "Backlog certificate", labelMl: "ബാക്ക്‌ലോഗ് സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 46 },
  { code: "MOI", label: "Medium of instruction letter", labelMl: "മീഡിയം ഓഫ് ഇൻസ്ട്രക്ഷൻ കത്ത്", uploadedBy: "partner", sortOrder: 61 },
  { code: "WORK_EXPERIENCE_LETTER", label: "Work experience letter", labelMl: "ജോലി പരിചയ കത്ത്", uploadedBy: "partner", sortOrder: 91 },
  { code: "PORTFOLIO", label: "Portfolio", labelMl: "പോർട്ട്ഫോളിയോ", uploadedBy: "partner", sortOrder: 92 },
  { code: "UNIVERSITY_FORM", label: "University's own application form", labelMl: "സർവകലാശാലയുടെ അപേക്ഷാ ഫോം", uploadedBy: "partner", sortOrder: 100 },
  { code: "ROUTE_FORM", label: "Vendor's application form", labelMl: "വെൻഡറുടെ അപേക്ഷാ ഫോം", uploadedBy: "partner", sortOrder: 101 },
  { code: "OFFER_CONDITION_EVIDENCE", label: "Evidence for the offer conditions", labelMl: "ഓഫർ നിബന്ധനകൾക്കുള്ള തെളിവ്", uploadedBy: "partner", sortOrder: 201 },
  { code: "OFFER_ACCEPTANCE", label: "Signed offer acceptance", labelMl: "ഒപ്പിട്ട ഓഫർ സ്വീകാര്യത", uploadedBy: "partner", sortOrder: 202 },
  { code: "SCHOLARSHIP_LETTER", label: "Scholarship letter", labelMl: "സ്കോളർഷിപ്പ് കത്ത്", uploadedBy: "team", sortOrder: 203 },
  { code: "DEPOSIT_RECEIPT", label: "Tuition deposit receipt", labelMl: "ട്യൂഷൻ ഡെപ്പോസിറ്റ് രസീത്", uploadedBy: "partner", sortOrder: 204 },
  { code: "BANK_TRANSFER_PROOF", label: "Bank transfer proof (A1 or SWIFT)", labelMl: "ബാങ്ക് ട്രാൻസ്ഫർ തെളിവ് (A1 / SWIFT)", uploadedBy: "partner", sortOrder: 205 },
  { code: "LOAN_SANCTION", label: "Education loan sanction letter", labelMl: "വിദ്യാഭ്യാസ വായ്പ അനുമതി കത്ത്", uploadedBy: "partner", sortOrder: 206 },
  { code: "SPONSOR_AFFIDAVIT", label: "Sponsor affidavit and relationship proof", labelMl: "സ്പോൺസർ സത്യവാങ്മൂലവും ബന്ധ തെളിവും", uploadedBy: "partner", sortOrder: 207 },
  { code: "UNCONDITIONAL_OFFER", label: "Unconditional offer letter", labelMl: "അൺകണ്ടീഷണൽ ഓഫർ ലെറ്റർ", uploadedBy: "team", sortOrder: 211 },
  { code: "FEE_RECEIPT", label: "Tuition fee receipt", labelMl: "ട്യൂഷൻ ഫീ രസീത്", uploadedBy: "partner", sortOrder: 212 },
  { code: "MEDICAL_REPORT", label: "Medical report", labelMl: "മെഡിക്കൽ റിപ്പോർട്ട്", uploadedBy: "partner", sortOrder: 213 },
  { code: "VISA_FORM", label: "Visa application form", labelMl: "വിസ അപേക്ഷാ ഫോം", uploadedBy: "partner", sortOrder: 214 },
  { code: "BANK_STATEMENT", label: "Bank statement", labelMl: "ബാങ്ക് സ്റ്റേറ്റ്മെന്റ്", uploadedBy: "partner", sortOrder: 215 },
  { code: "ITR", label: "Income tax returns", labelMl: "ആദായ നികുതി റിട്ടേൺ", uploadedBy: "partner", sortOrder: 216 },
  { code: "TB_TEST", label: "TB test certificate", labelMl: "ടി ബി ടെസ്റ്റ് സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 217 },
  { code: "POLICE_CLEARANCE", label: "Police clearance certificate", labelMl: "പോലീസ് ക്ലിയറൻസ് സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 218 },
  { code: "BIOMETRICS_RECEIPT", label: "Biometrics receipt", labelMl: "ബയോമെട്രിക്സ് രസീത്", uploadedBy: "partner", sortOrder: 219 },
  { code: "CREDIBILITY_STATEMENT", label: "Credibility or GS statement", labelMl: "ക്രെഡിബിലിറ്റി / GS സ്റ്റേറ്റ്മെന്റ്", uploadedBy: "partner", sortOrder: 221 },
  { code: "VISA_APPOINTMENT", label: "Visa appointment letter", labelMl: "വിസ അപ്പോയിന്റ്മെന്റ് കത്ത്", uploadedBy: "partner", sortOrder: 222 },
  { code: "TICKET", label: "Flight ticket", labelMl: "വിമാന ടിക്കറ്റ്", uploadedBy: "partner", sortOrder: 230 },
  { code: "INSURANCE", label: "Travel and health insurance", labelMl: "യാത്ര, ആരോഗ്യ ഇൻഷുറൻസ്", uploadedBy: "partner", sortOrder: 231 },
  { code: "ACCOMMODATION", label: "Accommodation contract", labelMl: "താമസ കരാർ", uploadedBy: "partner", sortOrder: 232 },
  { code: "FOREX_CARD", label: "Forex card", labelMl: "ഫോറെക്സ് കാർഡ്", uploadedBy: "partner", sortOrder: 233 },
  { code: "SIM_CARD", label: "SIM", labelMl: "സിം", uploadedBy: "partner", sortOrder: 234 },
  { code: "PRE_DEPARTURE_BRIEFING", label: "Pre-departure briefing, signed", labelMl: "യാത്രയ്ക്ക് മുൻപുള്ള ബ്രീഫിങ്, ഒപ്പിട്ടത്", uploadedBy: "team", sortOrder: 235 },
  { code: "ENROLMENT_CONFIRMATION", label: "Enrolment confirmation", labelMl: "എൻറോൾമെന്റ് സ്ഥിരീകരണം", uploadedBy: "team", sortOrder: 240 },
  { code: "RESIDENCE_PERMIT", label: "Residence permit or BRP", labelMl: "റെസിഡൻസ് പെർമിറ്റ് / BRP", uploadedBy: "partner", sortOrder: 241 },
  { code: "LOCAL_ADDRESS", label: "Local address proof", labelMl: "പ്രാദേശിക വിലാസ തെളിവ്", uploadedBy: "partner", sortOrder: 242 },
  { code: "LOCAL_BANK_ACCOUNT", label: "Local bank account", labelMl: "പ്രാദേശിക ബാങ്ക് അക്കൗണ്ട്", uploadedBy: "partner", sortOrder: 243 },
  { code: "TERM_REGISTRATION", label: "First-term registration", labelMl: "ആദ്യ ടേം രജിസ്ട്രേഷൻ", uploadedBy: "partner", sortOrder: 244 },
  // Ausbildung and nursing registration ask for paper a degree does not.
  { code: "MOTIVATION_LETTER", label: "Motivation letter (Anschreiben)", labelMl: "മോട്ടിവേഷൻ ലെറ്റർ", uploadedBy: "partner", sortOrder: 93 },
  { code: "BIRTH_CERTIFICATE", label: "Birth certificate", labelMl: "ജനന സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 12 },
  { code: "NURSING_DEGREE", label: "Nursing degree or diploma certificate (BSc / GNM)", labelMl: "നഴ്സിങ് ബിരുദം / ഡിപ്ലോമ സർട്ടിഫിക്കറ്റ്", uploadedBy: "partner", sortOrder: 47 },
  { code: "NURSING_MARKSHEETS", label: "Nursing marksheets and transcript", labelMl: "നഴ്സിങ് മാർക്ക് ഷീറ്റുകളും ട്രാൻസ്ക്രിപ്റ്റും", uploadedBy: "partner", sortOrder: 48 },
  // The rest of the paper Medcity's written Ausbildung process names, from the
  // consultancy agreement at registration to the employer's forms the visa
  // file waits for. No Malayalam yet, so the portal shows the English; the
  // Documents screen says "Not translated" until somebody adds it.
  { code: "AADHAAR_PAN", label: "Aadhaar and PAN card", labelMl: null, uploadedBy: "partner", sortOrder: 13 },
  { code: "CONSULTANCY_AGREEMENT", label: "Consultancy agreement (declaration form)", labelMl: null, uploadedBy: "partner", sortOrder: 16 },
  { code: "TRANSLATED_CERTIFICATES", label: "Educational certificates, German translation", labelMl: null, uploadedBy: "team", sortOrder: 67 },
  { code: "NOTARISED_CERTIFICATES", label: "Notarised and attested certificates", labelMl: null, uploadedBy: "partner", sortOrder: 68 },
  { code: "GERMAN_CV", label: "CV in German format (Lebenslauf)", labelMl: null, uploadedBy: "team", sortOrder: 94 },
  { code: "SELF_INTRO_VIDEO", label: "Self-introduction video", labelMl: null, uploadedBy: "partner", sortOrder: 99 },
  { code: "JOB_CONSENT", label: "Job-specific consent (declaration form)", labelMl: null, uploadedBy: "partner", sortOrder: 103 },
  { code: "SCHOOL_CONTRACT", label: "School contract (vocational school)", labelMl: null, uploadedBy: "team", sortOrder: 197 },
  { code: "EZB", label: "EZB: declaration of employment relationship", labelMl: null, uploadedBy: "team", sortOrder: 198 },
  { code: "VACCINATION_CERTIFICATE", label: "Vaccination certificate", labelMl: null, uploadedBy: "partner", sortOrder: 199 },
  { code: "BIOMETRIC_PHOTO", label: "Biometric photo (35 x 40 mm)", labelMl: null, uploadedBy: "partner", sortOrder: 223 },
  { code: "LEGAL_REPRESENTATION_FORM", label: "Legal representation form", labelMl: null, uploadedBy: "partner", sortOrder: 224 },
  { code: "COVER_LETTER", label: "Cover letter for the visa file", labelMl: null, uploadedBy: "team", sortOrder: 225 },
  { code: "ANNEX_EMPLOYMENT_DATA", label: "Annex employment data", labelMl: null, uploadedBy: "team", sortOrder: 226 },
  { code: "FAST_TRACK_FORM", label: "Fast-track form", labelMl: null, uploadedBy: "team", sortOrder: 227 },
  { code: "ZAV", label: "ZAV approval (Federal Employment Agency)", labelMl: null, uploadedBy: "team", sortOrder: 228 },
  { code: "LANGUAGE_CONFIRMATION", label: "Language confirmation letter from the employer", labelMl: null, uploadedBy: "team", sortOrder: 229 },
  { code: "TESTIMONIAL", label: "Testimonial and felicitation record", labelMl: null, uploadedBy: "team", sortOrder: 236 },
];

export type SeedRequirement = {
  stage: JourneyStage;
  typeCode: string;
  required?: boolean;
  owedBy?: OwedBy;
  validityMonths?: number;
  guidance?: string;
  /** A two-letter country code where the destination is what asks for it. */
  country?: string;
  /** The journey this belongs to. Left out, it is every journey's. */
  pathway?: Pathway;
};

/** The nine lists. Anything with a country is a destination's own addition. */
export const STAGE_REQUIREMENTS: SeedRequirement[] = [
  // 1. Profile
  { stage: "PROFILE", typeCode: "PASSPORT", guidance: "Both pages, in one file, readable. The name here is the name every other document must match." },
  { stage: "PROFILE", typeCode: "PHOTOGRAPH", guidance: "Recent, plain background, face uncovered." },
  { stage: "PROFILE", typeCode: "MARKSHEET_10" },
  { stage: "PROFILE", typeCode: "MARKSHEET_12" },
  { stage: "PROFILE", typeCode: "DEGREE_MARKSHEETS", pathway: "DEGREE", required: false, guidance: "Where the student has studied a degree. All semesters." },
  { stage: "PROFILE", typeCode: "DEGREE_CERTIFICATE", pathway: "DEGREE", required: false, guidance: "Where the student has studied a degree. A provisional certificate is enough until the original is issued." },
  { stage: "PROFILE", typeCode: "TRANSCRIPT", pathway: "DEGREE", required: false, guidance: "Where the university issues one separately from the marksheets." },
  { stage: "PROFILE", typeCode: "BACKLOG_CERTIFICATE", pathway: "DEGREE", required: false, guidance: "Where there are backlogs. Some universities ask for it even at zero." },
  { stage: "PROFILE", typeCode: "ENGLISH_TEST", pathway: "DEGREE", validityMonths: 24, guidance: "IELTS, PTE or OET. Two years from the test date, so read the date off the report." },
  { stage: "PROFILE", typeCode: "MOI", pathway: "DEGREE", required: false, guidance: "Instead of a test, where the university accepts it. On the university's letterhead." },
  { stage: "PROFILE", typeCode: "WORK_EXPERIENCE_LETTER", pathway: "DEGREE", required: false, guidance: "Where there is work experience to show, on company letterhead with dates and role." },
  { stage: "PROFILE", typeCode: "CV", pathway: "DEGREE" },
  // 2. Shortlist asks for nothing new: the gate is that stage 1 is complete.
  // 3. Application
  { stage: "APPLICATION", typeCode: "SOP", pathway: "DEGREE" },
  { stage: "APPLICATION", typeCode: "LOR", pathway: "DEGREE", guidance: "Two, unless the university says otherwise." },
  { stage: "APPLICATION", typeCode: "PORTFOLIO", pathway: "DEGREE", required: false, guidance: "Design, architecture and fine art courses." },
  { stage: "APPLICATION", typeCode: "UNIVERSITY_FORM", pathway: "DEGREE", owedBy: "MEDCITY", guidance: "The university's own form, filled and signed." },
  // 4. Offer
  { stage: "OFFER", typeCode: "OFFER_LETTER", pathway: "DEGREE", owedBy: "UNIVERSITY" },
  { stage: "OFFER", typeCode: "OFFER_CONDITION_EVIDENCE", pathway: "DEGREE", required: false, guidance: "One file for each condition on the offer." },
  { stage: "OFFER", typeCode: "OFFER_ACCEPTANCE", pathway: "DEGREE" },
  { stage: "OFFER", typeCode: "SCHOLARSHIP_LETTER", pathway: "DEGREE", required: false, owedBy: "UNIVERSITY" },
  // 5. Deposit
  { stage: "DEPOSIT", typeCode: "DEPOSIT_RECEIPT", pathway: "DEGREE" },
  { stage: "DEPOSIT", typeCode: "BANK_TRANSFER_PROOF", pathway: "DEGREE", required: false, guidance: "The A1 form or the SWIFT copy, whichever the bank issued." },
  { stage: "DEPOSIT", typeCode: "LOAN_SANCTION", pathway: "DEGREE", required: false, guidance: "Where the fee is met by a loan." },
  { stage: "DEPOSIT", typeCode: "SPONSOR_AFFIDAVIT", pathway: "DEGREE", required: false, guidance: "Where somebody other than the student pays, with proof of the relationship." },
  // 6. Confirmation
  { stage: "CONFIRMATION", typeCode: "CAS_COE", pathway: "DEGREE", owedBy: "UNIVERSITY", guidance: "CAS for the UK, I-20 for the United States, CoE for Australia, LOA for Canada." },
  { stage: "CONFIRMATION", typeCode: "UNCONDITIONAL_OFFER", pathway: "DEGREE", required: false, owedBy: "UNIVERSITY" },
  { stage: "CONFIRMATION", typeCode: "FEE_RECEIPT", pathway: "DEGREE" },
  { stage: "CONFIRMATION", typeCode: "MEDICAL_REPORT", pathway: "DEGREE", required: false, guidance: "Where the university asks for one." },
  // 7. Visa
  { stage: "VISA", typeCode: "VISA_FORM", owedBy: "MEDCITY" },
  { stage: "VISA", typeCode: "FINANCIAL_PROOF", pathway: "DEGREE", guidance: "The blocked account for Germany, the GIC for Canada, the funds the destination states elsewhere." },
  { stage: "VISA", typeCode: "BANK_STATEMENT", pathway: "DEGREE", guidance: "Read the dates off the statement: the destination's window is what decides, not the day it was printed." },
  { stage: "VISA", typeCode: "ITR", pathway: "DEGREE", required: false },
  { stage: "VISA", typeCode: "BIOMETRICS_RECEIPT", pathway: "DEGREE" },
  { stage: "VISA", typeCode: "VISA_APPOINTMENT" },
  { stage: "VISA", typeCode: "TB_TEST", country: "GB", validityMonths: 6, guidance: "From a clinic on the approved list. Six months from the test date." },
  { stage: "VISA", typeCode: "CREDIBILITY_STATEMENT", pathway: "DEGREE", country: "GB", guidance: "The credibility interview statement, in the student's own words." },
  { stage: "VISA", typeCode: "POLICE_CLEARANCE", country: "AU", validityMonths: 3, guidance: "Three months from the date of issue." },
  { stage: "APPLICATION", typeCode: "APS_CERTIFICATE", pathway: "DEGREE", country: "DE", guidance: "Germany asks for it before the application, so start it early." },
  { stage: "APPLICATION", typeCode: "CREDENTIAL_EVALUATION", pathway: "DEGREE", country: "CA", required: false, guidance: "WES or an equivalent, where the college asks for it." },
  // 8. Departure
  { stage: "DEPARTURE", typeCode: "VISA", owedBy: "MEDCITY", guidance: "The visa page itself, once it is in the passport." },
  { stage: "DEPARTURE", typeCode: "TICKET" },
  { stage: "DEPARTURE", typeCode: "INSURANCE" },
  { stage: "DEPARTURE", typeCode: "ACCOMMODATION", required: false },
  { stage: "DEPARTURE", typeCode: "FOREX_CARD", required: false },
  { stage: "DEPARTURE", typeCode: "SIM_CARD", required: false },
  { stage: "DEPARTURE", typeCode: "PRE_DEPARTURE_BRIEFING", owedBy: "MEDCITY" },
  // 9. Arrived
  { stage: "ARRIVED", typeCode: "ENROLMENT_CONFIRMATION", pathway: "DEGREE", owedBy: "UNIVERSITY" },
  { stage: "ARRIVED", typeCode: "RESIDENCE_PERMIT", required: false },
  { stage: "ARRIVED", typeCode: "LOCAL_ADDRESS", required: false },
  { stage: "ARRIVED", typeCode: "LOCAL_BANK_ACCOUNT", required: false },
  { stage: "ARRIVED", typeCode: "TERM_REGISTRATION", pathway: "DEGREE", required: false },

  // Ausbildung: an employer reads the file, not an admissions office, and it
  // is read in German. A starting list for the Overseas team to edit under
  // Settings, not a rule written into the code.
  { stage: "PROFILE", typeCode: "GERMAN_CERTIFICATE", pathway: "AUSBILDUNG", guidance: "Goethe, telc or ÖSD. Most places ask for B1; nursing and care usually B2." },
  { stage: "PROFILE", typeCode: "CV", pathway: "AUSBILDUNG", guidance: "The student's own resume, in English. The documentation mentor prepares the German Lebenslauf from it." },
  { stage: "PROFILE", typeCode: "MOTIVATION_LETTER", pathway: "AUSBILDUNG", guidance: "In German, addressed to the employer, one page." },
  { stage: "PROFILE", typeCode: "WORK_EXPERIENCE_LETTER", pathway: "AUSBILDUNG", required: false, guidance: "Any work or internship, on letterhead with dates and role." },
  { stage: "PROFILE", typeCode: "BIRTH_CERTIFICATE", pathway: "AUSBILDUNG", required: false, guidance: "Where the embassy or the employer asks for it." },
  { stage: "OFFER", typeCode: "TRAINING_CONTRACT", pathway: "AUSBILDUNG", guidance: "Signed by the employer and the student. The visa is applied for on this." },
  // The rest of the written process, step by step. Registration and document
  // collection (steps 2 and 3) land on Profile; what the documentation mentor
  // prepares for employers (steps 6 and 9) on Application; what comes with the
  // training contract (step 11) on Offer; the pre-visa list (step 12) on Visa.
  // A document the employer sends is owed by Medcity, because the placement
  // team is who the portal waits on for it, not the student.
  { stage: "PROFILE", typeCode: "CONSULTANCY_AGREEMENT", pathway: "AUSBILDUNG", guidance: "Signed at registration with the registration fee. States the refund policy and the compensation if an employer's contract is not honoured." },
  { stage: "PROFILE", typeCode: "AADHAAR_PAN", pathway: "AUSBILDUNG", guidance: "Both cards in one file. The embassy asks for them with the visa file, so collect them at registration." },
  { stage: "PROFILE", typeCode: "DIPLOMA_CERTIFICATE", pathway: "AUSBILDUNG", required: false, guidance: "Where the student holds a diploma." },
  { stage: "PROFILE", typeCode: "DEGREE_CERTIFICATE", pathway: "AUSBILDUNG", required: false, guidance: "Where the student holds a degree. A provisional certificate is enough until the original is issued." },
  // The three the documentation mentor makes after the hand-over (steps 4 to
  // 6 of the written process) are not required, or the branch could never
  // hand the file to the desk that makes them.
  { stage: "APPLICATION", typeCode: "GERMAN_CV", pathway: "AUSBILDUNG", owedBy: "MEDCITY", required: false, guidance: "Prepared by the documentation mentor from the student's resume: tabular Lebenslauf form, in German, with a photograph." },
  { stage: "APPLICATION", typeCode: "TRANSLATED_CERTIFICATES", pathway: "AUSBILDUNG", owedBy: "MEDCITY", required: false, guidance: "German translation of the 10th, 12th and any higher certificate. Sent to translation.germany@miak.in and checked by the language specialist before it goes anywhere." },
  { stage: "APPLICATION", typeCode: "NOTARISED_CERTIFICATES", pathway: "AUSBILDUNG", required: false, guidance: "Where the employer or the embassy asks for notarisation and attestation." },
  { stage: "APPLICATION", typeCode: "SELF_INTRO_VIDEO", pathway: "AUSBILDUNG", required: false, guidance: "A short introduction in German for employers. Upload a one-page PDF with the link to the video (Drive or YouTube); the video file itself is too large to upload here." },
  { stage: "APPLICATION", typeCode: "JOB_CONSENT", pathway: "AUSBILDUNG", required: false, guidance: "Sent when an employer shortlists the student: consent to that job, with the compensation for dishonouring the contract stated plainly." },
  { stage: "OFFER", typeCode: "SCHOOL_CONTRACT", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "The vocational school's contract, from the employer. Signed and returned with the training contract." },
  { stage: "OFFER", typeCode: "EZB", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "The declaration of employment relationship (Erklärung zum Beschäftigungsverhältnis), filled by the employer. The visa file waits for it." },
  { stage: "OFFER", typeCode: "LANGUAGE_CONFIRMATION", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "From the employer, confirming the German level the place needs. The visa file waits for it." },
  { stage: "OFFER", typeCode: "VACCINATION_CERTIFICATE", pathway: "AUSBILDUNG", required: false, guidance: "Where the employer asks for it; care and nursing places usually do." },
  { stage: "OFFER", typeCode: "POLICE_CLEARANCE", pathway: "AUSBILDUNG", required: false, guidance: "Where the employer asks for it. Read the date of issue off the certificate." },
  { stage: "VISA", typeCode: "ACCOMMODATION", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "Proof from the employer of where the student will live. The visa file waits for it." },
  { stage: "VISA", typeCode: "INSURANCE", pathway: "AUSBILDUNG", guidance: "Health insurance covering the stay from the day of arrival. The embassy asks for it with the visa file." },
  { stage: "VISA", typeCode: "BIOMETRIC_PHOTO", pathway: "AUSBILDUNG", guidance: "35 by 40 mm with 80 percent face coverage, as the embassy specifies. Not the passport-size photograph." },
  { stage: "VISA", typeCode: "LEGAL_REPRESENTATION_FORM", pathway: "AUSBILDUNG", guidance: "Signed by the student, so Medcity may deal with the embassy on their behalf." },
  { stage: "VISA", typeCode: "COVER_LETTER", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "Prepared by the visa team, listing what is in the file." },
  { stage: "VISA", typeCode: "ANNEX_EMPLOYMENT_DATA", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "Filled by the employer." },
  { stage: "VISA", typeCode: "ZAV", pathway: "AUSBILDUNG", owedBy: "MEDCITY", guidance: "The Federal Employment Agency's approval of the employment, obtained by the employer." },
  { stage: "VISA", typeCode: "FAST_TRACK_FORM", pathway: "AUSBILDUNG", required: false, owedBy: "MEDCITY", guidance: "Where the employer uses the accelerated skilled worker procedure." },
  { stage: "DEPARTURE", typeCode: "TESTIMONIAL", pathway: "AUSBILDUNG", required: false, owedBy: "MEDCITY", guidance: "Felicitation and the testimonial, collected before departure; a second one and a reference after arrival." },

  // Nursing registration abroad: NCLEX-RN, the NMC and the like. The board
  // reads the nursing education and the licence at home before anything else.
  { stage: "PROFILE", typeCode: "NURSING_DEGREE", pathway: "NURSING" },
  { stage: "PROFILE", typeCode: "NURSING_MARKSHEETS", pathway: "NURSING", guidance: "Every year of the course, with the theory and clinical hours where the college states them." },
  { stage: "PROFILE", typeCode: "NURSING_LICENSE", pathway: "NURSING", guidance: "The state nursing council registration, current." },
  { stage: "PROFILE", typeCode: "ENGLISH_TEST", pathway: "NURSING", validityMonths: 24, guidance: "OET or IELTS academic. Two years from the test date." },
  { stage: "PROFILE", typeCode: "WORK_EXPERIENCE_LETTER", pathway: "NURSING", required: false, guidance: "Each hospital, on letterhead, with the dates and the ward." },
  { stage: "PROFILE", typeCode: "CV", pathway: "NURSING" },
  { stage: "APPLICATION", typeCode: "CREDENTIAL_EVALUATION", pathway: "NURSING", guidance: "CGFNS for NCLEX-RN, or the evaluation the board names." },
];

/** The reasons a document goes back. The words here are the words the student reads. */
export const REJECTION_REASONS = [
  { code: "not_clear", label: "Not clear enough to read", labelMl: "വായിക്കാൻ വ്യക്തമല്ല" },
  { code: "page_missing", label: "A page is missing", labelMl: "ഒരു പേജ് ഇല്ല" },
  { code: "name_mismatch", label: "The name does not match the passport", labelMl: "പേര് പാസ്പോർട്ടുമായി ചേരുന്നില്ല" },
  { code: "too_old", label: "Older than the destination allows", labelMl: "അനുവദനീയമായതിനേക്കാൾ പഴയത്" },
  { code: "not_attested", label: "Not attested or not signed", labelMl: "സാക്ഷ്യപ്പെടുത്തിയിട്ടില്ല" },
  { code: "wrong_document", label: "This is not the document we asked for", labelMl: "ഞങ്ങൾ ചോദിച്ച രേഖയല്ല" },
  { code: "period_short", label: "The period it covers is too short", labelMl: "കാലയളവ് പര്യാപ്തമല്ല" },
];
