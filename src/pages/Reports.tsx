import React, { useState, useCallback, useEffect, useRef } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  Building2,
  Calendar,
  CalendarRange,
  ChevronDown,
  RefreshCw,
  X,
  TrendingUp,
  BarChart3,
  CreditCard,
  ShoppingCart,
  Package,
  ArrowDownToLine,
  Layers,
  Landmark,
  BookOpen,
  ClipboardList,
  FileBarChart2,
  Users,
  Clock,
  GitPullRequest,
  Banknote,
  Wrench,
  Receipt,
  Store,
  ChevronLeft,
  AlertCircle,
  Loader2,
  FileText,
  ArrowUpDown,
  ChevronRight,
  IndianRupee,
  Boxes,
  Settings2,
  Warehouse,
  XCircle,
  Ban,
  Wallet,
  Megaphone,
  Target,
  PhoneCall,
  MapPinned,
  Percent,
  Repeat,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyOption {
  id: number;
  name: string;
}
interface FinYearOption {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
}
type DateMode = "single" | "range";

interface FilterState {
  companyId: string;
  finYearId: string;
  dateMode: DateMode;
  singleDate: string;
  rangeFrom: string;
  rangeTo: string;
}

interface ActiveFilter {
  label: string;
  clear: () => void;
}

/**
 * Per-report filter configuration.
 * Keys map standard FilterState fields → the actual query param the backend accepts.
 * Set a key to null to disable that filter for the report entirely.
 * Omit a key to use the default (companyId, dateFrom, dateTo; no finYear by default).
 */
interface FilterConfig {
  /** Backend param name for company filter, or null to skip. Default: "companyId" */
  companyParam?: string | null;
  /** Backend param name for financial year ID, or null to skip. Default: null (most routes don't have it) */
  finYearParam?: string | null;
  /** Backend param name for single-day date filter, or null to skip. Default: "dateFrom" */
  singleDateParam?: string | null;
  /** Backend param name for range-start date, or null to skip. Default: "dateFrom" */
  dateFromParam?: string | null;
  /** Backend param name for range-end date, or null to skip. Default: "dateTo" */
  dateToParam?: string | null;
  /** Key in the JSON response that holds the data array. Default: "data" */
  dataKey?: string;
}

interface ReportDef {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  apiPath: string;
  columns: ExportColumn[];
  defaultParams?: Record<string, string>;
  filterConfig?: FilterConfig;
}

interface ModuleSection {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  accent: string;
  reportIds: string[];
}

const fmt = (n: number | undefined | null) =>
  n == null
    ? "—"
    : "₹" +
      new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
        Number(n),
      );

// ── All report definitions ────────────────────────────────────────────────────

const ALL_REPORTS: ReportDef[] = [
  {
    id: "payment-register",
    label: "Payment Register",
    description: "Outward payments with mode & amount",
    icon: Banknote,
    color: "#6366f1",
    apiPath: "/api/new-payment",
    // newPayment: company filter is text-based (PCompany name), skip it.
    // Fin-year filter uses ?finYear=<id>. Single-date uses ?date=. No range.
    filterConfig: {
      companyParam: null,
      finYearParam: "finYear",
      singleDateParam: "date",
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      {
        header: "Company",
        accessor: (r) => (r.PCompanyName ?? r.PCompany ?? "—") as string,
      },
      {
        header: "Project",
        accessor: (r) => (r.PProjectName ?? r.PProject ?? "—") as string,
      },
      {
        header: "Supplier",
        accessor: (r) => (r.PSupplierName ?? r.PPaymentName ?? "—") as string,
      },
      {
        header: "Amount (Net Payable)",
        accessor: (r) => fmt(r.PAmount as number),
      },
      {
        header: "Tax",
        accessor: (r) =>
          r.TaxAmount != null && Number(r.TaxAmount) !== 0
            ? fmt(r.TaxAmount as number)
            : "—",
      },
      { header: "Method of Payment", accessor: "PMode" },
      {
        header: "Taxable Amt (Base Amt)",
        accessor: (r) =>
          r.TaxableAmount != null ? fmt(r.TaxableAmount as number) : "—",
      },
      {
        header: "Fin Year",
        accessor: (r) => (r.EBFinYear ?? "—") as string,
      },
      {
        header: "Ref Doc",
        accessor: (r) => (r.RefDoc ?? r.PExpenseRef ?? "—") as string,
      },
      {
        header: "Date",
        accessor: (r) => (r.PDate ? String(r.PDate).slice(0, 10) : "—"),
      },
      { header: "Document Number", accessor: "DocNo" },
    ],
  },
  {
    id: "payment-reason-report",
    label: "Payment Reason Report",
    description: "Outward payments grouped and filterable by Payment Reason",
    icon: Receipt,
    color: "#9333ea",
    apiPath: "/api/payment-reason-master/report",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "Reason", accessor: "ReasonName" },
      { header: "Company", accessor: (r) => (r.Company ?? "—") as string },
      { header: "Project", accessor: (r) => (r.Project ?? "—") as string },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      { header: "Mode", accessor: (r) => (r.Mode ?? "—") as string },
      {
        header: "Date",
        accessor: (r) => (r.Date ? String(r.Date).slice(0, 10) : "—"),
      },
      { header: "Document Number", accessor: "DocNo" },
    ],
  },
  {
    id: "received-payment",
    label: "Received Payment",
    description: "Inward payments received from clients",
    icon: TrendingUp,
    color: "#06d6a0",
    apiPath: "/api/received-payment",
    // receivedPayment route has no company/date/finYear filter params.
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Doc No", accessor: "RPDocNo" },
      {
        header: "Date",
        accessor: (r) => (r.RPDocDate ? String(r.RPDocDate).slice(0, 10) : "—"),
      },
      { header: "Received From", accessor: "RPReceivedFrom" },
      { header: "Project", accessor: "RPProjectName" },
      { header: "Amount", accessor: (r) => fmt(r.RPAmount as number) },
      { header: "Mode", accessor: "RPMode" },
      { header: "Status", accessor: "RPStatus" },
    ],
  },
  {
    id: "emi-register",
    label: "EMI Register",
    description: "EMI schedules across received payments",
    icon: CreditCard,
    color: "#8b5cf6",
    apiPath: "/api/received-payment",
    defaultParams: { isEmi: "1" },
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Doc No", accessor: "RPDocNo" },
      {
        header: "Date",
        accessor: (r) => (r.RPDocDate ? String(r.RPDocDate).slice(0, 10) : "—"),
      },
      { header: "Received From", accessor: "RPReceivedFrom" },
      { header: "EMI Total", accessor: (r) => fmt(r.RPEmiTotal as number) },
      { header: "EMI Months", accessor: "RPEmiMonths" },
      { header: "Mode", accessor: "RPMode" },
      { header: "Status", accessor: "RPStatus" },
    ],
  },
  {
    id: "pending-payment",
    label: "Pending Payments",
    description: "Payments awaiting approval or disbursement",
    icon: Clock,
    color: "#f43f5e",
    apiPath: "/api/new-payment",
    defaultParams: { status: "Pending" },
    filterConfig: {
      companyParam: null,
      finYearParam: "finYear",
      singleDateParam: "date",
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Doc No", accessor: "DocNo" },
      {
        header: "Date",
        accessor: (r) => (r.PDate ? String(r.PDate).slice(0, 10) : "—"),
      },
      { header: "Party", accessor: "PPaymentName" },
      { header: "Amount", accessor: (r) => fmt(r.PAmount as number) },
      { header: "Mode", accessor: "PMode" },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "bank-report",
    label: "Bank Report",
    description: "Bank reconciliation statement summary",
    icon: Landmark,
    color: "#0ea5e9",
    apiPath: "/api/brs",
    // BRS route accepts fromDate/toDate (not dateFrom/dateTo). No company/finYear.
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: "fromDate",
      dateFromParam: "fromDate",
      dateToParam: "toDate",
    },
    columns: [
      {
        header: "Date",
        accessor: (r) => (r.PayDate ? String(r.PayDate).slice(0, 10) : "—"),
      },
      { header: "Bank", accessor: "BankName" },
      { header: "Party", accessor: "PaymentName" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      { header: "Mode", accessor: "Mode" },
      { header: "Doc No", accessor: "DocNo" },
      {
        header: "Cleared",
        accessor: (r) => (r.IsMatched ? "Yes" : "No"),
      },
    ],
  },
  {
    id: "brs-report",
    label: "BRS Report",
    description: "Full bank reconciliation statement",
    icon: ArrowUpDown,
    color: "#14b8a6",
    apiPath: "/api/brs",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: "fromDate",
      dateFromParam: "fromDate",
      dateToParam: "toDate",
    },
    columns: [
      { header: "Doc No", accessor: "DocNo" },
      {
        header: "Date",
        accessor: (r) => (r.PayDate ? String(r.PayDate).slice(0, 10) : "—"),
      },
      { header: "Bank", accessor: "BankName" },
      { header: "Party", accessor: "PaymentName" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      { header: "Type", accessor: "SourceType" },
      { header: "Status", accessor: "PayStatus" },
      {
        header: "Cleared",
        accessor: (r) => (r.IsMatched ? "Yes" : "No"),
      },
    ],
  },
  {
    id: "ledger-report",
    label: "Ledger Report",
    description: "General ledger entries by account head",
    icon: BookOpen,
    color: "#64748b",
    apiPath: "/api/general-ledger",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      {
        header: "Account",
        accessor: (r) => (r.LHeadName ?? r.label ?? "—") as string,
      },
      {
        header: "Code",
        accessor: (r) => (r.LHeadCode ?? r.code ?? "—") as string,
      },
      { header: "Type", accessor: "LHeadType" },
      { header: "Group", accessor: "GroupName" },
    ],
  },
  {
    id: "journal-voucher-report",
    label: "Journal Voucher",
    description: "Forced account-head corrections, year & filter wise",
    icon: FileBarChart2,
    color: "#a855f7",
    apiPath: "/api/reports/journal-voucher/list",
    // journalVoucherReports.js accepts companyId/projectId/status/dateFrom/dateTo.
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: "dateFrom",
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "JV No", accessor: (r) => (r.JVNo ?? `JV-${r.JVID}`) as string },
      {
        header: "Date",
        accessor: (r) => (r.JVDate ? String(r.JVDate).slice(0, 10) : "—"),
      },
      { header: "Narration", accessor: (r) => (r.Narration ?? "—") as string },
      { header: "Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "bounced-cheques",
    label: "Bounced Cheques",
    description: "Dishonoured cheque payments with bounce details",
    icon: XCircle,
    color: "#ef4444",
    apiPath: "/api/brs",
    defaultParams: { status: "bounced", hideDummyBank: "true", limit: "500" },
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: "fromDate",
      dateFromParam: "fromDate",
      dateToParam: "toDate",
      dataKey: "data",
    },
    columns: [
      {
        header: "Bounce Date",
        accessor: (r) =>
          r.BounceDate ? String(r.BounceDate).slice(0, 10) : "—",
      },
      { header: "Doc No", accessor: (r) => (r.DocNo ?? "—") as string },
      { header: "Cheque No", accessor: (r) => (r.ChequeNo ?? "—") as string },
      {
        header: "Cheque Book",
        accessor: (r) => (r.ChequeLotNumber ?? "—") as string,
      },
      { header: "Party", accessor: (r) => (r.PaymentName ?? "—") as string },
      { header: "Bank", accessor: (r) => (r.BankName ?? "—") as string },
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      { header: "Project", accessor: (r) => (r.ProjectName ?? "—") as string },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      {
        header: "Bounce Reason",
        accessor: (r) => (r.BounceReason ?? "—") as string,
      },
      {
        header: "Remarks",
        accessor: (r) => (r.BounceRemarks ?? "—") as string,
      },
      {
        header: "Pay Date",
        accessor: (r) => (r.PayDate ? String(r.PayDate).slice(0, 10) : "—"),
      },
      {
        header: "Re-issued Via",
        accessor: (r) => (r.ReplacementDocNo ?? "—") as string,
      },
    ],
  },
  {
    id: "cancelled-cheques-report",
    label: "Cancelled Cheques",
    description: "Every cheque cancelled via Finance → Cheque Cancellation",
    icon: Ban,
    color: "#dc2626",
    apiPath: "/api/cheque-cancellation",
    defaultParams: { limit: "500" },
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
      dataKey: "data",
    },
    columns: [
      { header: "Cheque No", accessor: (r) => (r.ChequeNo ?? "—") as string },
      { header: "Lot Number", accessor: (r) => (r.ChequeLotNumber ?? "—") as string },
      { header: "Bank", accessor: (r) => (r.BankName ?? "—") as string },
      { header: "A/C Number", accessor: (r) => (r.AccountNumber ?? "—") as string },
      { header: "Payment Doc No", accessor: (r) => (r.DocNo ?? "—") as string },
      { header: "Payment Name", accessor: (r) => (r.PPaymentName ?? "—") as string },
      { header: "Amount", accessor: (r) => fmt(r.PAmount as number) },
      { header: "Company", accessor: (r) => (r.PCompanyName ?? "—") as string },
      { header: "Reason", accessor: (r) => (r.Reason ?? "—") as string },
      { header: "Cancelled By", accessor: (r) => (r.CancelledBy ?? "—") as string },
      {
        header: "Cancelled At",
        accessor: (r) => (r.CancelledAt ? String(r.CancelledAt).slice(0, 10) : "—"),
      },
    ],
  },
  {
    id: "inter-company-transfer-report",
    label: "Inter-Company Transfer",
    description: "Project-to-project stock transfer with auto invoice/payment chain",
    icon: Warehouse,
    color: "#0f766e",
    apiPath: "/api/inter-company-transfer",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: "dateFrom",
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "ICT No", accessor: (r) => (r.DocNo ?? `ICT-${r.ICTId}`) as string },
      {
        header: "Date",
        accessor: (r) =>
          r.TransferDate ? String(r.TransferDate).slice(0, 10) : "—",
      },
      { header: "From Project", accessor: (r) => (r.SenderProjectName ?? "—") as string },
      { header: "To Project", accessor: (r) => (r.ReceiverProjectName ?? "—") as string },
      { header: "Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Sale Invoice", accessor: (r) => String(r.SaleInvoiceId ?? "—") },
      { header: "GRN", accessor: (r) => String(r.GRNId ?? "—") },
      { header: "Expense", accessor: (r) => String(r.ExpenseBookingId ?? "—") },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "asset-transfer-report",
    label: "Asset Transfer Report",
    description: "Fixed asset custody transfers between users, department-wise",
    icon: Repeat,
    color: "#eab308",
    apiPath: "/api/asset-transfer",
    // GET / on assetTransfer.js filters on TransferDate; no finYear-by-id.
    filterConfig: {
      companyParam: "companyId",
      finYearParam: "finYear",
      singleDateParam: null,
      dateFromParam: "fromDate",
      dateToParam: "toDate",
    },
    columns: [
      { header: "FA Item Code", accessor: (r) => (r.FAItemCode ?? "—") as string },
      { header: "Item Name", accessor: (r) => (r.AssetName ?? "—") as string },
      { header: "Date of Transfer", accessor: (r) => (r.TransferDate ? String(r.TransferDate).slice(0, 10) : "—") },
      { header: "From User", accessor: (r) => (r.FromUserName ?? "—") as string },
      { header: "To User", accessor: (r) => (r.ToUserName ?? "—") as string },
      { header: "Department", accessor: (r) => (r.DepartmentName ?? "—") as string },
    ],
  },
  {
    id: "po-register",
    label: "PO Register",
    description: "All purchase orders with vendor & value",
    icon: ShoppingCart,
    color: "#f59e0b",
    apiPath: "/api/purchase-orders",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Company", accessor: "CompanyName" },
      { header: "Project", accessor: "ProjectName" },
      {
        header: "Date of PO",
        accessor: (r) => (r.PODate ? String(r.PODate).slice(0, 10) : "—"),
      },
      {
        header: "Document Number",
        accessor: (r) =>
          (r.DocNo ?? r.PurchaseOrderNo ?? r.PONo ?? "—") as string,
      },
      { header: "Supplier", accessor: "SupplierName" },
      { header: "Fin Year", accessor: "FinYearName" },
      {
        header: "Items in the PO",
        accessor: (r) =>
          Array.isArray(r.POItems)
            ? r.POItems.map(
                (it) =>
                  (it as Record<string, unknown>)?.itemDescription ??
                  (it as Record<string, unknown>)?.itemName ??
                  "",
              )
                .filter(Boolean)
                .join(", ")
            : "—",
      },
      { header: "Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      {
        header: "Ref Doc",
        accessor: (r) => (r.SourceMRDocNo ?? r.SourceWODocNo ?? "—") as string,
      },
    ],
  },
  {
    id: "grn-register",
    label: "GRN Register",
    description: "Goods received notes with item details",
    icon: Package,
    color: "#10b981",
    apiPath: "/api/grns",
    // GRN accepts companyId ✓ but no date or finYear filters.
    filterConfig: {
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Company", accessor: "CompanyName" },
      { header: "Project", accessor: "ProjectName" },
      {
        header: "Date of GRN",
        accessor: (r) => (r.GRNDate ? String(r.GRNDate).slice(0, 10) : "—"),
      },
      {
        header: "Document Number",
        accessor: (r) => (r.DocNo ?? r.GRNNo ?? "—") as string,
      },
      { header: "Supplier", accessor: "SupplierName" },
      {
        header: "Fin Year",
        accessor: (r) => (r.FinYearName ?? r.FinYear ?? "—") as string,
      },
      {
        header: "Items in the GRN",
        accessor: (r) =>
          Array.isArray(r.GRNItems)
            ? r.GRNItems.map(
                (it) =>
                  (it as Record<string, unknown>)?.itemName ??
                  (it as Record<string, unknown>)?.ItemName ??
                  (it as Record<string, unknown>)?.name ??
                  "",
              )
                .filter(Boolean)
                .join(", ")
            : "—",
      },
      { header: "Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      {
        header: "Ref Doc",
        accessor: (r) => (r.PONumber ?? "—") as string,
      },
    ],
  },
  {
    id: "pending-mr-report",
    label: "Pending MR Report",
    description: "Material Requests not yet fully converted into Purchase Orders",
    icon: ClipboardList,
    color: "#f97316",
    apiPath: "/api/material-requests/pending-report",
    // materialRequests.js's /pending-report accepts companyId/projectId —
    // project has no standard FilterState slot in this generic engine, so
    // only Company + Date range are exposed here; Requestor/Status/Dock
    // Number filtering exists server-side (?requestor=&status=&docNo=) for
    // future UI, and can be applied today via a direct API call/URL.
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "MR Dock Number", accessor: "DocNo" },
      {
        header: "Request Date",
        accessor: (r) => (r.RequestDate ? String(r.RequestDate).slice(0, 10) : "—"),
      },
      { header: "Company", accessor: "CompanyName" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Requestor", accessor: (r) => (r.Requestor ?? "—") as string },
      { header: "Item Name", accessor: "ItemName" },
      {
        header: "Requested Quantity",
        accessor: (r) => String(r.RequestedQty ?? 0),
      },
      {
        header: "Fulfilled Quantity",
        accessor: (r) => String(r.FulfilledQty ?? 0),
      },
      {
        header: "Pending Quantity",
        accessor: (r) => String(r.PendingQty ?? 0),
      },
      { header: "Status", accessor: "Status" },
      {
        header: "Linked Purchase Orders",
        accessor: (r) => (r.LinkedPOs ? String(r.LinkedPOs) : "—"),
      },
    ],
  },
  {
    id: "issue-register",
    label: "Issue Register",
    description: "Material issues to sites and projects",
    icon: ArrowDownToLine,
    color: "#ef4444",
    apiPath: "/api/material-issues",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Issue No", accessor: "IssueNo" },
      { header: "Doc No", accessor: "DocNo" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Items", accessor: "ItemCount" },
      { header: "Total Qty", accessor: "TotalQty" },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "stock-summary",
    label: "Stock Summary",
    description: "Current stock levels across all items and godowns",
    icon: Layers,
    color: "#06b6d4",
    apiPath: "/api/inventory-master",

    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: "date",
      dateFromParam: null,
      dateToParam: null,
      dataKey: "data",
    },
    columns: [
      { header: "Item", accessor: "ItemName" },
      { header: "Group", accessor: "ItemGroupName" },
      {
        header: "Location",
        accessor: (r) =>
          ((r.GodownName ?? "Main Godown") +
            (r.IsMainGodown ? " [MAIN]" : "")) as string,
      },
      { header: "Opening", accessor: (r) => String(r.OpeningStock ?? "—") },
      { header: "In", accessor: (r) => String(r.StockIn ?? "—") },
      { header: "Out", accessor: (r) => String(r.StockOut ?? "—") },
      { header: "Closing", accessor: (r) => String(r.ClosingStock ?? "—") },
      {
        header: "UOM",
        accessor: (r) => (r.UOMName ?? r.UOMCode ?? "—") as string,
      },
    ],
  },
  {
    id: "work-order-register",
    label: "Work Order Register",
    description: "All work orders with contractor & value",
    icon: Wrench,
    color: "#f97316",
    apiPath: "/api/work-orders",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      {
        header: "WO No",
        accessor: (r) => (r.DocumentNumber ?? r.DocNo ?? "—") as string,
      },
      {
        header: "Date",
        accessor: (r) =>
          r.DocumentDate ? String(r.DocumentDate).slice(0, 10) : "—",
      },
      { header: "Contractor", accessor: "ContractorName" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Value", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "boq-register",
    label: "BOQ Register",
    description: "Bill of quantities with project breakdown",
    icon: FileBarChart2,
    color: "#84cc16",
    apiPath: "/api/boq",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      {
        header: "BOQ No",
        accessor: (r) => (r.DocNo ?? r.BoqNo ?? "—") as string,
      },
      { header: "Project", accessor: "ProjectName" },
      { header: "Company", accessor: "CompanyName" },
      { header: "Total Value", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "work-done",
    label: "Work Done",
    description: "Certified work done entries",
    icon: ClipboardList,
    color: "#22c55e",
    apiPath: "/api/engineering/work-done",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Doc No", accessor: "DocNo" },
      {
        header: "Date",
        accessor: (r) => (r.DocDate ? String(r.DocDate).slice(0, 10) : "—"),
      },
      { header: "WO No", accessor: "WorkOrderNo" },
      { header: "Project", accessor: "ProjectName" },
      {
        header: "Certified",
        accessor: (r) => fmt(r.CertifiedAmount as number),
      },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "invoice-register",
    label: "Invoice Register",
    description: "Expense bookings & invoices across all projects",
    icon: Receipt,
    color: "#ec4899",
    apiPath: "/api/reports/invoice-register",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: "finYearId",
      singleDateParam: "dateFrom",
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "Doc No", accessor: "DocumentNumber" },
      {
        header: "Date",
        accessor: (r) => (r.Date ? String(r.Date).slice(0, 10) : "—"),
      },
      { header: "Company", accessor: "Company" },
      { header: "Project", accessor: (r) => r.Project ?? "—" },
      { header: "Supplier", accessor: "Supplier" },
      { header: "Ref Doc", accessor: "RefDoc" },
      {
        header: "Taxable Amt",
        accessor: (r) => fmt(r.TaxableAmount as number),
      },
      { header: "Tax", accessor: (r) => fmt(r.TaxAmount as number) },
      { header: "Net Payable", accessor: (r) => fmt(r.NetPayable as number) },
      {
        header: "Method of Payment",
        accessor: (r) => r.MethodOfPayment ?? "—",
      },
      { header: "Fin Year", accessor: (r) => r.FinYear ?? "—" },
    ],
  },
  {
    id: "supplier-report",
    label: "Supplier Report",
    description: "Vendor-wise purchase and payment summary",
    icon: Store,
    color: "#78716c",
    apiPath: "/api/enterprises",
    defaultParams: { business_type: "S" },
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
      dataKey: "_array", // enterprise GET / returns a raw array, handled by Array.isArray check
    },
    columns: [
      { header: "Supplier Name", accessor: "name" },
      { header: "GST No", accessor: "gst_no" },
      { header: "PAN", accessor: "pan_no" },
      { header: "Contact", accessor: "contact_person" },
      { header: "Phone", accessor: "phone" },
      { header: "City", accessor: "city" },
    ],
  },
  {
    id: "pending-requests",
    label: "Pending Requests",
    description: "Approval inbox items awaiting action",
    icon: GitPullRequest,
    color: "#fb923c",
    apiPath: "/api/approval-inbox",
    // approval-inbox returns a plain array (no pagination wrapper). No filter params.
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Reference", accessor: "Reference" },
      { header: "Module", accessor: "ModuleLabel" },
      {
        header: "Date",
        accessor: (r) =>
          r.RecordDate ? String(r.RecordDate).slice(0, 10) : "—",
      },
      { header: "Status", accessor: "Status" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
    ],
  },
  {
    id: "user-activity",
    label: "User Activity",
    description: "Login, access and audit trail logs",
    icon: Users,
    color: "#a855f7",
    apiPath: "/api/user-activity",
    defaultParams: { limit: "200" },
    // userActivity accepts dateFrom/dateTo ✓ but no company or finYear filter.
    filterConfig: {
      companyParam: null,
      finYearParam: null,
    },
    columns: [
      { header: "User", accessor: "userName" },
      { header: "Email", accessor: "userEmail" },
      { header: "Role", accessor: "userRole" },
      { header: "Event", accessor: "event" },
      { header: "Action", accessor: "actionType" },
      { header: "Resource", accessor: "resource" },
      { header: "IP", accessor: "ipAddress" },
      {
        header: "Timestamp",
        accessor: (r) =>
          r.timestamp
            ? String(r.timestamp).slice(0, 19).replace("T", " ")
            : "—",
      },
    ],
  },
  {
    id: "on-account-report",
    label: "On Account",
    description: "Excess payment credits stored & adjusted per party",
    icon: Wallet,
    color: "#10b981",
    apiPath: "/api/on-account/report",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "Date",     accessor: (r) => (r.TxnDate ? String(r.TxnDate).slice(0, 10) : "—") },
      { header: "Party",    accessor: (r) => (r.PartyName ?? "—") as string },
      { header: "Type",     accessor: (r) => (r.PartyType ?? "—") as string },
      { header: "Txn Type", accessor: (r) => (r.TxnType === "CREDIT" ? "Stored" : "Adjusted") },
      { header: "Credit",   accessor: (r) => (Number(r.OnAccountCreated) > 0 ? fmt(r.OnAccountCreated as number) : "—") },
      { header: "Debit",    accessor: (r) => (Number(r.OnAccountAdjusted) > 0 ? fmt(r.OnAccountAdjusted as number) : "—") },
      { header: "Balance",  accessor: (r) => fmt(r.RunningBalance as number) },
      { header: "Ref Doc",  accessor: (r) => (r.RefDocNo ?? "—") as string },
      { header: "Notes",    accessor: (r) => (r.Notes ?? "—") as string },
    ],
  },
  {
    id: "quality-debit-note-report",
    label: "Quality Debit Notes",
    description: "Deductions raised against Vehicle In/Out & GRN deliveries found below the ordered grade",
    icon: AlertCircle,
    color: "#f43f5e",
    apiPath: "/api/quality-debit-note",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Doc No",       accessor: (r) => (r.DocNo ?? "—") as string },
      { header: "Date",         accessor: (r) => (r.DebitDate ? String(r.DebitDate).slice(0, 10) : "—") },
      { header: "Source",       accessor: (r) => (r.VehicleInOutDocNo ?? r.GRNDocNo ?? "—") as string },
      { header: "Supplier",     accessor: (r) => (r.SupplierName ?? "—") as string },
      { header: "Item",         accessor: (r) => (r.ItemName ?? "—") as string },
      { header: "Received Qty", accessor: (r) => `${r.ReceivedQty ?? "—"} ${r.UomName ?? ""}`.trim() },
      { header: "Rejected Qty", accessor: (r) => `${r.RejectedQty ?? "—"} ${r.UomName ?? ""}`.trim() },
      { header: "% Bad",        accessor: (r) => (r.PercentBad != null ? `${r.PercentBad}%` : "—") },
      { header: "Amount",       accessor: (r) => fmt(r.Amount as number) },
      { header: "Status",       accessor: (r) => (r.Status ?? "—") as string },
      { header: "Reason",       accessor: (r) => (r.Reason ?? "—") as string },
    ],
  },
  {
    id: "pdc-report",
    label: "PDC Report",
    description: "Post-dated cheques — pending, cleared & bounced, both directions",
    icon: Clock,
    color: "#0ea5e9",
    apiPath: "/api/reports/pdc",
    // pdcReport.js: no company/finYear param — date range filters ChequeDate.
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: "from",
      dateToParam: "to",
    },
    columns: [
      { header: "Cheque No",       accessor: (r) => (r.ChequeNo ?? "—") as string },
      { header: "Party",           accessor: (r) => (r.PartyName ?? "—") as string },
      { header: "Direction",       accessor: (r) => (r.Direction ?? "—") as string },
      { header: "Bank",            accessor: (r) => (r.BankName ?? "—") as string },
      { header: "Cheque Date",     accessor: (r) => (r.ChequeDate ? String(r.ChequeDate).slice(0, 10) : "—") },
      { header: "Amount",          accessor: (r) => fmt(r.Amount as number) },
      { header: "Status",          accessor: (r) => (r.Status ?? "—") as string },
      { header: "Days Remaining",  accessor: (r) => (r.DaysRemaining ?? "—") },
      { header: "Cleared Date",    accessor: (r) => (r.ClearedDate ?? "—") as string },
    ],
  },
  {
    id: "tds-report",
    label: "TDS Report",
    description: "TDS actually deducted on payments — invoice-linked & direct",
    icon: Percent,
    color: "#eab308",
    apiPath: "/api/reports/tds",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: "finYearId",
      singleDateParam: "dateFrom",
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "Payment Doc No", accessor: "DocNo" },
      { header: "Date", accessor: (r) => (r.PayDate ?? "—") as string },
      { header: "Company", accessor: (r) => (r.Company ?? "—") as string },
      { header: "Party", accessor: (r) => (r.PartyName ?? "—") as string },
      { header: "Type", accessor: (r) => (r.PaymentType ?? "—") as string },
      { header: "Invoice Ref", accessor: (r) => (r.InvoiceRef ?? "—") as string },
      { header: "TDS Nature", accessor: (r) => (r.TDSNature ?? "—") as string },
      { header: "TDS Name", accessor: (r) => (r.TDSName ?? "—") as string },
      { header: "TDS Rate", accessor: (r) => (r.TDSPercentage != null ? `${r.TDSPercentage}%` : "—") },
      { header: "Gross Amount", accessor: (r) => fmt(r.GrossAmount as number) },
      { header: "TDS Amount", accessor: (r) => fmt(r.TDSAmount as number) },
      { header: "Net Paid", accessor: (r) => fmt(r.NetPaid as number) },
      { header: "Fin Year", accessor: (r) => (r.FinYear ?? "—") as string },
    ],
  },

  // ── Sales Automation / CRM reports ──────────────────────────────────────────
  {
    id: "sa-lead-source",
    label: "Lead Source Report",
    description: "Leads by platform, bookings & losses",
    icon: Target,
    color: "#ec4899",
    apiPath: "/api/sa/reports/lead-source",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Platform", accessor: "Platform" },
      { header: "Total Leads", accessor: "TotalLeads" },
      { header: "Bookings", accessor: "Bookings" },
      { header: "Lost", accessor: "Lost" },
    ],
  },
  {
    id: "sa-campaign-performance",
    label: "Campaign Performance",
    description: "Ad campaigns, spend, leads & conversion",
    icon: Megaphone,
    color: "#f472b6",
    apiPath: "/api/sa/reports/campaign-performance",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Code", accessor: "CampaignCode" },
      { header: "Name", accessor: "Name" },
      { header: "Budget", accessor: (r) => fmt(r.Budget as number) },
      { header: "Status", accessor: "Status" },
      { header: "Total Ads", accessor: "TotalAds" },
      { header: "Total Leads", accessor: "TotalLeads" },
      { header: "Cost Spent", accessor: (r) => fmt(r.CostSpent as number) },
      { header: "Bookings", accessor: "Bookings" },
      { header: "Conversion %", accessor: (r) => (r.ConversionPct != null ? `${r.ConversionPct}%` : "—") },
    ],
  },
  {
    id: "sa-ad-performance",
    label: "Advertisement Performance",
    description: "Per-ad spend, leads, ROI & conversion",
    icon: BarChart3,
    color: "#db2777",
    apiPath: "/api/sa/reports/ad-performance",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Ad Name", accessor: "Name" },
      { header: "Campaign", accessor: "CampaignName" },
      { header: "Status", accessor: "Status" },
      { header: "Budget", accessor: (r) => fmt(r.Budget as number) },
      { header: "Spent", accessor: (r) => fmt(r.Spent as number) },
      { header: "Leads Generated", accessor: "LeadsGenerated" },
      { header: "Bookings", accessor: "Bookings" },
      { header: "Cost / Lead", accessor: (r) => fmt(r.CostPerLead as number) },
      { header: "Conversion Rate", accessor: (r) => (r.ConversionRate != null ? `${r.ConversionRate}%` : "—") },
      { header: "ROI %", accessor: (r) => (r.RoiPercent != null ? `${r.RoiPercent}%` : "—") },
    ],
  },
  {
    id: "sa-daily-ad-performance",
    label: "Daily Reach & Cost",
    description: "Day-wise reach, spend & cost per lead",
    icon: TrendingUp,
    color: "#c026d3",
    apiPath: "/api/sa/reports/daily-ad-performance",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Date", accessor: (r) => (r.ReportDate ? String(r.ReportDate).slice(0, 10) : "—") },
      { header: "Ad Name", accessor: "AdName" },
      { header: "Campaign", accessor: "CampaignName" },
      { header: "Daily Reach", accessor: "DailyReach" },
      { header: "Daily Cost", accessor: (r) => fmt(r.DailyCost as number) },
      { header: "Cost / Lead", accessor: (r) => fmt(r.CostPerLead as number) },
    ],
  },
  {
    id: "sa-cost-per-lead",
    label: "Cost Per Lead",
    description: "Campaign spend vs leads generated",
    icon: Percent,
    color: "#a21caf",
    apiPath: "/api/sa/reports/cost-per-lead",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Campaign", accessor: "CampaignName" },
      { header: "Code", accessor: "CampaignCode" },
      { header: "Total Spent", accessor: (r) => fmt(r.TotalSpent as number) },
      { header: "Total Leads", accessor: "TotalLeads" },
      { header: "Cost / Lead", accessor: (r) => fmt(r.CostPerLead as number) },
    ],
  },
  {
    id: "sa-sales-performance",
    label: "Sales Performance",
    description: "Per-salesperson leads, calls, visits & bookings",
    icon: Users,
    color: "#7c3aed",
    apiPath: "/api/sa/reports/sales-performance",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Salesperson", accessor: "SalespersonName" },
      { header: "Leads Handled", accessor: "LeadsHandled" },
      { header: "Calls Made", accessor: "CallsMade" },
      { header: "Site Visits", accessor: "SiteVisits" },
      { header: "Bookings", accessor: "Bookings" },
    ],
  },
  {
    id: "sa-team-leader-performance",
    label: "Team Leader Performance",
    description: "Lead distribution & team bookings by team lead",
    icon: Users,
    color: "#6d28d9",
    apiPath: "/api/sa/reports/team-leader-performance",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Team Lead", accessor: "TeamLeadName" },
      { header: "Leads Received", accessor: "LeadsReceived" },
      { header: "Leads Distributed", accessor: "LeadsDistributed" },
      { header: "Pending Distribution", accessor: "PendingDistribution" },
      { header: "Team Bookings", accessor: "TeamBookings" },
    ],
  },
  {
    id: "sa-executive-performance",
    label: "Executive Performance",
    description: "Site-visit assignment & completion by executive",
    icon: PhoneCall,
    color: "#9333ea",
    apiPath: "/api/sa/reports/executive-performance",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Executive", accessor: "ExecutiveName" },
      { header: "Visits Assigned", accessor: "VisitsAssigned" },
      { header: "Visits Completed", accessor: "VisitsCompleted" },
      { header: "Visits Cancelled", accessor: "VisitsCancelled" },
    ],
  },
  {
    id: "sa-inquiry-status",
    label: "Inquiry Status",
    description: "Lead count by current status",
    icon: ClipboardList,
    color: "#8b5cf6",
    apiPath: "/api/sa/reports/inquiry-status",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Status", accessor: "Status" },
      { header: "Count", accessor: "Cnt" },
    ],
  },
  {
    id: "sa-site-visit",
    label: "Site Visit Report",
    description: "Scheduled & completed site visits",
    icon: MapPinned,
    color: "#a855f7",
    apiPath: "/api/sa/reports/site-visit",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Customer", accessor: "CustomerName" },
      { header: "Mobile", accessor: "Mobile" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Executive", accessor: "ExecutiveName" },
      { header: "Preferred Date", accessor: (r) => (r.PreferredDate ? String(r.PreferredDate).slice(0, 10) : "—") },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "sa-booking-conversion",
    label: "Booking Conversion",
    description: "Campaign funnel: leads → visits → bookings",
    icon: GitPullRequest,
    color: "#d946ef",
    apiPath: "/api/sa/reports/booking-conversion",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Campaign", accessor: "CampaignName" },
      { header: "Code", accessor: "CampaignCode" },
      { header: "Total Leads", accessor: "TotalLeads" },
      { header: "Visited", accessor: "Visited" },
      { header: "Booked", accessor: "Booked" },
      { header: "Conversion Rate", accessor: (r) => (r.ConversionRate != null ? `${r.ConversionRate}%` : "—") },
    ],
  },
  {
    id: "sa-marketing-roi",
    label: "Marketing ROI",
    description: "Campaign spend vs revenue generated",
    icon: Wallet,
    color: "#e879f9",
    apiPath: "/api/sa/reports/marketing-roi",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Campaign", accessor: "CampaignName" },
      { header: "Code", accessor: "CampaignCode" },
      { header: "Total Spent", accessor: (r) => fmt(r.TotalSpent as number) },
      { header: "Total Revenue", accessor: (r) => fmt(r.TotalRevenue as number) },
      { header: "ROI", accessor: (r) => (r.ROI != null ? `${r.ROI}%` : "—") },
    ],
  },

  // ── CRM reports ──────────────────────────────────────────────────────────────
  {
    id: "crm-booking-register",
    label: "Booking Register",
    description: "All bookings with customer, unit & value",
    icon: ClipboardList,
    color: "#0ea5e9",
    apiPath: "/api/crm/reports/booking-register",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Mobile", accessor: "Mobile" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Unit", accessor: "UnitNo" },
      { header: "Unit Type", accessor: "UnitType" },
      { header: "Area (Sq Ft)", accessor: "AreaSqFt" },
      { header: "Total Value", accessor: (r) => fmt(r.TotalValue as number) },
      { header: "Booking Amt", accessor: (r) => fmt(r.BookingAmount as number) },
      { header: "Status", accessor: "Status" },
      { header: "Booking Date", accessor: (r) => (r.BookingDate ? String(r.BookingDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "crm-payment-collection",
    label: "Payment Collection",
    description: "Milestone due, paid & outstanding balance",
    icon: IndianRupee,
    color: "#0284c7",
    apiPath: "/api/crm/reports/payment-collection",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Milestone", accessor: "MilestoneName" },
      { header: "Due Date", accessor: (r) => (r.DueDate ? String(r.DueDate).slice(0, 10) : "—") },
      { header: "Amount Due", accessor: (r) => fmt(r.AmountDue as number) },
      { header: "Amount Paid", accessor: (r) => fmt(r.AmountPaid as number) },
      { header: "Balance", accessor: (r) => fmt(r.Balance as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "crm-receipt-register",
    label: "Receipt Register",
    description: "Payments actually received against milestones",
    icon: Banknote,
    color: "#0369a1",
    apiPath: "/api/crm/reports/receipt-register",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Receipt No", accessor: "ReceiptNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Milestone", accessor: "MilestoneName" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      { header: "Received Date", accessor: (r) => (r.ReceivedDate ? String(r.ReceivedDate).slice(0, 10) : "—") },
      { header: "Mode", accessor: "PaymentMode" },
      { header: "Txn Ref", accessor: (r) => (r.TransactionRef ?? "—") as string },
    ],
  },
  {
    id: "crm-overdue-payments",
    label: "Overdue Payments",
    description: "Pending milestones past their due date",
    icon: AlertCircle,
    color: "#dc2626",
    apiPath: "/api/crm/reports/overdue-payments",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Mobile", accessor: "Mobile" },
      { header: "Milestone", accessor: "MilestoneName" },
      { header: "Due Date", accessor: (r) => (r.DueDate ? String(r.DueDate).slice(0, 10) : "—") },
      { header: "Overdue Amt", accessor: (r) => fmt(r.OverdueAmount as number) },
      { header: "Days Overdue", accessor: "DaysOverdue" },
    ],
  },
  {
    id: "crm-brokerage-report",
    label: "Brokerage Report",
    description: "Broker commission computed vs paid",
    icon: Percent,
    color: "#0891b2",
    apiPath: "/api/crm/reports/brokerage-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Broker", accessor: "BrokerName" },
      { header: "Firm", accessor: (r) => (r.BrokerFirm ?? "—") as string },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Rate Type", accessor: "RateType" },
      { header: "Rate Value", accessor: "RateValue" },
      { header: "Computed Amt", accessor: (r) => fmt(r.ComputedAmount as number) },
      { header: "Total Paid", accessor: (r) => fmt(r.TotalPaid as number) },
      { header: "Balance", accessor: (r) => fmt(r.Balance as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "crm-cancellation-report",
    label: "Cancellation Report",
    description: "Refunds & deductions on cancelled bookings",
    icon: XCircle,
    color: "#e11d48",
    apiPath: "/api/crm/reports/cancellation-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Cancellation No", accessor: "CancellationNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Reason", accessor: "Reason" },
      { header: "Paid Till Date", accessor: (r) => fmt(r.AmountPaidTillDate as number) },
      { header: "Deduction %", accessor: "DeductionPercent" },
      { header: "Deduction Amt", accessor: (r) => fmt(r.DeductionAmount as number) },
      { header: "Refund Amt", accessor: (r) => fmt(r.RefundAmount as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "crm-booking-status-summary",
    label: "Booking Status Summary",
    description: "Booking funnel counts & value by status",
    icon: BarChart3,
    color: "#0e7490",
    apiPath: "/api/crm/reports/booking-status-summary",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Status", accessor: "Status" },
      { header: "Count", accessor: "Count" },
      { header: "Total Value", accessor: (r) => fmt(r.TotalValue as number) },
    ],
  },
  {
    id: "crm-customer-report",
    label: "Customer Report",
    description: "Customer master with booking counts",
    icon: Users,
    color: "#155e75",
    apiPath: "/api/crm/reports/customer-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Customer No", accessor: "CustomerNo" },
      { header: "Name", accessor: "CustomerName" },
      { header: "Mobile", accessor: "Mobile" },
      { header: "Email", accessor: (r) => (r.Email ?? "—") as string },
      { header: "Total Bookings", accessor: "TotalBookings" },
      { header: "Created", accessor: (r) => (r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "crm-application-funnel",
    label: "Application Funnel",
    description: "Lead-to-booking conversion by application status",
    icon: GitPullRequest,
    color: "#0d9488",
    apiPath: "/api/crm/reports/application-funnel",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Status", accessor: "Status" },
      { header: "Count", accessor: "Count" },
      { header: "Converted (Booked)", accessor: "Converted" },
    ],
  },
  {
    id: "crm-service-tickets",
    label: "Service Ticket Report",
    description: "Support tickets, SLA due dates & resolution",
    icon: PhoneCall,
    color: "#059669",
    apiPath: "/api/crm/reports/service-tickets",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Ticket No", accessor: "TicketNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Category", accessor: "Category" },
      { header: "Priority", accessor: "Priority" },
      { header: "Subject", accessor: "Subject" },
      { header: "Status", accessor: "Status" },
      { header: "SLA Due", accessor: (r) => (r.SlaDueDate ? String(r.SlaDueDate).slice(0, 10) : "—") },
      { header: "Created", accessor: (r) => (r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "crm-legal-milestones",
    label: "Legal Milestone Report",
    description: "Title clearance & legal drafting progress",
    icon: BookOpen,
    color: "#047857",
    apiPath: "/api/crm/reports/legal-milestones",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Current Step", accessor: "CurrentStep" },
      { header: "Overall Status", accessor: "OverallStatus" },
      { header: "Created", accessor: (r) => (r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : "—") },
      { header: "Updated", accessor: (r) => (r.UpdatedDate ? String(r.UpdatedDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "crm-noc-report",
    label: "NOC Report",
    description: "Bank & organisation no-objection certificates",
    icon: FileText,
    color: "#065f46",
    apiPath: "/api/crm/reports/noc-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "NOC No", accessor: "NocNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Type", accessor: "NocType" },
      { header: "NOC Date", accessor: (r) => (r.NocDate ? String(r.NocDate).slice(0, 10) : "—") },
      { header: "Bank", accessor: (r) => (r.BankName ?? "—") as string },
      { header: "Loan Amount", accessor: (r) => (r.LoanAmount != null ? fmt(r.LoanAmount as number) : "—") },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "crm-sales-deed-report",
    label: "Sales Deed Report",
    description: "Deed execution & registration status",
    icon: FileBarChart2,
    color: "#134e4a",
    apiPath: "/api/crm/reports/sales-deed-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Deed No", accessor: "DeedNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Deed Value", accessor: (r) => fmt(r.DeedValue as number) },
      { header: "Stamp Duty", accessor: (r) => fmt(r.StampDuty as number) },
      { header: "Reg. Fee", accessor: (r) => fmt(r.RegistrationFee as number) },
      { header: "Deed Date", accessor: (r) => (r.DeedDate ? String(r.DeedDate).slice(0, 10) : "—") },
      { header: "Reg. No", accessor: (r) => (r.RegistrationNo ?? "—") as string },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "crm-handover-report",
    label: "Handover Report",
    description: "Key handover scheduling & completion",
    icon: ArrowDownToLine,
    color: "#0f766e",
    apiPath: "/api/crm/reports/handover-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Scheduled Date", accessor: (r) => (r.ScheduledDate ? String(r.ScheduledDate).slice(0, 10) : "—") },
      { header: "Actual Date", accessor: (r) => (r.ActualHandoverDate ? String(r.ActualHandoverDate).slice(0, 10) : "—") },
      { header: "Status", accessor: "Status" },
      { header: "Dues Cleared", accessor: (r) => (r.FinalDuesCleared ? "Yes" : "No") },
      { header: "Acknowledged", accessor: (r) => (r.CustomerAcknowledged ? "Yes" : "No") },
    ],
  },
  {
    id: "crm-agreement-report",
    label: "Agreement Report",
    description: "Sale agreement drafting & approval status",
    icon: ClipboardList,
    color: "#115e59",
    apiPath: "/api/crm/reports/agreement-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Agreement No", accessor: "AgreementNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Agreement Date", accessor: (r) => (r.AgreementDate ? String(r.AgreementDate).slice(0, 10) : "—") },
      { header: "Status", accessor: "Status" },
      { header: "Senior Approval", accessor: "SeniorApprovalStatus" },
      { header: "Customer Approval", accessor: "CustomerApprovalStatus" },
    ],
  },
  {
    id: "crm-welcome-call-report",
    label: "Welcome Call Report",
    description: "Post-booking onboarding call outcomes",
    icon: PhoneCall,
    color: "#0e7490",
    apiPath: "/api/crm/reports/welcome-call-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Call Date", accessor: (r) => (r.CallDate ? String(r.CallDate).slice(0, 10) : "—") },
      { header: "Outcome", accessor: "Outcome" },
      { header: "Next Call", accessor: (r) => (r.NextCallDate ? String(r.NextCallDate).slice(0, 10) : "—") },
      { header: "Payment Plan Confirmed", accessor: (r) => (r.PaymentPlanConfirmed ? "Yes" : "No") },
    ],
  },
  {
    id: "crm-parking-report",
    label: "Parking Allotment Report",
    description: "Parking slot sales & payment status",
    icon: Warehouse,
    color: "#155e75",
    apiPath: "/api/crm/reports/parking-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Booking No", accessor: (r) => (r.BookingNo ?? "—") as string },
      { header: "Applicant", accessor: (r) => (r.ApplicantName ?? "—") as string },
      { header: "Slot No", accessor: "ParkingSlotNo" },
      { header: "Qty", accessor: "Quantity" },
      { header: "Total Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Payment Status", accessor: "PaymentStatus" },
      { header: "Created", accessor: (r) => (r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "crm-possession-notice-report",
    label: "Possession Notice Report",
    description: "Possession offer notices & response deadlines",
    icon: MapPinned,
    color: "#0369a1",
    apiPath: "/api/crm/reports/possession-notice-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Notice No", accessor: "NoticeNo" },
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Offered Date", accessor: (r) => (r.OfferedDate ? String(r.OfferedDate).slice(0, 10) : "—") },
      { header: "Response Deadline", accessor: (r) => (r.ResponseDeadline ? String(r.ResponseDeadline).slice(0, 10) : "—") },
      { header: "Delivery Mode", accessor: "DeliveryMode" },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "crm-pre-possession-report",
    label: "Pre-Possession Inspection",
    description: "Unit inspection scheduling before handover",
    icon: MapPinned,
    color: "#0c4a6e",
    apiPath: "/api/crm/reports/pre-possession-report",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: null, dateToParam: null },
    columns: [
      { header: "Booking No", accessor: "BookingNo" },
      { header: "Applicant", accessor: "ApplicantName" },
      { header: "Scheduled Inspection", accessor: (r) => (r.ScheduledInspectionDate ? String(r.ScheduledInspectionDate).slice(0, 10) : "—") },
      { header: "Status", accessor: "Status" },
      { header: "Created", accessor: (r) => (r.CreatedDate ? String(r.CreatedDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "crm-construction-updates",
    label: "Construction Update Report",
    description: "Project-wise construction progress log",
    icon: Wrench,
    color: "#164e63",
    apiPath: "/api/crm/reports/construction-updates",
    filterConfig: { companyParam: null, finYearParam: null, singleDateParam: null, dateFromParam: "from", dateToParam: "to" },
    columns: [
      { header: "Project", accessor: "ProjectName" },
      { header: "Update Date", accessor: (r) => (r.UpdateDate ? String(r.UpdateDate).slice(0, 10) : "—") },
      { header: "% Complete", accessor: (r) => (r.PercentComplete != null ? `${r.PercentComplete}%` : "—") },
      { header: "Stage", accessor: "Stage" },
      { header: "Summary", accessor: (r) => (r.Summary ?? "—") as string },
    ],
  },
];

const REPORT_MAP = new Map(ALL_REPORTS.map((r) => [r.id, r]));

// ── Module sections ───────────────────────────────────────────────────────────

const MODULE_SECTIONS: ModuleSection[] = [
  {
    id: "finance",
    label: "Finance",
    accent: "#6366f1",
    description: "Payments, receipts, bank reconciliation & ledgers",
    icon: IndianRupee,
    reportIds: [
      "payment-register",
      "payment-reason-report",
      "received-payment",
      "emi-register",
      "pending-payment",
      "bank-report",
      "brs-report",
      "ledger-report",
      "journal-voucher-report",
      "on-account-report",
      "pdc-report",
      "cancelled-cheques-report",
      "tds-report",
    ],
  },
  {
    id: "material",
    label: "Material",
    accent: "#10b981",
    description: "Purchase orders, GRN, stock, issues & work orders",
    icon: Boxes,
    reportIds: [
      "po-register",
      "grn-register",
      "pending-mr-report",
      "issue-register",
      "stock-summary",
      "inter-company-transfer-report",
      "asset-transfer-report",
      "work-order-register",
      "boq-register",
      "work-done",
      "bounced-cheques",
      "quality-debit-note-report",
    ],
  },
  {
    id: "admin",
    label: "Admin",
    accent: "#f59e0b",
    description: "Invoices, suppliers, approval requests & user activity",
    icon: Settings2,
    reportIds: [
      "invoice-register",
      "supplier-report",
      "pending-requests",
      "user-activity",
    ],
  },
  {
    id: "sales-automation",
    label: "Sales Automation",
    accent: "#d946ef",
    description: "Leads, campaigns, ad performance, site visits & CRM conversion",
    icon: Megaphone,
    reportIds: [
      "sa-lead-source",
      "sa-campaign-performance",
      "sa-ad-performance",
      "sa-daily-ad-performance",
      "sa-cost-per-lead",
      "sa-sales-performance",
      "sa-team-leader-performance",
      "sa-executive-performance",
      "sa-inquiry-status",
      "sa-site-visit",
      "sa-booking-conversion",
      "sa-marketing-roi",
    ],
  },
  {
    id: "crm",
    label: "CRM",
    accent: "#0891b2",
    description: "Bookings, payment collection, brokerage & cancellations",
    icon: ClipboardList,
    reportIds: [
      "crm-booking-register",
      "crm-payment-collection",
      "crm-receipt-register",
      "crm-overdue-payments",
      "crm-brokerage-report",
      "crm-cancellation-report",
      "crm-booking-status-summary",
      "crm-customer-report",
      "crm-application-funnel",
      "crm-service-tickets",
      "crm-legal-milestones",
      "crm-noc-report",
      "crm-sales-deed-report",
      "crm-handover-report",
      "crm-agreement-report",
      "crm-welcome-call-report",
      "crm-parking-report",
      "crm-possession-notice-report",
      "crm-pre-possession-report",
      "crm-construction-updates",
    ],
  },
];

// ── Filter bar (inside expanded section) ─────────────────────────────────────

const SectionFilters: React.FC<{
  companies: CompanyOption[];
  finYears: FinYearOption[];
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  activeFilters: ActiveFilter[];
  onClearAll: () => void;
}> = ({
  companies,
  finYears,
  filters,
  onChange,
  activeFilters,
  onClearAll,
}) => (
  <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2.5">
    <div className="flex flex-wrap items-end gap-2.5">
      {/* Company */}
      <div className="min-w-[160px] flex-1 max-w-[210px]">
        <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Company
        </label>
        <div className="relative">
          <Building2
            size={11}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={filters.companyId}
            onChange={(e) => onChange({ companyId: e.target.value })}
            className="w-full appearance-none pl-7 pr-6 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          >
            <option value="">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={11}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>
      </div>

      {/* Fin Year */}
      <div className="min-w-[140px] flex-1 max-w-[180px]">
        <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Financial Year
        </label>
        <div className="relative">
          <Calendar
            size={11}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={filters.finYearId}
            onChange={(e) => onChange({ finYearId: e.target.value })}
            className="w-full appearance-none pl-7 pr-6 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          >
            <option value="">All Years</option>
            {finYears.map((f) => (
              <option key={f.FId} value={String(f.FId)}>
                {f.FName}
              </option>
            ))}
          </select>
          <ChevronDown
            size={11}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>
      </div>

      {/* Date mode + inputs */}
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Date
          </label>
          <div className="flex rounded-lg border border-border overflow-hidden bg-muted/30 h-[34px]">
            {(["single", "range"] as DateMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ dateMode: m })}
                className={`px-3 flex items-center gap-1 text-[11px] font-medium transition-all
                  ${filters.dateMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "single" ? (
                  <Calendar size={10} />
                ) : (
                  <CalendarRange size={10} />
                )}
                {m === "single" ? "Day" : "Range"}
              </button>
            ))}
          </div>
        </div>

        {filters.dateMode === "single" ? (
          <input
            type="date"
            value={filters.singleDate}
            onChange={(e) => onChange({ singleDate: e.target.value })}
            disabled={!!filters.finYearId}
            className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-[34px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40 transition-all"
          />
        ) : (
          <div className="flex gap-1.5 items-center">
            <input
              type="date"
              value={filters.rangeFrom}
              onChange={(e) => onChange({ rangeFrom: e.target.value })}
              disabled={!!filters.finYearId}
              className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-[34px] w-[130px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40 transition-all"
            />
            <span className="text-[10px] text-muted-foreground">→</span>
            <input
              type="date"
              value={filters.rangeTo}
              onChange={(e) => onChange({ rangeTo: e.target.value })}
              disabled={!!filters.finYearId}
              className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-[34px] w-[130px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40 transition-all"
            />
          </div>
        )}
      </div>

      {/* Clear */}
      {activeFilters.length > 0 && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1 px-2.5 py-2 h-[34px] rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>

    {/* Active chips */}
    {activeFilters.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider">
          Active:
        </span>
        {activeFilters.map((f) => (
          <span
            key={f.label}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20"
          >
            {f.label}
            <button
              onClick={f.clear}
              className="hover:text-destructive transition-colors"
            >
              <X size={8} />
            </button>
          </span>
        ))}
      </div>
    )}
  </div>
);

// ── Report data table ─────────────────────────────────────────────────────────

const ReportTable: React.FC<{
  report: ReportDef;
  filters: FilterState;
  onClose: () => void;
}> = ({ report, filters, onClose }) => {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const PAGE_SIZE = 20;

  // ── Godown switcher (stock-summary only) ─────────────────────────────────
  const isStockSummary = report.id === "stock-summary";
  const [godownId, setGodownId] = useState<string>("");
  const [godowns, setGodowns] = useState<
    { GodownID: number; GodownName: string; IsMain: number }[]
  >([]);
  useEffect(() => {
    if (!isStockSummary) return;
    fetchWithAuth("/api/godowns")
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        const list = Array.isArray(j) ? j : (j.data ?? []);
        setGodowns(list);
        // Default to the main godown
        const main = list.find((g: { IsMain: number }) => g.IsMain);
        if (main) setGodownId(String(main.GodownID));
      })
      .catch(() => {});
  }, [isStockSummary]);

  // ── Payment Reason switcher (payment-reason-report only) ─────────────────
  const isPaymentReasonReport = report.id === "payment-reason-report";
  const [reasonFilter, setReasonFilter] = useState<string>("");
  const [reasonOptions, setReasonOptions] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!isPaymentReasonReport) return;
    fetchWithAuth("/api/payment-reason-master/options")
      .then((r) => r.json().catch(() => []))
      .then((list) => setReasonOptions(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [isPaymentReasonReport]);

  const buildParams = (): Record<string, string> => {
    const fc = report.filterConfig ?? {};
    const f: Record<string, string> = {};

    // ── Company ───────────────────────────────────────────────────────────────
    // Default param name is "companyId". If filterConfig.companyParam is null, skip.
    const compParam = "companyParam" in fc ? fc.companyParam : "companyId";
    if (compParam && filters.companyId) f[compParam] = filters.companyId;

    // ── Financial year / Date ─────────────────────────────────────────────────
    // fin-year takes priority over calendar dates (same as the UI logic).
    const fyParam = "finYearParam" in fc ? fc.finYearParam : null;
    // Default single-date param: "dateFrom"  Default range params: "dateFrom"/"dateTo"
    const sdParam = "singleDateParam" in fc ? fc.singleDateParam : "dateFrom";
    const dfParam = "dateFromParam" in fc ? fc.dateFromParam : "dateFrom";
    const dtParam = "dateToParam" in fc ? fc.dateToParam : "dateTo";

    if (filters.finYearId) {
      if (fyParam) f[fyParam] = filters.finYearId;
    } else if (filters.dateMode === "single" && filters.singleDate) {
      if (sdParam) f[sdParam] = filters.singleDate;
    } else if (
      filters.dateMode === "range" &&
      filters.rangeFrom &&
      filters.rangeTo
    ) {
      if (dfParam) f[dfParam] = filters.rangeFrom;
      if (dtParam) f[dtParam] = filters.rangeTo;
    }

    // Stock summary: pass selected godownId to inventory-master
    if (isStockSummary && godownId) f["godownId"] = godownId;

    // Payment Reason Report: scope to a single reason when selected
    if (isPaymentReasonReport && reasonFilter) f["reason"] = reasonFilter;

    return f;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        ...report.defaultParams,
        ...buildParams(),
        limit: "500",
      });
      const res = await fetchWithAuth(`${report.apiPath}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Some routes return a plain array; others wrap in { data: [...] }.
      // stock-summary uses { byItem: [...] }. Honour filterConfig.dataKey.
      const dataKey = report.filterConfig?.dataKey ?? "data";
      const data: Record<string, unknown>[] = Array.isArray(json)
        ? json
        : (json[dataKey] ?? json.data ?? json.records ?? []);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    report.id,
    filters.companyId,
    filters.finYearId,
    filters.singleDate,
    filters.rangeFrom,
    filters.rangeTo,
    godownId,
    reasonFilter,
  ]);

  useEffect(() => {
    load();
    setPage(1);
  }, [load]);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cell = (row: Record<string, unknown>, col: ExportColumn): string => {
    if (typeof col.accessor === "function") return col.accessor(row) as string;
    const v = row[col.accessor as string];
    return v == null ? "—" : String(v);
  };

  return (
    <>
    <div
      className="rounded-xl border border-border bg-card overflow-hidden"
      style={{ borderTopWidth: 2, borderTopColor: report.color }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/10">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={13} /> Back
          </button>
          <span className="text-border">|</span>
          <div
            className="p-1.5 rounded-md"
            style={{ background: `${report.color}18` }}
          >
            <report.icon size={13} style={{ color: report.color }} />
          </div>
          <span className="text-sm font-heading font-semibold text-foreground">
            {report.label}
          </span>
          {!loading && !error && (
            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {rows.length} records
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />{" "}
            Refresh
          </button>

          {/* Godown switcher — stock-summary only */}
          {isStockSummary && godowns.length > 0 && (
            <div className="relative flex items-center">
              <Warehouse
                size={11}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={godownId}
                onChange={(e) => setGodownId(e.target.value)}
                className="appearance-none pl-7 pr-6 py-1.5 h-[30px] rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              >
                {godowns.map((g) => (
                  <option key={g.GodownID} value={String(g.GodownID)}>
                    {g.GodownName}
                    {g.IsMain ? " ★" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={11}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          )}

          {/* Reason switcher — payment-reason-report only */}
          {isPaymentReasonReport && reasonOptions.length > 0 && (
            <div className="relative flex items-center">
              <Receipt
                size={11}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value)}
                className="appearance-none pl-7 pr-6 py-1.5 h-[30px] rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              >
                <option value="">All Reasons</option>
                {reasonOptions.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={11}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          )}

          <ExportMenu
            data={rows as unknown as Record<string, unknown>[]}
            columns={report.columns}
            title={report.label}
            filename={report.id}
            disabled={loading || rows.length === 0}
          />
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading {report.label}…</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <AlertCircle size={16} className="text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={load}
            className="text-xs underline hover:text-foreground"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <FileText size={16} />
          <p className="text-sm">No records found</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider w-8">
                    #
                  </th>
                  {report.columns.map((col) => (
                    <th
                      key={col.header}
                      className="px-4 py-2.5 text-left text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {pageRows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setSelectedRow(row)}
                    className="hover:bg-muted/20 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {(page - 1) * PAGE_SIZE + i + 1}
                    </td>
                    {report.columns.map((col) => (
                      <td
                        key={col.header}
                        className="px-4 py-2.5 text-xs text-foreground whitespace-nowrap max-w-[200px] truncate"
                      >
                        {cell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  Prev
                </button>
                <span className="px-2">
                  {page}/{totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {/* ── Row detail card ── */}
    <Dialog open={!!selectedRow} onOpenChange={(o) => { if (!o) setSelectedRow(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${report.color}18` }}>
              <report.icon size={14} style={{ color: report.color }} />
            </div>
            {report.label}
          </DialogTitle>
        </DialogHeader>
        {selectedRow && (
          <div className="divide-y divide-border">
            {report.columns.map((col) => {
              const val = cell(selectedRow, col);
              if (!val || val === "—") return null;
              return (
                <div key={col.header} className="flex items-start justify-between gap-6 py-2.5">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 w-28 pt-0.5">
                    {col.header}
                  </span>
                  <span className="text-sm text-foreground text-right break-all">
                    {val}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
};

// ── Report tile ───────────────────────────────────────────────────────────────

const ReportTile: React.FC<{
  report: ReportDef;
  active: boolean;
  onClick: () => void;
}> = ({ report, active, onClick }) => (
  <button
    onClick={onClick}
    className={`group flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-all duration-150 w-full
      ${
        active
          ? "border-2 bg-card shadow-sm"
          : "border-border/60 bg-card/50 hover:bg-card hover:border-border hover:shadow-sm"
      }`}
    style={
      active
        ? {
            borderColor: report.color,
            boxShadow: `0 2px 10px ${report.color}18`,
          }
        : {}
    }
  >
    <div
      className="shrink-0 p-2 rounded-lg transition-colors"
      style={{ background: `${report.color}15` }}
    >
      <report.icon size={15} style={{ color: report.color }} />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-heading font-semibold text-foreground truncate leading-tight">
        {report.label}
      </p>
      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
        {report.description}
      </p>
    </div>
    {active && (
      <div
        className="shrink-0 w-1.5 h-1.5 rounded-full"
        style={{ background: report.color }}
      />
    )}
  </button>
);

// ── Main page ─────────────────────────────────────────────────────────────────

// marketing_head is scoped to Sales Automation + CRM only (see auth.utils.ts
// isMarketingHeadPage) — showing Finance/Material/Admin tiles they can't
// actually open would just be a dead end (backend 403s on click).
const MARKETING_HEAD_SECTION_IDS = new Set(["sales-automation", "crm"]);

const Reports: React.FC = () => {
  usePageRights("reports");
  const { currentUser } = useAuth();
  const visibleSections =
    currentUser?.role === "marketing_head"
      ? MODULE_SECTIONS.filter((s) => MARKETING_HEAD_SECTION_IDS.has(s.id))
      : MODULE_SECTIONS;

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [finYears, setFinYears] = useState<FinYearOption[]>([]);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    companyId: "",
    finYearId: "",
    dateMode: "single",
    singleDate: "",
    rangeFrom: "",
    rangeTo: "",
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetchWithAuth("/api/reports/companies")
      .then((r) => r.json().catch(() => ({})))
      .then((l: CompanyOption[]) => setCompanies(Array.isArray(l) ? l : []))
      .catch(() => {});
    fetchWithAuth("/api/fin-year")
      .then((r) => r.json().catch(() => ({})))
      .then((l: FinYearOption[]) => setFinYears(Array.isArray(l) ? l : []))
      .catch(() => {});
  }, []);

  const patchFilters = (patch: Partial<FilterState>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const clearFilters = () =>
    setFilters({
      companyId: "",
      finYearId: "",
      dateMode: "single",
      singleDate: "",
      rangeFrom: "",
      rangeTo: "",
    });

  // Build active filter chips
  const activeFilters: ActiveFilter[] = [];
  if (filters.companyId) {
    const c = companies.find((x) => String(x.id) === filters.companyId);
    if (c)
      activeFilters.push({
        label: c.name,
        clear: () => patchFilters({ companyId: "" }),
      });
  }
  if (filters.finYearId) {
    const fy = finYears.find((f) => String(f.FId) === filters.finYearId);
    if (fy)
      activeFilters.push({
        label: fy.FName,
        clear: () => patchFilters({ finYearId: "" }),
      });
  } else {
    if (filters.singleDate)
      activeFilters.push({
        label: filters.singleDate,
        clear: () => patchFilters({ singleDate: "" }),
      });
    if (filters.rangeFrom && filters.rangeTo)
      activeFilters.push({
        label: `${filters.rangeFrom} → ${filters.rangeTo}`,
        clear: () => patchFilters({ rangeFrom: "", rangeTo: "" }),
      });
  }

  const handleSectionClick = (id: string) => {
    const opening = openSection !== id;
    setOpenSection(opening ? id : null);
    setActiveReport(null);
    if (opening) {
      setTimeout(
        () =>
          sectionRefs.current[id]?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          }),
        80,
      );
    }
  };

  const handleTileClick = (reportId: string) => {
    setActiveReport((prev) => (prev === reportId ? null : reportId));
    setTimeout(
      () =>
        panelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      60,
    );
  };

  return (
    <div className="flex flex-col min-h-0">
      <Breadcrumbs items={["Dashboard", "Reports"]} />

      <AdminShell
        title="Reports"
        subtitle={
          openSection
            ? `${visibleSections.find((s) => s.id === openSection)?.label} · ${visibleSections.find((s) => s.id === openSection)?.reportIds.length} reports available`
            : "Select a module to explore reports"
        }
        icon={BarChart3}
      >
      {/* Module sections */}
      <div className="space-y-3">
        {visibleSections.map((section) => {
          const isOpen = openSection === section.id;
          const reports = section.reportIds
            .map((id) => REPORT_MAP.get(id))
            .filter(Boolean) as ReportDef[];
          const activeReportDef = activeReport
            ? REPORT_MAP.get(activeReport)
            : undefined;
          const reportHere =
            !!activeReport && section.reportIds.includes(activeReport);

          return (
            <div
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
            >
              {/* ── Module toggle ── */}
              <button
                onClick={() => handleSectionClick(section.id)}
                className={`group relative w-full flex items-center gap-4 px-5 py-4 rounded-2xl border text-left transition-all duration-200
                  ${isOpen ? "border-2 bg-card shadow-md" : "border-border bg-card hover:shadow-sm hover:-translate-y-0.5"}`}
                style={
                  isOpen
                    ? {
                        borderColor: section.accent,
                        boxShadow: `0 4px 20px ${section.accent}12`,
                      }
                    : {}
                }
              >
                {/* Accent bar */}
                <div
                  className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full"
                  style={{
                    background: isOpen ? section.accent : `${section.accent}40`,
                  }}
                />

                {/* Icon */}
                <div
                  className="shrink-0 p-2.5 rounded-xl ml-1"
                  style={{ background: `${section.accent}12` }}
                >
                  <section.icon size={20} style={{ color: section.accent }} />
                </div>

                {/* Label + description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-heading font-bold text-foreground">
                      {section.label}
                    </span>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                      style={{
                        background: `${section.accent}10`,
                        color: section.accent,
                        borderColor: `${section.accent}30`,
                      }}
                    >
                      {reports.length} reports
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>

                {/* Icon previews */}
                <div className="hidden md:flex items-center gap-1.5 shrink-0">
                  {reports.slice(0, 5).map((r) => (
                    <div
                      key={r.id}
                      className="p-1.5 rounded-lg opacity-40 group-hover:opacity-70 transition-opacity"
                      style={{ background: `${r.color}18` }}
                    >
                      <r.icon size={11} style={{ color: r.color }} />
                    </div>
                  ))}
                  {reports.length > 5 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{reports.length - 5}
                    </span>
                  )}
                </div>

                <ChevronRight
                  size={15}
                  className={`shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                />
              </button>

              {/* ── Expanded section ── */}
              {isOpen && (
                <div className="mt-2 rounded-2xl border border-border/60 bg-background/40 overflow-hidden">
                  {/* Filters */}
                  <div className="p-3 border-b border-border/50">
                    <SectionFilters
                      companies={companies}
                      finYears={finYears}
                      filters={filters}
                      onChange={patchFilters}
                      activeFilters={activeFilters}
                      onClearAll={clearFilters}
                    />
                  </div>

                  {/* Tiles */}
                  <div className="p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                      {reports.map((report) => (
                        <ReportTile
                          key={report.id}
                          report={report}
                          active={activeReport === report.id}
                          onClick={() => handleTileClick(report.id)}
                        />
                      ))}
                    </div>

                    {/* Report table */}
                    <div ref={reportHere ? panelRef : undefined}>
                      {reportHere && activeReportDef && (
                        <ReportTable
                          key={activeReportDef.id}
                          report={activeReportDef}
                          filters={filters}
                          onClose={() => setActiveReport(null)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </AdminShell>
    </div>
  );
};

export default Reports;
