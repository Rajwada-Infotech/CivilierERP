// ─── On Account adjustment preview — shared by OnAccountAdjustment.tsx and ────
// the Payment page's create/edit form. Pure math, no API calls (the actual
// write happens via applyOAAdjustment in onAccountApi.ts) — this is the "how
// much CAN be adjusted" formula, computed once instead of copy-pasted per page.

export interface OAAdjustmentPreview {
  /** How much will actually move from the party's on-account balance onto
   *  this invoice — clamped to both the available balance and what the
   *  invoice still needs. */
  applyAmount: number;
  /** Party's on-account balance after this adjustment. */
  balanceAfter: number;
  /** Invoice's remaining-to-pay after this adjustment. */
  invoiceRemainingAfter: number;
  /** True if this adjustment alone brings the invoice to fully paid. */
  isFullyCovered: boolean;
  /** True if this adjustment uses up the party's entire on-account balance. */
  isFullBalanceUsed: boolean;
}

/**
 * Preview a full or partial on-account adjustment without writing anything.
 * Omit `requestedAmount` to default to "adjust as much as possible" —
 * min(balance, invoiceRemaining). Pass it to preview a user-chosen partial
 * amount (e.g. the editable amount field in the On A/C Adjustment dialog);
 * it's clamped to the same [0, maxApplicable] range either way, so a caller
 * can never accidentally request more than what's actually available.
 */
export function previewOAAdjustment(
  balance: number,
  invoiceRemaining: number,
  requestedAmount?: number,
): OAAdjustmentPreview {
  const maxApplicable = Math.max(0, Math.min(balance, invoiceRemaining));
  const applyAmount = requestedAmount != null
    ? Math.max(0, Math.min(requestedAmount, maxApplicable))
    : maxApplicable;
  const balanceAfter = Math.max(0, balance - applyAmount);
  const invoiceRemainingAfter = Math.max(0, invoiceRemaining - applyAmount);
  return {
    applyAmount,
    balanceAfter,
    invoiceRemainingAfter,
    isFullyCovered: invoiceRemaining > 0 && invoiceRemainingAfter <= 0.005,
    isFullBalanceUsed: balance > 0 && balanceAfter <= 0.005,
  };
}

/**
 * Filters the invoice picker for the On A/C Adjustment dialog so the bill
 * that originally generated this on-account credit (the one overpaid to
 * create the excess) never shows up as something to adjust the same credit
 * back onto — that invoice is where the credit came FROM, not a target for
 * it. Every OTHER outstanding invoice for the same party remains selectable.
 *
 * @param invoices          the party's full invoice list from getInvoicesForParty
 * @param originatingDocNo  the CreditEntry's InvoiceRef (nullable — some
 *                          credits, e.g. a straight advance payment with no
 *                          linked invoice, have none, in which case nothing
 *                          is excluded)
 */
export function excludeOriginatingInvoice<T extends { docNo: string }>(
  invoices: T[],
  originatingDocNo: string | null | undefined,
): T[] {
  if (!originatingDocNo) return invoices;
  return invoices.filter((inv) => inv.docNo !== originatingDocNo);
}
