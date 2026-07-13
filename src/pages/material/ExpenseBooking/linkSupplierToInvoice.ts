import type { SelectedDoc } from "./types";

export interface LinkedSupplier {
  supplier: string;
  supplierLHeadId: number | null;
}

/**
 * Resolves which supplier a booking should carry once a source document is
 * selected in the Document Selection picker.
 *
 * PO / WO_PO / WORK_DONE / GRN docs carry their own supplier (`doc.vendorLabel`,
 * resolved server-side from the linked document) — that always wins, and any
 * previously hand-picked supplier is cleared since it no longer applies.
 *
 * TOD ("Other Expenses") docs have no source document to derive a supplier
 * from — they're direct/manual bookings, so whichever supplier is currently
 * selected on the form (via the Supplier/Vendor dropdown) is kept and
 * explicitly linked to the booking. This is what ends up written to
 * `ExpenseBooking.LHeadId` on save, which is what On A/C Adjustment and the
 * invoice detail view key off for these bookings.
 */
export function linkSupplierToInvoice(
  doc: SelectedDoc,
  current: LinkedSupplier,
): LinkedSupplier {
  if (doc.vendorLabel) {
    return { supplier: doc.vendorLabel, supplierLHeadId: null };
  }
  return { supplier: current.supplier, supplierLHeadId: current.supplierLHeadId };
}
