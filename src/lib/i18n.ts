/**
 * The student portal speaks English and Malayalam. Keep the strings short and
 * plain: most of this is read on a phone, often by a parent rather than the
 * student. Only the portal is translated; the staff app stays in English.
 */

export const LOCALES = ["en", "ml"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = { en: "English", ml: "മലയാളം" };

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "ml";
}

const en = {
  portal: "Student portal",
  signedInAs: "Signed in as",
  signOut: "Sign out",
  language: "Language",
  home: "My application",
  documents: "Documents",
  messages: "Messages",
  profile: "My details",
  changePassword: "Change password",

  greeting: "Hello",
  yourApplications: "Your applications",
  noApplications: "Nothing has been submitted for you yet. Your counsellor will start this once your documents are in.",
  applicationFor: "Application for",
  intake: "Intake",
  reference: "Reference",
  whereItStands: "Where it stands",
  updated: "Updated",
  milestones: "What has happened so far",
  nothingYet: "Nothing recorded yet.",
  needFromYou: "What we need from you",
  allDocumentsIn: "Every document we asked for is with us. Nothing to do right now.",
  uploadHere: "Upload it here",
  counsellor: "Your counsellor",
  branch: "Branch",
  callUs: "If anything here looks wrong, message your counsellor and they will correct it.",
  shortlistTitle: "Programs your counsellor is considering",
  shortlistNote: "These are options, not applications yet. Talk to your counsellor about them.",
  tuition: "Tuition",
  perYear: "a year",
  wholeCourse: "for the whole course",
  notConfirmed: "not confirmed yet",
  duration: "Duration",
  months: "months",
  postStudyWork: "Work after study possible",

  documentsTitle: "Your documents",
  documentsIntro: "Clear photos or scans are fine. PDF, JPG, PNG or WebP, up to 10 MB each.",
  required: "Still needed",
  received: "With us",
  teamUploads: "Medcity Overseas adds this one",
  chooseFile: "Choose a file",
  upload: "Upload",
  uploaded: "Uploaded",
  uploadedOn: "Uploaded on",
  weHaveIt: "We have it. Your counsellor will check it and come back to you if anything is unclear.",

  messagesTitle: "Messages",
  messagesIntro: "This is the same thread your counsellor sees. Replies here reach them and your WhatsApp.",
  writeMessage: "Write a message",
  send: "Send",
  noMessages: "No messages yet. Ask anything about your application here.",
  you: "You",
  team: "Medcity Overseas",

  profileTitle: "Your details",
  profileIntro: "This is what we hold about you. Ask your counsellor to correct anything that is wrong.",
  name: "Name",
  email: "Email",
  phone: "Mobile",
  passport: "Passport",
  passportExpiry: "Passport expiry",
  dateOfBirth: "Date of birth",
  city: "Town or city",
  notGiven: "Not given",
  askCorrection: "Ask for a correction",
  correctionSent: "Sent. Your counsellor will look at it.",
} as const;

const ml: Record<keyof typeof en, string> = {
  portal: "വിദ്യാർഥി പോർട്ടൽ",
  signedInAs: "സൈൻ ഇൻ ചെയ്തിരിക്കുന്നത്",
  signOut: "സൈൻ ഔട്ട്",
  language: "ഭാഷ",
  home: "എന്റെ അപേക്ഷ",
  documents: "രേഖകൾ",
  messages: "സന്ദേശങ്ങൾ",
  profile: "എന്റെ വിവരങ്ങൾ",
  changePassword: "പാസ്‌വേഡ് മാറ്റുക",

  greeting: "നമസ്കാരം",
  yourApplications: "നിങ്ങളുടെ അപേക്ഷകൾ",
  noApplications: "നിങ്ങൾക്കായി ഇതുവരെ അപേക്ഷ അയച്ചിട്ടില്ല. രേഖകൾ ലഭിച്ചാൽ കൗൺസലർ അത് തുടങ്ങും.",
  applicationFor: "അപേക്ഷ",
  intake: "ഇൻടേക്ക്",
  reference: "റഫറൻസ്",
  whereItStands: "ഇപ്പോഴത്തെ സ്ഥിതി",
  updated: "അവസാനം മാറിയത്",
  milestones: "ഇതുവരെ നടന്നത്",
  nothingYet: "ഇതുവരെ ഒന്നും രേഖപ്പെടുത്തിയിട്ടില്ല.",
  needFromYou: "നിങ്ങളിൽ നിന്ന് വേണ്ടത്",
  allDocumentsIn: "ഞങ്ങൾ ചോദിച്ച എല്ലാ രേഖകളും ലഭിച്ചു. ഇപ്പോൾ ഒന്നും ചെയ്യേണ്ടതില്ല.",
  uploadHere: "ഇവിടെ അപ്‌ലോഡ് ചെയ്യുക",
  counsellor: "നിങ്ങളുടെ കൗൺസലർ",
  branch: "ബ്രാഞ്ച്",
  callUs: "ഇവിടെ എന്തെങ്കിലും തെറ്റായി കാണുന്നുവെങ്കിൽ കൗൺസലർക്ക് സന്ദേശം അയയ്ക്കുക, അവർ അത് ശരിയാക്കും.",
  shortlistTitle: "നിങ്ങളുടെ കൗൺസലർ പരിഗണിക്കുന്ന കോഴ്സുകൾ",
  shortlistNote: "ഇവ ഓപ്ഷനുകൾ മാത്രമാണ്, അപേക്ഷകളല്ല. ഇവയെക്കുറിച്ച് കൗൺസലറുമായി സംസാരിക്കുക.",
  tuition: "ട്യൂഷൻ ഫീസ്",
  perYear: "പ്രതിവർഷം",
  wholeCourse: "മുഴുവൻ കോഴ്സിന്",
  notConfirmed: "ഇതുവരെ സ്ഥിരീകരിച്ചിട്ടില്ല",
  duration: "കാലാവധി",
  months: "മാസം",
  postStudyWork: "പഠനശേഷം ജോലി ചെയ്യാൻ അവസരം",

  documentsTitle: "നിങ്ങളുടെ രേഖകൾ",
  documentsIntro: "വ്യക്തമായ ഫോട്ടോയോ സ്കാനോ മതി. PDF, JPG, PNG അല്ലെങ്കിൽ WebP, ഓരോന്നും 10 MB വരെ.",
  required: "ഇനി വേണ്ടത്",
  received: "ലഭിച്ചു",
  teamUploads: "ഇത് മെഡ്സിറ്റി ഓവർസീസ് ചേർക്കും",
  chooseFile: "ഫയൽ തിരഞ്ഞെടുക്കുക",
  upload: "അപ്‌ലോഡ്",
  uploaded: "അപ്‌ലോഡ് ചെയ്തു",
  uploadedOn: "അപ്‌ലോഡ് ചെയ്ത ദിവസം",
  weHaveIt: "ഞങ്ങൾക്ക് ലഭിച്ചു. കൗൺസലർ പരിശോധിച്ച് എന്തെങ്കിലും സംശയമുണ്ടെങ്കിൽ അറിയിക്കും.",

  messagesTitle: "സന്ദേശങ്ങൾ",
  messagesIntro: "നിങ്ങളുടെ കൗൺസലർ കാണുന്ന അതേ സംഭാഷണമാണിത്. ഇവിടെ എഴുതുന്നത് അവർക്കും നിങ്ങളുടെ വാട്സാപ്പിലും എത്തും.",
  writeMessage: "സന്ദേശം എഴുതുക",
  send: "അയയ്ക്കുക",
  noMessages: "ഇതുവരെ സന്ദേശങ്ങളില്ല. അപേക്ഷയെക്കുറിച്ച് എന്തും ഇവിടെ ചോദിക്കാം.",
  you: "നിങ്ങൾ",
  team: "മെഡ്സിറ്റി ഓവർസീസ്",

  profileTitle: "നിങ്ങളുടെ വിവരങ്ങൾ",
  profileIntro: "ഞങ്ങളുടെ കൈയിലുള്ള വിവരങ്ങളാണ് ഇവ. തെറ്റുണ്ടെങ്കിൽ കൗൺസലറോട് പറഞ്ഞ് തിരുത്തിക്കുക.",
  name: "പേര്",
  email: "ഇമെയിൽ",
  phone: "മൊബൈൽ",
  passport: "പാസ്പോർട്ട്",
  passportExpiry: "പാസ്പോർട്ട് കാലാവധി",
  dateOfBirth: "ജനന തീയതി",
  city: "സ്ഥലം",
  notGiven: "നൽകിയിട്ടില്ല",
  askCorrection: "തിരുത്താൻ ആവശ്യപ്പെടുക",
  correctionSent: "അയച്ചു. നിങ്ങളുടെ കൗൺസലർ പരിശോധിക്കും.",
};

const DICTIONARIES = { en, ml } as const;
export type Phrase = keyof typeof en;

/** t("documents") in whichever language the student chose. */
export function translator(locale: Locale) {
  const dict = DICTIONARIES[locale] ?? en;
  return (key: Phrase) => dict[key] ?? en[key];
}
