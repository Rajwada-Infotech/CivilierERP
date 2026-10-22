// Number / date formats, line types and the blank line shared by the Stock Transfer page and its parts.


export const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

// Rate is stored to 4 decimal places (InterCompanyTransferItems.Rate) and
// Amount is computed from that full-precision value server-side — showing
// Rate capped to 2dp via fmtNum made "Rate × Qty" visibly not reconcile
// with the printed Excl. GST/Total (e.g. a weighted-average rate like
// 241.525 printed as "241.53"), which read as the GST calc "not adding
// up" even though the underlying numbers were always correct.
export const fmtRate = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(n ?? 0);

export const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });


export interface TItem {
  itemId: string;
  itemName: string;
  qty: string;
  uom: string;
  availableQty: number;
  remarks: string;
  /** Set when this line came from a Material Request (inter-company only) —
   *  the source MaterialRequestItems row. */
  mrItemId?: number | null;
  /** Cap for this line's quantity — what's still pending on that MR item. */
  mrPendingQty?: number | null;
  /** Computed each render from the source godown's live stock — not stored. */
  stockKnown?: boolean;
  /** True when this item's total requested qty (all lines) exceeds the stock. */
  stockShort?: boolean;
  /** Inter-company + Fixed Asset item: the units moved are picked by FA Item Code
   *  (one per unit), so the quantity follows the selection. Computed each render. */
  isFa?: boolean;
  /** FixedAssetTagging.TagId of each unit picked on this line. */
  faTagIds?: number[];
}

export interface AvailableItem {
  itemId: string;
  itemName: string;
  uom: string;
  available: number;
}

export const emptyItem = (): TItem => ({
  itemId: "",
  itemName: "",
  qty: "",
  uom: "",
  availableQty: 0,
  remarks: "",
});
