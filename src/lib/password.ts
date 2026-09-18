/**
 * Password rules, kept free of server-only imports so unit tests can reach them.
 *
 * The aim is a password a person can actually remember while still being hard to
 * guess, so the rules reward length rather than demanding a symbol soup.
 */

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Passwords that show up first in every credential-stuffing list, plus the ones
 * this portal invites by name. Compared after lowercasing and stripping trailing
 * digits, so "Passw0rd123" is caught along with "password".
 */
const COMMON = new Set([
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "qwerty",
  "qwertyuiop",
  "asdfghjkl",
  "abcdef",
  "abcdefgh",
  "iloveyou",
  "admin",
  "administrator",
  "superadmin",
  "root",
  "changeme",
  "secret",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "cricket",
  "india",
  "kerala",
  "kochi",
  "medcity",
  "medcityoverseas",
  "overseas",
  "studyabroad",
  "student",
  "counsellor",
  "partner",
  "portal",
  "trustno1",
  "whatever",
  "starwars",
  "pakistan",
  "computer",
]);

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasRun(value: string) {
  const lower = value.toLowerCase();
  const sequences = "abcdefghijklmnopqrstuvwxyz0123456789qwertyuiopasdfghjklzxcvbnm";
  for (let i = 0; i + 4 <= lower.length; i++) {
    const slice = lower.slice(i, i + 4);
    if (sequences.includes(slice)) return true;
    if (sequences.includes([...slice].reverse().join(""))) return true;
  }
  return false;
}

/**
 * Returns a sentence explaining what is wrong with the password, or null when it
 * is good enough. `context` holds strings the password must not simply repeat:
 * the person's email, their name, the portal name.
 */
export function passwordProblem(password: string, context: (string | null | undefined)[] = []): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you will remember works well.`;
  }
  if (password.length > 200) return "That password is too long.";
  if (/^\s|\s$/.test(password)) return "Remove the space at the start or end.";

  const flat = normalise(password);
  if (flat.length < 6) return "Use a few more letters or numbers.";

  if (new Set(flat).size <= 3) return "That repeats too few characters. Mix in some more.";

  const stripped = flat.replace(/[0-9]+$/, "");
  if (COMMON.has(flat) || COMMON.has(stripped)) {
    return "That password is one of the most commonly guessed ones. Please pick another.";
  }
  for (const word of COMMON) {
    if (word.length >= 6 && flat.includes(word)) {
      return "That password is built around a very common word. Please pick another.";
    }
  }

  if (hasRun(password)) return "Avoid runs of letters or numbers that sit next to each other on the keyboard.";

  for (const item of context) {
    if (!item) continue;
    const parts = normalise(item.split("@")[0]).match(/[a-z0-9]{4,}/g) ?? [];
    for (const part of parts) {
      if (flat.includes(part)) return "Your password should not contain your name or email address.";
    }
  }

  return null;
}

/** A rough 0 to 4 score for the strength meter. Not security, just feedback. */
export function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (passwordProblem(password)) score = Math.min(score, 1);
  const label = ["Too weak", "Weak", "Fair", "Good", "Strong", "Strong"][Math.min(score, 5)];
  return { score: Math.min(score, 4), label };
}
