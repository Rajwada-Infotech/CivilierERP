/**
 * src/pages/material/grnRemainingItems.ts
 *
 * Shared "remaining PO quantity" logic for the GRN form.
 *
 * A Purchase Order can be received against over many separate GRNs — e.g.
 * 100 units ordered, 50 received on GRN #1, the remaining 50 received
 * (possibly in further splits) on GRN #2, #3, etc. This module computes
 * what's left to receive on a PO and turns that into ready-to-submit GRN
 * line items, so the "how much is left" math lives in exactly one place
 * instead of being duplicated across the two places a GRN can start from:
 *
 *   1. The main GRN form's PO picker — shows the remaining balance and
 *      offers a "Create GRN for Remaining Items" quick action that skips
 *      the Vehicle In/Out step entirely.
 *   2. The "New GRN for Remaining" button on an already-viewed GRN
 *      (RemainingItemsPanel), which pre-fills a follow-up GRN from
 *      whatever a specific prior GRN left outstanding.
 *
 * Both paths land on the same PO, so both are "grouped with the linked
 * PO" — the PO's own document-chain view (DocumentChainPanel) is what
 * ties every GRN raised against it back together, regardless of which of
 * the two paths created it.
 */

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

/** A single PO line item's ordered/received/remaining position. */
export interface RemainingPOItem {
  itemId: string;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom: string;
  rate: number;
  gstPct: number;
}

/** Minimal shape of a GRN line item, structurally compatible with GRN.tsx's GRNItemLine. */
export interface RemainingGRNLineItem {
  itemId: string;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom: string;
  rate: number;
  quantity: number;
  totalAmount: number;
  gstPct: number;
  gstAmount: number;
}

/**
 * Computes each line item's remaining-to-receive quantity from a PO
 * detail response (GET /api/purchase-orders/:id — LineItems carries
 * Quantity ordered and the running ReceivedQty kept in sync by
 * syncPOItemReceivedQty() on the backend every time a GRN is saved).
 */
export function computeRemainingPOItems(po: any): RemainingPOItem[] {
  const lineItems = po?.LineItems ?? [];
  return (Array.isArray(lineItems) ? lineItems : [])
    .map((li: any): RemainingPOItem => {
      const orderedQty = Number(li.Quantity ?? 0);
      const receivedQty = Number(li.ReceivedQty ?? 0);
      const remainingQty = Math.max(round3(orderedQty - receivedQty), 0);
      return {
        itemId: String(li.ItemId ?? li.Id ?? ""),
        itemName: li.ItemName ?? li.Description ?? "",
        orderedQty,
        receivedQty,
        remainingQty,
        uom: li.UomName ?? li.UomId ?? "",
        rate: Number(li.Rate ?? 0),
        gstPct: Number(li.TaxPct ?? 0),
      };
    })
    .filter((it) => it.orderedQty > 0);
}

/** True when at least one line still has qty left to receive. */
export function hasRemainingItems(items: RemainingPOItem[]): boolean {
  return items.some((it) => it.remainingQty > 1e-6);
}

/** Total count of lines with qty left to receive. */
export function countRemainingItems(items: RemainingPOItem[]): number {
  return items.filter((it) => it.remainingQty > 1e-6).length;
}

/**
 * Turns remaining PO items into ready-to-submit GRN line items, with
 * receivedQty/quantity pre-filled to the full remaining balance. The
 * caller can still let the user edit quantities down before saving —
 * this only seeds the form.
 */
export function buildGRNLineItemsFromRemaining(
  items: RemainingPOItem[],
): RemainingGRNLineItem[] {
  return items
    .filter((it) => it.remainingQty > 1e-6)
    .map((it) => {
      const totalAmount = it.rate * it.remainingQty;
      return {
        itemId: it.itemId,
        itemName: it.itemName,
        orderedQty: it.orderedQty,
        receivedQty: it.remainingQty,
        remainingQty: 0, // recalculated live as the user edits qty on the form
        uom: it.uom,
        rate: it.rate,
        quantity: it.remainingQty,
        totalAmount,
        gstPct: it.gstPct,
        gstAmount: totalAmount * (it.gstPct / 100),
      };
    });
}
