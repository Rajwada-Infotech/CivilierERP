import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Truck,
  Package,
  Trash2,
  Save,
  X,
  Search,
  Calendar,
  FileText,
  Eye,
  Receipt,
  Clock,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  Hash,
  Filter,
  AlertTriangle,
  FileWarning,
  Printer,
  CopyPlus,
  Warehouse,
  ArrowLeftRight,
  ArrowLeft,
  RotateCcw,
  BookOpen,
  Landmark,
  Download,
  Upload,
  Loader2,
  Lock,
} from "lucide-react";
import { escapeHtml, safeHtml } from "@/utils/escapeHtml";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { ExportMenu } from "@/components/ExportMenu";
import {
  computeRemainingPOItems,
  hasRemainingItems,
  countRemainingItems,
  buildGRNLineItemsFromRemaining,
  type RemainingPOItem,
} from "./grnRemainingItems";

// ─── Template columns ─────────────────────────────────────────────────────────
const GRN_TEMPLATE_COLUMNS = [
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

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const GRN_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "GRN Date", accessor: (r) => r.GrnDate ? new Date(r.GrnDate as string).toLocaleDateString("en-IN") : "" },
  { header: "Supplier", accessor: "SupplierName" },
  { header: "PO Number", accessor: "PONumber" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Status", accessor: "Status" },
];

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as grnApi from "@/api/grnApi";
import { createQualityDebitNote } from "@/api/qualityRejectionDebitNoteApi";
import { RaiseDebitNoteModal } from "@/components/quality/RaiseDebitNoteModal";
import { getProjects, getCompanies } from "@/api/grnApi";
import { getGodowns } from "@/api/godownsApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import type {
  GRNFormDataPayload,
  GRNItemLine as GRNItemLineBase,
  PurchaseOrder,
  UOM,
} from "@/api/grnApi";

// Extend the base type with GST fields sourced from PurchaseOrderItems.TaxPct
// (which itself comes from ItemMaster / HSN master at PO creation time).
type GRNItemLine = GRNItemLineBase & {
  gstPct: number; // GST % from PO line (TaxPct) ← HSN master
  gstAmount: number; // base (rate × qty) × gstPct / 100
};

// ─── Remaining Items Panel ─────────────────────────────────────────────────────
// Shows GRN items that still have remainingQty > 0 (not yet fully expense-booked).
interface PendingItem {
  itemId: string | null;
  itemName: string;
  uom: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  rate: number;
  pendingAmount: number;
}
interface PartialGRN {
  grnId: number;
  grnNo: string;
  grnDate: string;
  status: string;
  totalAmount: number;
  itemCount: number;
}

interface PendingItemsData {
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

function RemainingItemsPanel({
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
        <span className="ml-auto text-[10px] text-muted-foreground">
          {data.pendingItems.length}{" "}
          {data.pendingItems.length === 1 ? "item" : "items"} pending
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/10 border-b border-amber-500/15">
              <th className="px-3 py-2 text-left text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                Item
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                Ordered
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Received
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Remaining
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                UOM
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                Rate (₹)
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Pending Amt (₹)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-500/10">
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
                className="px-3 py-2.5 text-[10px] font-heading uppercase tracking-wider text-muted-foreground"
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
            <span className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
              Other GRN receipts for this PO
            </span>
          </div>
          <div className="divide-y divide-border">
            {data.partialGRNs.map((g) => (
              <div key={g.grnId} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className="font-mono font-semibold text-foreground">{g.grnNo}</span>
                <span className="text-muted-foreground">{new Date(g.grnDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  g.status === "Approved" ? "bg-emerald-500/10 text-emerald-600" :
                  g.status === "Pending" ? "bg-amber-500/10 text-amber-600" :
                  "bg-muted text-muted-foreground"
                }`}>{g.status}</span>
                <span className="ml-auto font-mono text-muted-foreground">
                  ₹{g.totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
                <span className="text-muted-foreground/60 text-[10px]">{g.itemCount} item{g.itemCount !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 py-2.5 border-t border-amber-500/15 bg-amber-500/5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] text-amber-600 dark:text-amber-500">
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
const createEmptyItem = (): GRNItemLine => ({
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

const parseJsonArray = <T,>(val: unknown): T[] => {
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

const fmt = (n: number) =>
  n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Round a quantity to 3 decimal places, clearing JS floating-point drift
// (e.g. 499.99 - 400 = 99.99000000000001 → 99.99).
const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

// Display a quantity with at most 3 decimal places (no trailing zero padding).
const fmtQty = (n: number) => {
  const rounded = round3(n);
  return rounded.toLocaleString("en-IN", { maximumFractionDigits: 3 });
};

// Derive a "YYYY-YYYY" financial-year label (Apr–Mar) from a date string.
// Used as a fallback for older POs that have no fy_id / FinYearName set.
const deriveFYFromDate = (dateStr?: string | null): string | null => {
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
const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 text-foreground placeholder:text-muted-foreground/50";

const inpSel =
  "w-full px-3 py-2 pr-8 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 text-foreground appearance-none";

// ─── Linked Expense Bookings ──────────────────────────────────────────────────
interface LinkedBooking {
  Eid: number;
  EDocNo: string | null;
  EStatus: string;
  ENetAmount: number;
  ERemarks: string | null;
  EDocDate: string | null;
  EName: string | null;
}

function LinkedExpenseBookings({ grnId }: { grnId: number }) {
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
      return "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400";
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
            className={`shrink-0 p-1.5 rounded-lg ${isAutoSplit(b) ? "bg-amber-500/10" : "bg-emerald-500/10"}`}
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
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-medium">
                  Pending split
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${statusColor(b.EStatus)}`}
              >
                {StatusIcon(b.EStatus)}
                {b.EStatus}
              </span>
            </div>
            {b.EName && !isAutoSplit(b) && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {b.EName}
              </p>
            )}
            {isAutoSplit(b) && (
              <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
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
              <p className="text-[10px] text-muted-foreground mt-0.5">
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
let queryClient: ReturnType<typeof useQueryClient>;
let onEdit: (grn: any) => void;
let onView: (grn: any) => void;
let deleteMutation: { mutate: (id: string) => void };
let handleDeleteGrn: (id: string) => void;
let goToGRNAmend: (grn: any) => void;
let _canDelete = true;

// ─── List Columns ─────────────────────────────────────────────────────────────
// isTransferGRN: doc number starts with "TRF-GRN" — these rows came from a
// Stock Transfer and have no PO / Supplier; their ref doc is the TRF-xxx number.
const isTransferGRN = (grn: any): boolean => Boolean(grn.SourceTransferDocNo);

const GRN_LIST_COLUMNS: ColumnDef<any, unknown>[] = [
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
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-400/20 w-fit">
              <ArrowLeftRight size={8} /> Transfer GRN
            </span>
          ) : grn.POType ? (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border w-fit ${
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
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
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
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
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
            <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
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
          <span className="text-[10px] text-muted-foreground">
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
          <button
            onClick={() => onView(grn)}
            className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
            title="View details"
          >
            <Eye size={15} />
          </button>
          {_canDelete && (
            <button
              onClick={() => handleDeleteGrn(String(grn.GRNID))}
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
function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function SectionCard({
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

function SectionTitle({
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
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function InfoPill({
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
      <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">
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
export default function GRN() {
  queryClient = useQueryClient();
  const rights = usePageRights("grn-master");
  const today = new Date().toISOString().slice(0, 10);
  _canDelete = rights.canDelete;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Quality-rejection debit note — raised against a single GRN line item
  // (identified by its position in the GRNItems JSON array) from the view
  // modal's Received Items table.
  const [debitNoteLine, setDebitNoteLine] = useState<{ index: number; item: GRNItemLine } | null>(null);
  const [debitNoteQty, setDebitNoteQty] = useState("");
  const [debitNoteReason, setDebitNoteReason] = useState("");
  const debitNoteMut = useMutation({
    mutationFn: () =>
      createQualityDebitNote({
        grnId: viewingGrn.GRNID,
        grnItemIndex: debitNoteLine!.index,
        rejectedQty: parseFloat(debitNoteQty) || 0,
        reason: debitNoteReason.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(
        `Debit note ${res.docNo} raised — ${res.percentBad}% bad, ₹${res.amount.toLocaleString("en-IN")}`,
      );
      setDebitNoteLine(null);
      setDebitNoteQty("");
      setDebitNoteReason("");
    },
    onError: (err: any) => toast.error(err.message || "Failed to raise debit note"),
  });
  const { finYears } = useFinYear();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewingGrn, setViewingGrn] = useState<any | null>(null);
  const [viewModalTab, setViewModalTab] = useState<"details" | "posting">(
    "details",
  );

  // Fetch live posting data when the posting tab is opened
  React.useEffect(() => {
    if (viewModalTab !== "posting" || !viewingGrn?.GRNID) return;
    setGrnPostingLoading(true);
    setGrnPostingData(null);
    fetchWithAuth(`/api/grns/${viewingGrn.GRNID}/posting`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGrnPostingData(d ?? null))
      .catch(() => setGrnPostingData(null))
      .finally(() => setGrnPostingLoading(false));
  }, [viewModalTab, viewingGrn?.GRNID]);

  const [grnPostingData, setGrnPostingData] = useState<any | null>(null);
  const [grnPostingLoading, setGrnPostingLoading] = useState(false);
  const [grnPosting, setGrnPosting] = useState(false);
  const [grnPostingError, setGrnPostingError] = useState<string | null>(null);

  // Auto-post as soon as the posting tab's data has loaded and it isn't
  // posted yet — no manual "Post to GL" click; the journal entry is created
  // the moment the user looks at the posting tab.
  React.useEffect(() => {
    if (
      viewModalTab !== "posting" ||
      grnPostingLoading ||
      !grnPostingData ||
      grnPostingData.isPosted ||
      grnPosting ||
      !viewingGrn?.GRNID
    )
      return;
    const grnId = viewingGrn.GRNID;
    setGrnPosting(true);
    setGrnPostingError(null);
    fetchWithAuth(`/api/grns/${grnId}/post-to-gl`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? "Posting failed");
        setGrnPostingData((prev: any) => ({
          ...prev,
          isPosted: true,
          jvNo: body.jvNo,
          jvId: body.jvId,
        }));
      })
      .catch((err: any) => setGrnPostingError(err.message ?? "Posting failed"))
      .finally(() => setGrnPosting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewModalTab, grnPostingLoading, grnPostingData, viewingGrn?.GRNID]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [grnStatusFilter, setGrnStatusFilter] = useState("All");
  const [loadingPO, setLoadingPO] = useState(false);
  const [pendingVehicleInOuts, setPendingVehicleInOuts] = useState<any[]>([]);
  const [loadingVehicleInOuts, setLoadingVehicleInOuts] = useState(false);
  const [poRemainingItems, setPoRemainingItems] = useState<RemainingPOItem[]>(
    [],
  );
  const [selectedFinYear, setSelectedFinYear] = useState<string>("");
  const [deleteBlockInfo, setDeleteBlockInfo] = useState<{
    reason: string;
    expenseBookings?: { id: number; docNo: string; status: string }[];
    clearedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      brsId: number;
      expenseDocNo: string;
    }[];
    linkedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      expenseDocNo: string;
    }[];
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const limit = 10;

  const activeFinYearEntry =
    finYears.find((fy) => fy.status === "Active") ||
    [...finYears].sort((a, b) => b.year.localeCompare(a.year))[0];
  const activeFinYear = activeFinYearEntry?.year || undefined;
  // The GRN list endpoint filters by a derived "YYYY-YYYY" FinYear string
  // (built from GRNDate, see GET /api/grns), not the FinYear label ("FY
  // 2026-27") the context stores — passing the label made the filter never
  // match anything and silently returned zero rows. Derive the same
  // "YYYY-YYYY" shape from the active year's start date instead.
  const activeFinYearRange = activeFinYearEntry?.startDate
    ? `${new Date(activeFinYearEntry.startDate).getFullYear()}-${new Date(activeFinYearEntry.startDate).getFullYear() + 1}`
    : undefined;

  // Selectable years for the (now unlocked) Financial Year filter — same
  // "YYYY-YYYY" shape as activeFinYearRange so it matches what the backend
  // computes per-GRN. Restricted to Active fin years from the Fin Year
  // master — a GRN is a live receiving transaction, not a backdated entry
  // against a closed year.
  const finYearOptions = useMemo(
    () =>
      finYears
        .filter((fy) => fy.status === "Active")
        .map((fy) =>
          fy.startDate
            ? `${new Date(fy.startDate).getFullYear()}-${new Date(fy.startDate).getFullYear() + 1}`
            : null,
        )
        .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
        .sort((a, b) => b.localeCompare(a)),
    [finYears],
  );

  // Default the Financial Year filter to the active year once it loads, but
  // leave it editable — matches PurchaseOrderMaster.tsx / VehicleInOut.tsx.
  useEffect(() => {
    if (!selectedFinYear && activeFinYearRange)
      setSelectedFinYear(activeFinYearRange);
  }, [activeFinYearRange, selectedFinYear]);

  const buildEmptyForm = () => ({
    grnNo: "",
    grnDate: new Date().toISOString().slice(0, 10),
    // Doc Date — always today's date, distinct from GRN Date which now
    // tracks the linked Vehicle In/Out document's own date.
    docDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    vehicleInOutId: "" as string,
    vehicleInOutDocNo: "" as string,
    // Which of the two ways this GRN's items were sourced from — a
    // specific Vehicle In/Out lot, or a direct "remaining items on this
    // PO" quick-fill. Empty until the user picks one.
    grnSourceMode: "" as "" | "vehicleInOut" | "remaining",
    poTotalAmount: 0 as number,
    poSubtotalAmount: 0 as number,
    poReceivedAmount: 0 as number,
    remarks: "",
    status: "Draft" as const,
    items: [createEmptyItem()] as GRNItemLine[],
    docTypeId: null as number | null,
    docNo: "",
    parentDocNo: "",
    rootExBDocNo: "",
    finYear: activeFinYear || "",
    companyId: "" as string,
    projectId: "" as string,
    godownId: "" as string,
  });

  const [formData, setFormData] = useState(buildEmptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Queries ──────────────────────────────────────────────────────────────────
  const {
    data: grnsPage,
    isLoading: loadingGrns,
    isFetching: fetchingGrns,
  } = useQuery({
    queryKey: ["grns", page, limit, selectedFinYear],
    queryFn: () =>
      grnApi.getGRNs({
        page,
        limit,
        ...(selectedFinYear ? { finYear: selectedFinYear } : {}),
      }),
    placeholderData: (prev) => prev,
  });
  const grns = grnsPage?.data ?? [];
  const totalPages = Math.max(grnsPage?.totalPages ?? 1, 1);
  const totalRecords = grnsPage?.total ?? grns.length;

  // Fetch ALL POs — filtered client-side by fy_id
  const { data: posData = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => grnApi.getPurchaseOrders(),
  });

  // Derive the financial year string from a date string using Indian FY rule (Apr–Mar).
  // e.g. 2026-01-15 → "2025-2026",  2026-05-10 → "2026-2027"
  useQuery({ queryKey: ["uomMaster"], queryFn: grnApi.getUoms });

  const { data: grnNumberPreview, isFetching: loadingPreview } = useQuery({
    queryKey: ["grns", "next-number", formData.parentDocNo],
    queryFn: () => grnApi.previewNextGRNNumber(formData.parentDocNo || null),
    enabled: !editingId,
    staleTime: 15_000,
  });

  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const godowns = (godownsData as any)?.data ?? [];

  // Find the godown linked to a project (by ProjectID FK on Godowns row)
  const findProjectGodownId = (
    projectId: string | number | null | undefined,
  ): string => {
    if (!projectId || !godowns.length) return "";
    const match = godowns.find(
      (g: any) => String(g.ProjectID) === String(projectId),
    );
    return match ? String(match.GodownID) : "";
  };

  // Auto-select the project-linked godown whenever projectId changes.
  // Skip when editing an existing GRN (the saved GodownID is loaded via loadForEdit).
  useEffect(() => {
    if (editingId) return;
    const auto = findProjectGodownId(formData.projectId);
    setFormData((prev) => {
      if (prev.godownId === auto) return prev; // no change → no re-render
      return { ...prev, godownId: auto };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.projectId, godowns]);

  const { data: filteredProjects = [] } = useQuery({
    queryKey: ["grn-projects", formData.companyId],
    queryFn: () => getProjects(formData.companyId || null),
  });

  // POs eligible for a GRN must have at least one Vehicle In/Out already
  // logged against them — goods can't be receipted before a vehicle's
  // actually brought them in.
  const { data: poIdsWithVio = [] } = useQuery({
    queryKey: ["po-ids-with-vio"],
    queryFn: () =>
      fetchWithAuth("/api/vehicle-in-out/po-ids-with-vio")
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d.map(Number) : [])),
    staleTime: 60_000,
  });
  const poIdsWithVioSet = useMemo(
    () => new Set(poIdsWithVio as number[]),
    [poIdsWithVio],
  );

  const { data: companiesData = [] } = useQuery({
    queryKey: ["grn-companies"],
    queryFn: getCompanies,
  });

  const pos = useMemo(
    () =>
      (posData as PurchaseOrder[])
        .filter((po) => {
          if (formData.poId && String(po.PurchaseOrderID) === formData.poId)
            return true;
          // Only Approved POs (or already-partially-received ones) can be
          // used to raise a GRN. Draft / Pending / Rejected / Cancelled POs
          // must not show up in the dropdown.
          const status = (po as any).Status;
          if (status !== "Approved" && status !== "Received") return false;
          if (selectedFinYear) {
            // selectedFinYear is a derived "YYYY-YYYY" string (see
            // activeFinYearRange above) — always derive the PO's FY the
            // same way from its date rather than comparing against the
            // "FY YYYY-YY" label, which uses a different format.
            const poFY = deriveFYFromDate((po as any).PODate);
            if (!poFY || poFY !== selectedFinYear) return false;
          }
          if (formData.companyId) {
            if (String((po as any).CompanyId ?? "") !== formData.companyId)
              return false;
          }
          if (formData.projectId) {
            if (String((po as any).ProjectId ?? "") !== formData.projectId)
              return false;
          }
          // A GRN can only be raised once a vehicle's actually brought the
          // goods in — a PO with no Vehicle In/Out logged against it yet
          // has nothing to receipt.
          if (!poIdsWithVioSet.has(Number(po.PurchaseOrderID))) return false;
          return true;
        })
        .map((po) => {
          const docNo = po.DocNo || po.PurchaseOrderNo;
          const typeTag =
            po.POType === "Normal"
              ? " [Normal]"
              : po.POType === "WO_PO"
                ? " [WO_PO]"
                : "";
          return {
            value: String(po.PurchaseOrderID),
            label: `${docNo}${typeTag}`,
          };
        }),
    [
      posData,
      selectedFinYear,
      formData.companyId,
      formData.projectId,
      formData.poId,
      editingId,
      poIdsWithVioSet,
    ],
  );

  const filteredGrns = grns.filter((grn: any) => {
    if (selectedFinYear && grn.FinYear && grn.FinYear !== selectedFinYear)
      return false;
    if (grnStatusFilter !== "All" && grn.Status !== grnStatusFilter)
      return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      grn.DocNo?.toLowerCase().includes(q) ||
      grn.GRNNo?.toLowerCase().includes(q) ||
      grn.PONumber?.toLowerCase().includes(q) ||
      grn.SupplierName?.toLowerCase().includes(q) ||
      grn.SourceTransferDocNo?.toLowerCase().includes(q) ||
      grn.SourceMRDocNo?.toLowerCase().includes(q)
    );
  });

  // ── Group by linked PO — every GRN raised against the same PO now shows
  // together instead of scattered across the flat register, matching the
  // same grouping VehicleInOut.tsx uses. GRNs with no PO link (transfer
  // GRNs, older records) fall into one "No PO Linked" bucket. Group order
  // follows first-appearance in the (already recency-sorted) page.
  const groupedGrns = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; poNumber: string | null; supplierName: string | null; rows: any[] }
    >();
    for (const grn of filteredGrns) {
      const key = grn.POID ? `po-${grn.POID}` : "no-po";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          poNumber: grn.PONumber || null,
          supplierName: grn.SupplierName || null,
          rows: [],
        });
      }
      groups.get(key)!.rows.push(grn);
    }
    return Array.from(groups.values());
  }, [filteredGrns]);

  const [collapsedGrnGroups, setCollapsedGrnGroups] = useState<
    Record<string, boolean>
  >({});
  const toggleGrnGroup = (key: string) =>
    setCollapsedGrnGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // base total (excl. GST) — used for stock ledger and line display
  const grandTotal = formData.items.reduce(
    (sum, i) => sum + (i.totalAmount || 0),
    0,
  );
  // GST amount per item comes from PO's TaxPct (HSN master) × billing value
  const grandGSTAmount = formData.items.reduce(
    (sum, i) => sum + (i.gstAmount || 0),
    0,
  );
  // GRN total incl. GST — compared against poTotalAmount (also incl. GST)
  const grnTotalWithGST = grandTotal + grandGSTAmount;

  // ── Mutations ─────────────────────────────────────────────────────────────────
  // Cache-version bumps (bumpCacheVersion("grns") on the backend) take a
  // beat to propagate across backend workers before a refetch is
  // guaranteed to see fresh data — PurchaseOrderMaster.tsx's approval flow
  // already works around this with the same delay (see its
  // handleApprovalSuccess). GRN's create/update/delete didn't have it,
  // which is why the list looked stale until a manual browser refresh.
  const CACHE_PROPAGATION_DELAY_MS = 400;

  const createMutation = useMutation({
    mutationFn: grnApi.addGRN,
    onSuccess: async (res) => {
      setPage(1);
      await new Promise((r) => setTimeout(r, CACHE_PROPAGATION_DELAY_MS));
      await queryClient.invalidateQueries({ queryKey: ["grns"] });
      await queryClient.refetchQueries({ queryKey: ["grns"], type: "all" });
      const generated = res?.grnNo || "";
      setFormData(buildEmptyForm());
      setEditingId(null);
      setShowForm(false);
      setErrors({});
      if (generated) setFormData((p) => ({ ...p, grnNo: generated }));
      toast.success(`GRN ${generated} created and sent for approval`);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create GRN"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: GRNFormDataPayload) =>
      grnApi.updateGRN(editingId!, payload),
    onSuccess: async () => {
      setPage(1);
      await new Promise((r) => setTimeout(r, CACHE_PROPAGATION_DELAY_MS));
      await queryClient.invalidateQueries({ queryKey: ["grns"] });
      await queryClient.refetchQueries({ queryKey: ["grns"], type: "all" });
      setFormData(buildEmptyForm());
      setEditingId(null);
      setShowForm(false);
      setErrors({});
      toast.success("GRN updated successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update GRN"),
  });

  deleteMutation = useMutation({
    mutationFn: grnApi.deleteGRN,
    onSuccess: async () => {
      setPage(1);
      await new Promise((r) => setTimeout(r, CACHE_PROPAGATION_DELAY_MS));
      await queryClient.invalidateQueries({ queryKey: ["grns"] });
      await queryClient.refetchQueries({ queryKey: ["grns"], type: "all" });
      toast.success("GRN deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete GRN"),
  });

  const handleDeleteGrnLocal = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/grns/${id}/can-delete`);
      const data = await res.json();
      if (!data.deletable) {
        setDeleteBlockInfo(data);
        return;
      }
      setDeleteConfirmId(id);
    } catch (err: any) {
      toast.error(`Check failed: ${err.message}`);
    }
  };

  handleDeleteGrn = handleDeleteGrnLocal;

  const confirmDeleteGrn = () => {
    if (!deleteConfirmId) return;
    deleteMutation.mutate(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  // ── PO select ─────────────────────────────────────────────────────────────────
  const handlePOSelect = async (poId: string) => {
    if (!poId) {
      setFormData((prev) => ({
        ...prev,
        poId: "",
        poNumber: "",
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "",
        supplierId: "",
        supplierName: "",
        items: [createEmptyItem()],
        grnNo: "",
        docNo: "",
        docTypeId: null,
        parentDocNo: "",
        rootExBDocNo: "",
        poTotalAmount: 0,
        poSubtotalAmount: 0,
      }));
      setPendingVehicleInOuts([]);
      setPoRemainingItems([]);
      return;
    }
    setLoadingPO(true);
    try {
      const res = await fetchWithAuth(`/api/purchase-orders/${poId}`);
      if (!res.ok) throw new Error("Failed to fetch PO details");
      const po = await res.json();

      setPoRemainingItems(computeRemainingPOItems(po));

      setFormData((prev) => ({
        ...prev,
        poId,
        poNumber: po.PurchaseOrderNo ?? "",
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "",
        supplierId: String(po.SupplierID ?? ""),
        supplierName: po.SupplierName ?? "",
        // Auto-fill Company + Project straight from the PO — picking a PO
        // first (without narrowing by company/project beforehand) now
        // works the same as the other direction. Godown follows via the
        // existing projectId-watching effect below.
        companyId: po.CompanyId ? String(po.CompanyId) : prev.companyId,
        projectId: po.ProjectId ? String(po.ProjectId) : prev.projectId,
        items: [createEmptyItem()],
        docTypeId: null,
        parentDocNo: po.DocNo || po.PurchaseOrderNo || "",
        rootExBDocNo: po.RootExBDocNo || "",
        finYear: prev.finYear || activeFinYear || "",
        grnNo: "",
        docNo: "",
        poTotalAmount: Number(po.TotalAmount ?? 0),
        poSubtotalAmount: Number(po.SubtotalAmount ?? 0),
        poReceivedAmount: Number(po.POTotalReceived ?? 0),
      }));

      // GRNs are now raised only against a Vehicle In/Out document linked to
      // this PO — fetch the ones that don't already have a GRN.
      setLoadingVehicleInOuts(true);
      try {
        const vioRes = await fetchWithAuth(
          `/api/vehicle-in-out/po/${poId}/pending-grn`,
        );
        const vios = vioRes.ok ? await vioRes.json() : [];
        setPendingVehicleInOuts(Array.isArray(vios) ? vios : []);
        if (!vios || vios.length === 0) {
          toast.info(
            "No Vehicle In/Out documents pending a GRN were found for this Purchase Order.",
          );
        }
      } catch {
        setPendingVehicleInOuts([]);
      } finally {
        setLoadingVehicleInOuts(false);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load PO details");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Vehicle In/Out select — loads GRN line items from the chosen lot ─────────
  const handleVehicleInOutSelect = async (vehicleInOutId: string) => {
    if (!vehicleInOutId) {
      setFormData((prev) => ({
        ...prev,
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "",
        grnDate: new Date().toISOString().slice(0, 10),
        items: [createEmptyItem()],
      }));
      return;
    }
    setLoadingPO(true);
    try {
      const res = await fetchWithAuth(
        `/api/vehicle-in-out/${vehicleInOutId}/items-enriched`,
      );
      if (!res.ok) throw new Error("Failed to fetch Vehicle In/Out items");
      const items = await res.json();

      const lineItems: GRNItemLine[] = (items ?? []).map((it: any) => {
        const rate = Number(it.Rate ?? 0);
        const vehicleQty = Number(it.VehicleQty ?? 0);
        const gstPct = Number(it.TaxPct ?? 0);
        const totalAmount = rate * vehicleQty;
        return {
          itemId: String(it.ItemId ?? ""),
          itemName: it.ItemName ?? "",
          orderedQty: vehicleQty,
          receivedQty: vehicleQty,
          remainingQty: 0,
          uom: it.UomName ?? "",
          rate,
          quantity: vehicleQty,
          totalAmount,
          gstPct,
          gstAmount: totalAmount * (gstPct / 100),
        };
      });

      const vio = pendingVehicleInOuts.find(
        (v) => String(v.VehicleInOutID) === vehicleInOutId,
      );

      setFormData((prev) => ({
        ...prev,
        vehicleInOutId,
        vehicleInOutDocNo: vio?.DocNo ?? "",
        grnSourceMode: "vehicleInOut",
        // GRN Date now tracks the linked Vehicle In/Out document's own
        // date — the goods were received on that date, not today.
        grnDate: vio?.DocDate
          ? String(vio.DocDate).slice(0, 10)
          : prev.grnDate,
        items: lineItems.length ? lineItems : [createEmptyItem()],
      }));
    } catch (e: any) {
      toast.error(e.message || "Failed to load Vehicle In/Out items");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Use remaining PO items directly — second way to raise a GRN for
  // what's left on a PO, alongside picking a Vehicle In/Out lot. Lets the
  // same PO be received across as many GRNs as needed without requiring
  // a Vehicle In/Out document for every split.
  const handleUseRemainingItems = () => {
    if (!hasRemainingItems(poRemainingItems)) return;
    setFormData((prev) => ({
      ...prev,
      vehicleInOutId: "",
      vehicleInOutDocNo: "",
      grnSourceMode: "remaining",
      grnDate: new Date().toISOString().slice(0, 10),
      items: buildGRNLineItemsFromRemaining(poRemainingItems),
    }));
    toast.success(
      `Form filled with ${countRemainingItems(poRemainingItems)} remaining item${countRemainingItems(poRemainingItems) !== 1 ? "s" : ""} from this PO`,
    );
  };

  // ── Create new GRN from remaining items ───────────────────────────────────────
  // Called from RemainingItemsPanel "New GRN for Remaining" button.
  // Seeds the form with the same PO but pre-fills receivedQty = remainingQty
  // so the user only needs to confirm quantities and submit.
  const handleCreateGRNFromRemaining = async (pending: PendingItemsData) => {
    // Close the view modal first
    setViewingGrn(null);

    if (!pending.poId) {
      // Fallback: open a blank form and toast a hint
      setFormData((prev) => ({
        ...buildEmptyForm(),
        finYear: prev.finYear || activeFinYear || "",
      }));
      setEditingId(null);
      setShowForm(true);
      toast.info(
        `Open the form and select PO ${pending.poNo ?? ""} to create a follow-up GRN.`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setLoadingPO(true);
    try {
      const res = await fetchWithAuth(`/api/purchase-orders/${pending.poId}`);
      if (!res.ok) throw new Error("Failed to fetch PO details");
      const po = await res.json();

      // Same "what's left on this PO" logic used by the main form's
      // "Create GRN for Remaining Items" quick action — computed fresh
      // from the PO's own Ordered/ReceivedQty rather than the specific
      // pending-items snapshot passed in, so it reflects anything else
      // received against this PO since that snapshot was taken.
      const remaining = computeRemainingPOItems(po);
      const lineItems = buildGRNLineItemsFromRemaining(remaining);

      setFormData({
        ...buildEmptyForm(),
        poId: String(po.PurchaseOrderID ?? pending.poId),
        poNumber: po.PurchaseOrderNo ?? "",
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "remaining",
        supplierId: String(po.SupplierID ?? ""),
        supplierName: po.SupplierName ?? "",
        companyId: po.CompanyId ? String(po.CompanyId) : "",
        projectId: po.ProjectId ? String(po.ProjectId) : "",
        items: lineItems.length ? lineItems : [createEmptyItem()],
        docTypeId: null,
        parentDocNo: po.DocNo || po.PurchaseOrderNo || "",
        rootExBDocNo: po.RootExBDocNo || "",
        finYear: po.FinYearName || activeFinYear || "",
        poTotalAmount: Number(po.TotalAmount ?? 0),
        poSubtotalAmount: Number(po.SubtotalAmount ?? 0),
        poReceivedAmount: Number(po.POTotalReceived ?? 0),
      });
      setPoRemainingItems(remaining);
      setEditingId(null);
      setShowForm(true);
      setErrors({});
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success(
        `Form pre-filled with ${lineItems.length} remaining item${lineItems.length !== 1 ? "s" : ""} from ${pending.poNo ?? "PO"}`,
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to load PO details");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Validate ──────────────────────────────────────────────────────────────────
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.poId) errs.poId = "Purchase Order is required";
    // Two valid ways to source this GRN's items: a specific Vehicle
    // In/Out lot, or a direct "remaining items on this PO" quick-fill.
    if (!formData.vehicleInOutId && formData.grnSourceMode !== "remaining")
      errs.vehicleInOutId =
        "Select a Vehicle In/Out document, or use \"Create GRN for Remaining Items\"";
    if (!formData.supplierId)
      errs.supplierId = "Supplier could not be determined";
    if (formData.items.every((i) => i.receivedQty <= 0))
      errs.items = "Enter received quantity for at least one item";
    if (
      formData.items.some((i) => i.receivedQty > 0 && (!i.rate || i.rate <= 0))
    )
      errs.items = errs.items || "Enter a rate (₹) for each received item";
    if (
      formData.items.some(
        (i) => i.receivedQty > 0 && (!i.quantity || i.quantity <= 0),
      )
    )
      errs.items = errs.items || "Enter billing qty for each received item";
    // Received can't exceed what was actually ordered on the PO line —
    // matters most for the "remaining items" flow, where orderedQty is the
    // PO's own line quantity (the Vehicle In/Out flow already locks the
    // input to what the vehicle brought in, and the backend separately
    // rejects any GRN qty over that lot's own recorded quantity).
    const overOrdered = formData.items.find(
      (i) => i.orderedQty > 0 && i.receivedQty > i.orderedQty,
    );
    if (overOrdered)
      errs.items =
        errs.items ||
        `${overOrdered.itemName || "An item"}: received quantity (${overOrdered.receivedQty}) exceeds ordered quantity (${overOrdered.orderedQty})`;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = () => {
    if (!validate()) {
      toast.error("Please fix the errors");
      return;
    }
    const payload: GRNFormDataPayload = {
      grnNo: formData.grnNo || "",
      grnDate: formData.grnDate,
      docDate: formData.docDate,
      supplierId: Number(formData.supplierId),
      poId: Number(formData.poId) || 0,
      vehicleInOutId: formData.vehicleInOutId
        ? Number(formData.vehicleInOutId)
        : null,
      grnItems: formData.items,
      status: "Draft",
      remarks: formData.remarks,
      supplierName: formData.supplierName,
      poNumber: formData.poNumber,
      docNo: "",
      finYear: formData.finYear || null,
      parentDocNo: formData.parentDocNo || null,
      rootExBDocNo: formData.rootExBDocNo || null,
      projectId: formData.projectId ? Number(formData.projectId) : null,
      godownId: formData.godownId ? Number(formData.godownId) : null,
    };
    if (editingId) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  // ── Item helpers ──────────────────────────────────────────────────────────────
  const updateItemField = (
    index: number,
    field: "receivedQty" | "rate" | "quantity",
    value: number,
  ) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const current = { ...nextItems[index], [field]: value };
      if (field === "receivedQty") {
        current.remainingQty = round3(current.orderedQty - value);
        if (nextItems[index].quantity === nextItems[index].receivedQty)
          current.quantity = value;
      }
      current.totalAmount =
        Number(current.rate || 0) * Number(current.quantity || 0);
      current.gstAmount =
        current.totalAmount * (Number(current.gstPct || 0) / 100);
      nextItems[index] = current;
      return { ...prev, items: nextItems };
    });
  };

  const updateReceivedQty = (index: number, value: number) =>
    updateItemField(index, "receivedQty", value);

  // ── View / Edit ───────────────────────────────────────────────────────────────
  onView = async (grn: any) => {
    try {
      const res = await fetchWithAuth(`/api/grns/${grn.GRNID}`);
      if (!res.ok) throw new Error("Failed to fetch GRN details");
      setViewingGrn(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setViewingGrn(grn);
    }
  };

  // Deep-link support — Linked Documents panels navigate here as
  // /material/grn?view=<GRNID> to open this exact GRN.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    onView({ GRNID: Number(viewId) });
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  onEdit = async (grn: any) => {
    let fullGrn = grn;
    try {
      const res = await fetchWithAuth(`/api/grns/${grn.GRNID}`);
      if (res.ok) fullGrn = await res.json();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
    const parsedItems = parseJsonArray<GRNItemLine>(fullGrn.GRNItems).map(
      (item) => ({
        ...createEmptyItem(),
        ...item,
        orderedQty: Number(item.orderedQty || 0),
        receivedQty: Number(item.receivedQty || 0),
        remainingQty: Number(item.remainingQty || 0),
        rate: Number(item.rate || 0),
        quantity: Number(item.quantity || 0),
        totalAmount: Number(item.totalAmount || 0),
      }),
    );
    setSelectedFinYear("");
    setFormData({
      grnNo: fullGrn.GRNNo || "",
      grnDate: fullGrn.GRNDate ? String(fullGrn.GRNDate).slice(0, 10) : "",
      docDate: fullGrn.DocDate
        ? String(fullGrn.DocDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      supplierId: String(fullGrn.SupplierID || ""),
      supplierName: fullGrn.SupplierName || "",
      poId: String(fullGrn.POID || ""),
      poNumber: fullGrn.PONumber || "",
      vehicleInOutId: fullGrn.VehicleInOutID
        ? String(fullGrn.VehicleInOutID)
        : "",
      vehicleInOutDocNo: fullGrn.documentChain?.vehicleInOut?.docNo || "",
      grnSourceMode: fullGrn.VehicleInOutID ? "vehicleInOut" : "remaining",
      poTotalAmount: Number(fullGrn.POTotalAmount ?? 0),
      poSubtotalAmount: Number(fullGrn.POSubtotalAmount ?? 0),
      poReceivedAmount: Number(fullGrn.POTotalReceived ?? 0),
      remarks: fullGrn.Remarks || "",
      status: (fullGrn.Status as any) || "Draft",
      items: parsedItems.length ? parsedItems : [createEmptyItem()],
      docTypeId: fullGrn.DocTypeId ?? null,
      docNo: fullGrn.DocNo || "",
      parentDocNo: fullGrn.ParentDocNo || "",
      rootExBDocNo: fullGrn.RootExBDocNo || "",
      finYear: fullGrn.FinYear || "",
      companyId: String(fullGrn.CompanyId || ""),
      projectId: String(fullGrn.ProjectId || ""),
      godownId: fullGrn.GodownID ? String(fullGrn.GodownID) : "",
    });
    setEditingId(String(fullGrn.GRNID));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToGRNAmendLocal = (grn: any) => {
    navigate("/material/amendment-menu", {
      state: {
        prefill: {
          tab: "GRN",
          docId: String(grn.GRNID),
          docNo: grn.GRNNo,
          supplierName: grn.SupplierName,
          projectName: grn.ProjectName ?? "",
          companyName: grn.CompanyName ?? "",
          totalAmount: grn.TotalAmount ?? 0,
        },
      },
    });
  };
  goToGRNAmend = goToGRNAmendLocal;

  const resetForm = () => {
    setFormData(buildEmptyForm());
    setEditingId(null);
    setShowForm(false);
    setErrors({});
  };

  if (loadingGrns) {
    return (
      <div className="flex items-center gap-2.5 mt-8 text-muted-foreground text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        Loading GRNs…
      </div>
    );
  }

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], GRN_TEMPLATE_COLUMNS, "grn-template");
  };
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };
  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        toast.error("CSV is empty");
        return;
      }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  // ── Print a GRN — a standalone document opened in its own window rather
  // than window.print()'ing the live modal. The modal uses theme CSS
  // variables (bg-card, text-muted-foreground, ...) which don't have a
  // print-safe light-on-white override, so printing it directly produced
  // an unreadable page. This builds independent light-themed HTML instead,
  // same blob-URL pattern used by PurchaseOrderMaster.tsx / VehicleInOut.tsx.
  const handlePrintGRN = (
    grn: any,
    items: GRNItemLine[],
    subtotal: number,
    gstTotal: number,
  ) => {
    const grnNo = grn.GRNNo
      ? grn.GRNNo.startsWith("GRN-")
        ? grn.GRNNo
        : `GRN-${grn.GRNNo}`
      : "—";
    const total = subtotal + gstTotal;

    const itemRows = items
      .map(
        (it, i) => safeHtml`
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
        <td style="padding:8px 10px;font-weight:500;">${it.itemName || "—"}</td>
        <td style="padding:8px 10px;text-align:center;">${it.orderedQty ?? "—"}</td>
        <td style="padding:8px 10px;text-align:center;font-weight:600;">${it.receivedQty ?? "—"}</td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;">${it.uom || "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">₹${Number(it.rate || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="padding:8px 10px;text-align:center;">${it.gstPct ? it.gstPct + "%" : "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;">₹${Number(it.totalAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(grnNo)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; padding: 9px 10px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #4f46e5;margin-bottom:28px;">
    <div style="font-size:20px;font-weight:800;color:#4f46e5;">${escapeHtml(grn.CompanyName || "CivilierERP")}</div>
    <div style="text-align:right;">
      <div style="font-size:24px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">GOODS RECEIPT NOTE</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;color:#111827;margin-top:4px;">${escapeHtml(grnNo)}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:6px;">Date: <strong>${grn.GRNDate ? new Date(grn.GRNDate).toLocaleDateString("en-IN") : "—"}</strong></div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px;">
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Supplier</div>
      <div style="font-weight:700;font-size:13px;">${escapeHtml(grn.SupplierName || "—")}</div>
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Purchase Order</div>
      <div style="font-weight:700;font-size:13px;">${escapeHtml(grn.PONumber || "—")}</div>
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Company / Project</div>
      <div style="font-weight:600;font-size:13px;">${escapeHtml(grn.CompanyName || "—")}</div>
      <div style="font-size:11px;color:#374151;">${escapeHtml(grn.ProjectName || "—")}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center;">#</th>
        <th style="text-align:left;">Item</th>
        <th style="text-align:center;">Ordered</th>
        <th style="text-align:center;">Received</th>
        <th style="text-align:center;">UOM</th>
        <th style="text-align:right;">Rate (₹)</th>
        <th style="text-align:center;">GST %</th>
        <th style="text-align:right;">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-top:16px;">
    <table style="width:260px;border-collapse:collapse;">
      <tbody>
        <tr><td style="color:#6b7280;padding:5px 8px;">Subtotal (excl. GST)</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
        ${gstTotal > 0 ? `<tr><td style="color:#6b7280;padding:5px 8px;">GST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${gstTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>` : ""}
        <tr style="border-top:2px solid #4f46e5;">
          <td style="padding:8px;font-weight:800;font-size:14px;">Grand Total</td>
          <td style="text-align:right;padding:8px;font-family:monospace;font-weight:800;font-size:15px;color:#4f46e5;">₹${total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${grn.Remarks ? `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${escapeHtml(grn.Remarks)}</div></div>` : ""}

  <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank", "width=960,height=720");
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error("Pop-up blocked — please allow pop-ups for this site.");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  // ─── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "GRN"]} />
      <MaterialShell
        title="Goods Receipt Note"
        subtitle="Record goods received against purchase orders"
        icon={Truck}
        action={
          !showForm ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={grns as unknown as Record<string, unknown>[]}
                columns={GRN_EXPORT_COLUMNS}
                title="Goods Receipt Notes"
                filename="grn"
                disabled={!grns.length || !rights.canExport}
              />
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportFileChange}
                className="hidden"
              />
              <button
                onClick={handleDownloadTemplate}
                title="Download a blank CSV template"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                <span className="hidden sm:inline">
                  {importing ? "Importing..." : "Import CSV"}
                </span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setShowForm(true);
                    setEditingId(null);
                    setFormData(buildEmptyForm());
                    setErrors({});
                  }}
                  className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 inline-flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                >
                  <Plus size={13} /> New GRN
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  FORM                                                              */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {showForm && (
          <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
            {/* Form header — Finance Payment style with emerald theme */}
            <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <span className="text-emerald-500/40">|</span>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
                    <Truck size={12} className="text-emerald-400" />
                  </div>
                  <h2 className="text-sm font-heading font-bold text-foreground truncate">
                    {editingId
                      ? "Edit Goods Receipt Note"
                      : "New Goods Receipt Note"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* ── Section 1: Filters + PO ── */}
              <SectionCard>
                <SectionTitle
                  icon={Filter}
                  label="Filters & Purchase Order"
                  sub="Narrow the list, then select a PO"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {/* Fin Year */}
                  <div>
                    <FieldLabel>Financial Year</FieldLabel>
                    <div className="relative">
                      {/* Defaults to the active financial year but stays
                          editable — some GRNs are booked against a prior
                          year (e.g. late entries). */}
                      <select
                        value={selectedFinYear}
                        onChange={(e) => setSelectedFinYear(e.target.value)}
                        className={inpSel}
                      >
                        {finYearOptions.length === 0 && (
                          <option value="">Loading…</option>
                        )}
                        {finYearOptions.map((fy) => (
                          <option key={fy} value={fy}>
                            {fy}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Company */}
                  <div>
                    <FieldLabel>Company</FieldLabel>
                    <div className="relative">
                      <select
                        value={formData.companyId}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            companyId: e.target.value,
                            projectId: "",
                            poId: "",
                            poNumber: "",
                            supplierId: "",
                            supplierName: "",
                            items: [createEmptyItem()],
                            parentDocNo: "",
                            rootExBDocNo: "",
                          }))
                        }
                        className={inpSel}
                      >
                        <option value="">All Companies</option>
                        {(companiesData as any[]).map((c: any) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Project */}
                  <div>
                    <FieldLabel>
                      <span className="inline-flex items-center gap-1">
                        <FolderOpen size={9} />
                        Project
                      </span>
                    </FieldLabel>
                    <div className="relative">
                      <select
                        value={formData.projectId}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            projectId: e.target.value,
                            poId: "",
                            poNumber: "",
                            supplierId: "",
                            supplierName: "",
                            items: [createEmptyItem()],
                            parentDocNo: "",
                            rootExBDocNo: "",
                          }))
                        }
                        className={inpSel}
                      >
                        <option value="">All Projects</option>
                        {filteredProjects.map((p: any) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Godown — once a Project is picked, this is locked to
                      that project's own linked godown (auto-selected above
                      by findProjectGodownId) rather than letting the user
                      pick any godown company-wide. No project yet → falls
                      back to the full godown list so it isn't blocked. */}
                  <div>
                    <FieldLabel>
                      <span className="inline-flex items-center gap-1">
                        <Warehouse size={9} />
                        Godown
                      </span>
                    </FieldLabel>
                    <div className="relative">
                      {formData.projectId ? (
                        <div
                          className={`${inpSel} flex items-center gap-1.5 bg-muted/30 cursor-not-allowed`}
                          title="Locked to this project's linked godown"
                        >
                          <Lock size={11} className="text-muted-foreground shrink-0" />
                          <span className="truncate">
                            {formData.godownId
                              ? (godowns.find(
                                  (g: any) =>
                                    String(g.GodownID) === formData.godownId,
                                )?.GodownName ?? "Main Godown")
                              : "Main Godown"}
                          </span>
                        </div>
                      ) : (
                        <>
                          <select
                            value={formData.godownId}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                godownId: e.target.value,
                              }))
                            }
                            className={inpSel}
                          >
                            <option value="">Main Godown</option>
                            {godowns
                              .filter((g: any) => !g.IsMain)
                              .map((g: any) => (
                                <option key={g.GodownID} value={String(g.GodownID)}>
                                  {g.GodownName}
                                </option>
                              ))}
                          </select>
                          <ChevronDown
                            size={12}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                        </>
                      )}
                    </div>
                  </div>

                  {/* Purchase Order — spans 2 cols */}
                  <div className="sm:col-span-2">
                    <FieldLabel required>Purchase Order</FieldLabel>
                    <div className="relative">
                      <select
                        value={formData.poId}
                        onChange={(e) => handlePOSelect(e.target.value)}
                        disabled={!!editingId || loadingPO}
                        className={`${inpSel} ${!!editingId || loadingPO ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <option value="">
                          {loadingPO
                            ? "Loading…"
                            : pos.length === 0
                              ? "No POs for selected filters"
                              : "Select Purchase Order…"}
                        </option>
                        {pos.map((po) => (
                          <option key={po.value} value={po.value}>
                            {po.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                    {errors.poId && (
                      <p className="text-destructive text-[11px] mt-1">
                        {errors.poId}
                      </p>
                    )}
                    {loadingPO && (
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin inline-block" />
                        Loading PO details…
                      </p>
                    )}
                  </div>

                  {/* Vehicle In/Out — only shown once a PO is selected. One
                      of two ways to source this GRN's items: pick a Vehicle
                      In/Out lot linked to this PO that doesn't already have
                      a GRN, or use "Remaining Items" below instead. */}
                  {formData.poId && (
                    <div className="sm:col-span-2">
                      <FieldLabel required={formData.grnSourceMode !== "remaining"}>
                        Vehicle In/Out Document
                      </FieldLabel>
                      <div className="relative">
                        <select
                          value={formData.vehicleInOutId}
                          onChange={(e) =>
                            handleVehicleInOutSelect(e.target.value)
                          }
                          disabled={
                            !!editingId ||
                            loadingPO ||
                            loadingVehicleInOuts ||
                            formData.grnSourceMode === "remaining"
                          }
                          className={`${inpSel} ${!!editingId || loadingPO || loadingVehicleInOuts || formData.grnSourceMode === "remaining" ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                          <option value="">
                            {loadingVehicleInOuts
                              ? "Loading…"
                              : pendingVehicleInOuts.length === 0
                                ? "No pending Vehicle In/Out documents for this PO"
                                : "Select Vehicle In/Out…"}
                          </option>
                          {pendingVehicleInOuts.map((v) => (
                            <option
                              key={v.VehicleInOutID}
                              value={String(v.VehicleInOutID)}
                            >
                              {v.DocNo} — {v.VehicleNo || "No Vehicle No"}
                              {v.DocDate
                                ? ` (${new Date(v.DocDate).toLocaleDateString("en-IN")})`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={12}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                      {errors.vehicleInOutId && (
                        <p className="text-destructive text-[11px] mt-1">
                          {errors.vehicleInOutId}
                        </p>
                      )}
                      {formData.grnSourceMode === "remaining" && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Sourced from remaining PO items instead — clear it below to pick a Vehicle In/Out lot.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Remaining PO Items — the second way to raise a GRN
                    against this PO, grouped alongside the linked PO
                    itself rather than routed through a Vehicle In/Out
                    lot. Lets the same PO be split across as many GRNs as
                    needed as quantities trickle in. */}
                {formData.poId &&
                  !editingId &&
                  poRemainingItems.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/20">
                        <RotateCcw
                          size={12}
                          className="text-emerald-600/80 dark:text-emerald-400/80 shrink-0"
                        />
                        <span className="text-xs font-semibold text-foreground">
                          Remaining Items on this PO
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {countRemainingItems(poRemainingItems)} of{" "}
                          {poRemainingItems.length} item
                          {poRemainingItems.length !== 1 ? "s" : ""} left
                        </span>
                      </div>
                      {hasRemainingItems(poRemainingItems) ? (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/10 border-b border-border">
                                  <th className="px-3 py-2 text-left text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                                    Item
                                  </th>
                                  <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                                    Ordered
                                  </th>
                                  <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                                    Received
                                  </th>
                                  <th className="px-3 py-2 text-right text-[10px] font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                    Remaining
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {poRemainingItems
                                  .filter((it) => it.remainingQty > 1e-6)
                                  .map((it, idx) => (
                                    <tr key={idx}>
                                      <td className="px-3 py-1.5 font-medium text-foreground max-w-[200px] truncate">
                                        {it.itemName || `Item ${idx + 1}`}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                        {it.orderedQty}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                        {it.receivedQty}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                        {it.remainingQty}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="px-4 py-2.5 border-t border-border">
                            <button
                              type="button"
                              onClick={handleUseRemainingItems}
                              disabled={
                                loadingPO ||
                                formData.grnSourceMode === "vehicleInOut"
                              }
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                                formData.grnSourceMode === "remaining"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default"
                                  : formData.grnSourceMode === "vehicleInOut"
                                    ? "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                                    : "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                              }`}
                            >
                              {formData.grnSourceMode === "remaining" ? (
                                <>
                                  <CheckCircle2 size={13} /> Using Remaining Items
                                </>
                              ) : (
                                <>
                                  <CopyPlus size={13} /> Create GRN for Remaining Items
                                </>
                              )}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="px-4 py-4 text-center text-xs text-muted-foreground">
                          Fully received — no quantity left to receive on this PO.
                        </div>
                      )}
                    </div>
                  )}

                {/* Autofilled chips */}
                {formData.poId && !loadingPO && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <InfoPill label="Supplier" value={formData.supplierName} />
                    <InfoPill label="PO No" value={formData.poNumber} mono />
                    <InfoPill label="Fin Year" value={formData.finYear} />
                    {formData.vehicleInOutDocNo && (
                      <InfoPill
                        label="Vehicle In/Out"
                        value={formData.vehicleInOutDocNo}
                        mono
                      />
                    )}
                    {formData.projectId && (
                      <InfoPill
                        label="Project"
                        value={
                          (filteredProjects as any[]).find(
                            (p: any) => String(p.id) === formData.projectId,
                          )?.name || ""
                        }
                      />
                    )}
                  </div>
                )}
              </SectionCard>

              {/* ── Section 2: Dates + GRN Number ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <FieldLabel>GRN Date</FieldLabel>
                  <div className="relative">
                    <Calendar
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="date"
                      value={formData.grnDate}
                      max={today}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val > today) return; // reject future dates
                        setFormData((prev) => ({ ...prev, grnDate: val }));
                      }}
                      className={`${inp} pl-9`}
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel>Doc Date</FieldLabel>
                  <div className="relative">
                    <Calendar
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="date"
                      value={formData.docDate}
                      max={today}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val > today) return; // reject future dates
                        setFormData((prev) => ({ ...prev, docDate: val }));
                      }}
                      className={`${inp} pl-9`}
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel>GRN Number</FieldLabel>
                  <div className="flex items-center gap-2 px-3 h-[38px] rounded-lg bg-muted/40 border border-dashed border-border">
                    <Hash
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    {editingId && formData.grnNo ? (
                      <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                        {formData.grnNo}
                      </span>
                    ) : grnNumberPreview?.nextDocNo ? (
                      <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                        {grnNumberPreview.nextDocNo}
                      </span>
                    ) : loadingPreview ? (
                      <span className="text-sm text-muted-foreground/60 animate-pulse">
                        Generating…
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground/40 italic">
                        Auto-generated on save
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Section 3: Items Table ── */}
              <SectionCard>
                <SectionTitle
                  icon={Package}
                  label="Received Items"
                  sub={
                    formData.poId
                      ? `${formData.items.length} item${formData.items.length !== 1 ? "s" : ""} from PO`
                      : "Select a PO above"
                  }
                />

                {errors.items && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                    <AlertCircle size={12} />
                    {errors.items}
                  </div>
                )}

                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {!formData.poId ? (
                    <div className="border-2 border-dashed border-border rounded-xl py-10 text-center text-muted-foreground/40 text-sm italic">
                      Select a Purchase Order above
                    </div>
                  ) : (
                    formData.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="border border-border rounded-xl p-4 space-y-3 bg-muted/20"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">
                            {item.itemName || "—"}
                          </span>
                          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {item.uom || "—"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          {[
                            ["Ordered", String(item.orderedQty), ""],
                            [
                              "Pending Qty",
                              fmtQty(item.remainingQty),
                              item.remainingQty > 0
                                ? "text-amber-500"
                                : "text-green-500",
                            ],
                            [
                              "Total",
                              item.totalAmount > 0
                                ? `₹${fmt(item.totalAmount)}`
                                : "—",
                              "text-emerald-600 dark:text-emerald-400 font-bold",
                            ],
                          ].map(([l, v, c]) => (
                            <div key={l}>
                              <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                {l}
                              </p>
                              <p className={`font-semibold ${c}`}>{v}</p>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {(["receivedQty", "rate", "quantity"] as const).map(
                            (field) => (
                              <div key={field}>
                                <label className="block text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                                  {field === "receivedQty"
                                    ? "Received"
                                    : field === "rate"
                                      ? "Rate ₹"
                                      : "Qty Bill"}
                                  <span className="text-destructive ml-0.5">
                                    *
                                  </span>
                                </label>
                                {formData.grnSourceMode === "vehicleInOut" ? (
                                  <div
                                    className={`${inp} text-right text-xs flex items-center justify-end gap-1 bg-muted/30`}
                                    title="Locked to the quantity recorded on the selected Vehicle In/Out"
                                  >
                                    <Lock size={10} className="text-muted-foreground shrink-0" />
                                    {field === "receivedQty"
                                      ? item.receivedQty
                                      : field === "rate"
                                        ? item.rate
                                        : item.quantity}
                                  </div>
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    step={
                                      field !== "receivedQty" ? "0.01" : "0.001"
                                    }
                                    value={
                                      field === "receivedQty"
                                        ? item.receivedQty
                                        : field === "rate"
                                          ? item.rate
                                          : item.quantity
                                    }
                                    onChange={(e) =>
                                      updateItemField(
                                        idx,
                                        field,
                                        Number(e.target.value),
                                      )
                                    }
                                    className={`${inp} text-right text-xs`}
                                  />
                                )}
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {formData.poId && grnTotalWithGST > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/20">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          GRN Total (this receipt)
                        </span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          ₹{fmt(grnTotalWithGST)}
                        </span>
                      </div>
                      {formData.poTotalAmount > 0 &&
                        (() => {
                          const diff =
                            formData.poTotalAmount -
                            formData.poReceivedAmount -
                            grnTotalWithGST;
                          return (
                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="flex flex-col px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
                                <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                  PO Value (incl. GST)
                                </span>
                                <span className="text-xs font-semibold text-foreground">
                                  ₹{fmt(formData.poTotalAmount)}
                                </span>
                              </div>
                              {formData.poReceivedAmount > 0 && (
                                <div className="flex flex-col px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
                                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Already Received
                                  </span>
                                  <span className="text-xs font-semibold text-foreground">
                                    ₹{fmt(formData.poReceivedAmount)}
                                  </span>
                                </div>
                              )}
                              <div
                                className={`flex flex-col px-3 py-2.5 rounded-xl border ${diff > 0.005 ? "bg-amber-500/10 border-amber-500/30" : "bg-green-500/10 border-green-500/30"}`}
                              >
                                <span className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                  Balance on PO
                                </span>
                                <span
                                  className={`text-xs font-semibold ${diff > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                                >
                                  {diff > 0.005
                                    ? `₹${fmt(diff)}`
                                    : "Fully received"}
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: "20%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "16%" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        {[
                          { h: "Item", align: "text-left" },
                          { h: "Ordered", align: "text-right" },
                          { h: "Received *", align: "text-right" },
                          { h: "Pending Qty", align: "text-right" },
                          { h: "UOM", align: "text-left" },
                          { h: "Rate (₹) *", align: "text-right" },
                          { h: "Qty Bill *", align: "text-right" },
                          { h: "Total (₹)", align: "text-right" },
                        ].map(({ h, align }) => (
                          <th
                            key={h}
                            className={`px-3 py-2.5 ${align} text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap`}
                          >
                            {h.replace(" *", "")}
                            {h.includes("*") && (
                              <span className="text-destructive ml-0.5">*</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {!formData.poId ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-12 text-center text-muted-foreground/40 text-sm italic"
                          >
                            Select a Purchase Order above — items will autofill
                            from the PO
                          </td>
                        </tr>
                      ) : (
                        formData.items.map((item, idx) => (
                          <tr
                            key={idx}
                            className="hover:bg-muted/20 transition-colors"
                          >
                            <td className="px-3 py-2.5">
                              <span className="text-xs font-medium text-foreground">
                                {item.itemName || "—"}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                              {item.orderedQty}
                            </td>
                            <td className="px-1.5 py-1.5">
                              {formData.grnSourceMode === "vehicleInOut" ? (
                                <span
                                  className="flex items-center justify-end gap-1 text-xs font-medium text-foreground pr-2 py-1.5"
                                  title="Locked to the quantity recorded on the selected Vehicle In/Out"
                                >
                                  <Lock size={10} className="text-muted-foreground shrink-0" />
                                  {item.receivedQty}
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={item.orderedQty || undefined}
                                  step="0.001"
                                  value={item.receivedQty}
                                  onChange={(e) =>
                                    updateReceivedQty(idx, Number(e.target.value))
                                  }
                                  className={`${inp} text-right text-xs py-1.5`}
                                />
                              )}
                            </td>
                            <td
                              className={`px-2 py-2 text-right text-xs font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                            >
                              {fmtQty(item.remainingQty)}
                            </td>
                            <td className="px-2 py-2 text-xs text-muted-foreground">
                              {item.uom || "—"}
                            </td>
                            <td className="px-1.5 py-1.5">
                              {formData.grnSourceMode === "vehicleInOut" ? (
                                <span
                                  className="flex items-center justify-end gap-1 text-xs font-medium text-foreground pr-2 py-1.5"
                                  title="Locked to the quantity recorded on the selected Vehicle In/Out"
                                >
                                  <Lock size={10} className="text-muted-foreground shrink-0" />
                                  {item.rate}
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.rate}
                                  onChange={(e) =>
                                    updateItemField(
                                      idx,
                                      "rate",
                                      Number(e.target.value),
                                    )
                                  }
                                  className={`${inp} text-right text-xs py-1.5`}
                                  placeholder="0.00"
                                />
                              )}
                            </td>
                            <td className="px-1.5 py-1.5">
                              {formData.grnSourceMode === "vehicleInOut" ? (
                                <span
                                  className="flex items-center justify-end gap-1 text-xs font-medium text-foreground pr-2 py-1.5"
                                  title="Locked to the quantity recorded on the selected Vehicle In/Out"
                                >
                                  <Lock size={10} className="text-muted-foreground shrink-0" />
                                  {item.quantity}
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    updateItemField(
                                      idx,
                                      "quantity",
                                      Number(e.target.value),
                                    )
                                  }
                                  className={`${inp} text-right text-xs py-1.5`}
                                  placeholder="0"
                                />
                              )}
                            </td>
                            <td className="px-2 py-2 text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              {item.totalAmount > 0
                                ? `₹${fmt(item.totalAmount)}`
                                : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {formData.poId && grnTotalWithGST > 0 && (
                      <tfoot>
                        <tr className="bg-emerald-500/[0.05] border-t-2 border-emerald-500/20">
                          <td
                            colSpan={7}
                            className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            GRN Total (this receipt)
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                            ₹{fmt(grnTotalWithGST)}
                          </td>
                        </tr>
                        {formData.poTotalAmount > 0 &&
                          (() => {
                            const diff =
                              formData.poTotalAmount -
                              formData.poReceivedAmount -
                              grnTotalWithGST;
                            return (
                              <>
                                <tr className="bg-muted/30 border-t border-border/50">
                                  <td
                                    colSpan={7}
                                    className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                  >
                                    PO Value (incl. GST)
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                                    ₹{fmt(formData.poTotalAmount)}
                                  </td>
                                </tr>
                                {formData.poReceivedAmount > 0 && (
                                  <tr className="bg-muted/20 border-t border-border/50">
                                    <td
                                      colSpan={7}
                                      className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                    >
                                      Already Received
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                                      −₹{fmt(formData.poReceivedAmount)}
                                    </td>
                                  </tr>
                                )}
                                <tr
                                  className={
                                    diff > 0.005
                                      ? "bg-amber-500/10 border-t border-amber-500/20"
                                      : "bg-green-500/10 border-t border-green-500/20"
                                  }
                                >
                                  <td
                                    colSpan={7}
                                    className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                  >
                                    Balance on PO
                                  </td>
                                  <td
                                    className={`px-4 py-2 text-right text-xs font-bold ${diff > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                                  >
                                    {diff > 0.005
                                      ? `₹${fmt(diff)}`
                                      : "Fully received"}
                                  </td>
                                </tr>
                              </>
                            );
                          })()}
                      </tfoot>
                    )}
                  </table>
                </div>
              </SectionCard>

              {/* ── Remarks ── */}
              <div>
                <FieldLabel>Remarks</FieldLabel>
                <textarea
                  value={formData.remarks}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, remarks: e.target.value }))
                  }
                  rows={3}
                  className={`${inp} resize-y`}
                  placeholder="Additional notes…"
                />
              </div>

              {/* ── Actions ── */}
              {(() => {
                const isSaving =
                  createMutation.isPending || updateMutation.isPending;
                const canSave =
                  !!formData.poId &&
                  !!formData.supplierId &&
                  formData.items.some((i) => i.receivedQty > 0);
                const isDirty =
                  formData.poId !== "" ||
                  formData.remarks !== "" ||
                  formData.godownId !== "" ||
                  formData.projectId !== "" ||
                  formData.docNo !== "" ||
                  formData.items.some((i) => i.receivedQty > 0 || i.rate > 0);
                return (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
                    <p className="text-[11px] text-muted-foreground hidden sm:block">
                      {canSave ? (
                        <span className="text-emerald-500 font-medium">
                          Ready to save
                        </span>
                      ) : (
                        "Fill in the required fields to save"
                      )}
                    </p>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <button
                        onClick={() => {
                          setFormData(buildEmptyForm());
                          setEditingId(null);
                          setErrors({});
                        }}
                        disabled={!isDirty || isSaving}
                        className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw size={12} /> Reset
                      </button>
                      <button
                        onClick={onSubmit}
                        disabled={!canSave || isSaving}
                        className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                      >
                        {isSaving ? (
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Save size={14} />
                        )}
                        {isSaving
                          ? "Saving…"
                          : editingId
                            ? "Update GRN"
                            : "Save GRN"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  GRN HISTORY                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {!showForm && (
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      GRN Register
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {totalRecords} record{totalRecords !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <Input
                      placeholder="Search GRN, PO, Supplier…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["All", "Pending", "Approved", "Booked", "Rejected"].map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setGrnStatusFilter(s)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${grnStatusFilter === s ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white border-transparent shadow-sm" : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"}`}
                      >
                        {s}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredGrns.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-10">
                  No GRNs found. Click 'New GRN' to create one.
                </p>
              ) : (
                groupedGrns.map((group) => {
                  const collapsed = !!collapsedGrnGroups[group.key];
                  return (
                    <div
                      key={group.key}
                      className="border-b border-border last:border-0"
                    >
                      {/* Group header — one PO's GRNs grouped together */}
                      <button
                        type="button"
                        onClick={() => toggleGrnGroup(group.key)}
                        className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                      >
                        {collapsed ? (
                          <ChevronRight
                            size={14}
                            className="text-muted-foreground shrink-0"
                          />
                        ) : (
                          <ChevronDown
                            size={14}
                            className="text-muted-foreground shrink-0"
                          />
                        )}
                        <FileText size={13} className="text-primary shrink-0" />
                        <span className="text-sm font-heading font-semibold text-foreground">
                          {group.poNumber || "No PO Linked"}
                        </span>
                        {group.supplierName && (
                          <span className="text-xs text-muted-foreground truncate">
                            · {group.supplierName}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {group.rows.length} GRN
                          {group.rows.length !== 1 ? "s" : ""}
                        </span>
                      </button>

                      {!collapsed && (
                        <div
                          className={`overflow-x-auto transition-opacity duration-200 ${fetchingGrns ? "opacity-60 pointer-events-none" : ""}`}
                        >
                          <DataTable
                            data={group.rows}
                            columns={GRN_LIST_COLUMNS}
                            searchable={false}
                            paginated={false}
                            emptyMessage="No GRNs found."
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span>
                  Page {page} of {totalPages} · {totalRecords} record
                  {totalRecords !== 1 ? "s" : ""}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page >= totalPages}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </MaterialShell>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/*  VIEW MODAL                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {viewingGrn &&
        (() => {
          // Only lines actually received — a GRN sourced from "remaining
          // items" can be saved with some lines still at 0 (the user chose
          // not to receive them in this lot), and those shouldn't show up
          // in a "Received Items" list.
          const items = parseJsonArray<GRNItemLine>(viewingGrn.GRNItems).filter(
            (i) => Number(i.receivedQty) > 0,
          );
          const subtotal = items.reduce(
            (s, i) => s + (Number(i.totalAmount) || 0),
            0,
          );
          const gstTotal = items.reduce(
            (s, i) => s + (Number(i.gstAmount) || 0),
            0,
          );
          const subtotalInclGST = subtotal + gstTotal;
          return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
              <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
                {/* Modal header */}
                <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-border">
                  <div>
                    <h2 className="font-heading font-bold text-base">
                      {viewingGrn.GRNNo
                        ? viewingGrn.GRNNo.startsWith("GRN-")
                          ? viewingGrn.GRNNo
                          : `GRN-${viewingGrn.GRNNo}`
                        : "—"}
                    </h2>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                      Goods Receipt Note
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {rights.canPrint && (
                      <button
                        onClick={() =>
                          handlePrintGRN(viewingGrn, items, subtotal, gstTotal)
                        }
                        title="Print GRN"
                        className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground print:hidden"
                      >
                        <Printer size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setViewingGrn(null);
                        setViewModalTab("details");
                      }}
                      className="p-2 hover:bg-muted rounded-lg transition-colors print:hidden"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                {/* ── Tab bar ─────────────────────────────────────────── */}
                <div className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-border bg-card print:hidden">
                  {(["details", "posting"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setViewModalTab(tab)}
                      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors capitalize
                          ${
                            viewModalTab === tab
                              ? "border-primary text-primary bg-primary/5"
                              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                          }`}
                    >
                      {tab === "details" ? (
                        <FileText size={12} />
                      ) : (
                        <Landmark size={12} />
                      )}
                      {tab === "details" ? "Details" : "Posting"}
                    </button>
                  ))}
                </div>
                {/* ── Details tab ─────────────────────────────────────── */}
                {viewModalTab === "details" && (
                  <div className="p-5 sm:p-6 space-y-6">
                    {/* Meta grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        {
                          label: "Doc No",
                          value: viewingGrn.DocNo || viewingGrn.GRNNo || "—",
                          mono: true,
                        },
                        {
                          label: "Date",
                          value: viewingGrn.GRNDate
                            ? new Date(viewingGrn.GRNDate).toLocaleDateString(
                                "en-IN",
                              )
                            : "—",
                        },
                        {
                          label: "Supplier",
                          value: viewingGrn.SupplierName || "—",
                        },
                        {
                          label: "Purchase Order",
                          value: viewingGrn.PONumber || "—",
                        },
                        {
                          label: "Company",
                          value: viewingGrn.CompanyName || "—",
                        },
                        {
                          label: "Project",
                          value: viewingGrn.ProjectName || "—",
                        },
                        ...(viewingGrn.SourceMRDocNo
                          ? [
                              {
                                label: "Source MR",
                                value: viewingGrn.SourceMRDocNo,
                                mono: true,
                                color: "text-emerald-600 dark:text-emerald-400",
                              },
                            ]
                          : []),
                        ...(viewingGrn.SourceWODocNo
                          ? [
                              {
                                label: "Source WO",
                                value: viewingGrn.SourceWODocNo,
                                mono: true,
                                color: "text-orange-600 dark:text-orange-400",
                              },
                            ]
                          : []),
                        ...(viewingGrn.SourceWDDocNo
                          ? [
                              {
                                label: "Source WD",
                                value: viewingGrn.SourceWDDocNo,
                                mono: true,
                                color: "text-orange-600 dark:text-orange-400",
                              },
                            ]
                          : []),
                        ...(viewingGrn.VehicleInOutDocNo
                          ? [
                              {
                                label: "Vehicle In/Out",
                                value: viewingGrn.VehicleInOutVehicleNo
                                  ? `${viewingGrn.VehicleInOutDocNo} — ${viewingGrn.VehicleInOutVehicleNo}`
                                  : viewingGrn.VehicleInOutDocNo,
                                mono: true,
                                color: "text-sky-600 dark:text-sky-400",
                              },
                            ]
                          : []),
                      ].map(({ label, value, mono, color }: any) => (
                        <div
                          key={label}
                          className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50"
                        >
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                            {label}
                          </p>
                          <p
                            className={`text-xs font-semibold ${mono ? "font-mono" : ""} ${color || "text-foreground"}`}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <DocumentChainPanel docType="grn" id={viewingGrn.GRNID} />

                    {/* Items */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
                        Received Items
                      </p>

                      {/* Mobile */}
                      <div className="md:hidden space-y-3">
                        {items.length ? (
                          items.map((item, i) => (
                            <div
                              key={i}
                              className="border border-border rounded-xl p-4 space-y-2 bg-muted/20"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm">
                                  {item.itemName || "—"}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {item.uom || "—"}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                                {[
                                  ["Ordered", String(item.orderedQty), ""],
                                  [
                                    "Received",
                                    String(item.receivedQty),
                                    "font-semibold",
                                  ],
                                  [
                                    "Pending Qty",
                                    fmtQty(item.remainingQty),
                                    item.remainingQty > 0
                                      ? "text-amber-500 font-semibold"
                                      : "text-green-500 font-semibold",
                                  ],
                                ].map(([l, v, c]) => (
                                  <div key={l}>
                                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                      {l}
                                    </p>
                                    <p className={c}>{v}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-1 border-t border-border">
                                <div>
                                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Rate
                                  </p>
                                  <p>
                                    {item.rate
                                      ? `₹${fmt(Number(item.rate))}`
                                      : "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Qty Bill
                                  </p>
                                  <p>{item.quantity ?? "—"}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                                    Total
                                  </p>
                                  <p className="font-bold text-emerald-600 dark:text-emerald-400">
                                    {item.totalAmount
                                      ? `₹${fmt(Number(item.totalAmount))}`
                                      : "—"}
                                  </p>
                                </div>
                              </div>
                              {rights.canEdit && item.receivedQty > 0 && (
                                <button
                                  onClick={() => {
                                    setDebitNoteLine({ index: i, item });
                                    setDebitNoteQty("");
                                    setDebitNoteReason("");
                                  }}
                                  title="Raise a debit note if part of this line was found below the ordered grade"
                                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500/25 text-rose-600 dark:text-rose-400 text-[11px] font-semibold hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors"
                                >
                                  <FileWarning size={12} /> Raise Debit Note
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-muted-foreground text-sm py-6">
                            No items
                          </p>
                        )}
                      </div>

                      {/* Desktop */}
                      <div className="hidden md:block border border-border rounded-xl overflow-x-auto">
                        <table className="w-full text-sm min-w-[680px]">
                          <thead>
                            <tr className="bg-muted/50 border-b border-border">
                              {[
                                "Item",
                                "UOM",
                                "Ordered",
                                "Received",
                                "Pending Qty",
                                "Rate (₹)",
                                "Qty",
                                "Total (₹)",
                                "",
                              ].map((h) => (
                                <th
                                  key={h}
                                  className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground ${h === "Item" || h === "UOM" || h === "" ? "text-left" : "text-right"}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {items.length ? (
                              items.map((item, i) => (
                                <tr
                                  key={i}
                                  className="hover:bg-muted/20 transition-colors"
                                >
                                  <td className="px-3 py-2.5 font-medium text-xs">
                                    {item.itemName || "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                                    {item.uom || "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                    {item.orderedQty}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs font-semibold">
                                    {item.receivedQty}
                                  </td>
                                  <td
                                    className={`px-3 py-2.5 text-right text-xs font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                                  >
                                    {fmtQty(item.remainingQty)}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                    {item.rate
                                      ? `₹${fmt(Number(item.rate))}`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                                    {item.quantity ?? "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                    {item.totalAmount
                                      ? `₹${fmt(Number(item.totalAmount))}`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    {rights.canEdit && item.receivedQty > 0 && (
                                      <button
                                        onClick={() => {
                                          setDebitNoteLine({ index: i, item });
                                          setDebitNoteQty("");
                                          setDebitNoteReason("");
                                        }}
                                        title="Raise a debit note if part of this line was found below the ordered grade"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-rose-500/25 text-rose-600 dark:text-rose-400 text-[11px] font-semibold hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors whitespace-nowrap"
                                      >
                                        <FileWarning size={12} /> Debit Note
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={9}
                                  className="px-4 py-6 text-center text-muted-foreground text-sm"
                                >
                                  No items
                                </td>
                              </tr>
                            )}
                          </tbody>
                          {subtotalInclGST > 0 && (
                            <tfoot>
                              <tr className="bg-emerald-500/[0.05] border-t-2 border-emerald-500/20">
                                <td
                                  colSpan={8}
                                  className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                >
                                  GRN Total (received)
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                  ₹{fmt(subtotalInclGST)}
                                </td>
                              </tr>
                              {Number(viewingGrn.POTotalAmount) > 0 &&
                                (() => {
                                  const poTotal = Number(
                                    viewingGrn.POTotalAmount,
                                  );
                                  const diff = poTotal - subtotalInclGST;
                                  return (
                                    <>
                                      <tr className="bg-muted/30 border-t border-border/50">
                                        <td
                                          colSpan={8}
                                          className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                        >
                                          PO Value (incl. GST)
                                        </td>
                                        <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                                          ₹{fmt(poTotal)}
                                        </td>
                                      </tr>
                                      <tr
                                        className={
                                          diff > 0.005
                                            ? "bg-amber-500/10 border-t border-amber-500/20"
                                            : "bg-green-500/10 border-t border-green-500/20"
                                        }
                                      >
                                        <td
                                          colSpan={8}
                                          className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                                        >
                                          Balance on PO
                                        </td>
                                        <td
                                          className={`px-4 py-2 text-right text-xs font-bold ${diff > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                                        >
                                          {diff > 0.005
                                            ? `₹${fmt(diff)}`
                                            : "Fully received"}
                                        </td>
                                      </tr>
                                    </>
                                  );
                                })()}
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>

                    {/* GST Breakdown */}
                    {(() => {
                      if (subtotal <= 0 || gstTotal <= 0) return null;

                      // Group by gstPct so lines with same rate are merged
                      const rateMap = new Map<number, number>();
                      items.forEach((i) => {
                        const pct = Number(i.gstPct || 0);
                        const amt = Number(i.gstAmount || 0);
                        if (pct > 0 && amt > 0)
                          rateMap.set(pct, (rateMap.get(pct) ?? 0) + amt);
                      });

                      if (rateMap.size === 0) return null;

                      return (
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
                            GST Breakdown
                          </p>
                          <div className="border border-border rounded-xl overflow-hidden text-sm">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
                              <span className="text-xs text-muted-foreground">
                                Subtotal (before GST)
                              </span>
                              <span className="font-medium">
                                ₹{fmt(subtotal)}
                              </span>
                            </div>
                            {Array.from(rateMap.entries()).map(
                              ([rate, amount], idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between px-4 py-2.5 border-b border-border"
                                >
                                  <span className="text-xs text-muted-foreground">
                                    GST{" "}
                                    <span className="font-mono text-[10px] bg-muted px-1 rounded">
                                      {rate}%
                                    </span>
                                  </span>
                                  <span className="font-medium text-amber-600 dark:text-amber-400">
                                    +₹{fmt(amount)}
                                  </span>
                                </div>
                              ),
                            )}
                            <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/[0.05] border-t-2 border-emerald-500/20">
                              <span className="text-xs font-semibold uppercase tracking-widest">
                                Grand Total (incl. GST)
                              </span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                ₹{fmt(subtotalInclGST)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Linked Expense Bookings */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                        <Receipt
                          size={10}
                          className="text-emerald-600 dark:text-emerald-400"
                        />{" "}
                        Linked Expense Bookings
                      </p>
                      <LinkedExpenseBookings grnId={viewingGrn.GRNID} />
                    </div>

                    {/* Remaining Items — not yet expense-booked */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                        <AlertTriangle size={10} className="text-amber-500" />{" "}
                        Remaining Items
                      </p>
                      <RemainingItemsPanel
                        grnId={viewingGrn.GRNID}
                        onCreateNewGRN={handleCreateGRNFromRemaining}
                      />
                    </div>

                    {/* Remarks */}
                    {viewingGrn.Remarks && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                          Remarks
                        </p>
                        <p className="text-sm text-foreground bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
                          {viewingGrn.Remarks}
                        </p>
                      </div>
                    )}
                  </div>
                )}{" "}
                {/* end details tab */}
                {/* ── Posting tab ─────────────────────────────────────── */}
                {viewModalTab === "posting" && (
                  <div className="p-5 sm:p-6 space-y-4">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BookOpen size={14} className="text-primary" />
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Journal Entry — GRN Posting
                        </span>
                      </div>
                      {grnPostingLoading ? (
                        <span className="text-[10px] text-muted-foreground">Loading…</span>
                      ) : grnPostingData?.isPosted ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                          Posted · {grnPostingData.jvNo}
                        </span>
                      ) : null}
                    </div>

                    {/* Debit / Credit table */}
                    {grnPostingLoading ? (
                      <div className="rounded-xl border border-border py-10 text-center text-xs text-muted-foreground">
                        Loading posting details…
                      </div>
                    ) : !grnPostingData ? (
                      <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
                        Could not load posting data.
                      </div>
                    ) : (() => {
                      const { baseAmount, taxAmount, costCentre, accounts } = grnPostingData;
                      const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      type PostRow = { key: string; label: string; code: string | null; side: "debit" | "credit"; amount: number };
                      // Base and tax post as two separate self-balancing
                      // pairs: Purchase Dr (base) = PGRN Cr (base), and
                      // Provisional Credit Dr (tax) = Purchase Cr (tax) — a
                      // same-account repetition rather than crediting PGRN
                      // with the GST-inclusive total. Mirrors backend
                      // /post-to-gl's `lines` construction exactly.
                      const rows: PostRow[] = [
                        { key: "purchase-base", label: accounts?.purchase?.label ?? "Purchase A/c", code: accounts?.purchase?.code ?? null, side: "debit", amount: baseAmount },
                        { key: "pgrn", label: accounts?.pgrn?.label ?? "Provision for Pending GRN A/c", code: accounts?.pgrn?.code ?? null, side: "credit", amount: baseAmount },
                        ...(taxAmount > 0
                          ? [
                              { key: "provisional", label: accounts?.provisional?.label ?? "Provisional Credit Available", code: accounts?.provisional?.code ?? null, side: "debit" as const, amount: taxAmount },
                              { key: "purchase-tax", label: accounts?.purchase?.label ?? "Purchase A/c", code: accounts?.purchase?.code ?? null, side: "credit" as const, amount: taxAmount },
                            ]
                          : []),
                      ];
                      const totalDebit = rows.filter(r => r.side === "debit").reduce((s, r) => s + r.amount, 0);
                      const totalCredit = rows.filter(r => r.side === "credit").reduce((s, r) => s + r.amount, 0);
                      return (
                        <div className="rounded-xl border border-border overflow-hidden">
                          <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr] bg-muted/40 border-b border-border px-2 sm:px-4 py-2.5 text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground font-semibold gap-1 sm:gap-2">
                            <span>Account</span>
                            <span className="text-center">Cost Centre</span>
                            <span className="text-right">Debit (₹)</span>
                            <span className="text-right">Credit (₹)</span>
                          </div>
                          {rows.map((row) => (
                            <div
                              key={row.key}
                              className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr] px-2 sm:px-4 py-3 border-b border-border/50 last:border-b-0 items-center gap-1 sm:gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.side === "debit" ? "bg-emerald-500" : "bg-rose-500"}`} />
                                <span className="text-[11px] sm:text-xs text-foreground break-words sm:truncate min-w-0" title={row.code ? `${row.label} (${row.code})` : row.label}>
                                  {row.label}{row.code ? ` (${row.code})` : ""}
                                </span>
                              </div>
                              <span className="text-[11px] text-muted-foreground text-center truncate">{costCentre?.name || "—"}</span>
                              <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">
                                {row.side === "debit" ? fmt(row.amount) : ""}
                              </span>
                              <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">
                                {row.side === "credit" ? fmt(row.amount) : ""}
                              </span>
                            </div>
                          ))}
                          <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr] px-2 sm:px-4 py-3 bg-muted/30 border-t-2 border-border text-xs font-bold gap-1 sm:gap-2">
                            <span className="uppercase tracking-widest text-muted-foreground text-[10px]">Total</span>
                            <span />
                            <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmt(totalDebit)}</span>
                            <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmt(totalCredit)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Posted / auto-posting status — posting happens
                        automatically the moment this tab's data loads, no
                        manual "Post to GL" click required. */}
                    {!grnPostingLoading && grnPostingData && (
                      grnPostingData.isPosted ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                          <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                          <p className="text-xs text-emerald-700 dark:text-emerald-400">
                            Posted to General Ledger as <span className="font-semibold">{grnPostingData.jvNo}</span>. Entries are visible in the Trial Balance.
                          </p>
                        </div>
                      ) : grnPostingError ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                          <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                          <p className="text-xs text-destructive">
                            Auto-posting failed: {grnPostingError}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          <p className="text-xs text-muted-foreground">
                            Posting to General Ledger…
                          </p>
                        </div>
                      )
                    )}
                  </div>
                )}{" "}
                {/* end posting tab */}
              </div>
            </div>
          );
        })()}

      {/* ── Raise Debit Note modal (quality rejection against a GRN line) ── */}
      {debitNoteLine && (
        <RaiseDebitNoteModal
          item={{
            itemName: debitNoteLine.item.itemName || "Item",
            uomName: debitNoteLine.item.uom,
            receivedQty: Number(debitNoteLine.item.receivedQty) || 0,
          }}
          qty={debitNoteQty}
          onQtyChange={setDebitNoteQty}
          reason={debitNoteReason}
          onReasonChange={setDebitNoteReason}
          onClose={() => setDebitNoteLine(null)}
          onSubmit={() => debitNoteMut.mutate()}
          isPending={debitNoteMut.isPending}
        />
      )}

      {/* GRN Delete Block Dialog */}
      <Dialog
        open={!!deleteBlockInfo}
        onOpenChange={() => setDeleteBlockInfo(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={18} className="shrink-0" />
              Cannot Delete GRN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {deleteBlockInfo?.reason === "brs_cleared" && (
              <div className="space-y-2">
                <p className="font-medium text-destructive">
                  This GRN has an expense booking with payments cleared in BRS.
                  Follow these steps:
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>BRS</strong> and <strong>unclear</strong> the
                    matched payment entries.
                  </li>
                  <li>
                    Go to <strong>Payment Management</strong> and{" "}
                    <strong>delete</strong> the payment records.
                  </li>
                  <li>
                    Go to <strong>Expense Booking</strong> and{" "}
                    <strong>delete</strong> the expense booking(s).
                  </li>
                  <li>Return here and delete this GRN.</li>
                </ol>
                {deleteBlockInfo.clearedPayments &&
                  deleteBlockInfo.clearedPayments.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      <p className="font-semibold">
                        Cleared payments blocking deletion:
                      </p>
                      {deleteBlockInfo.clearedPayments.map((p) => (
                        <div key={p.paymentId} className="flex justify-between">
                          <span>
                            {p.paymentName || "Payment #" + p.paymentId} (Exp:{" "}
                            {p.expenseDocNo})
                          </span>
                          <span className="font-medium">
                            {Number(p.amount).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {deleteBlockInfo?.reason === "has_payments" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This GRN has expense bookings with linked payment records.
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>Payment Management</strong> and{" "}
                    <strong>delete</strong> the payment records.
                  </li>
                  <li>
                    Go to <strong>Expense Booking</strong> and{" "}
                    <strong>delete</strong> the expense booking(s).
                  </li>
                  <li>Return here and delete this GRN.</li>
                </ol>
              </div>
            )}
            {deleteBlockInfo?.reason === "has_expense" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This GRN has linked expense booking(s). Delete them first,
                  then delete this GRN.
                </p>
                {deleteBlockInfo.expenseBookings &&
                  deleteBlockInfo.expenseBookings.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      <p className="font-semibold">
                        Expense bookings to delete first:
                      </p>
                      {deleteBlockInfo.expenseBookings.map((e) => (
                        <div key={e.id} className="flex justify-between">
                          <span>{e.docNo || "Expense #" + e.id}</span>
                          <span className="text-muted-foreground">
                            {e.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBlockInfo(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GRN Delete Confirm Dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete GRN?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteGrn}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
