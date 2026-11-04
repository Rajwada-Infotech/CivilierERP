// A user switched back on cannot be made inactive again for 90 days (the server refuses it; see PUT /api/users/:id). Screens use
// this to say so before anyone tries. On an active user, the last status change is the day they were activated.
const HOLD_DAYS = 90;

export function deactivateHeldUntil(user: { discontinue?: boolean; StatusChangedAt?: string | null }): Date | null {
  if (user.discontinue || !user.StatusChangedAt) return null;
  const until = new Date(new Date(user.StatusChangedAt).getTime() + HOLD_DAYS * 86_400_000);
  return until.getTime() > Date.now() ? until : null;
}

export const fmtHeldUntil = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
