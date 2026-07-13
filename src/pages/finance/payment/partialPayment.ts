// ─── Partial payment / invoice-outstanding formula ─────────────────────────────
//
// This is the single source of truth for "how much of this invoice has been
// paid so far, and how much is left" on the frontend. It mirrors
// backend/utils/syncBillStatus.js exactly (that file is the backend's
// persisted-column version of the same formula) — this module does NOT
// replace that backend logic, it only stops the frontend from re-deriving
// the same numbers with six slightly-different copies of the same reducer.
//
// IMPORTANT — what this function does NOT do:
//   - It does not compute GST or apply billing terms. `netAmount` passed in
//     must already be the final, GST-inclusive, billing-terms-adjusted net
//     payable (ENetAmount from the expense booking, or the GRN item-level
//     GST breakdown total when that's authoritative). This module only
//     aggregates payments against that already-computed net amount.
//   - It does not decide amounts to prefill on the form; callers combine
//     this with their own context (reissue, "Pay Remaining" click, etc).

export interface ChainPaymentLike {
  Status?: string | null;
  IsBounced?: boolean | number | null;
  PAmount?: number | string | null;
  BounceCharge?: number | string | null;
}

export type BillStatus = "Payment Due" | "Partially Paid" | "Paid";

export interface PaymentStatusResult {
  /** Sum of Approved & non-bounced payments, net of each payment's bounce charge. */
  totalPaid: number;
  /** Sum of bounce charges on those same Approved & non-bounced payments — a bank
   *  fee, not money paid to the supplier, so it's excluded from totalPaid but
   *  reported separately so the UI can show "+₹X bounce" next to Paid. */
  bounceChargeTotal: number;
  /** max(0, round(netAmount − totalPaid, 2)) */
  remaining: number;
  billStatus: BillStatus;
  isFullyPaid: boolean;
}

/**
 * Aggregates a payment chain against a (GST + billing-terms adjusted) net
 * amount. Bounced payments are excluded entirely — the money never reached
 * the supplier — and each surviving payment's own bounce charge (if any,
 * e.g. from a *different* prior bounce on the same payment record) is
 * subtracted from its contribution.
 */
export function computePaymentStatus(
  netAmount: number,
  payments: ChainPaymentLike[] | null | undefined,
): PaymentStatusResult {
  const approved = (payments ?? []).filter((p) => p.Status === "Approved" && !p.IsBounced);

  const totalPaid = approved.reduce((sum, p) => {
    const amt = parseFloat(String(p.PAmount ?? 0)) || 0;
    const bounce = parseFloat(String(p.BounceCharge ?? 0)) || 0;
    return sum + amt - bounce;
  }, 0);

  const bounceChargeTotal = approved.reduce(
    (sum, p) => sum + (parseFloat(String(p.BounceCharge ?? 0)) || 0),
    0,
  );

  const remaining = Math.max(0, Math.round((netAmount - totalPaid) * 100) / 100);

  const billStatus: BillStatus =
    remaining <= 0 && netAmount > 0 ? "Paid" : totalPaid > 0 ? "Partially Paid" : "Payment Due";

  return {
    totalPaid,
    bounceChargeTotal,
    remaining,
    billStatus,
    isFullyPaid: remaining <= 0 && netAmount > 0,
  };
}

/**
 * Same status-label rule as computePaymentStatus, exposed standalone for the
 * few call sites that already have `paid`/`remaining` computed through their
 * own (non-payment-array) fallback chain — e.g. mixing live chain data with a
 * stale DB snapshot — and just need the consistent Paid/Partially Paid/Payment
 * Due label without re-deriving totalPaid.
 */
export function deriveBillStatus(totalPaid: number, remaining: number, netAmount: number): BillStatus {
  if (remaining <= 0 && netAmount > 0) return "Paid";
  if (totalPaid > 0) return "Partially Paid";
  return "Payment Due";
}

/**
 * Resolves "how much is still outstanding on this invoice right now" —
 * preferring live per-payment chain data (most accurate: excludes bounced,
 * subtracts bounce charges) and falling back to a known/DB-persisted
 * totalPaid snapshot only when the live chain hasn't loaded yet. This is
 * exactly the fallback order the "Payment calculation chain" card and the
 * "Pay Remaining" flow rely on: once a partial payment lands, the live chain
 * becomes the source of truth for what's left, not the DB snapshot from
 * before that payment was recorded.
 */
export function resolveOutstanding(
  netAmount: number,
  liveRemaining: number | null | undefined,
  knownTotalPaid: number | null | undefined,
): number {
  if (liveRemaining != null) return liveRemaining;
  return Math.max(0, netAmount - (knownTotalPaid ?? 0));
}
