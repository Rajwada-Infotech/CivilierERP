import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SummaryCards } from "@/components/reports/SummaryCards";
import { IncomeVsExpenseChart } from "@/components/reports/IncomeVsExpenseChart";
import { ExpenseByCategoryChart } from "@/components/reports/ExpenseByCategoryChart";
import { CashFlowChart } from "@/components/reports/CashFlowChart";
import { TopPartiesTable } from "@/components/reports/TopPartiesTable";
import { ExportMenu } from "@/components/ExportMenu";
import { exportToCsv } from "@/lib/export";
import type { ExportColumn } from "@/lib/export";
import { getCompanyById } from "@/api/enterpriseApi";
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
  SlidersHorizontal,
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
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportsSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  transactionCount: number;
}
interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
}
interface CategoryPoint {
  name: string;
  value: number;
  color: string;
}
interface CashFlowPoint {
  month: string;
  balance: number;
}
interface TopParty {
  name: string;
  txns: number;
  total: number;
}
interface ReportsData {
  summary: ReportsSummary;
  filters: {
    companyId: string | null;
    mode: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    finYearLabel: string | null;
  };
  charts: {
    monthly: MonthlyPoint[];
    categories: CategoryPoint[];
    cashFlow: CashFlowPoint[];
  };
  topParties: TopParty[];
}
interface CompanyOption {
  id: number;
  name: string;
}
interface FinYearOption {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
  FStatus: string;
}
type DateMode = "single" | "range";
type FinYearGranularity = "year" | "month" | "day";

// ── Report tile definitions ───────────────────────────────────────────────────

interface ReportDef {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  apiPath: string;
  // Map of field key → column header for CSV + table display
  columns: ExportColumn[];
  // Optional query params to append
  defaultParams?: Record<string, string>;
}

const fmt = (n: number | undefined | null) =>
  n == null
    ? "—"
    : "Rs." +
      new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
        Number(n),
      );

const REPORTS: ReportDef[] = [
  {
    id: "payment-register",
    label: "Payment Register",
    description: "All outward payments with mode & amount",
    icon: Banknote,
    color: "#6366f1",
    apiPath: "/api/new-payment",
    columns: [
      { header: "Doc No", accessor: "PaymentNo" },
      {
        header: "Date",
        accessor: (r) =>
          r.PaymentDate ? String(r.PaymentDate).slice(0, 10) : "—",
      },
      { header: "Party", accessor: "PartyName" },
      { header: "Mode", accessor: "PaymentMode" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      { header: "Bank", accessor: "BankName" },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "emi-register",
    label: "EMI Register",
    description: "EMI schedules across received payments",
    icon: CreditCard,
    color: "#8b5cf6",
    apiPath: "/api/received-payment",
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
    defaultParams: { isEmi: "1" },
  },
  {
    id: "po-register",
    label: "PO Register",
    description: "All purchase orders with vendor & value",
    icon: ShoppingCart,
    color: "#f59e0b",
    apiPath: "/api/purchase-orders",
    columns: [
      { header: "PO No", accessor: "PONo" },
      {
        header: "Date",
        accessor: (r) => (r.PODate ? String(r.PODate).slice(0, 10) : "—"),
      },
      { header: "Vendor", accessor: "VendorName" },
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
    columns: [
      { header: "GRN No", accessor: "GRNNo" },
      {
        header: "Date",
        accessor: (r) => (r.GRNDate ? String(r.GRNDate).slice(0, 10) : "—"),
      },
      { header: "Supplier", accessor: "SupplierName" },
      { header: "PO Ref", accessor: "PONo" },
      { header: "Total Qty", accessor: "TotalQty" },
      { header: "Total Value", accessor: (r) => fmt(r.TotalValue as number) },
    ],
  },
  {
    id: "issue-register",
    label: "Issue Register",
    description: "Material issues to sites and projects",
    icon: ArrowDownToLine,
    color: "#ef4444",
    apiPath: "/api/material-issues",
    columns: [
      { header: "Issue No", accessor: "IssueNo" },
      {
        header: "Date",
        accessor: (r) => (r.IssueDate ? String(r.IssueDate).slice(0, 10) : "—"),
      },
      { header: "Project", accessor: "ProjectName" },
      { header: "Item", accessor: "ItemName" },
      { header: "Qty", accessor: "Quantity" },
      { header: "UOM", accessor: "UOM" },
      { header: "Issued By", accessor: "IssuedBy" },
    ],
  },
  {
    id: "stock-summary",
    label: "Stock Summary",
    description: "Current stock levels across all items",
    icon: Layers,
    color: "#06b6d4",
    apiPath: "/api/stock-ledger",
    columns: [
      { header: "Item", accessor: "ItemName" },
      { header: "Item Code", accessor: "ItemCode" },
      { header: "Opening Qty", accessor: "OpeningQty" },
      { header: "Received Qty", accessor: "ReceivedQty" },
      { header: "Issued Qty", accessor: "IssuedQty" },
      { header: "Closing Qty", accessor: "ClosingQty" },
      { header: "UOM", accessor: "UOM" },
    ],
  },
  {
    id: "bank-report",
    label: "Bank Report",
    description: "Bank reconciliation statement summary",
    icon: Landmark,
    color: "#0ea5e9",
    apiPath: "/api/brs",
    columns: [
      {
        header: "Date",
        accessor: (r) =>
          r.TransactionDate ? String(r.TransactionDate).slice(0, 10) : "—",
      },
      { header: "Bank", accessor: "BankName" },
      { header: "Narration", accessor: "Narration" },
      { header: "Debit", accessor: (r) => fmt(r.Debit as number) },
      { header: "Credit", accessor: (r) => fmt(r.Credit as number) },
      { header: "Balance", accessor: (r) => fmt(r.Balance as number) },
    ],
  },
  {
    id: "ledger-report",
    label: "Ledger Report",
    description: "General ledger entries by account head",
    icon: BookOpen,
    color: "#64748b",
    apiPath: "/api/general-ledger",
    columns: [
      { header: "Account", accessor: "AccountName" },
      { header: "Account Code", accessor: "AccountCode" },
      { header: "Type", accessor: "LHeadType" },
      {
        header: "Opening Balance",
        accessor: (r) => fmt(r.OpeningBalance as number),
      },
      { header: "Debit", accessor: (r) => fmt(r.TotalDebit as number) },
      { header: "Credit", accessor: (r) => fmt(r.TotalCredit as number) },
    ],
  },
  {
    id: "work-order-register",
    label: "Work Order Register",
    description: "All work orders with contractor & value",
    icon: Wrench,
    color: "#f97316",
    apiPath: "/api/work-orders",
    columns: [
      { header: "WO No", accessor: "WONo" },
      {
        header: "Date",
        accessor: (r) => (r.WODate ? String(r.WODate).slice(0, 10) : "—"),
      },
      { header: "Contractor", accessor: "ContractorName" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Value", accessor: (r) => fmt(r.TotalValue as number) },
      { header: "Status", accessor: "Status" },
    ],
  },
  {
    id: "boq-register",
    label: "BOQ Register",
    description: "Bill of quantities with item-wise breakdown",
    icon: FileBarChart2,
    color: "#84cc16",
    apiPath: "/api/boq",
    columns: [
      { header: "BOQ No", accessor: "BOQNo" },
      { header: "Project", accessor: "ProjectName" },
      { header: "Item", accessor: "ItemDescription" },
      { header: "Qty", accessor: "Quantity" },
      { header: "Rate", accessor: (r) => fmt(r.Rate as number) },
      { header: "Total", accessor: (r) => fmt(r.TotalAmount as number) },
    ],
  },
  {
    id: "user-activity",
    label: "User Activity Report",
    description: "Login, access and audit trail logs",
    icon: Users,
    color: "#a855f7",
    apiPath: "/api/user-activity",
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
    defaultParams: { limit: "200" },
  },
  {
    id: "pending-payment",
    label: "Pending Payment Register",
    description: "Payments awaiting approval or disbursement",
    icon: Clock,
    color: "#f43f5e",
    apiPath: "/api/new-payment",
    columns: [
      { header: "Doc No", accessor: "PaymentNo" },
      {
        header: "Date",
        accessor: (r) =>
          r.PaymentDate ? String(r.PaymentDate).slice(0, 10) : "—",
      },
      { header: "Party", accessor: "PartyName" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
      { header: "Mode", accessor: "PaymentMode" },
      { header: "Status", accessor: "Status" },
    ],
    defaultParams: { status: "pending" },
  },
  {
    id: "brs-report",
    label: "BRS Report",
    description: "Full bank reconciliation statement",
    icon: ArrowUpDown,
    color: "#14b8a6",
    apiPath: "/api/brs",
    columns: [
      { header: "Voucher No", accessor: "VoucherNo" },
      {
        header: "Date",
        accessor: (r) =>
          r.TransactionDate ? String(r.TransactionDate).slice(0, 10) : "—",
      },
      { header: "Bank", accessor: "BankName" },
      { header: "Particulars", accessor: "Narration" },
      { header: "Debit", accessor: (r) => fmt(r.Debit as number) },
      { header: "Credit", accessor: (r) => fmt(r.Credit as number) },
      { header: "Cleared", accessor: (r) => (r.IsCleared ? "Yes" : "No") },
    ],
  },
  {
    id: "pending-requests",
    label: "Pending Request Report",
    description: "Approval inbox items awaiting action",
    icon: GitPullRequest,
    color: "#fb923c",
    apiPath: "/api/approval-inbox",
    columns: [
      { header: "Doc No", accessor: "DocNo" },
      { header: "Module", accessor: "ModuleName" },
      { header: "Requested By", accessor: "RequestedBy" },
      {
        header: "Date",
        accessor: (r) =>
          r.RequestedAt ? String(r.RequestedAt).slice(0, 10) : "—",
      },
      { header: "Status", accessor: "Status" },
      { header: "Amount", accessor: (r) => fmt(r.Amount as number) },
    ],
  },
  {
    id: "work-done",
    label: "Work Done Report",
    description: "Completed work orders and progress summary",
    icon: ClipboardList,
    color: "#22c55e",
    apiPath: "/api/work-orders",
    columns: [
      { header: "WO No", accessor: "WONo" },
      { header: "Contractor", accessor: "ContractorName" },
      { header: "Project", accessor: "ProjectName" },
      {
        header: "Completed Date",
        accessor: (r) =>
          r.CompletedDate ? String(r.CompletedDate).slice(0, 10) : "—",
      },
      { header: "Value", accessor: (r) => fmt(r.TotalValue as number) },
      { header: "Status", accessor: "Status" },
    ],
    defaultParams: { status: "completed" },
  },
  {
    id: "invoice-register",
    label: "Invoice Register",
    description: "Service & item invoices across all projects",
    icon: Receipt,
    color: "#ec4899",
    apiPath: "/api/expense-booking",
    columns: [
      { header: "Invoice No", accessor: "EDocNo" },
      {
        header: "Date",
        accessor: (r) => (r.EDate ? String(r.EDate).slice(0, 10) : "—"),
      },
      { header: "Party", accessor: "EPartyName" },
      { header: "Project", accessor: "EProjectName" },
      { header: "Amount", accessor: (r) => fmt(r.EAmount as number) },
      { header: "GST", accessor: (r) => fmt(r.EGST as number) },
      { header: "Total", accessor: (r) => fmt(r.ETotalAmount as number) },
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
    columns: [
      { header: "Supplier Name", accessor: "name" },
      { header: "Type", accessor: "business_type" },
      { header: "GST No", accessor: "gst_no" },
      { header: "PAN", accessor: "pan_no" },
      { header: "Contact", accessor: "contact_person" },
      { header: "Phone", accessor: "phone" },
      { header: "City", accessor: "city" },
    ],
    defaultParams: { business_type: "S" },
  },
  {
    id: "received-payment",
    label: "Received Payment Register",
    description: "All inward payments received from clients",
    icon: TrendingUp,
    color: "#06d6a0",
    apiPath: "/api/received-payment",
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
];

// ── Small helpers ─────────────────────────────────────────────────────────────

const FilterChip: React.FC<{ label: string; onRemove: () => void }> = ({
  label,
  onRemove,
}) => (
  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary border border-primary/20">
    {label}
    <button
      onClick={onRemove}
      className="hover:text-destructive transition-colors"
    >
      <X size={10} />
    </button>
  </span>
);

const StyledSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
  className?: string;
}> = ({ value, onChange, placeholder, options, icon, className = "" }) => (
  <div className={`relative ${className}`}>
    {icon && (
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10">
        {icon}
      </span>
    )}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full appearance-none rounded-lg border border-border bg-card text-foreground text-sm py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${icon ? "pl-9" : "pl-3"}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown
      size={14}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
    />
  </div>
);

// ── Report panel (opens when tile is clicked) ─────────────────────────────────

interface ReportPanelProps {
  report: ReportDef;
  globalFilters: Record<string, string>;
  onClose: () => void;
}

const ReportPanel: React.FC<ReportPanelProps> = ({
  report,
  globalFilters,
  onClose,
}) => {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        ...report.defaultParams,
        ...globalFilters,
        limit: "500",
      });
      const res = await fetchWithAuth(`${report.apiPath}?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Handle both array responses and paginated { data: [] } shapes
      const data: Record<string, unknown>[] = Array.isArray(json)
        ? json
        : (json.data ?? json.records ?? []);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [report.apiPath, report.defaultParams, globalFilters]);

  useEffect(() => {
    load();
    setPage(1);
  }, [load]);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getCell = (row: Record<string, unknown>, col: ExportColumn): string => {
    if (typeof col.accessor === "function") return col.accessor(row) as string;
    const v = row[col.accessor as string];
    return v == null ? "—" : String(v);
  };

  const handleCsvExport = () => {
    exportToCsv(rows, report.columns, report.id);
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
          >
            <ChevronLeft size={14} /> Back to Reports
          </button>
          <span className="text-muted-foreground/40">|</span>
          <div className="flex items-center gap-2">
            <div
              className="p-1.5 rounded-lg"
              style={{ background: `${report.color}20` }}
            >
              <report.icon size={14} style={{ color: report.color }} />
            </div>
            <span className="text-sm font-heading font-semibold text-foreground">
              {report.label}
            </span>
            {!loading && !error && (
              <span className="text-[11px] text-muted-foreground">
                ({rows.length} records)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />{" "}
            Refresh
          </button>
          <button
            onClick={handleCsvExport}
            disabled={loading || rows.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* Body */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">Loading {report.label}…</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <AlertCircle size={20} className="text-destructive" />
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
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <FileText size={20} />
          <p className="text-sm">No records found</p>
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wider w-10">
                    #
                  </th>
                  {report.columns.map((col) => (
                    <th
                      key={col.header}
                      className="text-left px-4 py-2.5 text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {pageRows.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {(page - 1) * PAGE_SIZE + i + 1}
                    </td>
                    {report.columns.map((col) => (
                      <td
                        key={col.header}
                        className="px-4 py-2.5 text-xs text-foreground whitespace-nowrap max-w-[220px] truncate"
                      >
                        {getCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
              <span className="text-xs text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded text-xs border border-border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  Prev
                </button>
                <span className="px-3 text-xs text-muted-foreground">
                  {page}/{totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded text-xs border border-border disabled:opacity-40 hover:bg-muted/40 transition-colors"
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

// ── Tile component ────────────────────────────────────────────────────────────

const ReportTile: React.FC<{
  report: ReportDef;
  active: boolean;
  onClick: () => void;
}> = ({ report, active, onClick }) => (
  <button
    onClick={onClick}
    className={`group relative flex flex-col gap-3 p-4 rounded-xl border text-left transition-all duration-200
      ${
        active
          ? "border-2 bg-card shadow-md"
          : "border-border bg-card hover:border-border/80 hover:shadow-sm hover:-translate-y-0.5"
      }`}
    style={
      active
        ? {
            borderColor: report.color,
            boxShadow: `0 0 0 1px ${report.color}30, 0 4px 12px ${report.color}15`,
          }
        : {}
    }
  >
    {/* Subtle background tint on hover */}
    <div
      className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
      style={{ background: `${report.color}06` }}
    />

    <div className="flex items-start justify-between relative z-10">
      <div
        className="p-2 rounded-lg transition-colors"
        style={{ background: `${report.color}18` }}
      >
        <report.icon size={16} style={{ color: report.color }} />
      </div>
      {active && (
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ background: `${report.color}20`, color: report.color }}
        >
          Open
        </span>
      )}
    </div>

    <div className="relative z-10">
      <p className="text-sm font-heading font-semibold text-foreground leading-tight mb-1">
        {report.label}
      </p>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {report.description}
      </p>
    </div>

    {/* Bottom accent bar */}
    <div
      className="absolute bottom-0 left-4 right-4 h-0.5 rounded-t-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      style={
        active
          ? { background: report.color, opacity: 1 }
          : { background: report.color }
      }
    />
  </button>
);

// ── Main page ─────────────────────────────────────────────────────────────────

const Reports: React.FC = () => {
  // ── Existing stats/filter state (unchanged) ─────────────────────────────
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [finYears, setFinYears] = useState<FinYearOption[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [dateMode, setDateMode] = useState<DateMode>("single");
  const [singleDate, setSingleDate] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [finYearId, setFinYearId] = useState("");
  const [fyGranularity, setFyGranularity] =
    useState<FinYearGranularity>("year");
  const [fyMonth, setFyMonth] = useState("");
  const [fyDay, setFyDay] = useState("");

  // ── Report tile state ──────────────────────────────────────────────────
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: selectedCompanyDetail = null } = useQuery({
    queryKey: ["company-detail-reports", companyId],
    queryFn: () =>
      companyId ? getCompanyById(Number(companyId)) : Promise.resolve(null),
    enabled: !!companyId,
  });

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

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (companyId) p.set("companyId", companyId);
    if (finYearId) {
      const fy = finYears.find((f) => String(f.FId) === finYearId);
      if (fy) {
        if (fyGranularity === "year") {
          p.set("mode", "finYear");
          p.set("finYearId", finYearId);
        } else if (fyGranularity === "month" && fyMonth) {
          const startYear = fy.FStartDate?.slice(0, 4) ?? "";
          const yr =
            fyMonth <= "03" ? String(parseInt(startYear) + 1) : startYear;
          p.set("mode", "month");
          p.set("dateFrom", `${yr}-${fyMonth}`);
        } else if (fyGranularity === "day" && fyDay) {
          p.set("mode", "day");
          p.set("dateFrom", fyDay);
        }
      }
    } else {
      if (dateMode === "single" && singleDate) {
        p.set("mode", "single");
        p.set("dateFrom", singleDate);
      } else if (dateMode === "range" && rangeFrom && rangeTo) {
        p.set("mode", "range");
        p.set("dateFrom", rangeFrom);
        p.set("dateTo", rangeTo);
      }
    }
    return p.toString();
  }, [
    companyId,
    dateMode,
    singleDate,
    rangeFrom,
    rangeTo,
    finYearId,
    fyGranularity,
    fyMonth,
    fyDay,
    finYears,
  ]);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = buildParams();
    fetchWithAuth(`/api/reports${qs ? `?${qs}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load reports");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [buildParams]);

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearAll = () => {
    setCompanyId("");
    setSingleDate("");
    setRangeFrom("");
    setRangeTo("");
    setFinYearId("");
    setFyGranularity("year");
    setFyMonth("");
    setFyDay("");
  };

  const activeChips: { label: string; clear: () => void }[] = [];
  if (companyId) {
    const c = companies.find((x) => String(x.id) === companyId);
    if (c) activeChips.push({ label: c.name, clear: () => setCompanyId("") });
  }
  if (finYearId) {
    const fy = finYears.find((f) => String(f.FId) === finYearId);
    if (fy) {
      let label = fy.FName;
      if (fyGranularity === "month" && fyMonth) label += ` · Month ${fyMonth}`;
      if (fyGranularity === "day" && fyDay) label += ` · ${fyDay}`;
      activeChips.push({
        label,
        clear: () => {
          setFinYearId("");
          setFyGranularity("year");
          setFyMonth("");
          setFyDay("");
        },
      });
    }
  } else {
    if (dateMode === "single" && singleDate)
      activeChips.push({ label: singleDate, clear: () => setSingleDate("") });
    if (dateMode === "range" && rangeFrom && rangeTo)
      activeChips.push({
        label: `${rangeFrom} → ${rangeTo}`,
        clear: () => {
          setRangeFrom("");
          setRangeTo("");
        },
      });
  }

  const selectedFY = finYears.find((f) => String(f.FId) === finYearId);

  // Build global filter params to pass to report panels
  const globalFilters: Record<string, string> = {};
  if (companyId) globalFilters.companyId = companyId;

  const TOP_PARTIES_COLUMNS: ExportColumn[] = [
    { header: "Party Name", accessor: "name" },
    { header: "Transactions", accessor: "txns" },
    { header: "Total (Rs.)", accessor: (r) => fmt(Number(r.total)) },
  ];
  const SUMMARY_COLUMNS: ExportColumn[] = [
    { header: "Metric", accessor: "metric" },
    { header: "Value", accessor: "value" },
  ];
  const summaryRows: Record<string, unknown>[] = data
    ? [
        { metric: "Total Income", value: fmt(data.summary.totalIncome) },
        { metric: "Total Expenses", value: fmt(data.summary.totalExpenses) },
        { metric: "Net Profit", value: fmt(data.summary.netProfit) },
        {
          metric: "Total Transactions",
          value: String(data.summary.transactionCount),
        },
      ]
    : [];
  const MONTHLY_COLUMNS: ExportColumn[] = [
    { header: "Month", accessor: "month" },
    { header: "Income (Rs.)", accessor: "income" },
    { header: "Expense (Rs.)", accessor: "expense" },
    { header: "Net (Rs.)", accessor: "net" },
  ];
  const monthlyRows: Record<string, unknown>[] = data
    ? data.charts.monthly.map((m) => ({
        month: m.month,
        income: fmt(m.income),
        expense: fmt(m.expense),
        net: fmt(m.income - m.expense),
      }))
    : [];
  const topPartiesRows: Record<string, unknown>[] = data
    ? data.topParties.map((p) => ({
        name: p.name,
        txns: p.txns,
        total: p.total,
      }))
    : [];

  const handleTileClick = (id: string) => {
    setActiveReport((prev) => (prev === id ? null : id));
    // Scroll panel into view after render
    setTimeout(
      () =>
        panelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        }),
      50,
    );
  };

  const activeReportDef = REPORTS.find((r) => r.id === activeReport);

  return (
    <div className="flex flex-col min-h-0">
      <Breadcrumbs items={["Dashboard", "Reports"]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <BarChart3 size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground leading-tight">
              Reports
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {activeChips.length > 0 ? "Filtered view" : "All-time overview"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <ExportMenu
                data={summaryRows}
                columns={SUMMARY_COLUMNS}
                title="Financial Summary"
                filename="reports-summary"
                subtitle={`Income: ${fmt(data.summary.totalIncome)} · Expenses: ${fmt(data.summary.totalExpenses)} · Net: ${fmt(data.summary.netProfit)}`}
                companyName={selectedCompanyDetail?.name ?? undefined}
                logoBase64={selectedCompanyDetail?.logo ?? undefined}
              />
              <ExportMenu
                data={monthlyRows}
                columns={MONTHLY_COLUMNS}
                title="Monthly Breakdown"
                filename="reports-monthly"
                disabled={monthlyRows.length === 0}
                companyName={selectedCompanyDetail?.name ?? undefined}
                logoBase64={selectedCompanyDetail?.logo ?? undefined}
              />
            </>
          )}
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all
              ${sidebarOpen ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:border-primary/40"}`}
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filters</span>
            {activeChips.length > 0 && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/20 text-[10px] font-bold">
                {activeChips.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Top filter bar — identical to original */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-[260px]">
            <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Company
            </label>
            <StyledSelect
              value={companyId}
              onChange={setCompanyId}
              placeholder="All Companies"
              icon={<Building2 size={13} />}
              options={companies.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
          </div>
          <div className="flex-1 min-w-[200px] max-w-[240px]">
            <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Date Filter
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden bg-muted/30">
              {(["single", "range"] as DateMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setDateMode(m)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all
                    ${dateMode === m && !finYearId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "single" ? (
                    <Calendar size={12} />
                  ) : (
                    <CalendarRange size={12} />
                  )}
                  {m === "single" ? "Single Day" : "Date Range"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2 flex-1 min-w-[180px]">
            {dateMode === "single" ? (
              <div className="flex-1">
                <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={singleDate}
                  onChange={(e) => setSingleDate(e.target.value)}
                  disabled={!!finYearId}
                  className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-40"
                />
              </div>
            ) : (
              <>
                <div className="flex-1">
                  <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    From
                  </label>
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    disabled={!!finYearId}
                    className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-40"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    To
                  </label>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    disabled={!!finYearId}
                    className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-40"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex items-end gap-2 pb-0.5">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-all"
            >
              <Filter size={13} /> Apply
            </button>
            {activeChips.length > 0 && (
              <button
                onClick={() => {
                  clearAll();
                  setTimeout(loadData, 0);
                }}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
              >
                <RefreshCw size={13} /> Reset
              </button>
            )}
          </div>
        </div>
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider">
              Active:
            </span>
            {activeChips.map((c) => (
              <FilterChip
                key={c.label}
                label={c.label}
                onRemove={() => {
                  c.clear();
                  setTimeout(loadData, 0);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content + Sidebar */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-5">
          {/* ── Summary charts (existing, unchanged) ── */}
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={24} className="animate-spin opacity-50" />
                <span className="text-sm">Loading reports…</span>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="text-destructive text-sm">{error}</p>
              <button
                onClick={loadData}
                className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Try again
              </button>
            </div>
          )}
          {!loading && !error && data && (
            <>
              <SummaryCards summary={data.summary} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <IncomeVsExpenseChart data={data.charts.monthly} />
                <ExpenseByCategoryChart data={data.charts.categories} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <CashFlowChart data={data.charts.cashFlow} />
                <div className="relative">
                  <TopPartiesTable parties={data.topParties} />
                  <div className="absolute top-4 right-4">
                    <ExportMenu
                      data={topPartiesRows}
                      columns={TOP_PARTIES_COLUMNS}
                      title="Top Parties by Volume"
                      filename="top-parties"
                      disabled={topPartiesRows.length === 0}
                      companyName={selectedCompanyDetail?.name ?? undefined}
                      logoBase64={selectedCompanyDetail?.logo ?? undefined}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Report tiles section ── */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-widest px-2">
                Report Registers
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {REPORTS.map((report) => (
                <ReportTile
                  key={report.id}
                  report={report}
                  active={activeReport === report.id}
                  onClick={() => handleTileClick(report.id)}
                />
              ))}
            </div>

            {/* Active report panel */}
            <div ref={panelRef}>
              {activeReportDef && (
                <ReportPanel
                  key={activeReportDef.id}
                  report={activeReportDef}
                  globalFilters={globalFilters}
                  onClose={() => setActiveReport(null)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Sidebar — identical to original */}
        {sidebarOpen && (
          <aside className="w-60 shrink-0 rounded-xl border border-border bg-card overflow-hidden sticky top-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
                <Filter size={12} /> Financial Year
              </div>
              {finYearId && (
                <button
                  onClick={() => {
                    setFinYearId("");
                    setFyGranularity("year");
                    setFyMonth("");
                    setFyDay("");
                    setTimeout(loadData, 0);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="p-4 space-y-4">
              <StyledSelect
                value={finYearId}
                onChange={(v) => {
                  setFinYearId(v);
                  setFyGranularity("year");
                  setFyMonth("");
                  setFyDay("");
                }}
                placeholder="Financial Year"
                options={finYears.map((f) => ({
                  value: String(f.FId),
                  label: f.FName,
                }))}
              />
              {finYearId && (
                <>
                  <div>
                    <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      View By
                    </p>
                    <div className="flex flex-col gap-1">
                      {[
                        {
                          g: "year" as FinYearGranularity,
                          icon: <TrendingUp size={12} />,
                          label: "Full Year",
                        },
                        {
                          g: "month" as FinYearGranularity,
                          icon: <Calendar size={12} />,
                          label: "Specific Month",
                        },
                        {
                          g: "day" as FinYearGranularity,
                          icon: <CalendarRange size={12} />,
                          label: "Specific Day",
                        },
                      ].map(({ g, icon, label }) => (
                        <button
                          key={g}
                          onClick={() => {
                            setFyGranularity(g);
                            setFyMonth("");
                            setFyDay("");
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left
                            ${fyGranularity === g ? "bg-primary/15 text-primary border border-primary/25" : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"}`}
                        >
                          {icon} {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {fyGranularity === "month" && (
                    <div>
                      <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Month
                      </p>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          "Apr",
                          "May",
                          "Jun",
                          "Jul",
                          "Aug",
                          "Sep",
                          "Oct",
                          "Nov",
                          "Dec",
                          "Jan",
                          "Feb",
                          "Mar",
                        ].map((m, i) => {
                          const mo = String(i < 9 ? i + 4 : i - 8).padStart(
                            2,
                            "0",
                          );
                          return (
                            <button
                              key={m}
                              onClick={() => setFyMonth(mo)}
                              className={`py-1.5 rounded text-[11px] font-medium transition-all
                                ${fyMonth === mo ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {fyGranularity === "day" && selectedFY && (
                    <div>
                      <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Day
                      </p>
                      <input
                        type="date"
                        value={fyDay}
                        min={selectedFY.FStartDate?.slice(0, 10)}
                        max={selectedFY.FEndDate?.slice(0, 10)}
                        onChange={(e) => setFyDay(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                      />
                    </div>
                  )}
                  {selectedFY && (
                    <div className="rounded-lg bg-muted/30 border border-border/60 p-3 space-y-1">
                      <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider">
                        Period
                      </p>
                      <p className="text-xs text-foreground font-medium">
                        {selectedFY.FStartDate?.slice(0, 10)} →{" "}
                        {selectedFY.FEndDate?.slice(0, 10)}
                      </p>
                      {selectedFY.FStatus && (
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${selectedFY.FStatus === "Active" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                        >
                          {selectedFY.FStatus}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={loadData}
                    disabled={
                      loading ||
                      (fyGranularity === "month" && !fyMonth) ||
                      (fyGranularity === "day" && !fyDay)
                    }
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                  >
                    <Filter size={13} /> Apply Filter
                  </button>
                </>
              )}
              {!finYearId && (
                <p className="text-[11px] text-muted-foreground text-center py-2">
                  Select a financial year to filter by year, month, or day.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default Reports;
