// Unsaved CRM entry (the application wizard, a co-applicant being typed) is kept so closing a dialog or moving between
// steps does not lose it - but only in memory, for as long as the tab is open. It holds personal data (PAN, Aadhaar,
// date of birth, address ...), and browser storage keeps that in clear text on the machine long after the person has left
// (CodeQL js/clear-text-storage-of-sensitive-data). What is saved to the application is on the server; only what was
// typed and not yet saved is lost if the page is refreshed.

const drafts = new Map<string, string>();

/** Drafts an earlier version left in this browser's storage: removed, so no personal data stays there. */
const OLD_PREFIXES = ["crm-app-draft:", "crm-coapp-draft:"];
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && OLD_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key);
  }
} catch {
  /* storage unavailable */
}

export function readCrmDraft<T>(key: string): T | null {
  const raw = drafts.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeCrmDraft(key: string, value: unknown): void {
  drafts.set(key, JSON.stringify(value));
}

export function clearCrmDraft(key: string): void {
  drafts.delete(key);
}
