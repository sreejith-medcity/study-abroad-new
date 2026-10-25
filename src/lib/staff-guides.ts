/**
 * The staff guides: plain-English pages on how a part of the portal is used,
 * written for Medcity's own people and kept here, in code, because the learning
 * library's resources table holds a file or a link and has no column for a
 * body of text. Each guide is served at its own address under the learning
 * library, listed there as a GUIDE resource pointing at that address, and read
 * before the training course that quizzes on it.
 *
 * The text names screens and buttons exactly as the code labels them, and
 * nothing the portal does not do: where the written process has a step people
 * do outside the portal, the guide says so. The unit test holds the list of
 * labels the guides may quote, so a renamed button fails a test rather than
 * leaving a guide pointing at a label that is gone.
 */
import { APP_ROLES, DOCUMENTATION_ROLES } from "./permissions";
import { NOT_ISSUED, REPORT_ROLES } from "./journal";

export type GuideSection = {
  heading: string;
  /** Paragraphs, in order. */
  paragraphs?: string[];
  /** Numbered steps a person follows, in order. Shown after the paragraphs. */
  steps?: string[];
  /** A closing paragraph under the steps. */
  after?: string;
};

export type GuideQuestion = {
  prompt: string;
  options: string[];
  correctIndex: number;
  /** A phrase from the guide that answers the question, where the right option is not itself in the text word for word. */
  evidence?: string;
};

export type StaffGuide = {
  /** The address under /learning/guides, stable across releases so links to it hold. */
  slug: string;
  title: string;
  /** The one-line summary on the library card. */
  summary: string;
  /** The roles whose library lists it. Staff see everything in the library anyway. */
  audience: string[];
  sections: GuideSection[];
  course: { title: string; description: string; passMark: number; questions: GuideQuestion[] };
  /**
   * Summaries this guide was seeded with before the current one, so the live
   * database's row is brought up to date only while it still carries one of
   * them: an admin's own wording is kept. Empty until the summary changes.
   */
  previousSummaries: string[];
};

export const GUIDE_BASE = "/learning/guides";
export const guideHref = (slug: string) => `${GUIDE_BASE}/${slug}`;

/**
 * Who is issued a day end report, by role, plus the roles that read the
 * consolidated report. A sub-agent firm's counsellor is left out because a
 * sub-agent firm is never issued one, whatever the role says.
 */
const DAY_END_AUDIENCE = [...new Set([...APP_ROLES.filter((r) => !(NOT_ISSUED as readonly string[]).includes(r) && r !== "SUB_AGENT_COUNSELLOR"), ...REPORT_ROLES])];

const AUSBILDUNG_AUDIENCE = ["PARTNER", "COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "DESK_COUNSELLOR", ...DOCUMENTATION_ROLES, "ADMIN", "OPS_MANAGER", "SUPER_ADMIN"];

export const DAY_END_GUIDE: StaffGuide = {
  slug: "day-end-report",
  title: "The day end report",
  summary: "What the 5 PM report is, how to verify or flag it, the five figures a counsellor gives, what a branch head reads in the month view, and the admin's consolidated report.",
  audience: DAY_END_AUDIENCE,
  previousSummaries: [],
  sections: [
    {
      heading: "What it is",
      paragraphs: [
        "Every working day the portal writes down what each person did in it, from the records themselves. At 5 PM India time (unless Platform settings say otherwise) that list is issued to you as your day end report, to read and verify before you leave.",
        "It goes to Medcity's own staff at the Overseas desk and the branches; a sub-agent firm's staff, the super admin and management are not issued one. Sundays have no report unless the settings ask for one.",
      ],
    },
    {
      heading: "Answering it: everybody",
      steps: [
        "From 5 PM a popup headed \"Your day end report for today\" opens over whatever page you are on, with the day's totals and latest lines. \"Minimise\" puts it away as a corner tab that opens it again, for the day, in that browser only.",
        "\"Read every line on the full report\" opens \"My day end report\", also \"Day end report\" in the menu under Account.",
        "If it is your day as it happened, press \"I have checked these N lines: verified\", where N is the number of lines.",
        "If anything is wrong, open \"Something here is wrong\", say what, and press \"Flag my report\". Your branch head is told at once; from the head office, the Overseas admin and operations are.",
        "Answer before the cutoff, 11:59 PM by default; a report not answered by then is recorded as \"Missed\". A sign-in after 5:45 PM (the default) is recorded as out of hours.",
      ],
      after: "An answered report is kept exactly as it was. \"Your last two weeks\" lists each day as \"Verified\", \"Verified after hours\", \"Flagged a problem\", \"Not yet verified\" or \"Missed\".",
    },
    {
      heading: "The figures: counsellors and branch heads",
      paragraphs: [
        "Everybody who counsels, and the branch head, also fills five boxes under \"The day's figures\": \"Leads received\", \"Calls made\", \"Connected calls\", \"Follow-ups done\" and \"Registrations done\". Nobody else sees them.",
      ],
      steps: [
        "Every box starts from what the portal counted for you today and says underneath where the number came from: enquiries entered today that you hold, calls you logged, calls logged as reached, follow-ups marked done, students you registered.",
        "Change any box if the day was different; calls happen outside the portal too. What you type wins over the count.",
        "Fill every box with a whole number, 0 if none. A blank is refused, because nobody can tell a blank from a 0.",
        "Verify or flag as above; the figures are saved with the answer.",
      ],
    },
    {
      heading: "The month view and the notice: branch heads",
      paragraphs: [
        "\"Day end figures\" in the menu under Account opens \"The month's figures\" for your own branch only: each counsellor's five figures added up over the reports they answered that month, with \"Days answered\" and \"Days missed\", and a branch total. A missed day adds nothing. A name opens that person's month day by day; \"Close\" shuts it. \"Download as Excel\" gives the table as a workbook.",
        "When the day closes you get a notification headed with your branch's name and how many of its reports were verified, with the flagged, missed and unanswered counts and the branch's figures; it opens the month view.",
      ],
    },
    {
      heading: "The consolidated report, the Excel download and the cutoff: admins",
      paragraphs: [
        "\"Day end reports\" in the menu opens the consolidated report for the Overseas admin, the ops manager, the super admin and management. Tiles count \"Reports issued\", \"Verified\", \"Flagged a problem\", \"Not yet verified\", \"Missed\" and \"Signed in after hours\". The table \"Everybody issued a day end report\" puts the ones that need a look first; a name opens what that person saw, to read, never to answer for them. Under it, \"The day's figures\" lists each counsellor by branch with totals.",
        "\"Day before\", \"Day after\" and \"Month\" move around; \"Download as Excel\" gives the day as a workbook.",
        "At the cutoff every unanswered report becomes missed and the consolidated report is sent to the admins as a notification; earlier if everybody has answered. The times are in Platform settings under \"Day end report\": \"Day ends\", \"Sign-ins after hours from\", \"Unanswered reports missed at\" and \"Issue day end reports on Sundays too\". The scheduler runs the clock; without one the next page view does, a few minutes late at most.",
      ],
    },
  ],
  course: {
    title: "The day end report",
    description: "Read the guide in the learning library first. Five questions; four right is a pass.",
    passMark: 80,
    questions: [
      {
        prompt: "At what time, India time, is the day end report issued unless Platform settings say otherwise?",
        options: ["9 AM", "1 PM", "5 PM", "Midnight"],
        correctIndex: 2,
      },
      {
        prompt: "Which of these is NOT one of the five figures a counsellor gives?",
        options: ["Leads received", "Connected calls", "Registrations done", "Emails sent"],
        correctIndex: 3,
        evidence: "\"Follow-ups done\" and \"Registrations done\"",
      },
      {
        prompt: "What happens to a report that is not answered by the cutoff?",
        options: ["It is recorded as Missed", "It is verified for you", "It is deleted", "It stays open until the next day"],
        correctIndex: 0,
        evidence: "recorded as \"Missed\"",
      },
      {
        prompt: "What should a counsellor do when a box in the day's figures has nothing to report?",
        options: ["Leave it blank", "Type 0", "Type a dash", "Flag the report"],
        correctIndex: 1,
        evidence: "0 if none",
      },
      {
        prompt: "Which screen does a branch head open to read their own branch's figures for a month?",
        options: ["Day end figures", "Day end reports", "Platform settings", "Targets"],
        correctIndex: 0,
      },
    ],
  },
};

export const AUSBILDUNG_GUIDE: StaffGuide = {
  slug: "ausbildung-process",
  title: "The Ausbildung process in the portal",
  summary: "The written process's 19 steps and six desks as the portal records them: the hand-over, the mentor, the statuses per desk, the documents per stage, the payment milestones, the turnaround follow-up and what the student sees.",
  audience: AUSBILDUNG_AUDIENCE,
  previousSummaries: [],
  sections: [
    {
      heading: "Where the process lives",
      paragraphs: [
        "The written Ausbildung process has 19 steps across six desks, each with a turnaround such as T+7. A step is recorded as the application's status, which only the Overseas admins move, on the \"Applications\" tab with \"Update status\"; a desk asks an admin to record a move. The student's \"Ausbildung\" tab has a card, \"The written process\", that names the step, lights the desk the file is with, and shows the days there against the turnaround. \"Placement tracker\" in the menu has a \"Desk and step\" column, a \"Desk\" filter and \"Over turnaround\" under \"Show\".",
      ],
    },
    {
      heading: "Counsellors and branch heads: steps 1 to 3",
      steps: [
        "Register the student for Ausbildung and create the application; it starts at \"German A2 / B1 pending\". Record the training fields and German levels on the \"Ausbildung\" tab.",
        "Collect the Profile stage papers on the \"Documentation\" tab (passport, photograph, marksheets, consultancy agreement, Aadhaar and PAN, CV, German certificate, motivation letter). \"Ask\" records a request; \"Upload\" takes the file.",
        "When they are in, press \"Hand to the documentation desk\" on the \"Ausbildung\" tab, add a note, and press \"Hand it over\". While a required document is missing, the button is replaced by what is still needed.",
      ],
      after:
        "The portal marks the file handed over and tells the documentation officers and their team leader, who can now open it. A move to \"Mentor assigned\" or later also hands it over. The portal does not send the hand-over emails; the tracker lists the addresses under \"Hand-overs in the written process\" and the desk sends them. When a mentor is named you are told their name, email and phone.",
    },
    {
      heading: "The documentation desk: steps 4, 6 and 9",
      steps: [
        "Under \"Mentor\" on the \"Ausbildung\" tab, pick a documentation officer and press \"Set the mentor\". A file at the branch's steps moves to \"Mentor assigned\" by itself; the counsellor, branch head and mentor are told. \"Change the mentor\" replaces them.",
        "Prepare the Application stage documents: the German CV, translated certificates, the self-introduction video as a one-page PDF with its link. The translation and the language specialist's check happen outside the portal; the files come back as uploads. The admin moves the status to \"Document preparation and translation\", then \"German CV and profile in progress\".",
        "Then \"Employer matching\", \"Profile submitted to German employers\" and \"Employer shortlisted the candidate\", with the submission date saved by \"Save Ausbildung details\".",
      ],
    },
    {
      heading: "The language steps: 5, 7 and 8",
      paragraphs: [
        "The student mentor's steps are recorded as \"Language assessment and interview preparation\" and \"Mock interview passed: ready for employers\". The portal does not grade the assessments or hold the readiness report; the status and a comment carry the outcome. The \"Service charge\" card marks the 50 percent milestone \"Due now\" from step 7.",
      ],
    },
    {
      heading: "Placement, visa and travel: steps 10 to 19",
      steps: [
        "Placement: \"Employer interview scheduled\", with the interview time and employer saved on the \"Ausbildung\" tab; then \"Training contract signed\" with the contract date and employer, and the Offer stage documents (training contract, school contract, EZB, language confirmation). 80 percent is due here.",
        "Visa: \"Pre-visa documentation\", \"Visa filed (VFS)\", \"Visa processing\", \"Visa received\", with the Visa stage documents (accommodation proof, insurance, biometric photo, legal representation form, cover letter, annex, ZAV approval). 100 percent is due before the file goes in.",
        "Travel desk: \"Pre-departure process\", \"Joined employer\" and \"Destination Germany: happy call\".",
      ],
    },
    {
      heading: "What the portal does by itself",
      paragraphs: [
        "Once a morning it finds every open file past its step's turnaround and raises one follow-up task, \"Step N is over its turnaround\", on whoever owns the step: the mentor on documentation and language steps, the Overseas desk on placement, visa and travel steps, the counsellor and branch head on counselling steps, all told by notification. One task per stay in a step, so nobody is nagged daily. The task shows on the student's \"Timeline\" tab under \"Waiting on somebody\".",
      ],
    },
    {
      heading: "What the student sees",
      paragraphs: [
        "On the portal home a card, \"Your Ausbildung journey\", shows the six desks with the current one lit, \"Where you are\", \"What happens next\", \"Who to contact\" (the counsellor and mentor), \"Your German levels\" and \"Your payments\" with the next payment named. Anything not on record reads Not recorded.",
      ],
    },
  ],
  course: {
    title: "The Ausbildung process in the portal",
    description: "Read the guide in the learning library first. Five questions; four right is a pass.",
    passMark: 80,
    questions: [
      {
        prompt: "Which button does the branch press to hand an Ausbildung file to the documentation desk?",
        options: ["Hand to the documentation desk", "Update status", "Set the mentor", "Save Ausbildung details"],
        correctIndex: 0,
      },
      {
        prompt: "Who names the documentation mentor, and where?",
        options: ["The counsellor, on the Profile tab", "The documentation desk, under Mentor on the Ausbildung tab", "The student, in the portal", "The placement team, on the tracker"],
        correctIndex: 1,
        evidence: "Set the mentor",
      },
      {
        prompt: "Which of these does the portal NOT do?",
        options: ["Raise a follow-up task when a step is over its turnaround", "Tell the counsellor the mentor's name", "Send the hand-over emails", "Light the desk a file is with"],
        correctIndex: 2,
        evidence: "does not send the hand-over emails",
      },
      {
        prompt: "How often is a turnaround follow-up task raised for one file at one step?",
        options: ["Every day until the status moves", "Once per stay in the step", "Once a week", "Never; only the tracker shows it"],
        correctIndex: 1,
        evidence: "One task per stay in a step",
      },
      {
        prompt: "What status does a new Ausbildung application start at?",
        options: ["Mentor assigned", "Document collection by the counsellor", "German A2 / B1 pending", "Employer matching"],
        correctIndex: 2,
      },
    ],
  },
};

export const STAFF_GUIDES: StaffGuide[] = [DAY_END_GUIDE, AUSBILDUNG_GUIDE];

export const guideBySlug = (slug: string) => STAFF_GUIDES.find((g) => g.slug === slug) ?? null;

/** The whole guide as one plain text, for the tests and anything that counts its words. */
export function guideText(g: StaffGuide): string {
  return g.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.steps ?? []), ...(s.after ? [s.after] : [])]).join("\n");
}

/** Whether somebody may read a guide: the staff roles read everything in the library, everybody else their audience. */
export function mayReadGuide(g: StaffGuide, role: string, staff: boolean) {
  return staff || g.audience.includes(role);
}
