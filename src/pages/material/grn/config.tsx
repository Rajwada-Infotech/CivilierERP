// Constants, small parts (panels, cards, pills) and the register columns shared by the GRN page and its parts.
import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Pencil, FileText, Eye, Receipt, Clock, CheckCircle2, AlertCircle, AlertTriangle, CopyPlus, ArrowLeftRight } from "lucide-react";
import { printStatusLabel } from "@/utils/printStatus";
import { type ExportColumn } from "@/lib/export";
import { Input } from "@/components/ui/input";
import { type ColumnDef } from "@/components/ui/DataTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { StatusBadge } from "@/components/StatusBadge";
import { type GRNItemLine as GRNItemLineBase, type UOM } from "@/api/grnApi";


export const GRN_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "GRN Date", accessor: (r) => r.GrnDate ? new Date(r.GrnDate as string).toLocaleDateString("en-IN") : "" },
  { header: "Supplier", accessor: "SupplierName" },
  { header: "PO Number", accessor: "PONumber" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Status", accessor: (r) => printStatusLabel(r.Status as string) },
];


// Extend the base type with GST fields sourced from PurchaseOrderItems.TaxPct
// (which itself comes from ItemMaster / HSN master at PO creation time).
export type GRNItemLine = GRNItemLineBase & {
  gstPct: number; // GST % from PO line (TaxPct) ← HSN master
  gstAmount: number; // base (rate × qty) × gstPct / 100
};

// ─── Remaining Items Panel ─────────────────────────────────────────────────────
// Shows GRN items that still have remainingQty > 0 (not yet fully expense-booked).
export interface PendingItem {
  itemId: string | null;
  itemName: string;
  uom: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  rate: number;
  pendingAmount: number;
}
export interface PartialGRN {
  grnId: number;
  grnNo: string;
  grnDate: string;
  status: string;
  totalAmount: number;
  itemCount: number;
}

export interface PendingItemsData {
  grnId: number;
  grnNo: string;
  supplierName: string | null;
  poId: number | null;
  poNo: string | null;
  pendingItems: PendingItem[];
  totalPendingAmount: number;
  hasPending: boolean;
  partialGRNs: PartialGRN[];
}

export function RemainingItemsPanel({
  grnId,
  onCreateNewGRN,
}: {
  grnId: number;
  onCreateNewGRN?: (data: PendingItemsData) => void;
}) {
  const [data, setData] = useState<PendingItemsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`/api/grns/${grnId}/pending-items`)
      .then((r) => (r.ok ? r.json().catch(() => ({})) : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [grnId]);

  if (loading)
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <div className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
        Checking remaining items…
      </div>
    );

  if (!data || !data.hasPending) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/8">
        <AlertTriangle size={12} className="text-amber-500 shrink-0" />
        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
          Remaining Items — Not Yet Expense Booked
        </span>
        <span className="ml-auto text-[0.625rem] text-muted-foreground">
          {data.pendingItems.length}{" "}
          {data.pendingItems.length === 1 ? "item" : "items"} pending
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/10 border-b border-amber-500/15">
              <th className="px-3 py-2 text-left text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                Item
              </th>
              <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                Ordered
              </th>
              <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Received
              </th>
              <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Remaining
              </th>
              <th className="px-3 py-2 text-left text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                UOM
              </th>
              <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                Rate (₹)
              </th>
              <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Pending Amt (₹)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ffe2021a]">
            {data.pendingItems.map((item, idx) => (
              <tr key={idx} className="hover:bg-amber-500/5 transition-colors">
                <td className="px-3 py-2 font-medium text-foreground max-w-[160px] truncate">
                  {item.itemName || `Item ${idx + 1}`}
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {item.orderedQty}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {item.receivedQty}
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                  {fmtQty(item.remainingQty)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {item.uom || "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {item.rate > 0
                    ? item.rate.toLocaleString("en-IN", {
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                  {item.pendingAmount > 0
                    ? item.pendingAmount.toLocaleString("en-IN", {
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-amber-500/30 bg-muted/10">
            <tr>
              <td
                colSpan={6}
                className="px-3 py-2.5 text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground"
              >
                Total Pending Value
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-sm font-bold text-amber-600 dark:text-amber-400">
                {data.totalPendingAmount.toLocaleString("en-IN", {
                  maximumFractionDigits: 2,
                })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {data.partialGRNs?.length > 0 && (
        <div className="border-t border-amber-500/15">
          <div className="px-4 py-2 bg-muted/20 flex items-center gap-2">
            <FileText size={11} className="text-muted-foreground shrink-0" />
            <span className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
              Other GRN receipts for this PO
            </span>
          </div>
          <div className="divide-y divide-border">
            {data.partialGRNs.map((g) => (
              <div key={g.grnId} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className="font-mono font-semibold text-foreground">{g.grnNo}</span>
                <span className="text-muted-foreground">{new Date(g.grnDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[0.625rem] font-medium ${
                  g.status === "Approved" ? "bg-emerald-500/10 text-emerald-600" :
                  g.status === "Pending" ? "bg-[#ffe2021a] text-amber-600" :
                  "bg-muted text-muted-foreground"
                }`}>{g.status}</span>
                <span className="ml-auto font-mono text-muted-foreground">
                  ₹{g.totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
                <span className="text-muted-foreground/60 text-[0.625rem]">{g.itemCount} item{g.itemCount !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 py-2.5 border-t border-amber-500/15 bg-amber-500/5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[0.625rem] text-amber-600 dark:text-amber-500">
          These items have been received but not yet booked as expenses. Create
          an Expense Booking from the Finance → Invoice page to book them.
        </p>
        {onCreateNewGRN && data && (
          <button
            onClick={() => onCreateNewGRN(data)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            <CopyPlus size={12} />
            New GRN for Remaining
          </button>
        )}
      </div>
    </div>
  );
}
export const createEmptyItem = (): GRNItemLine => ({
  itemId: "",
  itemName: "",
  orderedQty: 0,
  receivedQty: 0,
  remainingQty: 0,
  uom: "",
  rate: 0,
  quantity: 0,
  totalAmount: 0,
  gstPct: 0, // GST % sourced from PurchaseOrderItems.TaxPct (HSN master)
  gstAmount: 0, // computed: totalAmount × gstPct / 100
});

export const parseJsonArray = <T,>(val: unknown): T[] => {
  if (Array.isArray(val)) return val as T[];
  if (typeof val !== "string" || !val.trim()) return [];
  try {
    let parsed = JSON.parse(val);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

export const fmt = (n: number) =>
  n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Round a quantity to 3 decimal places, clearing JS floating-point drift
// (e.g. 499.99 - 400 = 99.99000000000001 → 99.99).
export const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

// Display a quantity with at most 3 decimal places (no trailing zero padding).
export const fmtQty = (n: number) => {
  const rounded = round3(n);
  return rounded.toLocaleString("en-IN", { maximumFractionDigits: 3 });
};

// Derive a "YYYY-YYYY" financial-year label (Apr–Mar) from a date string.
// Used as a fallback for older POs that have no fy_id / FinYearName set.
export const deriveFYFromDate = (dateStr?: string | null): string | null => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed; Jan = 0
  // April (3) onward → FY starts this year; Jan-Mar → FY started last year
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
};

// Input classes — matches existing app design tokens
export const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 text-foreground placeholder:text-muted-foreground/50";

export const inpSel =
  "w-full px-3 py-2 pr-8 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 text-foreground appearance-none";


// ─── Linked Expense Bookings ──────────────────────────────────────────────────
export interface LinkedBooking {
  Eid: number;
  EDocNo: string | null;
  EStatus: string;
  ENetAmount: number;
  ERemarks: string | null;
  EDocDate: string | null;
  EName: string | null;
}

export function LinkedExpenseBookings({ grnId }: { grnId: number }) {
  const [bookings, setBookings] = useState<LinkedBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(
      `/api/expense-booking/by-source?sourceType=GRN&sourceId=${grnId}`,
    )
      .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
      .then((data) =>
        setBookings(
          Array.isArray(data)
            ? data.filter(
                (b: LinkedBooking) =>
                  b.EStatus !== "Draft" &&
                  !(b.ERemarks ?? "").startsWith(
                    "Auto-created for remaining items from GRN",
                  ),
              )
            : [],
        ),
      )
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [grnId]);

  const statusColor = (s: string) => {
    if (s === "Approved" || s === "Booked")
      return "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400";
    if (s === "Pending")
      return "bg-[#ffe2021a] border-amber-500/20 text-amber-700 dark:text-amber-400";
    if (s === "Rejected")
      return "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400";
    return "bg-muted border-border text-muted-foreground";
  };

  const StatusIcon = (s: string) => {
    if (s === "Approved" || s === "Booked") return <CheckCircle2 size={10} />;
    if (s === "Pending") return <Clock size={10} />;
    if (s === "Rejected") return <AlertCircle size={10} />;
    return <Receipt size={10} />;
  };

  const isAutoSplit = (b: LinkedBooking) =>
    (b.ERemarks ?? "").startsWith("Auto-created for remaining items from GRN");

  if (loading)
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <div className="w-3 h-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        Loading…
      </div>
    );
  if (bookings.length === 0)
    return (
      <div className="text-xs text-muted-foreground/60 italic py-2">
        No expense bookings linked yet.
      </div>
    );

  return (
    <div className="space-y-2">
      {bookings.map((b) => (
        <div
          key={b.Eid}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isAutoSplit(b) ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/20"}`}
        >
          <div
            className={`shrink-0 p-1.5 rounded-lg ${isAutoSplit(b) ? "bg-[#ffe2021a]" : "bg-emerald-500/10"}`}
          >
            <Receipt
              size={13}
              className={
                isAutoSplit(b)
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold">
                {b.EDocNo ?? `Draft #${b.Eid}`}
              </span>
              {isAutoSplit(b) && (
                <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-medium">
                  Pending split
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[0.625rem] px-1.5 py-0.5 rounded-full border font-semibold ${statusColor(b.EStatus)}`}
              >
                {StatusIcon(b.EStatus)}
                {b.EStatus}
              </span>
            </div>
            {b.EName && !isAutoSplit(b) && (
              <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">
                {b.EName}
              </p>
            )}
            {isAutoSplit(b) && (
              <p className="text-[0.625rem] text-amber-600 dark:text-amber-500 mt-0.5">
                Remaining items — review in Expense Booking
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            {b.ENetAmount > 0 && (
              <p className="font-mono text-xs font-semibold">
                ₹{fmt(Number(b.ENetAmount))}
              </p>
            )}
            {b.EDocDate && (
              <p className="text-[0.625rem] text-muted-foreground mt-0.5">
                {new Date(b.EDocDate).toLocaleDateString("en-IN")}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Module-level refs (same pattern as original) ─────────────────────────────
// The register columns are defined outside the page component, so the page hands them its
// query client, handlers, rights and approval trails through this one object (set on every render).
export const bridge = {
  queryClient: null as unknown as ReturnType<typeof useQueryClient>,
  onEdit: (() => {}) as (grn: any) => void,
  onView: (() => {}) as (grn: any) => void,
  deleteMutation: { mutate: () => {} } as { mutate: (id: string) => void },
  handleDeleteGrn: (() => {}) as (id: string) => void,
  canDelete: true,
  canEdit: true,
  grnApprovalTrails: new Map<string, import("@/components/ApprovalStatusChain").TrailData | null>(),
  grnApprovalTrailsLoading: false,
};

// ─── List Columns ─────────────────────────────────────────────────────────────
// isTransferGRN: doc number starts with "TRF-GRN" — these rows came from a
// Stock Transfer and have no PO / Supplier; their ref doc is the TRF-xxx number.
export const isTransferGRN = (grn: any): boolean => Boolean(grn.SourceTransferDocNo);

export const GRN_LIST_COLUMNS: ColumnDef<any, unknown>[] = [
  // ── Doc No + type badge ──────────────────────────────────────────────────
  {
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ row, getValue }) => {
      const grn = row.original;
      const docNo = (getValue() as string) || grn.GRNNo;
      const isTRF = isTransferGRN(grn);
      return (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs font-bold text-foreground">
            {docNo || "—"}
          </span>
          {isTRF ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.5625rem] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-400/20 w-fit">
              <ArrowLeftRight size={8} /> Transfer GRN
            </span>
          ) : grn.POType && grn.POType !== "Direct" ? (
            // POType "Direct" is skipped here — a GRN off a Direct PO
            // already gets the "Direct Entry" badge below whenever it also
            // has no Vehicle In/Out (the common case), and the two badges
            // read as the same thing side by side.
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-semibold border w-fit ${
                grn.POType === "Normal"
                  ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                  : grn.POType === "WO_PO"
                    ? "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800"
                    : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {grn.POType}
            </span>
          ) : null}
          {/* Entry Mode — a GRN with no Vehicle In/Out skipped the gate
              control (raised via "remaining PO items" instead); worth
              flagging at a glance for audit/reporting. Transfer GRNs never
              have a vehicle either, but that's expected for that path, not
              an exception worth badging. */}
          {!isTRF && !grn.VehicleInOutID && (
            <span
              title={grn.DirectEntryReason || undefined}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.5625rem] font-semibold bg-[#ffe2021a] text-amber-700 dark:text-amber-400 border border-amber-400/20 w-fit"
            >
              Direct Entry
            </span>
          )}
        </div>
      );
    },
  },
  // ── Ref doc — smart column ───────────────────────────────────────────────
  // Transfer GRN → show TRF-xxx (the source transfer)
  // Normal GRN   → show PO No
  {
    id: "RefDoc",
    header: "Ref Doc",
    meta: { className: "hidden sm:table-cell" },
    cell: ({ row }) => {
      const grn = row.original;
      const isTRF = isTransferGRN(grn);
      if (isTRF) {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.5625rem] uppercase tracking-wide text-muted-foreground font-semibold">
              Transfer
            </span>
            <span className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400">
              {grn.SourceTransferDocNo || "—"}
            </span>
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-0.5">
          {grn.PONumber ? (
            <>
              <span className="text-[0.5625rem] uppercase tracking-wide text-muted-foreground font-semibold">
                PO
              </span>
              <span className="font-mono text-xs">{grn.PONumber}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      );
    },
  },
  // ── Supplier / Source ────────────────────────────────────────────────────
  // Transfer GRN → show Source MR if any (from the original transfer context)
  // Normal GRN   → show Supplier + Source MR
  {
    id: "SupplierOrSource",
    header: "Supplier / Source MR",
    meta: { className: "hidden sm:table-cell" },
    cell: ({ row }) => {
      const grn = row.original;
      const isTRF = isTransferGRN(grn);
      if (isTRF) {
        return (
          <span className="text-xs text-muted-foreground italic">
            Via stock transfer
          </span>
        );
      }
      return (
        <div className="flex flex-col gap-0.5">
          {grn.SupplierName ? (
            <span className="text-xs font-medium">{grn.SupplierName}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          {grn.SourceMRDocNo && (
            <span className="font-mono text-[0.625rem] font-semibold text-emerald-600 dark:text-emerald-400">
              {grn.SourceMRDocNo}
            </span>
          )}
        </div>
      );
    },
  },
  // ── Company / Project ────────────────────────────────────────────────────
  {
    id: "CompanyProject",
    header: "Company / Project",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => {
      const grn = row.original;
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs">{grn.CompanyName || "—"}</span>
          <span className="text-[0.625rem] text-muted-foreground">
            {grn.ProjectName || "—"}
          </span>
        </div>
      );
    },
  },
  // ── Date ─────────────────────────────────────────────────────────────────
  {
    accessorKey: "GRNDate",
    header: "Date",
    meta: { className: "hidden sm:table-cell" },
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {v ? new Date(v).toLocaleDateString("en-IN") : "—"}
        </span>
      );
    },
  },
  // ── Amount ───────────────────────────────────────────────────────────────
  {
    accessorKey: "TotalAmount",
    header: "Amount",
    meta: { className: "hidden sm:table-cell" },
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return (
        <span className="text-xs font-semibold">
          {v != null ? `₹${fmt(Number(v))}` : "—"}
        </span>
      );
    },
  },
  // ── Status ───────────────────────────────────────────────────────────────
  {
    id: "chain",
    header: "Status",
    meta: { className: "hidden sm:table-cell" },
    enableSorting: false,
    cell: ({ row }) => (
      <ApprovalStatusChain
        table="GoodsReceiptNotes"
        recordId={row.original.GRNID}
        compact
        fallback={<StatusBadge status={row.original.Status} />}
        preloaded={bridge.grnApprovalTrails.get(String(row.original.GRNID)) ?? null}
        preloadedLoading={bridge.grnApprovalTrailsLoading}
      />
    ),
  },
  // ── Actions ──────────────────────────────────────────────────────────────
  {
    id: "actions",
    header: () => <div className="text-right">ACTIONS</div>,
    enableSorting: false,
    cell: ({ row }) => {
      const grn = row.original;
      return (
        <div className="flex items-center justify-end gap-2">
          <button data-row-view="hide"
            onClick={(e) => { e.stopPropagation(); bridge.onView(grn); }}
            className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
            title="View details"
          >
            <Eye size={15} />
          </button>
          {bridge.canEdit && !isTransferGRN(grn) && (
            <button
              onClick={(e) => { e.stopPropagation(); bridge.onEdit(grn); }}
              className="p-1 rounded text-primary hover:bg-primary/10 transition-colors"
              title="Edit this GRN"
            >
              <Pencil size={15} />
            </button>
          )}
          {bridge.canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); bridge.handleDeleteGrn(String(grn.GRNID)); }}
              className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete this GRN"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      );
    },
  },
];

// ─── Small UI helpers ─────────────────────────────────────────────────────────
export function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

export function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card/50 p-5 space-y-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <div className="p-1.5 rounded-lg bg-emerald-500/10 shrink-0">
        <Icon size={13} className="text-emerald-600 dark:text-emerald-400" />
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground tracking-wide">
          {label}
        </p>
        {sub && <p className="text-[0.625rem] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export function InfoPill({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  if (!value) return null;
  // Defensive: some callers derive `value` from `.find(...)` on loosely
  // (`any[]`) typed lookups. If a caller's data shape ever mismatches and
  // hands us an object instead of a string, rendering it directly used to
  // crash the entire GRN page (React refuses objects as children) —
  // degrade to the item's own name/label/docNo, or drop the pill, instead.
  const safeValue =
    typeof value === "string" || typeof value === "number"
      ? value
      : ((value as any)?.name ??
        (value as any)?.label ??
        (value as any)?.docNo ??
        null);
  if (!safeValue) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-muted/60 border border-border/60 min-w-0">
      <span className="text-[0.5625rem] uppercase tracking-widest font-semibold text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-xs font-semibold text-foreground truncate ${mono ? "font-mono" : ""}`}
      >
        {safeValue}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Template columns ─────────────────────────────────────────────────────────
export const GRN_TEMPLATE_COLUMNS = [
  { header: "Purchase Order No", accessor: "Purchase Order No" },
  { header: "Supplier", accessor: "Supplier" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "GRN Date (YYYY-MM-DD)", accessor: "GRN Date (YYYY-MM-DD)" },
  { header: "Challan No", accessor: "Challan No" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "Ordered Qty", accessor: "Ordered Qty" },
  { header: "Received Qty", accessor: "Received Qty" },
  { header: "UOM", accessor: "UOM" },
  { header: "Rate", accessor: "Rate" },
];
