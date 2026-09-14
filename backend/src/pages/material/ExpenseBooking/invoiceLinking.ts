/**
 * src/pages/material/ExpenseBooking/invoiceLinking.ts
 *
 * Shared logic for the Invoice page's two linking changes:
 *
 *   1. A "PO" tab that only ever shows Service-type Purchase Orders — the
 *      backend (`GET /api/purchase-orders/service-eligible`, backed by
 *      backend/services/invoiceLinking.js's getServicePurchaseOrders)
 *      already pre-filters to POs where every line item is a Service
 *      item, so goods always still have to flow through a GRN first.
 *      filterServicePOs() applies the same company/project/finYear/search
 *      narrowing DocSelectorPanel already does for its other tabs, kept
 *      here so it isn't duplicated a fourth time.
 *
 *   2. Combining multiple GRNs raised against the *same* PO into one
 *      total-amount invoice — as many times as there are GRNs left to
 *      invoice on that PO — while keeping the original "one GRN, one
 *      invoice" flow exactly as it was. aggregateGRNsForInvoice() is the
 *      client-side preview of what backend/services/invoiceLinking.js's
 *      computeMultiGRNInvoice will compute authoritatively on save.
 */

import type { GRNItem, GRNItemLine, POItem } from "./types";

// ── 1. Service-only Purchase Orders ─────────────────────────────────────────

export interface ServicePOFilters {
  companyId?: number | null;
  projectId?: number | null;
  finYear?: string | null;
  search?: string;
}

const yearTokens = (str?: string | null): string[] =>
  (str?.match(/\d{2,4}/g) || []).map((s) => s.slice(-2));

const inFinYear = (docNo: string | undefined, filterFinYear?: string | null) => {
  if (!filterFinYear) return true;
  const filterYears = yearTokens(filterFinYear);
  if (!filterYears.length) return true;
  const docYears = yearTokens(docNo);
  return docYears.some((y) => filterYears.includes(y));
};

/**
 * Narrows the (already Service-only, per the backend endpoint) PO list by
 * the same company/project/finYear/search criteria the other Invoice tabs
 * use, so the "PO" tab behaves consistently with WO Material POs / GRN.
 */
export function filterServicePOs(
  pos: POItem[],
  filters: ServicePOFilters,
  bookedPOIds?: Set<number>,
): POItem[] {
  const q = (filters.search ?? "").toLowerCase().trim();
  return pos.filter((po) => {
    if (bookedPOIds?.has(po.PurchaseOrderID)) return false;
    if (po.Status !== "Approved" && po.Status !== "Received") return false;
    if (
      filters.companyId &&
      po.CompanyId &&
      Number(po.CompanyId) !== Number(filters.companyId)
    )
      return false;
    if (
      filters.projectId &&
      po.ProjectId &&
      Number(po.ProjectId) !== Number(filters.projectId)
    )
      return false;
    if (!inFinYear(po.DocNo || po.PurchaseOrderNo, filters.finYear)) return false;
    if (!q) return true;
    return (
      (po.DocNo || po.PurchaseOrderNo || "").toLowerCase().includes(q) ||
      (po.SupplierName || "").toLowerCase().includes(q)
    );
  });
}

// ── 2. Multi-GRN invoices ───────────────────────────────────────────────────

export interface MultiGRNAggregateResult {
  valid: boolean;
  error?: string;
  poId?: number;
  poNo?: string | null;
  supplierId?: number;
  supplierLabel?: string | null;
  totalAmount: number;
  /** Sum of (receivedQty × rate) across every merged item — GST-exclusive. */
  basicAmount: number;
  /** Weighted-average GST% across merged items, split evenly CGST/SGST. */
  cgstRate: number;
  sgstRate: number;
  items: (GRNItemLine & { sourceGrnId: number; sourceGrnDocNo: string })[];
  grnIds: number[];
  grnDocNos: string[];
}

function parseGRNItems(raw: GRNItem["GRNItems"]): GRNItemLine[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Client-side preview of combining several selected GRNs into one
 * invoice: validates they all share a Purchase Order, sums their
 * TotalAmount, and merges their line items (tagged with which GRN each
 * came from). The backend re-validates and re-totals this authoritatively
 * on save (computeMultiGRNInvoice) — this is only for showing the user
 * what they're about to submit before they hit Save.
 */
function invalidResult(error: string): MultiGRNAggregateResult {
  return {
    valid: false,
    error,
    totalAmount: 0,
    basicAmount: 0,
    cgstRate: 0,
    sgstRate: 0,
    items: [],
    grnIds: [],
    grnDocNos: [],
  };
}

export function aggregateGRNsForInvoice(
  selectedGrns: GRNItem[],
): MultiGRNAggregateResult {
  if (selectedGrns.length === 0) {
    return invalidResult("Select at least one GRN.");
  }

  const rejected = selectedGrns.find((g) => g.Status === "Rejected");
  if (rejected) {
    return invalidResult(
      `${rejected.DocNo || rejected.GRNNo} is Rejected and can't be invoiced.`,
    );
  }

  const poIds = new Set(
    selectedGrns.map((g) => g.POID).filter((id): id is number => id != null),
  );
  if (poIds.size !== 1) {
    return invalidResult(
      "All selected GRNs must be linked to the same Purchase Order.",
    );
  }

  const ordered = [...selectedGrns].sort((a, b) => a.GRNID - b.GRNID);
  const [poId] = poIds;

  let basicAmount = 0;
  let weightedGstSum = 0;
  const items: MultiGRNAggregateResult["items"] = [];
  const grnIds: number[] = [];
  const grnDocNos: string[] = [];

  for (const g of ordered) {
    grnIds.push(g.GRNID);
    const docNo = g.DocNo || g.GRNNo || `GRN-${g.GRNID}`;
    grnDocNos.push(docNo);
    const parsed = parseGRNItems(g.GRNItems);
    for (const item of parsed) {
      items.push({ ...item, sourceGrnId: g.GRNID, sourceGrnDocNo: docNo });
      const qtyRate =
        (Number(item.receivedQty) || 0) * (Number(item.rate) || 0);
      basicAmount += qtyRate;
      weightedGstSum += qtyRate * (Number((item as any).gstPct) || 0);
    }
  }
  const gstPct = basicAmount > 0 ? weightedGstSum / basicAmount : 0;

  // Prefer the sum of each GRN's own stored TotalAmount (GST-inclusive,
  // the authoritative figure) over re-deriving it from line items.
  const storedTotal = ordered.reduce(
    (sum, g) => sum + Number((g as any).TotalAmount ?? 0),
    0,
  );

  return {
    valid: true,
    poId: poId ?? undefined,
    poNo: ordered[0].PONumber ?? null,
    supplierId: undefined,
    supplierLabel: ordered[0].SupplierName ?? null,
    totalAmount: storedTotal > 0 ? storedTotal : basicAmount,
    basicAmount,
    cgstRate: gstPct / 2,
    sgstRate: gstPct / 2,
    items,
    grnIds,
    grnDocNos,
  };
}
