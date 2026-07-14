"use strict";

/**
 * Resolves the amount/GST fields and supplier link for a direct/manual
 * (TOD — "Other Expenses") expense booking: one with no PO/WO_PO/WORK_DONE/
 * GRN source document to derive amounts or a supplier from.
 *
 * Centralizes what used to be an inline fallback block duplicated (and
 * drifting — the PUT handler never picked up EIgstRate/EPaymentType/
 * EPartialAmount when the POST handler did) across the create (POST) and
 * update (PUT) handlers in expenseBooking.js.
 *
 * The supplier link (LHeadId) is decided on the frontend by
 * linkSupplierToInvoice.ts before the request ever reaches here — this
 * function just passes it through consistently so ExpenseBooking.LHeadId
 * is always populated for direct bookings, which is what the supplier-name
 * resolution in expenseBookingSupplier.js (and the /options endpoints) key
 * off instead of falling back to the booking's own EName.
 *
 * @param {object} payload - relevant fields off req.body (POST) or the
 *   destructured PUT body — same field names either way
 * @returns {{
 *   bookingAmount: number,
 *   bookingNetAmount: number,
 *   bookingCgstRate: number,
 *   bookingSgstRate: number,
 *   bookingIgstRate: number,
 *   paymentType: "full" | "partial",
 *   partialAmount: number | null,
 *   supplierLHeadId: number | null,
 * }}
 */
function buildDirectExpenseBooking(payload) {
  const {
    EAmount,
    ENetAmount,
    ECgstRate,
    ESgstRate,
    EIgstRate,
    EPaymentType,
    EPartialAmount,
    LHeadId,
  } = payload;

  const bookingAmount = EAmount != null ? Number(EAmount) : 0;
  const paymentType = EPaymentType === "partial" ? "partial" : "full";

  return {
    bookingAmount,
    bookingNetAmount: ENetAmount != null ? Number(ENetAmount) : bookingAmount,
    bookingCgstRate: ECgstRate ?? 0,
    bookingSgstRate: ESgstRate ?? 0,
    bookingIgstRate: EIgstRate ?? 0,
    paymentType,
    partialAmount:
      paymentType === "partial" && EPartialAmount != null
        ? Number(EPartialAmount)
        : null,
    supplierLHeadId: LHeadId ? parseInt(LHeadId, 10) : null,
  };
}

module.exports = { buildDirectExpenseBooking };
