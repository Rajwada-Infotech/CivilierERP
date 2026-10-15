import { bankReportChequeNo } from "@/lib/bankReportCheque";
import { fmtIstIso } from "@/lib/istTime";
import { TrendingUp, CreditCard, ShoppingCart, Package, ArrowDownToLine, Layers, Landmark, BookOpen, ClipboardList, FileBarChart2, Users, Clock, Banknote, Wrench, Receipt, ArrowUpDown, Warehouse, XCircle, Ban, Repeat } from "lucide-react";
import { fmt } from "@/pages/reports/format";
import type { ReportDef } from "@/pages/reports/types";

// Finance, Material, Engineering, Admin and the other general reports. Part of the one report list assembled in ../registry.ts.
export const CORE_REPORTS: ReportDef[] = [
  {
    id: "payment-register",
    label: "Payment Register",
    description: "Outward payments with mode & amount",
    icon: Banknote,
    color: "#6366f1",
    apiPath: "/api/new-payment",
    // newPayment: company filter is text-based (PCompany name), skip it.
    // Fin-year filter uses ?finYear=<id>. Single-date uses ?date=. No range.
    // Project filter is also text-based (?project=<name>, LIKE match).
    filterConfig: {
      companyParam: null,
      finYearParam: "finYear",
      singleDateParam: "date",
      dateFromParam: null,
      dateToParam: null,
      projectParam: "project",
      projectValueType: "name",
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
        header: "TDS Amt",
        accessor: (r) =>
          r.TDSAmount != null && Number(r.TDSAmount) > 0
            ? fmt(r.TDSAmount as number)
            : "—",
      },
      {
        header: "Net Payable (After TDS)",
        accessor: (r) =>
          r.TDSAmount != null && Number(r.TDSAmount) > 0
            ? fmt(Math.max(0, (Number(r.PAmount) || 0) - Number(r.TDSAmount)))
            : "—",
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
      { header: "Vendor", accessor: (r) => (r.VendorName ?? "—") as string },
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
      projectParam: "project",
      projectValueType: "name",
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
    id: "expense-register",
    label: "Invoice Report",
    description: "Every booked invoice/expense, with GL head and GST breakup",
    icon: Receipt,
    color: "#0d9488",
    apiPath: "/api/expense-booking",
    // expenseBooking.js's GET / accepts companyId/projectName(name match)/
    // from/to/finYear(label, not id — skipped here since this catalog's
    // Financial Year filter sends the numeric FId)/expenseHeadId (matches
    // either the multi-head ExpenseHeadAllocation table or the legacy
    // single EGLAccountId column).
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: "from",
      dateFromParam: "from",
      dateToParam: "to",
      projectParam: "projectName",
      projectValueType: "name",
    },
    // Doc No + Paid To (the resolved supplier/contractor, same
    // ESupplierName expenseBooking.js's GET / already resolves via
    // expenseBookingSupplierSql — GRN/PO/WO_PO/WORK_DONE -> source doc's
    // supplier, direct/manual bookings -> eb.LHeadId) + Amount posted to
    // the Expense Head — an invoice always debits it (there's no
    // credit-note flow through this table), so "Amount" here is that debit.
    // Net Amt (eb.EAmount, the pre-GST taxable base) / Tax Amt (Total −
    // Net) / Total Amount follow the same split MaterialExpenseBooking.tsx
    // uses (Basic Amt + GST% -> Net Amt there — same numbers, this report
    // just spells out the tax split instead of a %).
    columns: [
      { header: "Doc No", accessor: (r) => (r.EDocNo ?? "—") as string },
      {
        header: "Doc Date",
        accessor: (r) => (r.EDocDate ? String(r.EDocDate).slice(0, 10) : "—"),
      },
      {
        header: "Company",
        accessor: (r) => (r.ECompanyName ?? "—") as string,
      },
      {
        // Resolved server-side: the booking's EProjectName if set, else the
        // linked GRN → PO → Project. See expenseBooking.js EProjectDisplayName.
        header: "Project",
        accessor: (r) => (r.EProjectDisplayName ?? "—") as string,
      },
      { header: "Paid To", accessor: (r) => (r.ESupplierName ?? "—") as string },
      {
        header: "Net Amt",
        accessor: (r) => fmt(Number(r.EAmount) || 0),
      },
      {
        header: "Tax Amt",
        accessor: (r) => {
          const total = Number(r.ENetAmount ?? r.EGrnTotalAmount ?? r.EAmount) || 0;
          const net = Number(r.EAmount) || 0;
          return fmt(Math.max(0, total - net));
        },
      },
      {
        header: "Total Amount",
        accessor: (r) => fmt(Number(r.ENetAmount ?? r.EGrnTotalAmount ?? r.EAmount) || 0),
      },
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
      // Cheque number, for the rows paid by cheque (a dash for every other mode).
      { header: "Cheque No", accessor: (r) => bankReportChequeNo(r) },
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
    description: "Every debit/credit posting — invoices, payments, journal entries — across every GL head, with Direct/Indirect expense type",
    icon: BookOpen,
    color: "#64748b",
    // GET /api/general-ledger/transactions — the actual GL transaction
    // feed (unlike GET /api/general-ledger, which is just the account-head
    // master list). Scoped to LHeadType='GL' so Supplier/Customer/Bank
    // postings (Vendor Ledger Report's own territory) don't flood this one.
    apiPath: "/api/general-ledger/transactions",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: "from",
      dateFromParam: "from",
      dateToParam: "to",
    },
    columns: [
      {
        header: "Date",
        accessor: (r) => (r.VoucherDate ? String(r.VoucherDate).slice(0, 10) : "—"),
      },
      { header: "GL Name", accessor: (r) => (r.LHeadName ?? "—") as string },
      { header: "Group", accessor: (r) => (r.GroupName ?? "—") as string },
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      { header: "Project", accessor: (r) => (r.ProjectName ?? "—") as string },
      {
        header: "Expense Type",
        accessor: (r) => (r.ExpenseType ?? "—") as string,
      },
      { header: "Source", accessor: (r) => (r.SourceType ?? "—") as string },
      { header: "Doc No", accessor: (r) => (r.DocNo ?? "—") as string },
      { header: "Paid To", accessor: (r) => (r.PaidTo ?? "—") as string },
      { header: "Debit", accessor: (r) => fmt(Number(r.DebitAmount) || 0) },
      { header: "Credit", accessor: (r) => fmt(Number(r.CreditAmount) || 0) },
      { header: "Narration", accessor: (r) => (r.Narration ?? "—") as string },
    ],
  },
  {
    // Special-cased below (isVendorLedger) — renders VendorLedgerReportBody
    // directly instead of the generic apiPath-fetched flat table, since this
    // report is search-driven (any party/GL head) with its own internal
    // fetching, not a single filterable list. apiPath/columns are still
    // required by ReportDef's type and harmless if ever fetched generically,
    // but load() skips calling them for this id.
    id: "vendor-ledger-report",
    label: "Vendor Ledger Report",
    description: "Every transaction posted against a supplier, customer, contractor, broker or any GL head",
    icon: Users,
    color: "#6366f1",
    apiPath: "/api/vendor-ledger/all-transactions",
    filterConfig: {
      companyParam: null,
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: null,
      dateToParam: null,
    },
    columns: [
      { header: "Date", accessor: (r) => (r.VoucherDate ? String(r.VoucherDate).slice(0, 10) : "—") },
      { header: "Party", accessor: (r) => (r.PartyName ?? "—") as string },
      { header: "Voucher No", accessor: "VoucherNo" },
      { header: "Debit", accessor: (r) => (r.DebitAmount ?? 0) as number },
      { header: "Credit", accessor: (r) => (r.CreditAmount ?? 0) as number },
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
      projectParam: "projectId",
    },
    columns: [
      { header: "JV No", accessor: (r) => (r.JVNo ?? `JV-${r.JVID}`) as string },
      {
        header: "Date",
        accessor: (r) => (r.JVDate ? String(r.JVDate).slice(0, 10) : "—"),
      },
      { header: "Narration", accessor: (r) => (r.Narration ?? "—") as string },
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      { header: "Project", accessor: (r) => (r.ProjectName ?? "—") as string },
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
    id: "fa-depreciation-summary-report",
    label: "Total Depreciation (FA Item Code wise)",
    description: "Posted depreciation, accumulated depreciation & book value per FA Item Code",
    icon: TrendingUp,
    color: "#8b5cf6",
    apiPath: "/api/fixed-assets/depreciation-summary",
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
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      { header: "Method", accessor: (r) => (r.DepreciationType ?? "—") as string },
      { header: "Rate %", accessor: (r) => (r.DepreciationRate != null ? `${r.DepreciationRate}%` : "—") },
      { header: "Purchase Cost", accessor: (r) => fmt(r.PurchaseCost as number) },
      { header: "Months Posted", accessor: (r) => String(r.MonthsPosted ?? 0) },
      { header: "Total Depreciation", accessor: (r) => fmt(r.TotalDepreciation as number) },
      { header: "Book Value", accessor: (r) => fmt(r.BookValue as number) },
      { header: "First Period", accessor: (r) => (r.FirstPeriod ? String(r.FirstPeriod).slice(0, 7) : "—") },
      { header: "Last Period", accessor: (r) => (r.LastPeriod ? String(r.LastPeriod).slice(0, 7) : "—") },
    ],
  },
  {
    id: "fa-depreciation-history-report",
    label: "Monthly Depreciation History",
    description: "Every monthly depreciation posting — calculation date, FA Item Code, charge, accumulated depreciation & remaining book value (auto and manual)",
    icon: TrendingUp,
    color: "#7c3aed",
    apiPath: "/api/fixed-assets/depreciation-history",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: "finYear",
      singleDateParam: null,
      dateFromParam: "fromDate",
      dateToParam: "toDate",
    },
    columns: [
      { header: "Calculation Date", accessor: (r) => (r.CalculationDate ? new Date(r.CalculationDate as string).toLocaleDateString("en-IN") : "—") },
      { header: "Period", accessor: (r) => (r.PeriodStart ? String(r.PeriodStart).slice(0, 7) : "—") },
      { header: "FA Item Code", accessor: (r) => (r.FAItemCode ?? "—") as string },
      { header: "Item Name", accessor: (r) => (r.AssetName ?? "—") as string },
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      { header: "Method", accessor: (r) => (r.Method ?? "—") as string },
      { header: "Rate %", accessor: (r) => (r.RatePct != null ? `${r.RatePct}%` : "—") },
      { header: "Opening Book Value", accessor: (r) => fmt(r.OpeningBookValue as number) },
      { header: "Depreciation", accessor: (r) => fmt(r.DepreciationAmount as number) },
      { header: "Accumulated Depreciation", accessor: (r) => fmt(r.AccumulatedDepreciation as number) },
      { header: "Remaining Book Value", accessor: (r) => fmt(r.RemainingBookValue as number) },
      { header: "Voucher", accessor: (r) => (r.VoucherNo ?? "—") as string },
      { header: "Source", accessor: (r) => (r.Source ?? "—") as string },
    ],
  },
  {
    id: "fa-owner-report",
    label: "FA Owner / Custodian (FA Item Code wise)",
    description: "Current custodian, department & location for every FA Item Code",
    icon: Users,
    color: "#0ea5e9",
    apiPath: "/api/fixed-assets",
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
      { header: "Category", accessor: (r) => (r.AssetCategory ?? "—") as string },
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      { header: "Owner / Custodian", accessor: (r) => (r.Custodian ?? "—") as string },
      { header: "Department", accessor: (r) => (r.Department ?? "—") as string },
      { header: "Location", accessor: (r) => (r.Location ?? "—") as string },
      { header: "Status", accessor: (r) => (r.AssetStatus ?? "—") as string },
      { header: "Activation Date", accessor: (r) => (r.ActivationDate ? String(r.ActivationDate).slice(0, 10) : "—") },
    ],
  },
  {
    id: "fa-maintenance-report",
    label: "FA Maintenance & Repair (FA Item Code wise)",
    description: "Repair/maintenance spend per FA Item Code — vendor, type, GST & total",
    icon: Wrench,
    color: "#f97316",
    apiPath: "/api/fixed-asset-maintenance",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: "finYear",
      singleDateParam: null,
      dateFromParam: "fromDate",
      dateToParam: "toDate",
    },
    columns: [
      { header: "FA Item Code", accessor: (r) => (r.FAItemCode ?? "—") as string },
      { header: "Item Name", accessor: (r) => (r.ItemName ?? "—") as string },
      { header: "Doc No", accessor: (r) => (r.DocNo ?? "—") as string },
      { header: "Doc Date", accessor: (r) => (r.DocDate ? String(r.DocDate).slice(0, 10) : "—") },
      { header: "Vendor", accessor: (r) => (r.VendorName ?? "—") as string },
      { header: "Repair Type", accessor: (r) => (r.RepairExpenseType ?? "—") as string },
      { header: "Taxable Amount", accessor: (r) => fmt(r.TaxableAmount as number) },
      { header: "GST", accessor: (r) => fmt(r.GstAmount as number) },
      { header: "Total Amount", accessor: (r) => fmt(r.TotalAmount as number) },
      { header: "Status", accessor: (r) => (r.Status ?? "—") as string },
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
    description:
      "Audit-ready register of every GRN — document, supplier, tax, amount & created-by details",
    icon: Package,
    color: "#10b981",
    // Dedicated read-only reporting endpoint (backend/routes/grns.js → GET
    // /register). One row per GRN header, tax split derived from the posted
    // total, Created By resolved from the DocNumberSequence audit trail.
    apiPath: "/api/grns/register",
    // Company scopes via the linked PO's company (same as the GRN list).
    // Date From / Date To filter on the GRN date. No financial-year param.
    filterConfig: {
      companyParam: "companyId",
      projectParam: "projectId",
      finYearParam: null,
      singleDateParam: "dateFrom",
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      // ── GRN / Document ──────────────────────────────────────────────────
      { header: "GRN Number", accessor: (r) => (r.GRNNo ?? "—") as string },
      {
        header: "Document Number",
        accessor: (r) => (r.DocNo ?? r.GRNNo ?? "—") as string,
      },
      {
        header: "Document Date",
        accessor: (r) => (r.DocDate ? String(r.DocDate).slice(0, 10) : "—"),
      },
      {
        header: "GRN Date",
        accessor: (r) => (r.GRNDate ? String(r.GRNDate).slice(0, 10) : "—"),
      },
      {
        header: "Reference No",
        accessor: (r) => (r.ReferenceNo ?? "—") as string,
      },
      { header: "GRN Status", accessor: (r) => (r.GRNStatus ?? "—") as string },
      { header: "Remarks", accessor: (r) => (r.Remarks ?? "—") as string },
      // ── Company ─────────────────────────────────────────────────────────
      { header: "Company", accessor: (r) => (r.CompanyName ?? "—") as string },
      {
        header: "Company Code",
        accessor: (r) => (r.CompanyCode ?? "—") as string,
      },
      {
        header: "Branch/Location",
        accessor: (r) => (r.BranchLocation ?? "—") as string,
      },
      { header: "Project", accessor: (r) => (r.ProjectName ?? "—") as string },
      // ── Supplier / Vendor ───────────────────────────────────────────────
      { header: "Supplier", accessor: (r) => (r.SupplierName ?? "—") as string },
      {
        header: "Supplier Code",
        accessor: (r) => (r.SupplierCode ?? "—") as string,
      },
      {
        header: "Supplier GSTIN",
        accessor: (r) => (r.SupplierGSTIN ?? "—") as string,
      },
      {
        header: "Supplier Address",
        accessor: (r) => (r.SupplierAddress ?? "—") as string,
      },
      // ── Tax ─────────────────────────────────────────────────────────────
      { header: "Taxable Amount", accessor: (r) => fmt(r.TaxableAmount as number) },
      { header: "CGST", accessor: (r) => fmt(r.CGSTAmount as number) },
      { header: "SGST", accessor: (r) => fmt(r.SGSTAmount as number) },
      { header: "IGST", accessor: (r) => fmt(r.IGSTAmount as number) },
      { header: "Cess", accessor: (r) => fmt(r.CessAmount as number) },
      { header: "Other Tax", accessor: (r) => fmt(r.OtherTaxAmount as number) },
      { header: "Total Tax", accessor: (r) => fmt(r.TotalTaxAmount as number) },
      // ── Amount ──────────────────────────────────────────────────────────
      { header: "Round Off", accessor: (r) => fmt(r.RoundOff as number) },
      { header: "Grand Total", accessor: (r) => fmt(r.GrandTotal as number) },
      { header: "Net Payable", accessor: (r) => fmt(r.NetPayable as number) },
      // ── Audit / User ────────────────────────────────────────────────────
      { header: "Created By", accessor: (r) => (r.CreatedBy ?? "—") as string },
      {
        header: "Created Date",
        accessor: (r) =>
          r.CreatedDate
            ? fmtIstIso(String(r.CreatedDate), true)
            : "—",
      },
      { header: "Modified By", accessor: (r) => (r.ModifiedBy ?? "—") as string },
      {
        header: "Modified Date",
        accessor: (r) =>
          r.ModifiedDate
            ? fmtIstIso(String(r.ModifiedDate), true)
            : "—",
      },
      { header: "Posted By", accessor: (r) => (r.PostedBy ?? "—") as string },
      {
        header: "Posted Date",
        accessor: (r) =>
          r.PostedDate
            ? fmtIstIso(String(r.PostedDate), true)
            : "—",
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
    id: "worker-attendance",
    label: "Worker Attendance",
    description: "Day-wise worker attendance across companies, projects and activities",
    icon: Users,
    color: "#06b6d4",
    apiPath: "/api/worker-attendance/report",
    filterConfig: {
      companyParam: "companyId",
      finYearParam: null,
      singleDateParam: null,
      dateFromParam: "dateFrom",
      dateToParam: "dateTo",
    },
    columns: [
      { header: "Date", accessor: (r) => (r.date ? String(r.date).slice(0, 10) : "—") },
      { header: "Company", accessor: (r) => r.companyName ?? "—" },
      { header: "Project", accessor: (r) => r.projectName ?? "—" },
      { header: "Activity", accessor: (r) => r.activityLabel ?? "—" },
      { header: "Worker", accessor: (r) => r.workerName ?? "—" },
      { header: "Contractor", accessor: (r) => r.contractorName ?? "—" },
      {
        header: "Status",
        accessor: (r) => (r.status === "P" ? "Present" : r.status === "A" ? "Absent" : r.status === "H" ? "Half Day" : "—"),
      },
    ],
  },
];
