/**
 * printStatusLabel
 *
 * A document sitting at "Pending" is mid-approval — a live system state,
 * not something to hand someone as paperwork. A printed or exported copy
 * of it should read "Provisional" instead, so it's obvious the copy isn't
 * final. Every other status (Draft/Approved/Rejected/etc.) prints exactly
 * as-is.
 *
 * Only ever call this from a PRINT or EXPORT code path (a window.print()
 * HTML string, or an Excel/PDF export column accessor) — the live in-app
 * status badges (StatusBadge, ApprovalStatusChain) must keep showing the
 * real "Pending" so staff can tell what's actually still awaiting approval.
 */
export function printStatusLabel(
  status: string | null | undefined,
): string {
  const s = (status ?? "").toString().trim();
  // Falsy input is left untouched (not coerced to any default) — callers
  // already apply their own fallback (e.g. `status || "Draft"`, `|| "—"`)
  // either before or after this call, and those conventions differ per page.
  if (!s) return s;
  return s.toLowerCase() === "pending" ? "Provisional" : s;
}
