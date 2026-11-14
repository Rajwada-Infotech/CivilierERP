// Which app and which use of it a request belongs to, for the Activity Browser. The server records every write
// (backend/middleware/activityAudit.js) with the X-Session-Id and X-Client headers sent here; without them a person
// using only the app showed 0 sessions next to their changes. One session per sign-in (or per app launch when
// already signed in) — the web app does the same per browser tab (src/lib/fetchWithAuth.ts activityHeaders).
export const APP_CLIENT = "mobile-maintenance";

let sessionId: string | null = null;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

export function appSessionId(): string {
  if (!sessionId) sessionId = newId();
  return sessionId;
}

/** A fresh session — on sign-in. */
export function startAppSession(): string {
  sessionId = newId();
  return sessionId;
}

/** No session — on sign-out. */
export function endAppSession(): void {
  sessionId = null;
}
