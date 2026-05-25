import React, { useState, useCallback, useEffect, useRef } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { exportToCsv } from "@/lib/export";
import type { ExportColumn } from "@/lib/export";
import {
  Building2,
  Calendar,
  CalendarRange,
  ChevronDown,
  Filter,
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
  Download,
  ChevronLeft,
  AlertCircle,
  Loader2,
  FileText,
  ArrowUpDown,
  ChevronRight,
  IndianRupee,
  Boxes,
  Settings2,
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
      { header: "Doc No", accessor: "DocNo" },
      {
        header: "Date",
        accessor: (r) => (r.PDate ? String(r.PDate).slice(0, 10) : "—"),
      },
      { header: "Party", accessor: "PPaymentName" },
      { header: "Mode", accessor: "PMode" },
      { header: "Amount", accessor: (r) => fmt(r.PAmount as number) },
      { header: "Bank", accessor: "PBankName" },
      { header: "Status", accessor: "Status" },
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
      {
        header: "PO No",
        accessor: (r) => (r.PurchaseOrderNo ?? r.PONo ?? "—") as string,
      },
      {
        header: "Date",
        accessor: (r) => (r.PODate ? String(r.PODate).slice(0, 10) : "—"),
      },
      { header: "Vendor", accessor: "SupplierName" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Status", accessor: "Status" },
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
      { header: "GRN No", accessor: "GRNNo" },
      {
        header: "Date",
        accessor: (r) => (r.GRNDate ? String(r.GRNDate).slice(0, 10) : "—"),
      },
      { header: "Supplier", accessor: "SupplierName" },
      { header: "Doc No", accessor: "DocNo" },
      { header: "Status", accessor: "Status" },
      { header: "Remarks", accessor: "Remarks" },
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
    apiPath: "/api/stock-ledger",
    defaultParams: { view: "summary" },
    // stockLedger returns { data: ledger rows, byItem: item-level summary, godowns: [] }.
    // For the summary report we want the byItem array broken down per godown.
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      dataKey: "byItem",
    },
    columns: [
      { header: "Item", accessor: "ItemName" },
      { header: "Group", accessor: "ItemGroupName" },
      {
        header: "Godown",
        accessor: (r) => (r.GodownName ?? "Main Godown") as string,
      },
      { header: "In", accessor: "stockIn" },
      { header: "Out", accessor: "stockOut" },
      { header: "Balance", accessor: "balance" },
      { header: "UOM", accessor: (r) => (r.UOMName ?? r.UOM ?? "—") as string },
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
    apiPath: "/api/expense-booking",
    // expenseBooking GET / accepts ?finYear=<id>. No date range or company filter.
    filterConfig: {
      companyParam: null,
      finYearParam: "finYear",
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Invoice No", accessor: "EDocNo" },
      {
        header: "Date",
        accessor: (r) => (r.EDocDate ? String(r.EDocDate).slice(0, 10) : "—"),
      },
      { header: "Project", accessor: "EProjectName" },
      { header: "Amount", accessor: (r) => fmt(r.EAmount as number) },
      {
        header: "Net Amount",
        accessor: (r) => fmt((r.ENetAmount ?? r.EAmount) as number),
      },
      { header: "Status", accessor: "EStatus" },
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
      "received-payment",
      "emi-register",
      "pending-payment",
      "bank-report",
      "brs-report",
      "ledger-report",
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
      "issue-register",
      "stock-summary",
      "work-order-register",
      "boq-register",
      "work-done",
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
  const PAGE_SIZE = 20;

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
          <button
            onClick={() => exportToCsv(rows, report.columns, report.id)}
            disabled={loading || rows.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            <Download size={11} /> Export CSV
          </button>
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
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
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

const Reports: React.FC = () => {
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
      .then((r) => r.json())
      .then((l: CompanyOption[]) => setCompanies(Array.isArray(l) ? l : []))
      .catch(() => {});
    fetchWithAuth("/api/fin-year")
      .then((r) => r.json())
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

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <BarChart3 size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground leading-tight">
            Reports
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {openSection
              ? `${MODULE_SECTIONS.find((s) => s.id === openSection)?.label} · ${MODULE_SECTIONS.find((s) => s.id === openSection)?.reportIds.length} reports available`
              : "Select a module to explore reports"}
          </p>
        </div>
      </div>

      {/* Module sections */}
      <div className="space-y-3">
        {MODULE_SECTIONS.map((section) => {
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
    </div>
  );
};

export default Reports;
