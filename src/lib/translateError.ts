/**
 * translateError — maps raw server/network error messages to plain-English
 * text that a non-IT real estate staff member can understand and act on.
 *
 * Usage:
 *   import { translateError } from "@/lib/translateError";
 *   toast.error(translateError(e.message));
 */

const ERROR_MAP: [RegExp, string][] = [
  // ── Handover ──────────────────────────────────────────────────────────────
  [/customer.*approve.*sales deed|sales deed.*customer.*approv/i,
    "The customer hasn't approved the Sales Deed yet. Ask them to log in to the Customer Portal and approve it."],
  [/director.*approv.*deed|deed.*director.*approv/i,
    "The Sales Deed must be approved by the Director before this step can proceed."],
  [/unresolved snag|snag.*pending|open snag/i,
    "There are open snag items that must be resolved before the handover can be completed."],
  [/ActualHandoverDate.*required|handover.*date.*required/i,
    "Please enter the actual handover date before marking as completed."],
  [/KeyHandoverBy.*required|handover.*key.*required/i,
    "Please select the staff member who handed over the keys."],
  [/FinalDuesCleared.*must be true|dues.*cleared.*required/i,
    "Please confirm that all final dues have been cleared by the customer."],
  [/CustomerAcknowledged.*must be true|acknowledgment.*required/i,
    "Please confirm that the customer has acknowledged receipt of the property."],

  // ── State machine / workflow transitions ──────────────────────────────────
  [/Cannot transition from '(\w+)' to '(\w+)'\. Allowed: (.+)/i,
    "This action is not allowed at this stage. Please follow the correct workflow sequence."],
  [/cannot transition|invalid.*transition|not.*valid.*transition/i,
    "This action cannot be performed at the current stage. Please check the workflow sequence."],

  // ── Agreement / Registration ───────────────────────────────────────────────
  [/agreement.*executed.*required|must.*executed.*agreement/i,
    "The Agreement must be Executed (signed) before this step can proceed."],
  [/agreement.*registered.*required|must.*registered.*agreement/i,
    "The Agreement must be Registered before this step can proceed."],

  // ── Sales Deed ─────────────────────────────────────────────────────────────
  [/sales deed.*not found|no.*sales deed/i,
    "No Sales Deed exists for this booking yet. Please create a Sales Deed first."],
  [/registration.*number.*required|RegistrationNo.*required/i,
    "Please enter the Registration Number before finalising the deed."],

  // ── Query Payment / Registry ───────────────────────────────────────────────
  [/query payment.*confirmed|InfoSent.*required/i,
    "Query Payment must first be sent to the customer before it can be confirmed."],
  [/registry.*scheduled.*required|registry.*must.*scheduled/i,
    "The Registry appointment must be scheduled before it can be marked as completed."],

  // ── Pre-Possession ─────────────────────────────────────────────────────────
  [/outstanding payment demand|pending.*demand.*exist/i,
    "There are pending payment demands outstanding. All demands must be paid or waived before dues can be marked as cleared."],
  [/pre.?possession.*ready|possession.*check.*incomplete/i,
    "The pre-possession checklist must be fully completed and marked as Ready before a Possession Notice can be sent."],

  // ── Possession Notice ──────────────────────────────────────────────────────
  [/possession.*notice.*disputed|notice.*disputed/i,
    "This possession notice has been disputed by the customer. Resolve the dispute before proceeding."],
  [/possession.*notice.*not.*accepted|notice.*must.*accepted/i,
    "The customer must accept the Possession Notice before the Handover can be scheduled."],

  // ── NOC ────────────────────────────────────────────────────────────────────
  [/noc.*pending|noc.*not.*issued|pending.*noc/i,
    "There is a pending NOC request that must be resolved before this step can proceed."],

  // ── Payments / dues ────────────────────────────────────────────────────────
  [/amount.*exceeds.*balance|payment.*exceeds|insufficient.*balance/i,
    "The payment amount exceeds the available balance. Please check the payment amount."],
  [/milestone.*already.*paid|already.*collected/i,
    "This payment milestone has already been collected."],
  [/demand.*not.*found|milestone.*not.*found/i,
    "The payment record could not be found. Please refresh the page and try again."],

  // ── Booking / Application ──────────────────────────────────────────────────
  [/booking.*already.*exists|application.*already.*booked/i,
    "A booking already exists for this application. Each application can only have one booking."],
  [/unit.*already.*booked|unit.*not.*available/i,
    "This unit is no longer available. It may have been booked by someone else. Please select a different unit."],
  [/booking.*cancelled|booking.*not.*active/i,
    "This booking has been cancelled and cannot be modified."],

  // ── Cancellations ─────────────────────────────────────────────────────────
  [/cancellation.*already.*exists|duplicate.*cancellation/i,
    "A cancellation request already exists for this booking. Please check the Cancellations page."],
  [/refund.*exceeds.*paid|refund.*more.*than.*collected/i,
    "The refund amount cannot be more than the total amount collected from the customer."],

  // ── Service Tickets ────────────────────────────────────────────────────────
  [/resolution.*notes.*required|ResolutionNotes.*required/i,
    "Please enter resolution notes describing what was done to fix the issue."],
  [/ticket.*already.*resolved|cannot.*reopen.*closed/i,
    "This ticket cannot be modified in its current state."],

  // ── Auth / permissions ─────────────────────────────────────────────────────
  [/forbidden|insufficient.*rights|not.*authorized|access.*denied/i,
    "You do not have permission to perform this action. Please contact your administrator."],
  [/unauthorized|token.*expired|session.*expired/i,
    "Your session has expired. Please refresh the page and log in again."],

  // ── Network / server ───────────────────────────────────────────────────────
  [/failed to fetch|network.*error|ERR_NETWORK|ECONNREFUSED/i,
    "Connection lost. Your changes were not saved. Please check your internet connection and try again."],
  [/timeout|ETIMEDOUT|request.*timed out/i,
    "The request took too long. Please try again. If the problem persists, contact support."],
  [/500|internal server error/i,
    "Something went wrong on the server. Please try again. If this keeps happening, contact your IT support."],
  [/too many requests|rate limit|429/i,
    "Too many requests. Please wait a moment and try again."],
  [/database.*error|sql.*error|DB error/i,
    "A database error occurred. Please try again or contact IT support."],


  // ── Generic validation ────────────────────────────────────────────────────
  // Kept last among "required" patterns on purpose — anything more specific
  // above (e.g. "Deposit bank is required...") must get its own real,
  // actionable message; this catch-all was flattening those into a vague
  // "fill in all required fields" toast that pointed at nothing (e.g. the
  // Application wizard's Deposited To field, which had no way to fix it).
  [/required|cannot be empty|must be provided/i,
    "Please fill in all required fields before submitting."],
  [/invalid.*date|date.*invalid/i,
    "Please enter a valid date."],
  [/duplicate.*entry|unique.*constraint|already.*exists/i,
    "A record with this information already exists. Please check for duplicates."],
];

/**
 * Translate a raw error message to a user-friendly string.
 * Falls back to the original message if no pattern matches,
 * with some light cleanup (removes stack traces, SQL fragments, etc.)
 */
export function translateError(raw: string | undefined | null): string {
  if (!raw) return "An unexpected error occurred. Please try again.";

  // Try pattern matching first
  for (const [pattern, friendly] of ERROR_MAP) {
    if (pattern.test(raw)) return friendly;
  }

  // Sanitize the raw message as a fallback:
  // Strip anything that looks like a stack trace or SQL
  const sanitized = raw
    .split("\n")[0]                          // first line only
    .replace(/at\s+\w+\s*\(.*?\)/g, "")     // remove stack trace refs
    .replace(/SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN/gi, "") // remove SQL
    .replace(/\s{2,}/g, " ")
    .trim();

  // If sanitized message is too long or empty, return generic
  if (!sanitized || sanitized.length > 200) {
    return "An unexpected error occurred. Please try again or contact support.";
  }

  return sanitized;
}

/**
 * Convenience wrapper — use with toast directly:
 *   toastError(e.message)
 */
export function toastError(raw: string | undefined | null): string {
  return translateError(raw);
}
