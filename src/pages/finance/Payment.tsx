import React from "react";
import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPayments,
  getPaymentById,
  addPayment,
  updatePayment,
  deletePayment,
  getPaymentChain,
} from "@/api/newPaymentApi";
import type { PaymentChainResponse, PaymentChainItem, DisplayStatus } from "@/api/newPaymentApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getBanks } from "@/api/bankMasterApi";
import { getCompanyById } from "@/api/enterpriseApi";
import type { CompanyDetail } from "@/api/enterpriseApi";
import { ExportMenu } from "@/components/ExportMenu";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import {
  Banknote,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Plus,
  RotateCcw,
  Check,
  Edit,
  Trash2,
  AlertCircle,
  FileText,
  ChevronDown,
  Receipt,
  Building2,
  FolderKanban,
  CalendarDays,
  Landmark,
  Wallet,
  Link2,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Truck,
  Hash,
  Smartphone,
  BookOpen,
  CalendarClock,
  AlertTriangle,
  Search,
  Eye,
  Printer,
  ArrowRight,
  CreditCard,
  RefreshCw,
  History,
} from "lucide-react";
import type { ExportColumn } from "@/lib/export";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { computeGrnNetWithTerms } from "@/pages/material/ExpenseBooking/helpers";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbPayment {
  PPaymentID: number;
  PPaymentName: string | null;
  PMode: string | null;
  PAmount: number | null;
  PDocType: string | null;
  PDate: string | null;
  PBankID: number | null;
  PBankName: string | null;
  PProject: string | null;
  PProjectName?: string | null;
  PCompany: string | null;
  PSupplierName?: string | null;
  PExpenseRef: string | null;
  DocNo?: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  Status?: string;
  DisplayStatus?: string;
  // Cheque
  PChequeNo?: string | null;
  PChequeLotId?: number | null;
  PChequeLotNumber?: string | null;
  PChequeDate?: string | null;
  PChequeAccountNumber?: string | null;
  PChequeIfsc?: string | null;
  PIsPostDated?: boolean;
  // Digital
  PNeftNumber?: string | null;
  PUpiTransactionId?: string | null;
  PRtgsReference?: string | null;
  PImpsReference?: string | null;
  PCardReference?: string | null;
  PCardId?: number | null;
  PCardNumber?: string | null;
  PCardNetwork?: string | null;
  PCardHolderName?: string | null;
  PExpenseId?: number | null;
}

interface BankOption {
  id: number;
  label: string;
  accountNumber?: string | null;
  ifscCode?: string | null;
  branch?: string | null;
  accountType?: string | null;
}

interface CardOption {
  id: number;
  bank_id: number | null;
  card_holder_name: string | null;
  card_number: string | null;
  card_network: string | null;
  card_type: string | null;
  status: boolean;
}

interface ChequeLot {
  CId: number;
  ChequeLotNumber: string;
  AccountNumber: string | null;
  IFSCCode: string | null;
  ChequeStartNumber: number | null;
  ChequeEndNumber: number | null;
  TotalCheques: number | null;
  RemainingCheques: number | null;
  BankId: number | null;
  BankName: string | null;
  BankBranch: string | null;
  BankAccountType: string | null;
  Remarks: string | null;
}

interface ExpenseOption {
  id: string;
  value: string;
  label: string;
  type?: "booking" | "emi";
  expenseBookingId?: number;
  docNo?: string;
  projectName?: string;
  supplierName?: string;
  partyName?: string;
  amount?: number;
  companyId?: number | null;
  companyName?: string;
  financialYear?: string;
  installmentNo?: number;
  refNumber?: string | null;
  dueDate?: string | null;
  status?: string;
  parentDocNo?: string;
  billStatus?: string;
  totalPaid?: number;
  remainingAmount?: number;
}

interface ExpenseDetail {
  Eid: number;
  EDocNo: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  EProjectName: string | null;
  EProjectDisplayName?: string | null;
  ECompanyId: number | null;
  EAmount: number | null;
  ENetAmount: number | null;
  EDocumentType: string | null;
  DocTypeName: string | null;
  ESourceType?: string | null;
  ESourceId?: number | null;
  // GST breakdown
  ECgstRate?: number | null;
  ESgstRate?: number | null;
  EIgstRate?: number | null;
  EBillingTermsData?: string | null;
  EDiscountData?: string | null;
}

interface GRNRef {
  GRNID: number;
  GRNNo: string;
  GRNDate?: string;
  SupplierName?: string;
  PONumber?: string;
  Status?: string;
  ProjectName?: string;
}

interface PaymentRecord {
  id: string;
  paymentName: string;
  paidTo: string;
  mode: string;
  amount: number | null;
  date: string;
  bankId: number | null;
  bankName: string;
  project: string;
  company: string;
  projectSite: string;
  expenseRef: string;
  expenseId: string;
  docNo: string;
  parentDocNo: string;
  rootExBDocNo: string;
  docType: string;
  status: string;
  displayStatus: string;
  // Cheque
  chequeNo: string;
  chequeLotId: number | null;
  chequeLotNumber: string;
  chequeDate: string;
  chequeAccountNumber: string;
  chequeIfsc: string;
  isPostDated: boolean;
  // Digital
  neftNumber: string;
  upiTransactionId: string;
  rtgsReference: string;
  impsReference: string;
  cardReference: string;
  cardId: number | null;
  cardDisplay: string; // read-only summary (network + last4 + holder) of the selected card, if any
  // GST breakdown from linked expense
  baseAmount: number | null;
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;
  billingTermsData: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_MODES = [
  "Cash",
  "Cheque",
  "Post-Dated Cheque",
  "NEFT",
  "UPI",
  "RTGS",
  "IMPS",
  "Card",
] as const;

type PaymentMode = (typeof PAYMENT_MODES)[number];

const MODE_STYLE: Record<string, { ring: string; text: string; dot: string }> =
  {
    Cash: {
      ring: "ring-emerald-500/30 bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    Cheque: {
      ring: "ring-blue-500/30 bg-blue-500/10",
      text: "text-blue-600 dark:text-blue-400",
      dot: "bg-blue-500",
    },
    "Post-Dated Cheque": {
      ring: "ring-indigo-500/30 bg-indigo-500/10",
      text: "text-indigo-600 dark:text-indigo-400",
      dot: "bg-indigo-500",
    },
    UPI: {
      ring: "ring-violet-500/30 bg-violet-500/10",
      text: "text-violet-600 dark:text-violet-400",
      dot: "bg-violet-500",
    },
    Card: {
      ring: "ring-amber-500/30 bg-amber-500/10",
      text: "text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
    },
    NEFT: {
      ring: "ring-cyan-500/30 bg-cyan-500/10",
      text: "text-cyan-600 dark:text-cyan-400",
      dot: "bg-cyan-500",
    },
    RTGS: {
      ring: "ring-orange-500/30 bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      dot: "bg-orange-500",
    },
    IMPS: {
      ring: "ring-pink-500/30 bg-pink-500/10",
      text: "text-pink-600 dark:text-pink-400",
      dot: "bg-pink-500",
    },
  };

// ─── Fetchers ─────────────────────────────────────────────────────────────────

const fetchBankOptions = async (): Promise<BankOption[]> => {
  const banks = await getBanks();
  return banks
    .filter((b) => b.BStatus)
    .map((b) => ({
      id: b.BId,
      label: b.BName
        ? `${b.BName}${b.BAccountNumber ? ` — ${b.BAccountNumber}` : ""}`
        : `Bank #${b.BId}`,
      accountNumber: b.BAccountNumber,
      ifscCode: b.BIfscCode,
      branch: b.BBranch,
      accountType: b.BAccountType,
    }));
};

const fetchChequeLots = async (
  bankId?: number | null,
): Promise<ChequeLot[]> => {
  const url = bankId
    ? `/api/new-payment/cheque-lots?bankId=${bankId}`
    : `/api/new-payment/cheque-lots`;
  const res = await fetchWithAuth(url);
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

// Active cards for a bank — used by the Card-mode card selector.
// Mirrors fetchChequeLots: returns [] for any bank with no cards on file
// rather than erroring, since card registration is optional.
const fetchCardsByBank = async (
  bankId?: number | null,
): Promise<CardOption[]> => {
  if (!bankId) return [];
  const res = await fetchWithAuth(`/api/card-master?bankId=${bankId}`);
  if (!res.ok) return [];
  const rows: any[] = await res.json().catch(() => ({}));
  return rows.map((r) => ({
    id: r.id,
    bank_id: r.bank_id ?? null,
    card_holder_name: r.card_holder_name ?? null,
    card_number: r.card_number ?? null,
    card_network: r.card_network ?? null,
    card_type: r.card_type ?? null,
    status: !!r.status,
  }));
};

const normaliseExpenseOptions = (items: any[]): ExpenseOption[] =>
  items.map((o: any) => ({
    ...o,
    companyName:
      o.companyName || o.ECompanyName || o.company_name || o.CompanyName || null,
    projectName:
      o.projectName ||
      o.EProjectDisplayName ||
      o.EProjectName ||
      o.project_name ||
      o.ProjectName ||
      null,
    financialYear:
      o.financialYear || o.EFinYear || o.fin_year || o.FinYear || null,
    supplierName:
      o.supplierName ||
      o.ESupplierName ||
      o.supplier_name ||
      o.SupplierName ||
      o.partyName ||
      o.EName ||
      null,
  }));

const fetchExpenseOptions = async (): Promise<ExpenseOption[]> => {
  const res = await fetchWithAuth("/api/expense-booking/options");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => ({}));
  const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return normaliseExpenseOptions(items);
};

const fetchExpenseOptionByRef = async (ref: string): Promise<ExpenseOption | null> => {
  const res = await fetchWithAuth(
    `/api/expense-booking/options?includeRef=${encodeURIComponent(ref)}`,
  );
  if (!res.ok) return null;
  const raw = await res.json().catch(() => ({}));
  const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const all = normaliseExpenseOptions(items);
  return all.find((o) => o.docNo === ref) ?? all[0] ?? null;
};

const fetchExpenseDetail = async (
  id: string,
): Promise<ExpenseDetail | null> => {
  if (!id) return null;
  const res = await fetchWithAuth(`/api/expense-booking/${id}`);
  if (!res.ok) return null;
  return res.json().catch(() => ({}));
};

const fetchExpenseGRNs = async (expenseId: string): Promise<GRNRef[]> => {
  if (!expenseId) return [];
  const res = await fetchWithAuth(`/api/expense-booking/${expenseId}/grns`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : [];
};

interface ChainSummary {
  docNo: string | null;
  status: string | null;
  billStatus: string | null;
  netAmount: number;
  totalPaid: number;
  remaining: number;
  payments: {
    id: number;
    docNo: string | null;
    date: string | null;
    mode: string | null;
    amount: number;
    status: string | null;
  }[];
  chain: {
    mrDocNo: string | null;
    workDoneRef: string | null;
    poNo: string | null;
    grnNo: string | null;
    expenseDocNo: string | null;
    vendorInvoiceNo: string | null;
    vendorInvoiceDate: string | null;
  };
  supplier: {
    id: number;
    name: string | null;
    code: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    gst: string | null;
    pan: string | null;
  } | null;
}

const fetchPaymentSummary = async (
  expenseId: string,
): Promise<ChainSummary | null> => {
  if (!expenseId) return null;
  try {
    const res = await fetchWithAuth(
      `/api/expense-booking/${expenseId}/payment-summary`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const fetchWorkDoneById = async (
  id: number,
): Promise<{ ProjectName: string | null } | null> => {
  const res = await fetchWithAuth(`/api/engineering/work-done/${id}`);
  if (!res.ok) return null;
  return res.json().catch(() => ({}));
};

const fetchChequeNumbers = async (
  lotId: number,
): Promise<{ number: string; used: boolean; bounced: boolean }[]> => {
  const res = await fetchWithAuth(`/api/new-payment/cheque-numbers/${lotId}`);
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

const deductChequeFromLot = async (
  lotId: number,
  chequeNo: string,
): Promise<{ remainingCheques: number; nextChequeNumber: string }> => {
  const res = await fetchWithAuth("/api/new-payment/deduct-cheque", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lotId, chequeNo }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to deduct cheque from lot");
  }
  return res.json().catch(() => ({}));
};

const fetchCompanyOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

const fetchProjectOptions = async (): Promise<
  {
    id: number;
    label: string;
    belongs_to?: number | null;
    company_id?: number | null;
  }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

const fetchSupplierOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  const res = await fetchWithAuth("/api/account-head/options?type=S");
  if (!res.ok) return [];
  return res.json().catch(() => ({}));
};

const fetchFinYearOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => r.FStatus === 1 || r.FStatus === true)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankForm(): Omit<PaymentRecord, "id"> {
  return {
    paymentName: "",
    mode: "",
    amount: null,
    baseAmount: null,
    date: new Date().toISOString().slice(0, 10),
    bankId: null,
    bankName: "",
    project: "",
    projectSite: "",
    company: "",
    expenseRef: "",
    expenseId: "",
    docNo: "",
    parentDocNo: "",
    rootExBDocNo: "",
    docType: "",
    status: "Draft",
    displayStatus: "Draft",
    chequeNo: "",
    chequeLotId: null,
    chequeLotNumber: "",
    chequeDate: "",
    chequeAccountNumber: "",
    chequeIfsc: "",
    isPostDated: false,
    neftNumber: "",
    upiTransactionId: "",
    rtgsReference: "",
    impsReference: "",
    cardReference: "",
    cardId: null,
    cardDisplay: "",
    cgstRate: null,
    sgstRate: null,
    igstRate: null,
    billingTermsData: null,
    paidTo: "",
  };
}

function dbToRecord(item: DbPayment): PaymentRecord {
  return {
    id: String(item.PPaymentID),
    paymentName: item.PPaymentName || "",
    paidTo: item.PSupplierName || "",
    mode: item.PMode || "",
    amount: item.PAmount ?? null,
    date: item.PDate?.slice(0, 10) || "",
    bankId: item.PBankID ?? null,
    bankName: item.PBankName || "",
    project: item.PProjectName || item.PProject || "",
    projectSite: item.PProjectName || item.PProject || "",
    company: item.PCompany || "",
    expenseRef: item.PExpenseRef || "",
    expenseId: item.PExpenseId ? String(item.PExpenseId) : "",
    docNo: item.DocNo || "",
    parentDocNo: item.ParentDocNo || "",
    rootExBDocNo: item.RootExBDocNo || "",
    docType: item.PDocType || "",
    status: (item as any).Status || "Draft",
    displayStatus: (item as any).DisplayStatus || (item as any).Status || "Draft",
    chequeNo: item.PChequeNo || "",
    chequeLotId: item.PChequeLotId ?? null,
    chequeLotNumber: item.PChequeLotNumber || "",
    chequeDate: item.PChequeDate?.slice(0, 10) || "",
    chequeAccountNumber: item.PChequeAccountNumber || "",
    chequeIfsc: item.PChequeIfsc || "",
    isPostDated: !!item.PIsPostDated,
    neftNumber: item.PNeftNumber || "",
    upiTransactionId: item.PUpiTransactionId || "",
    rtgsReference: item.PRtgsReference || "",
    impsReference: item.PImpsReference || "",
    cardReference: item.PCardReference || "",
    cardId: item.PCardId ?? null,
    cardDisplay: item.PCardId
      ? [
          item.PCardNetwork,
          maskCardNumber(item.PCardNumber ?? null),
          item.PCardHolderName,
        ]
          .filter(Boolean)
          .join(" · ")
      : "",
    baseAmount: null,
    cgstRate: null,
    sgstRate: null,
    igstRate: null,
    billingTermsData: null,
  };
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  badge?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
      style={{
        background: isDark ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.06)",
        border: isDark
          ? "1px solid rgba(99,102,241,0.18)"
          : "1px solid rgba(99,102,241,0.15)",
      }}
    >
      <div
        className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
        style={{
          background: "rgba(99,102,241,0.18)",
          border: "1px solid rgba(99,102,241,0.28)",
        }}
      >
        <Icon size={11} style={{ color: "#818cf8" }} />
      </div>
      <p
        className="text-[10px] font-heading uppercase tracking-widest flex-1"
        style={{ color: isDark ? "#94a3b8" : "#6366f1" }}
      >
        {label}
      </p>
      {badge}
    </div>
  );
}

function ReadOnlyField({
  value,
  placeholder,
}: {
  value: string;
  placeholder?: string;
}) {
  return (
    <div className="w-full px-3 py-2 rounded-lg text-sm bg-muted/30 border border-border/60 text-muted-foreground cursor-not-allowed truncate min-h-[38px] flex items-center">
      {value || (
        <span className="text-muted-foreground/50 italic text-xs">
          {placeholder ?? "Auto-filled"}
        </span>
      )}
    </div>
  );
}

function AutoFillBanner({
  docNo,
  onClear,
}: {
  docNo: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-primary/5 border border-primary/20 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <Link2 size={13} className="text-primary shrink-0" />
        <span className="text-xs text-muted-foreground">Linked to expense</span>
        <span className="font-mono text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md truncate">
          {docNo}
        </span>
      </div>
      <button
        onClick={onClear}
        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Clear expense link"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const s = MODE_STYLE[mode] ?? {
    ring: "ring-border bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-heading font-semibold ring-1 ${s.ring} ${s.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {mode || "—"}
    </span>
  );
}

function InputField({
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = "text",
  prefix,
  disabled,
}: {
  icon?: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  prefix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      {Icon && (
        <Icon
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      )}
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full ${Icon || prefix ? "pl-8" : "pl-3"} pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60 disabled:opacity-60 disabled:cursor-not-allowed font-mono`}
      />
    </div>
  );
}

// ─── GRN badges for list view ─────────────────────────────────────────────────

// ─── FilterBar ────────────────────────────────────────────────────────────────

type BookingFilters = {
  company: string;
  project: string;
  year: string;
  supplier: string;
};

function FilterBar({
  companyOptions,
  projectOptions,
  supplierOptions,
  finYearOptions,
  filters,
  onChange,
  selectedCompanyId,
}: {
  companyOptions: { id: number; label: string }[];
  projectOptions: {
    id: number;
    label: string;
    belongs_to?: number | null;
    company_id?: number | null;
  }[];
  supplierOptions: { id: number; label: string }[];
  finYearOptions: { id: number; label: string }[];
  filters: BookingFilters;
  onChange: (key: keyof BookingFilters, value: string) => void;
  selectedCompanyId?: number | null;
}) {
  const companies = companyOptions.map((o) => o.label);

  // Filter projects to only those belonging to the selected company
  const filteredProjectOptions = selectedCompanyId
    ? projectOptions.filter(
        (p) =>
          p.belongs_to === selectedCompanyId ||
          p.company_id === selectedCompanyId,
      )
    : projectOptions;
  const projects = filteredProjectOptions.map((o) => o.label);
  const finYears = finYearOptions.map((o) => o.label);
  const suppliers = supplierOptions.map((o) => o.label);

  const activeCount = Object.values(filters).filter(Boolean).length;

  const dropdowns: {
    key: keyof BookingFilters;
    label: string;
    icon: React.ElementType;
    items: string[];
    placeholder: string;
  }[] = [
    {
      key: "company",
      label: "Company",
      icon: Building2,
      items: companies,
      placeholder: "All companies",
    },
    {
      key: "project",
      label: "Project",
      icon: FolderKanban,
      items: projects,
      placeholder: "All projects",
    },
    {
      key: "year",
      label: "Year",
      icon: CalendarDays,
      items: finYears,
      placeholder: "All years",
    },
    {
      key: "supplier",
      label: "Supplier",
      icon: FileText,
      items: suppliers,
      placeholder: "All suppliers",
    },
  ];

  const { theme: _fbTheme } = useTheme();
  const _fbDark = _fbTheme !== "light";
  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{
        background: _fbDark ? "rgba(15,17,26,0.4)" : "rgba(248,250,252,0.72)",
        border: _fbDark
          ? "1px solid rgba(99,102,241,0.14)"
          : "1px solid rgba(99,102,241,0.12)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-5 h-5 rounded"
            style={{ background: "rgba(99,102,241,0.15)" }}
          >
            <Search size={11} style={{ color: "#818cf8" }} />
          </div>
          <span
            className="text-[11px] font-heading uppercase tracking-wider"
            style={{ color: _fbDark ? "#64748b" : "#6366f1" }}
          >
            Filter expense bookings
          </span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-primary/15 text-primary border border-primary/20">
              {activeCount} active
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange("company", "");
              onChange("project", "");
              onChange("year", "");
              onChange("supplier", "");
            }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <X size={10} /> Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {dropdowns.map(({ key, label, icon: Icon, items, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
              <Icon size={9} /> {label}
            </label>
            <div className="relative">
              <select
                value={filters[key] || ""}
                onChange={(e) => onChange(key, e.target.value)}
                className="w-full appearance-none pl-2 pr-7 py-1.5 rounded-lg text-xs bg-background border border-border/70 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">{placeholder}</option>
                {items.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={11}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>
        ))}
      </div>

      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {(Object.entries(filters) as [keyof BookingFilters, string][]).map(
            ([key, val]) => {
              if (!val) return null;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-primary/10 text-primary border border-primary/20"
                >
                  {val}
                  <button
                    type="button"
                    onClick={() => onChange(key, "")}
                    className="ml-0.5 text-primary/50 hover:text-destructive transition-colors"
                  >
                    <X size={9} />
                  </button>
                </span>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}

// ─── ExpenseBookingPicker ─────────────────────────────────────────────────────

function ExpenseBookingPicker({
  options,
  value,
  onChange,
  loading,
}: {
  options: ExpenseOption[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "booking" | "emi">(
    "all",
  );
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((o) => o.id === value);

  const filtered = options.filter((o) => {
    if (typeFilter !== "all" && o.type !== typeFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) ||
      (o.projectName ?? "").toLowerCase().includes(q)
    );
  });

  const bookingCount = options.filter((o) => o.type === "booking").length;
  const emiCount = options.filter((o) => o.type === "emi").length;

  return (
    <div className="space-y-1.5">
      <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground">
        Select Invoice
      </label>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Selecting an invoice auto-fills project, company, amount &amp; doc type.
      </p>
      <div className="relative" ref={ref}>
        {/* Trigger */}
        <button
          type="button"
          disabled={loading}
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-wait hover:border-primary/40 transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading bookings…
            </span>
          ) : selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span
                className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold ${selected.type === "emi" ? "bg-violet-500/10 text-violet-600 border border-violet-500/20" : "bg-primary/10 text-primary border border-primary/20"}`}
              >
                {selected.type === "emi" ? "EMI" : "EXB"}
              </span>
              <span className="font-mono text-xs text-primary font-semibold truncate">
                {selected.label}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">— Choose invoice —</span>
          )}
          <ChevronDown
            size={14}
            className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Dropdown panel */}
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden">
            {/* Search + filter bar */}
            <div className="p-2.5 border-b border-border space-y-2">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search by ref, project…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {/* Type filter pills */}
              <div className="flex gap-1.5">
                {(["all", "booking", "emi"] as const).map((t) => {
                  const count =
                    t === "all"
                      ? options.length
                      : t === "booking"
                        ? bookingCount
                        : emiCount;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-heading font-semibold transition-all border ${
                        typeFilter === t
                          ? t === "emi"
                            ? "bg-violet-500/15 text-violet-600 border-violet-500/30"
                            : "bg-primary/10 text-primary border-primary/30"
                          : "bg-muted text-muted-foreground border-border hover:border-primary/20"
                      }`}
                    >
                      {t === "all"
                        ? "All"
                        : t === "booking"
                          ? "Bookings"
                          : "EMI"}
                      <span className="opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Options list */}
            <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No matches found
                </div>
              )}
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${o.id === value ? "bg-primary/5" : ""}`}
                >
                  <span
                    className={`shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold ${o.type === "emi" ? "bg-violet-500/10 text-violet-600 border border-violet-500/20" : "bg-primary/10 text-primary border border-primary/20"}`}
                  >
                    {o.type === "emi" ? "EMI" : "EXB"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-foreground truncate">
                      {o.label}
                    </p>
                    {o.projectName && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {o.projectName}
                      </p>
                    )}
                    {o.supplierName && o.supplierName !== o.projectName && (
                      <p className="text-[10px] text-primary/60 mt-0.5 truncate">
                        {o.supplierName}
                      </p>
                    )}
                    {o.type === "emi" && o.installmentNo && (
                      <p className="text-[10px] text-violet-500 mt-0.5">
                        Installment #{o.installmentNo}
                      </p>
                    )}
                  </div>
                  {o.amount != null && (
                    <span className="shrink-0 text-[11px] font-mono font-semibold text-foreground/70 mt-0.5">
                      ₹{o.amount.toLocaleString("en-IN")}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Footer clear */}
            {value && (
              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                    setSearch("");
                  }}
                  className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
                >
                  Clear selection
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentGRNBadges({ expenseId }: { expenseId: string }) {
  const [grns, setGrns] = React.useState<GRNRef[]>([]);
  React.useEffect(() => {
    if (!expenseId) return;
    fetchWithAuth(`/api/expense-booking/${expenseId}/grns`)
      .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [expenseId]);
  if (!grns.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {grns.map((g) => (
        <span
          key={g.GRNID}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800 font-mono"
        >
          <Truck size={9} />
          {g.GRNNo}
        </span>
      ))}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "docNo" },
  { header: "Payment Purpose", accessor: "paymentName" },
  { header: "Paid To", accessor: "paidTo" },
  { header: "Expense Ref", accessor: "expenseRef" },
  { header: "Project", accessor: "project" },
  { header: "Company", accessor: "company" },
  { header: "Mode", accessor: "mode" },
  { header: "Date", accessor: "date" },
  { header: "Amount", accessor: (r) => formatINR(Number(r.amount || 0)) },
  { header: "Bank", accessor: "bankName" },
  { header: "Cheque No", accessor: "chequeNo" },
  { header: "Status", accessor: "status" },
];

// ─── Mode-specific info banner ─────────────────────────────────────────────────

function ModeInfoBanner({ mode }: { mode: string }) {
  const colorClasses: Record<string, { container: string; icon: string }> = {
    emerald: {
      container: "bg-emerald-500/5 border border-emerald-500/20",
      icon: "text-emerald-500",
    },
    blue: {
      container: "bg-blue-500/5 border border-blue-500/20",
      icon: "text-blue-500",
    },
    indigo: {
      container: "bg-indigo-500/5 border border-indigo-500/20",
      icon: "text-indigo-500",
    },
    cyan: {
      container: "bg-cyan-500/5 border border-cyan-500/20",
      icon: "text-cyan-500",
    },
    violet: {
      container: "bg-violet-500/5 border border-violet-500/20",
      icon: "text-violet-500",
    },
    orange: {
      container: "bg-orange-500/5 border border-orange-500/20",
      icon: "text-orange-500",
    },
    pink: {
      container: "bg-pink-500/5 border border-pink-500/20",
      icon: "text-pink-500",
    },
    amber: {
      container: "bg-amber-500/5 border border-amber-500/20",
      icon: "text-amber-500",
    },
  };
  const msgs: Record<
    string,
    { icon: React.ElementType; color: string; text: string }
  > = {
    Cash: {
      icon: Banknote,
      color: "emerald",
      text: "Enter the raw cash amount to be paid.",
    },
    Cheque: {
      icon: BookOpen,
      color: "blue",
      text: "Select a bank and lot to auto-populate cheque details. One cheque will be deducted from the lot inventory.",
    },
    "Post-Dated Cheque": {
      icon: CalendarClock,
      color: "indigo",
      text: "Same as cheque — enter a future cheque date. The record is stored as a scheduled payment.",
    },
    NEFT: {
      icon: Hash,
      color: "cyan",
      text: "Post-transaction: enter the NEFT UTR number for reconciliation. Record will go for approval after save.",
    },
    UPI: {
      icon: Smartphone,
      color: "violet",
      text: "Post-transaction: enter the UPI Transaction ID. Record will go for approval after save.",
    },
    RTGS: {
      icon: Hash,
      color: "orange",
      text: "Post-transaction: enter the RTGS UTR reference. Record will go for approval after save.",
    },
    IMPS: {
      icon: Hash,
      color: "pink",
      text: "Post-transaction: enter the IMPS reference number. Record will go for approval after save.",
    },
    Card: {
      icon: CreditCard,
      color: "amber",
      text: "Post-transaction: enter the card transaction/approval ID for reconciliation. Record will go for approval after save.",
    },
  };
  const m = msgs[mode];
  if (!m) return null;
  const Icon = m.icon;
  const classes = colorClasses[m.color] ?? colorClasses.emerald;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg px-4 py-3 ${classes.container}`}
    >
      <Icon size={14} className={`${classes.icon} shrink-0 mt-0.5`} />
      <p className="text-xs text-muted-foreground">{m.text}</p>
    </div>
  );
}

// ─── Cheque Panel ─────────────────────────────────────────────────────────────

interface ChequePanelProps {
  bankId: number | null;
  form: Omit<PaymentRecord, "id">;
  set: <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => void;
  isPostDated: boolean;
}

function ChequePanel({ bankId, form, set, isPostDated }: ChequePanelProps) {
  const [lots, setLots] = useState<ChequeLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [chequeNumbers, setChequeNumbers] = useState<
    { number: string; used: boolean; bounced: boolean }[]
  >([]);
  const [loadingCheques, setLoadingCheques] = useState(false);
  const [validating, setValidating] = useState(false);

  // Fetch lots whenever bankId changes; auto-select the first active lot
  useEffect(() => {
    setLoadingLots(true);
    fetchChequeLots(bankId)
      .then((fetched) => {
        setLots(fetched);
        // Auto-select first lot if none already selected
        if (fetched.length > 0 && !form.chequeLotId) {
          const first = fetched[0];
          set("chequeLotId", first.CId);
          set("chequeLotNumber", first.ChequeLotNumber);
          set("chequeAccountNumber", first.AccountNumber || "");
          set("chequeIfsc", first.IFSCCode || "");
          set("chequeNo", "");
        }
      })
      .catch(() => setLots([]))
      .finally(() => setLoadingLots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  // Fetch available cheque numbers whenever lot changes
  useEffect(() => {
    if (!form.chequeLotId) {
      setChequeNumbers([]);
      return;
    }
    setLoadingCheques(true);
    fetchChequeNumbers(form.chequeLotId)
      .then(setChequeNumbers)
      .catch(() => setChequeNumbers([]))
      .finally(() => setLoadingCheques(false));
  }, [form.chequeLotId]);

  const activeLot = lots.find((l) => l.CId === form.chequeLotId) ?? null;
  const availableCheques = chequeNumbers.filter((c) => !c.used && !c.bounced);

  const handleChequeSelect = async (chequeNo: string) => {
    set("chequeNo", chequeNo);
    if (!chequeNo || !form.chequeLotId) return;
    setValidating(true);
    try {
      await deductChequeFromLot(form.chequeLotId, chequeNo);
      // validation passed — chequeNo is set, no further action needed
    } catch (err: any) {
      toast.error(err.message);
      set("chequeNo", "");
    } finally {
      setValidating(false);
    }
  };

  // When the user picks a different lot from the dropdown, update all lot-derived fields
  const handleLotSelect = (lotIdStr: string) => {
    const lotId = Number(lotIdStr);
    const lot = lots.find((l) => l.CId === lotId);
    if (!lot) return;
    set("chequeLotId", lot.CId);
    set("chequeLotNumber", lot.ChequeLotNumber);
    set("chequeAccountNumber", lot.AccountNumber || "");
    set("chequeIfsc", lot.IFSCCode || "");
    set("chequeNo", ""); // reset cheque number when lot changes
  };

  return (
    <div className="space-y-4">
      {/* Lot selector — dropdown when multiple lots exist, static chip when only one */}
      {!bankId ? null : loadingLots ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading cheque lots…
        </div>
      ) : lots.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
          <AlertTriangle size={12} />
          No active cheque lots found for this bank.
        </div>
      ) : lots.length === 1 ? (
        <>
          {/* Single lot — show as a static info chip (original behaviour) */}
          <div className="space-y-1.5">
            <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
              Lot Number
            </label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/60">
              <BookOpen size={13} className="text-primary shrink-0" />
              <span className="font-mono text-sm font-semibold text-foreground">
                {activeLot?.ChequeLotNumber ?? "—"}
              </span>
              {activeLot?.RemainingCheques != null && (
                <span className="ml-auto text-[11px] text-muted-foreground bg-primary/10 text-primary px-2 py-0.5 rounded-full font-heading">
                  {activeLot.RemainingCheques} remaining
                </span>
              )}
            </div>
          </div>

          {/* Lot detail panel */}
          {activeLot && (
            <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Cheque Range
                </p>
                <p className="font-mono text-xs font-semibold text-foreground mt-0.5">
                  {activeLot.ChequeStartNumber} – {activeLot.ChequeEndNumber}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Account No.
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.AccountNumber || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  IFSC
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.IFSCCode || "—"}
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Multiple lots — show a selectable dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
              Lot Number
            </label>
            <div className="relative">
              <BookOpen
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={form.chequeLotId ? String(form.chequeLotId) : ""}
                onChange={(e) => handleLotSelect(e.target.value)}
                className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              >
                <option value="">— Select lot —</option>
                {lots.map((lot) => (
                  <option key={lot.CId} value={String(lot.CId)}>
                    {lot.ChequeLotNumber}
                    {lot.RemainingCheques != null
                      ? `  (${lot.RemainingCheques} remaining)`
                      : ""}
                    {lot.AccountNumber ? `  · ${lot.AccountNumber}` : ""}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <ChevronDown size={14} />
              </div>
            </div>
            {lots.length > 1 && (
              <p className="text-[11px] text-muted-foreground">
                {lots.length} lots available for this bank — select one to load
                its cheques.
              </p>
            )}
          </div>

          {/* Lot detail panel — shown once a lot is selected */}
          {activeLot && (
            <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Cheque Range
                </p>
                <p className="font-mono text-xs font-semibold text-foreground mt-0.5">
                  {activeLot.ChequeStartNumber} – {activeLot.ChequeEndNumber}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Account No.
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.AccountNumber || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  IFSC
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.IFSCCode || "—"}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Cheque number dropdown — only show after bank+lot loaded */}
      {bankId && form.chequeLotId && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Cheque Number"
              required
              hint="Select an available cheque from this lot"
            >
              <div className="relative">
                <Hash
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <select
                  value={form.chequeNo}
                  onChange={(e) => handleChequeSelect(e.target.value)}
                  disabled={loadingCheques || validating || !form.chequeLotId}
                  className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 font-mono"
                >
                  <option value="">— Select cheque number —</option>
                  {availableCheques.map((c) => (
                    <option key={c.number} value={c.number}>
                      # {c.number}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                  {loadingCheques || validating ? (
                    <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </div>
              </div>
              {availableCheques.length === 0 &&
                form.chequeLotId &&
                !loadingCheques && (
                  <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-1">
                    <AlertTriangle size={10} /> No available cheques left in
                    this lot.
                  </p>
                )}
            </Field>

            <Field
              label={isPostDated ? "Post-Dated Cheque Date" : "Cheque Date"}
              required={isPostDated}
              hint={isPostDated ? "Must be a future date" : undefined}
            >
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="date"
                  value={form.chequeDate}
                  min={
                    isPostDated
                      ? new Date().toISOString().slice(0, 10)
                      : undefined
                  }
                  onChange={(e) => set("chequeDate", e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </div>
            </Field>
          </div>

          {isPostDated && form.chequeDate && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-xs text-indigo-600 dark:text-indigo-400">
              <CalendarClock size={13} />
              Scheduled for{" "}
              {new Date(form.chequeDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Digital Reference Panel ──────────────────────────────────────────────────

function DigitalRefPanel({
  mode,
  form,
  set,
}: {
  mode: string;
  form: Omit<PaymentRecord, "id">;
  set: <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => void;
}) {
  const configs: Record<
    string,
    {
      field: keyof Omit<PaymentRecord, "id">;
      label: string;
      placeholder: string;
      hint: string;
    }
  > = {
    NEFT: {
      field: "neftNumber",
      label: "NEFT UTR Number",
      placeholder: "e.g. HDFC0000012345",
      hint: "22-character UTR number from your bank statement.",
    },
    UPI: {
      field: "upiTransactionId",
      label: "UPI Transaction ID",
      placeholder: "e.g. 4059876543210",
      hint: "12-digit transaction ID from the UPI app.",
    },
    RTGS: {
      field: "rtgsReference",
      label: "RTGS UTR Reference",
      placeholder: "e.g. RTGS2024050600001",
      hint: "UTR number provided by the bank for RTGS transfer.",
    },
    IMPS: {
      field: "impsReference",
      label: "IMPS Reference Number",
      placeholder: "e.g. 412210987654",
      hint: "12-digit reference from IMPS transfer confirmation.",
    },
    Card: {
      field: "cardReference",
      label: "Card Transaction / Approval ID",
      placeholder: "e.g. AUTH123456",
      hint: "Transaction or approval ID from the card terminal/statement.",
    },
  };
  const cfg = configs[mode];
  if (!cfg) return null;

  const value = (form[cfg.field] as string) || "";

  return (
    <Field label={cfg.label} required hint={cfg.hint}>
      <InputField
        icon={Hash}
        value={value}
        onChange={(v) => set(cfg.field, v)}
        placeholder={cfg.placeholder}
      />
    </Field>
  );
}

// ─── Card Panel ────────────────────────────────────────────────────────────────
// Lets the user pick which specific card (from Card Master) was used for a
// "Card" mode payment, since one bank can have multiple cards on file.
// Mirrors ChequePanel's bank → lot lookup, but cards are an optional layer on
// top of the existing free-text cardReference (transaction/approval ID).

interface CardPanelProps {
  bankId: number | null;
  form: Omit<PaymentRecord, "id">;
  set: <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => void;
}

function maskCardNumber(num: string | null): string {
  const digits = (num || "").replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••• ${digits.slice(-4)}`;
}

function CardPanel({ bankId, form, set }: CardPanelProps) {
  const [cards, setCards] = useState<CardOption[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  // Fetch cards whenever bankId changes; auto-select if there's exactly one
  useEffect(() => {
    if (!bankId) {
      setCards([]);
      return;
    }
    setLoadingCards(true);
    fetchCardsByBank(bankId)
      .then((fetched) => {
        setCards(fetched);
        if (fetched.length === 1 && !form.cardId) {
          set("cardId", fetched[0].id);
        }
      })
      .catch(() => setCards([]))
      .finally(() => setLoadingCards(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  if (!bankId) return null;

  if (loadingCards) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        Loading cards…
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
        <AlertTriangle size={12} />
        No cards on file for this bank. You can still enter the transaction ID
        below, or add a card in Card Master.
      </div>
    );
  }

  const selected = cards.find((c) => c.id === form.cardId) ?? null;

  return (
    <Field
      label="Card Used"
      hint="Select which card on file was used for this transaction."
    >
      <div className="relative">
        <CreditCard
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <select
          value={form.cardId ? String(form.cardId) : ""}
          onChange={(e) =>
            set("cardId", e.target.value ? Number(e.target.value) : null)
          }
          className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— Select card —</option>
          {cards.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {[
                c.card_network,
                maskCardNumber(c.card_number),
                c.card_holder_name,
              ]
                .filter(Boolean)
                .join(" · ")}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
      {selected && (
        <p className="text-[11px] text-muted-foreground/70 mt-1 pl-1">
          {[selected.card_type, selected.card_holder_name]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </Field>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const Payment: React.FC = () => {
  const rights = usePageRights("new-payment");
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const queryClient = useQueryClient();
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState(""); // stores numeric ID for display
  const [companyNameFilter, setCompanyNameFilter] = useState(""); // stores label for backend
  const [projectFilter, setProjectFilter] = useState("");
  const [finYearFilter, setFinYearFilter] = useState("");
  const [docNumberFilter, setDocNumberFilter] = useState("");
  const [docDateFilter, setDocDateFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const PAGE_SIZE = 20;

  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<PaymentRecord, "id">>(blankForm());
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Re-issue (bounced cheque replacement) context
  const [reissueCtx, setReissueCtx] = useState<{
    replacesPaymentId: number;
    replacesDocNo: string;
    amount: number;
    paymentName: string;
    companyName: string;
    expenseRef: string | null;
    bounceReason: string | null;
  } | null>(null);
  const [bounceCharge, setBounceCharge] = useState<string>("");
  const [viewingRec, setViewingRec] = useState<PaymentRecord | null>(null);
  const [viewingCompanyDetail, setViewingCompanyDetail] =
    useState<CompanyDetail | null>(null);
  const [viewingChain, setViewingChain] = useState<ChainSummary | null>(null);
  const [viewingGrnTotal, setViewingGrnTotal] = useState<number>(0);
  const [paymentChainData, setPaymentChainData] = useState<PaymentChainResponse | null>(null);
  const [loadingChain, setLoadingChain] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "chain">("details");
  const [formChainData, setFormChainData] = useState<PaymentChainResponse | null>(null);
  const [loadingFormChain, setLoadingFormChain] = useState(false);
  // Known totalPaid injected by "Pay Remaining" — overrides stale opt.totalPaid from DB
  const [formKnownTotalPaid, setFormKnownTotalPaid] = useState<number | null>(null);

  // Open the detail modal and eagerly fetch the company logo
  const openViewRec = async (rec: PaymentRecord) => {
    setViewingRec(rec);
    setViewingCompanyDetail(null);
    setViewingChain(null);
    setViewingGrnTotal(0);
    setPaymentChainData(null);
    setDetailTab("details");
    const matched = companyOptions.find(
      (c) => c.label === rec.company || String(c.id) === rec.company,
    );
    if (matched) {
      try {
        const detail = await getCompanyById(Number(matched.id));
        setViewingCompanyDetail(detail);
      } catch {
        /* logo not critical */
      }
    }
    if (rec.expenseId) {
      fetchPaymentSummary(rec.expenseId)
        .then(setViewingChain)
        .catch(() => {});
      // Fetch GRN breakdown to get GST-inclusive total (bypasses stale ENetAmount in payment-summary)
      fetchWithAuth(`/api/expense-booking/${rec.expenseId}`)
        .then((r) => r.ok ? r.json() : null)
        .then(async (eb: any) => {
          if (eb?.ESourceType === "GRN" && eb?.ESourceId) {
            const br = await fetchWithAuth(`/api/grns/${eb.ESourceId}/gst-breakdown`);
            if (br.ok) {
              const bd = await br.json();
              const total = bd?.totals?.totalInclGST ?? 0;
              if (total > 0) setViewingGrnTotal(total);
            }
          }
        })
        .catch(() => {});
    }
    if (rec.expenseRef) {
      setLoadingChain(true);
      getPaymentChain(rec.expenseRef)
        .then(setPaymentChainData)
        .catch(() => {})
        .finally(() => setLoadingChain(false));
    }
  };

  // Deep-link support — Trial Balance drill-down (Level 3) navigates here as
  // /payments?view=<PPaymentID>, so this payment's receipt should open
  // automatically in view mode, regardless of which page it's on.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    const id = parseInt(viewId, 10);
    if (!Number.isFinite(id)) return;
    getPaymentById(id)
      .then((row) => {
        if (row) openViewRec(dbToRecord(row));
        else toast.error(`Payment #${id} not found`);
      })
      .catch(() => toast.error("Failed to load the linked payment"))
      .finally(() => {
        searchParams.delete("view");
        setSearchParams(searchParams, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect bounce re-issue context passed from BRS page
  useEffect(() => {
    const ri = (location.state as any)?.reissue;
    if (!ri?.replacesPaymentId) return;
    setReissueCtx(ri);
    setBounceCharge("");
    setView("form");
    window.history.replaceState({}, "", location.pathname);

    // Fetch the full original payment record to pre-fill all fields
    fetchWithAuth(`/api/new-payment/${ri.replacesPaymentId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        if (!data) return;
        setForm((prev) => ({
          ...prev,
          paymentName: data.PPaymentName ?? ri.paymentName ?? prev.paymentName,
          amount:      data.PAmount      != null ? parseFloat(data.PAmount) : (ri.amount ?? prev.amount),
          expenseRef:  data.PExpenseRef  ?? ri.expenseRef  ?? prev.expenseRef,
          company:     data.PCompanyName ?? data.PCompany  ?? ri.company    ?? prev.company,
          project:     data.PProjectName ?? data.PProject  ?? ri.project    ?? prev.project,
          projectSite: data.PProjectName ?? data.PProject  ?? ri.project    ?? prev.projectSite,
          bankId:      data.PBankID      ?? ri.bankId      ?? prev.bankId,
          paidTo:      data.PSupplierName ?? prev.paidTo,
          docType:     data.PDocType     ?? prev.docType,
        }));
      })
      .catch(() => {
        // Fallback to the BRS-provided summary if the fetch fails
        setForm((prev) => ({
          ...prev,
          paymentName: ri.paymentName ?? prev.paymentName,
          amount:      ri.amount      ?? prev.amount,
          expenseRef:  ri.expenseRef  ?? prev.expenseRef,
          company:     ri.company     ?? prev.company,
          project:     ri.project     ?? prev.project,
          bankId:      ri.bankId      ?? prev.bankId,
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Print/PDF payment voucher
  const handlePrintPayment = (
    rec: PaymentRecord,
    companyDetail: CompanyDetail | null,
    chain: ChainSummary | null = null,
  ) => {
    const logoHtml = companyDetail?.logo
      ? `<img src="${companyDetail.logo}" alt="Logo" style="height:60px;max-width:180px;object-fit:contain;" />`
      : `<span style="font-size:18px;font-weight:800;color:#4f46e5;">${companyDetail?.name ?? rec.company ?? "—"}</span>`;

    const companyAddress = [
      companyDetail?.address,
      companyDetail?.address_line2,
      companyDetail?.city,
      companyDetail?.state,
      companyDetail?.pincode,
    ]
      .filter(Boolean)
      .join(", ");

    const statusColor: Record<string, string> = {
      Draft: "#64748b",
      Pending: "#d97706",
      Approved: "#059669",
      Rejected: "#dc2626",
    };
    const sColor = statusColor[rec.status] ?? "#64748b";

    const modeColor: Record<string, string> = {
      Cheque: "#4f46e5",
      "Post-Dated Cheque": "#7c3aed",
      NEFT: "#0891b2",
      UPI: "#059669",
      RTGS: "#d97706",
      IMPS: "#ea580c",
      Cash: "#16a34a",
    };
    const mColor = modeColor[rec.mode] ?? "#4f46e5";

    const field = (label: string, value: string | null | undefined) =>
      value
        ? `<tr>
            <td style="padding:7px 12px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;width:160px;">${label}</td>
            <td style="padding:7px 12px;font-size:13px;font-weight:500;color:#111827;">${value}</td>
           </tr>`
        : "";

    const sectionTitle = (label: string) =>
      `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4f46e5;margin:20px 0 8px;">${label}</div>`;

    const supplier = chain?.supplier ?? null;
    const docChain = chain?.chain ?? null;

    const supplierRows = supplier
      ? [
          field("Supplier Name", supplier.name),
          field("Supplier Code", supplier.code),
          field("Address", supplier.address),
          field("Contact No.", supplier.phone),
          field("Email", supplier.email),
          field("GST No.", supplier.gst),
          field("PAN No.", supplier.pan),
        ].join("")
      : "";

    const docRefRows = [
      field("Invoice No.", docChain?.vendorInvoiceNo || null),
      field("Invoice Date", docChain?.vendorInvoiceDate || null),
      field("Purchase Order Ref.", docChain?.poNo || null),
      field("GRN Ref.", docChain?.grnNo || null),
      field("Material Request Ref.", docChain?.mrDocNo || null),
      field(
        "Expense Booking Ref.",
        docChain?.expenseDocNo || rec.expenseRef || null,
      ),
    ].join("");

    const paymentRows = [
      field("Payment Ref", rec.docNo || "—"),
      field("Payment Purpose", rec.paymentName),
      field("Paid To", rec.paidTo),
      field("Date", rec.date || "—"),
      field("Mode", rec.mode || "—"),
      field("Bank Account", rec.bankName || null),
      field(
        "Reference / Txn ID",
        rec.chequeNo
          ? `Cheque #${rec.chequeNo}`
          : rec.neftNumber ||
              rec.upiTransactionId ||
              rec.rtgsReference ||
              rec.impsReference ||
              rec.cardReference ||
              null,
      ),
      field("Cheque Date", rec.chequeDate || null),
      field("Cheque Lot", rec.chequeLotNumber || null),
      field("Card Used", rec.cardDisplay || null),
      field("Company", rec.company || "—"),
      field("Project", rec.project || "—"),
      field("Project Site", rec.projectSite || null),
      field("Parent Doc", rec.parentDocNo || null),
    ].join("");

    const baseAmount = rec.baseAmount ?? null;
    const cgstRate = rec.cgstRate ?? null;
    const sgstRate = rec.sgstRate ?? null;
    const igstRate = rec.igstRate ?? null;
    const hasTaxDetails =
      baseAmount != null && (cgstRate || sgstRate || igstRate);
    const cgstAmt =
      hasTaxDetails && cgstRate ? (baseAmount! * cgstRate) / 100 : 0;
    const sgstAmt =
      hasTaxDetails && sgstRate ? (baseAmount! * sgstRate) / 100 : 0;
    const igstAmt =
      hasTaxDetails && igstRate ? (baseAmount! * igstRate) / 100 : 0;

    const taxRows = hasTaxDetails
      ? [
          field("Taxable Amount", formatINR(baseAmount!)),
          cgstRate ? field(`CGST (${cgstRate}%)`, formatINR(cgstAmt)) : "",
          sgstRate ? field(`SGST (${sgstRate}%)`, formatINR(sgstAmt)) : "",
          igstRate ? field(`IGST (${igstRate}%)`, formatINR(igstAmt)) : "",
        ].join("")
      : "";

    const printedAt = new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const signBlock = (label: string) =>
      `<div style="flex:1;text-align:center;">
         <div style="border-top:1px solid #9ca3af;margin:36px 12px 6px;"></div>
         <div style="font-size:11px;color:#6b7280;">${label}</div>
       </div>`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payment Receipt — ${rec.docNo || rec.paymentName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111827; padding: 36px; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; }
    tr:nth-child(even) { background: #f9fafb; }
    @media print { body { padding: 16px; } button { display: none !important; } }
  </style>
</head>
<body>
  <!-- Company header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #4f46e5;margin-bottom:8px;">
    <div>
      ${logoHtml}
      ${companyAddress ? `<div style="margin-top:6px;font-size:11px;color:#6b7280;max-width:340px;">${companyAddress}</div>` : ""}
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        ${[companyDetail?.phone_number, companyDetail?.email].filter(Boolean).join("  ·  ")}
      </div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        ${[companyDetail?.gst_no ? `GSTIN: ${companyDetail.gst_no}` : null, companyDetail?.pan_no ? `PAN: ${companyDetail.pan_no}` : null].filter(Boolean).join("  ·  ")}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PAYMENT RECEIPT</div>
      <div style="font-size:14px;font-weight:700;font-family:monospace;color:#111827;margin-top:4px;">${rec.docNo || "—"}</div>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;align-items:center;">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${sColor}18;color:${sColor};border:1px solid ${sColor}40;">
          ${rec.status}
        </span>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${mColor}18;color:${mColor};border:1px solid ${mColor}40;">
          ${rec.mode}
        </span>
      </div>
    </div>
  </div>

  <!-- Amount highlight -->
  <div style="margin:18px 0 8px;padding:16px 20px;background:linear-gradient(135deg,#4f46e510,#7c3aed10);border-radius:12px;border:1px solid #4f46e520;display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Payment Amount</div>
      <div style="font-size:28px;font-weight:800;color:#4f46e5;font-family:monospace;">${formatINR(rec.amount ?? 0)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Payment Date</div>
      <div style="font-size:16px;font-weight:700;color:#111827;">${rec.date || "—"}</div>
    </div>
  </div>

  ${supplierRows ? sectionTitle("Supplier / Vendor Information") : ""}
  ${supplierRows ? `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><table><tbody>${supplierRows}</tbody></table></div>` : ""}

  ${sectionTitle("Payment Information")}
  <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <table><tbody>${paymentRows}${docRefRows}</tbody></table>
  </div>

  ${taxRows ? sectionTitle("Tax Details") : ""}
  ${taxRows ? `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><table><tbody>${taxRows}</tbody></table></div>` : ""}

  <!-- Signatories -->
  <div style="display:flex;gap:8px;margin-top:48px;">
    ${signBlock("Prepared By")}
    ${signBlock("Approved By")}
    ${signBlock("Authorized Signatory")}
  </div>

  <!-- Footer -->
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;">
    <span>This is a system-generated receipt and does not require a physical signature.</span>
    <span>Printed: ${printedAt}</span>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank", "width=860,height=720");
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error("Pop-up blocked — please allow pop-ups.");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    win.onload = () => {
      win.focus();
      win.print();
    };
  };
  const [loadingExpense, setLoadingExpense] = useState(false);
  const [linkedGRNs, setLinkedGRNs] = useState<GRNRef[]>([]);
  const [grnGstBreakdown, setGrnGstBreakdown] = useState<{
    items: {
      itemName: string;
      hsnCode: string;
      gstPercent: number;
      receivedQty: number;
      totalAmountInclGST: number;
      baseAmount: number;
      cgstRate: number;
      cgstAmount: number;
      sgstRate: number;
      sgstAmount: number;
      gstAmount: number;
    }[];
    totals: {
      totalBase: number;
      totalCGST: number;
      totalSGST: number;
      totalGST: number;
      totalInclGST: number;
    };
  } | null>(null);
  const [, setSupplierBookingFilter] = useState("");
  const [bookingFilters, setBookingFilters] = useState<BookingFilters>({
    company: "",
    project: "",
    year: "",
    supplier: "",
  });

  // ── Queries ────────────────────────────────────────────────────────────────

  const {
    data: dbData,
    isLoading,
    isError,
    refetch: refetchPayments,
  } = useQuery({
    queryKey: [
      "payments",
      page,
      supplierFilter,
      companyNameFilter,
      projectFilter,
      finYearFilter,
      docNumberFilter,
      docDateFilter,
    ],
    queryFn: () =>
      getPayments(
        page,
        PAGE_SIZE,
        supplierFilter,
        companyNameFilter,
        projectFilter,
        finYearFilter,
        docNumberFilter,
        docDateFilter,
      ),
    staleTime: 0,
  });

  const { data: banks = [] } = useQuery<BankOption[]>({
    queryKey: ["bank-options-payment"],
    queryFn: fetchBankOptions,
  });

  const { data: enterprises = [] } = useQuery<{ id: number; label: string }[]>({
    queryKey: ["company-options-payment-filter"],
    queryFn: fetchCompanyOptions,
  });

  // Companies fetched with business_type=C from enterprise table
  const companyOptions = enterprises;

  const { data: projectOptions = [] } = useQuery<
    {
      id: number;
      label: string;
      belongs_to?: number | null;
      company_id?: number | null;
    }[]
  >({
    queryKey: ["project-options-payment-filter"],
    queryFn: fetchProjectOptions,
  });

  const { data: supplierOptions = [] } = useQuery<
    { id: number; label: string }[]
  >({
    queryKey: ["supplier-options-payment-filter"],
    queryFn: fetchSupplierOptions,
  });

  const { data: finYearOptions = [] } = useQuery<
    { id: number; label: string }[]
  >({
    queryKey: ["fin-year-options-payment-filter"],
    queryFn: fetchFinYearOptions,
  });

  const dbItems: DbPayment[] = Array.isArray(dbData?.data) ? dbData.data : [];
  const totalPages: number = dbData?.totalPages ?? 1;
  const totalRecords: number = dbData?.total ?? 0;
  const records: PaymentRecord[] = dbItems.map(dbToRecord);

  // Fetch full detail (name + logo + address) for the selected company — used in PDF export
  const { data: selectedCompanyDetail = null } = useQuery<CompanyDetail | null>(
    {
      queryKey: ["company-detail-export", companyFilter],
      queryFn: () =>
        companyFilter
          ? getCompanyById(Number(companyFilter))
          : Promise.resolve(null),
      enabled: !!companyFilter,
    },
  );

  const { data: expenseOptions = [] } = useQuery<ExpenseOption[]>({
    queryKey: ["expense-options-payment"],
    queryFn: fetchExpenseOptions,
    staleTime: 0,
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalAmount = dbItems.reduce((s, p) => s + (p.PAmount || 0), 0);
  const chequeCount = dbItems.filter(
    (p) => p.PMode === "Cheque" || p.PMode === "Post-Dated Cheque",
  ).length;
  const cashCount = dbItems.filter((p) => p.PMode === "Cash").length;

  // ── Form helpers ───────────────────────────────────────────────────────────

  const set = <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const openNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
    setView("form");
  };

  const openEdit = (rec: PaymentRecord) => {
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    const matchedOption = rest.expenseRef
      ? expenseOptions.find(
          (o) =>
            o.label.startsWith(rest.expenseRef + " ") ||
            o.label.startsWith(rest.expenseRef + " —"),
        )
      : undefined;
    setForm({ ...rest, expenseId: matchedOption?.id ?? "" });
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
    setView("form");
  };

  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm(blankForm());
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
  };

  const blank = blankForm();
  const isDirty = (Object.keys(blank) as (keyof typeof blank)[]).some(
    (k) => String(form[k] ?? "") !== String(blank[k] ?? ""),
  );

  const canSave = !!(
    form.paymentName.trim() &&
    form.mode &&
    form.date &&
    (Number(form.amount) > 0 || form.expenseRef)
  );

  const handleReset = () => {
    setForm(blankForm());
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
  };

  // ── Mode change — clear irrelevant fields ──────────────────────────────────

  const handleModeChange = (newMode: string) => {
    setForm((prev) => ({
      ...prev,
      mode: newMode,
      isPostDated: newMode === "Post-Dated Cheque",
      // Clear cheque fields when switching away from cheque modes
      ...(newMode !== "Cheque" && newMode !== "Post-Dated Cheque"
        ? {
            chequeNo: "",
            chequeLotId: null,
            chequeLotNumber: "",
            chequeDate: "",
            chequeAccountNumber: "",
            chequeIfsc: "",
          }
        : {}),
      // Clear digital fields when switching away from digital modes
      ...(!["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(newMode)
        ? {
            neftNumber: "",
            upiTransactionId: "",
            rtgsReference: "",
            impsReference: "",
            cardReference: "",
            cardId: null,
          }
        : {}),
    }));
  };

  // ── Expense booking selection → auto-fill ──────────────────────────────────

  const handleExpenseSelect = useCallback(
    async (expenseId: string, amountOverride?: number) => {
      // Reset known total paid unless this is a Pay Remaining call (amountOverride set)
      if (amountOverride == null) setFormKnownTotalPaid(null);
      if (!expenseId) {
        setForm((prev) => ({
          ...prev,
          expenseId: "",
          expenseRef: "",
          parentDocNo: "",
          rootExBDocNo: "",
          project: "",
          company: "",
          amount: null,
          docType: "",
        }));
        return;
      }

      const selectedOption = expenseOptions.find((o) => o.id === expenseId);
      if (selectedOption?.type === "emi") {
        const parentDocNo =
          selectedOption.parentDocNo ||
          selectedOption.refNumber?.replace(/-EMI-\d+$/i, "") ||
          selectedOption.docNo?.replace(/-EMI-\d+$/i, "") ||
          "";
        const padded = String(selectedOption.installmentNo ?? 1).padStart(
          2,
          "0",
        );
        const emiSuffix = `EMI-${padded}`;
        const ref =
          selectedOption.refNumber ||
          (selectedOption.parentDocNo
            ? `${selectedOption.parentDocNo}-${emiSuffix}`
            : selectedOption.docNo
              ? `${selectedOption.docNo}-${emiSuffix}`
              : emiSuffix);
        setForm((prev) => ({
          ...prev,
          expenseId,
          expenseRef: ref,
          parentDocNo,
          rootExBDocNo: parentDocNo,
          project: selectedOption.projectName || "",
          company: (() => {
            const name = selectedOption.companyName;
            if (name && name.trim()) return name.trim();
            const matched = companyOptions.find(
              (c) => c.id === selectedOption.companyId,
            );
            return matched?.label || String(selectedOption.companyId ?? "");
          })(),
          amount: selectedOption.amount ?? null,
          docType: `EMI-${padded}`,
        }));
        if (selectedOption.expenseBookingId) {
          fetchExpenseGRNs(String(selectedOption.expenseBookingId))
            .then((grns) => {
              setLinkedGRNs(grns);
              if (grns.length > 0 && grns[0].ProjectName) {
                setForm((prev) => ({
                  ...prev,
                  projectSite: grns[0].ProjectName!,
                }));
              }
            })
            .catch(() => setLinkedGRNs([]));
        }
        return;
      }

      setLoadingExpense(true);
      try {
        const detail = await fetchExpenseDetail(expenseId);
        if (!detail) throw new Error("Not found");
        const parentDocNo = detail.ParentDocNo || detail.EDocNo || "";
        const rootExBDocNo = detail.RootExBDocNo || detail.EDocNo || "";
        setForm((prev) => ({
          ...prev,
          expenseId,
          expenseRef: detail.EDocNo || "",
          parentDocNo,
          rootExBDocNo,
          project: detail.EProjectDisplayName || detail.EProjectName || "",
          company: (() => {
            const name = (detail as any).ECompanyName;
            if (name && name.trim()) return name.trim();
            // Fall back to label from the enterprise options list
            const matched = companyOptions.find(
              (c) => c.id === detail.ECompanyId,
            );
            return matched?.label || String(detail.ECompanyId ?? "");
          })(),
          // If an override is provided (Pay Remaining flow), always use it.
          // Otherwise fall back to stored ENetAmount → GRN total → EAmount.
          amount: amountOverride != null
            ? amountOverride
            : detail.ENetAmount
              ? parseFloat(String(detail.ENetAmount))
              : (detail as any).EGrnTotalAmount
                ? parseFloat((detail as any).EGrnTotalAmount)
                : (detail.EAmount ?? null),
          docType: detail.DocTypeName || detail.EDocumentType || "",
          // For GRN: baseAmount = pre-tax base (totalBase), rates from DB.
          // GST breakdown API will override these with precise per-item values.
          // If EGrnTotalAmount is set but breakdown hasn't loaded yet,
          // zero out GST rates to avoid double-counting on the incl-GST figure.
          baseAmount: (detail as any).EGrnTotalAmount
            ? parseFloat((detail as any).EGrnTotalAmount) // will be overridden by GRN breakdown
            : (detail.EAmount ?? null),
          // Zero out GST rates for GRN records — the GRN breakdown fetch below
          // will set correct totalBase + rates. Without this, if the breakdown
          // API fails, cgstRate applied on EGrnTotalAmount (incl-GST) would double-count GST.
          cgstRate: (detail as any).EGrnTotalAmount
            ? 0
            : (detail.ECgstRate ?? null),
          sgstRate: (detail as any).EGrnTotalAmount
            ? 0
            : (detail.ESgstRate ?? null),
          igstRate: (detail as any).EGrnTotalAmount
            ? 0
            : (detail.EIgstRate ?? null),
          billingTermsData:
            detail.EBillingTermsData ?? detail.EDiscountData ?? null,
        }));

        // For WORK_DONE entries, resolve project from the linked WorkDone record
        if (detail.EDocumentType === "WORK_DONE" && detail.ESourceId) {
          const wd = await fetchWorkDoneById(detail.ESourceId);
          if (wd?.ProjectName) {
            setForm((prev) => ({ ...prev, projectSite: wd.ProjectName! }));
          }
        }

        const grns = await fetchExpenseGRNs(expenseId);
        setLinkedGRNs(grns);
        if (grns.length > 0 && grns[0].ProjectName) {
          setForm((prev) => ({ ...prev, projectSite: grns[0].ProjectName! }));
        } else if (detail.EProjectDisplayName || detail.EProjectName) {
          setForm((prev) => ({
            ...prev,
            projectSite:
              detail.EProjectDisplayName || detail.EProjectName || "",
          }));
        }

        // Helper: given a GRNID, fetch its item-level GST breakdown and populate
        // grnGstBreakdown + form rates. Used by both GRN-direct and PO-indirect paths.
        const applyGrnBreakdown = async (grnId: number | string) => {
          try {
            const bdRes = await fetchWithAuth(
              `/api/grns/${grnId}/gst-breakdown`,
            );
            if (bdRes.ok) {
              const bd = await bdRes.json();
              setGrnGstBreakdown(bd);
              // Override form amounts with correct values from GRN item-level GST breakdown,
              // then apply billing terms (pre/post-GST) to arrive at the true Net Payable.
              if (bd?.totals?.totalInclGST > 0) {
                setGrnGstBreakdown(bd);
                const t = bd.totals;
                const avgCGST =
                  t.totalBase > 0 ? (t.totalCGST / t.totalBase) * 100 : 0;
                const avgSGST =
                  t.totalBase > 0 ? (t.totalSGST / t.totalBase) * 100 : 0;

                // Parse billing terms from the expense detail
                let billingTerms: any[] = [];
                try {
                  const raw =
                    detail.EBillingTermsData ?? detail.EDiscountData ?? null;
                  if (raw) {
                    let parsed = JSON.parse(raw);
                    if (typeof parsed === "string") parsed = JSON.parse(parsed);
                    billingTerms = Array.isArray(parsed) ? parsed : [];
                  }
                } catch {
                  /* ignore parse errors */
                }

                // Compute net payable: apply billing terms on GRN gross with
                // correct pre/post-GST ordering (same logic as MaterialExpenseBooking)
                const netPayable =
                  billingTerms.length > 0
                    ? computeGrnNetWithTerms(
                        t.totalInclGST,
                        billingTerms,
                        t.totalBase,
                      )
                    : Math.round(t.totalInclGST * 100) / 100;

                setForm((prev) => ({
                  ...prev,
                  amount: amountOverride != null ? amountOverride : netPayable,
                  baseAmount: Math.round(t.totalBase * 100) / 100,
                  cgstRate: Math.round(avgCGST * 100) / 100,
                  sgstRate: Math.round(avgSGST * 100) / 100,
                  igstRate: 0,
                }));
              }
            }
          } catch {
            /* non-fatal */
          }
        };

        // If this expense is linked to a GRN directly, fetch the per-item GST breakdown.
        // For PO/WO_PO-linked bookings, find the GRN created against that PO and use its breakdown —
        // because the actual GST lives in the GRN items (PO stores rates but GRN stores received actuals).
        if (detail.ESourceType === "GRN" && detail.ESourceId) {
          await applyGrnBreakdown(detail.ESourceId);
        } else if (
          (detail.ESourceType === "PO" || detail.ESourceType === "WO_PO") &&
          detail.ESourceId
        ) {
          try {
            const poGrnsRes = await fetchWithAuth(
              `/api/grns/by-po/${detail.ESourceId}`,
            );
            if (poGrnsRes.ok) {
              const poGrns: { GRNID: number }[] = await poGrnsRes.json();
              if (Array.isArray(poGrns) && poGrns.length > 0) {
                // grns returned newest-first; use most recent GRN's breakdown
                await applyGrnBreakdown(poGrns[0].GRNID);
              }
            }
          } catch {
            /* non-fatal — breakdown stays null, standard cgstRate/sgstRate used */
          }
        } else {
          setGrnGstBreakdown(null);
        }
      } catch {
        toast.error("Could not load expense booking details.");
      } finally {
        setLoadingExpense(false);
      }
    },
    [expenseOptions, companyOptions],
  );

  // Auto-select the matching invoice for re-issue once expenseOptions loads
  useEffect(() => {
    if (!reissueCtx || !expenseOptions.length || form.expenseId) return;
    const ref = reissueCtx.expenseRef;
    if (!ref) return;
    const opt =
      expenseOptions.find((o) => o.docNo === ref) ??
      expenseOptions.find(
        (o) =>
          o.label.startsWith(ref + " ") || o.label.startsWith(ref + " —"),
      );
    if (opt) handleExpenseSelect(opt.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseOptions, reissueCtx]);

  // Fetch payment chain for the form view whenever an invoice is linked
  useEffect(() => {
    if (!form.expenseRef) {
      setFormChainData(null);
      return;
    }
    let cancelled = false;
    setLoadingFormChain(true);
    getPaymentChain(form.expenseRef)
      .then((data) => { if (!cancelled) setFormChainData(data); })
      .catch(() => { if (!cancelled) setFormChainData(null); })
      .finally(() => { if (!cancelled) setLoadingFormChain(false); });
    return () => { cancelled = true; };
  }, [form.expenseRef]);

  const clearExpenseLink = () => {
    setForm((prev) => ({
      ...prev,
      expenseId: "",
      expenseRef: "",
      parentDocNo: "",
      rootExBDocNo: "",
      project: "",
      company: "",
      amount: null,
      docType: "",
      baseAmount: null,
      cgstRate: null,
      sgstRate: null,
      igstRate: null,
      billingTermsData: null,
    }));
    setLinkedGRNs([]);
    setGrnGstBreakdown(null);
    setSupplierBookingFilter("");
  };

  // ── Bank selection ─────────────────────────────────────────────────────────

  const handleBankSelect = (bankIdStr: string) => {
    if (!bankIdStr) {
      set("bankId", null);
      set("bankName", "");
      return;
    }
    const bank = banks.find((b) => String(b.id) === bankIdStr);
    set("bankId", bank?.id ?? null);
    set("bankName", bank?.label?.split(" — ")[0] ?? "");
    // Reset cheque lot when bank changes
    set("chequeLotId", null);
    set("chequeLotNumber", "");
    set("chequeNo", "");
    // Reset selected card when bank changes (cards are bank-specific)
    set("cardId", null);
  };

  // ── Validation ─────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    if (!form.paymentName.trim()) {
      toast.error("Payment purpose is required.");
      return false;
    }
    if (!form.mode) {
      toast.error("Please select a payment mode.");
      return false;
    }
    if (!form.date) {
      toast.error("Payment date is required.");
      return false;
    }

    const isChequeMode =
      form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
    const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(
      form.mode,
    );

    if (isChequeMode) {
      if (!form.bankId) {
        toast.error("Please select a bank account.");
        return false;
      }
      if (!form.chequeLotId) {
        toast.error("No active cheque lot found for the selected bank.");
        return false;
      }
      if (!form.chequeNo) {
        toast.error("Please select a cheque number from the lot.");
        return false;
      }
      if (form.mode === "Post-Dated Cheque" && !form.chequeDate) {
        toast.error("Post-dated cheque requires a future date.");
        return false;
      }
    }

    if (form.mode === "Cash" && !form.amount) {
      toast.error("Amount is required for Cash payment.");
      return false;
    }

    if (isDigitalMode) {
      if (!form.bankId) {
        toast.error("Please select a bank account.");
        return false;
      }
      if (form.mode === "NEFT" && !form.neftNumber.trim()) {
        toast.error("NEFT UTR number is required.");
        return false;
      }
      if (form.mode === "UPI" && !form.upiTransactionId.trim()) {
        toast.error("UPI Transaction ID is required.");
        return false;
      }
      if (form.mode === "RTGS" && !form.rtgsReference.trim()) {
        toast.error("RTGS reference is required.");
        return false;
      }
      if (form.mode === "IMPS" && !form.impsReference.trim()) {
        toast.error("IMPS reference is required.");
        return false;
      }
      if (form.mode === "Card" && !form.cardReference.trim()) {
        toast.error("Card transaction/approval ID is required.");
        return false;
      }
    }

    return true;
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;

    const payload = {
      // BaseTransactionSchema fields
      companyId: form.company || null,
      projectId: form.projectSite || form.project || null,
      docDate: form.date || "",
      docTypeId: form.docType || null,
      remarks: form.paymentName || null,
      // PaymentPayloadSchema fields
      supplierId: form.expenseRef || null,
      bankId: form.bankId ?? null,
      amount: form.amount ?? 0,
      // Extended payment fields (passed through for backend processing)
      bankName: form.bankName || null,
      parentDocNo: form.parentDocNo || null,
      rootExBDocNo: form.rootExBDocNo || null,
      mode: form.mode || null,
      // Cheque
      chequeNo: form.chequeNo || null,
      chequeLotId: form.chequeLotId ?? null,
      chequeLotNumber: form.chequeLotNumber || null,
      chequeDate: form.chequeDate || null,
      chequeAccountNumber: form.chequeAccountNumber || null,
      chequeIfsc: form.chequeIfsc || null,
      isPostDated: form.isPostDated,
      // Digital
      neftNumber: form.neftNumber || null,
      upiTransactionId: form.upiTransactionId || null,
      rtgsReference: form.rtgsReference || null,
      impsReference: form.impsReference || null,
      cardReference: form.cardReference || null,
      cardId: form.cardId ?? null,
      // Re-issue fields
      ...(reissueCtx ? {
        ReplacesPaymentId: reissueCtx.replacesPaymentId,
        BounceCharge: bounceCharge ? parseFloat(bounceCharge) : null,
        // Total = original amount + bounce charge
        amount: (form.amount ?? 0) + (bounceCharge ? parseFloat(bounceCharge) : 0),
      } : {}),
    } as any;

    try {
      setSaving(true);
      if (editingId) {
        await updatePayment(editingId, payload);
        toast.success("Payment updated.");
      } else {
        await addPayment(payload);
        toast.success(reissueCtx ? "Re-issue payment saved. Linked to original." : "Payment saved.");
      }
      queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["expense-options-payment"] });
      cancelForm();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      await deletePayment(id);
      toast.success("Payment deleted.");
      queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["expense-options-payment"] });
      setDeleteId(null);
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  // ── Pay Remaining ──────────────────────────────────────────────────────────
  // Opens a blank new-payment form pre-filled with the same invoice. Works even
  // when the invoice is marked 'Paid' in EBillStatus (uses includeRef bypass).
  const handlePayRemaining = async (rec: PaymentRecord, knownRemaining?: number) => {
    if (!rec.expenseRef) return;
    openNew();
    let opt = expenseOptions.find(
      (o) => o.docNo === rec.expenseRef || String(o.id) === rec.expenseId,
    );
    if (!opt) {
      opt = await fetchExpenseOptionByRef(rec.expenseRef).catch(() => null) ?? undefined;
    }
    if (opt) {
      // knownRemaining comes from viewingChain (live-computed from payment-summary).
      // Fall back to opt fields if not provided.
      const remaining = knownRemaining != null
        ? knownRemaining
        : opt.remainingAmount != null
          ? opt.remainingAmount
          : Math.max(0, (opt.amount ?? 0) - (opt.totalPaid ?? 0));
      await handleExpenseSelect(String(opt.id), remaining > 0 ? remaining : undefined);
    }
  };

  const isChequeMode =
    form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(
    form.mode,
  );
  const isCashMode = form.mode === "Cash";

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Payments"]} />
      <FinanceShell
        title="Payment Management"
        subtitle="Record and track payments linked to expense bookings"
        icon={Wallet}
        action={
          view === "list" ? (
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {rights.canCreate && (
                <Button
                  onClick={openNew}
                  className="shrink-0 gradient-accent text-white shadow-sm font-heading font-semibold px-3 sm:px-4 py-1.5 text-xs h-auto"
                >
                  <Plus size={13} className="sm:mr-1" />
                  <span className="hidden sm:inline">New Payment</span>
                </Button>
              )}
              <ExportMenu
                data={records as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Payment Management"
                filename="payments"
                subtitle={
                  companyFilter
                    ? `Company: ${companyOptions.find((c) => String(c.id) === companyFilter)?.label || companyFilter}`
                    : undefined
                }
                companyName={
                  selectedCompanyDetail?.name ||
                  selectedCompanyDetail?.short_name ||
                  undefined
                }
                logoBase64={selectedCompanyDetail?.logo || undefined}
                disabled={
                  !rights.canExport || isLoading || records.length === 0
                }
              />
              <button
                onClick={() => refetchPayments()}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors"
                style={{ color: "#818cf8" }}
              >
                <RefreshCw size={13} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          ) : undefined
        }
      >
        {/* ── Summary stats ── */}
        {view === "list" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              {
                label: "Total Paid",
                value: formatINR(totalAmount),
                icon: Banknote,
                ring: "ring-primary/20",
                bg: "bg-primary/10",
                blob: "bg-primary",
                borderL: "border-l-primary",
                color: "text-primary",
              },
              {
                label: "By Cheque",
                value: String(chequeCount),
                icon: Clock,
                ring: "ring-amber-500/20",
                bg: "bg-amber-500/10",
                blob: "bg-amber-500",
                borderL: "border-l-amber-500",
                color: "text-amber-500",
              },
              {
                label: "By Cash",
                value: String(cashCount),
                icon: CheckCircle2,
                ring: "ring-emerald-500/20",
                bg: "bg-emerald-500/10",
                blob: "bg-emerald-500",
                borderL: "border-l-emerald-500",
                color: "text-emerald-500",
              },
            ].map(
              ({
                label,
                value,
                icon: Icon,
                ring,
                bg,
                blob,
                borderL,
                color,
              }) => (
                <div
                  key={label}
                  className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL}`}
                >
                  <div
                    className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${blob}`}
                  />
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold font-heading text-foreground leading-none">
                      {value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                      {label}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* FORM VIEW                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {view === "form" && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: isDark
                ? "rgba(12,14,22,0.55)"
                : "rgba(255,255,255,0.80)",
              border: isDark
                ? "1px solid rgba(99,102,241,0.20)"
                : "1px solid rgba(99,102,241,0.18)",
              backdropFilter: "blur(20px) saturate(160%)",
              WebkitBackdropFilter: "blur(20px) saturate(160%)",
              boxShadow: isDark
                ? "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)"
                : "0 8px 40px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
          >
            {/* Form header */}
            <div
              className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 relative overflow-hidden"
              style={{
                background: isDark
                  ? "rgba(99,102,241,0.10)"
                  : "rgba(99,102,241,0.06)",
                borderBottom: isDark
                  ? "1px solid rgba(99,102,241,0.18)"
                  : "1px solid rgba(99,102,241,0.14)",
              }}
            >
              {/* Left accent stripe */}
              <div
                className="absolute left-0 top-0 bottom-0 w-0.5"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent 10%, #6366f1 30%, #6366f1 70%, transparent 90%)",
                }}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={cancelForm}
                  className="flex items-center gap-1.5 text-sm transition-colors hover:opacity-70"
                  style={{ color: isDark ? "#94a3b8" : "#6366f1" }}
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <span
                  style={{
                    color: isDark
                      ? "rgba(99,102,241,0.4)"
                      : "rgba(99,102,241,0.3)",
                  }}
                >
                  |
                </span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center"
                    style={{
                      background: "rgba(99,102,241,0.18)",
                      border: "1px solid rgba(99,102,241,0.30)",
                    }}
                  >
                    <Receipt size={12} style={{ color: "#818cf8" }} />
                  </div>
                  <h2
                    className="text-sm font-heading font-bold"
                    style={{ color: isDark ? "#e0e7ff" : "#3730a3" }}
                  >
                    {editingId ? "Edit Payment" : "New Payment"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-6 space-y-7">
              {/* ── 1. Link Expense Booking ── */}
              <div className="space-y-3">
                <SectionHeader icon={Link2} label="Expense Booking" />

                {/* Filter bar + picker — only shown before a booking is linked */}
                {!form.expenseRef &&
                  (() => {
                    const filteredOptions = expenseOptions.filter((o) => {
                      if (
                        bookingFilters.company &&
                        (o.companyName ?? "") !== bookingFilters.company
                      )
                        return false;
                      if (
                        bookingFilters.project &&
                        (o.projectName ?? "") !== bookingFilters.project
                      )
                        return false;
                      if (
                        bookingFilters.year &&
                        (o.financialYear ?? "") !== bookingFilters.year
                      )
                        return false;
                      if (
                        bookingFilters.supplier &&
                        (o.supplierName ?? "") !== bookingFilters.supplier
                      )
                        return false;
                      return true;
                    });

                    return (
                      <div className="space-y-3">
                        <FilterBar
                          companyOptions={companyOptions}
                          projectOptions={projectOptions}
                          supplierOptions={supplierOptions}
                          finYearOptions={finYearOptions}
                          filters={bookingFilters}
                          selectedCompanyId={
                            bookingFilters.company
                              ? (companyOptions.find(
                                  (c) => c.label === bookingFilters.company,
                                )?.id ?? null)
                              : null
                          }
                          onChange={(key, val) => {
                            setBookingFilters((prev) => {
                              const next = { ...prev, [key]: val };
                              // When company changes, clear project if it no longer belongs to the new company
                              if (key === "company") {
                                const newCompanyId = val
                                  ? (companyOptions.find((c) => c.label === val)
                                      ?.id ?? null)
                                  : null;
                                if (prev.project) {
                                  const projStillValid = newCompanyId
                                    ? projectOptions.some(
                                        (p) =>
                                          p.label === prev.project &&
                                          (p.belongs_to === newCompanyId ||
                                            p.company_id === newCompanyId),
                                      )
                                    : true;
                                  if (!projStillValid) next.project = "";
                                }
                              }
                              return next;
                            });
                          }}
                        />
                        <ExpenseBookingPicker
                          options={filteredOptions}
                          value={form.expenseId}
                          onChange={handleExpenseSelect}
                          loading={loadingExpense}
                        />
                        <div className="flex items-center gap-2 pt-1">
                          {filteredOptions.length === 0 && !loadingExpense && (
                            <p className="text-[11px] text-muted-foreground">Invoice not visible?</p>
                          )}
                          <button
                            type="button"
                            className="text-[11px] text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                            onClick={async () => {
                              try {
                                const r = await fetchWithAuth("/api/new-payment/recalculate-balances", { method: "POST" });
                                const d = await r.json().catch(() => ({}));
                                toast.success(`Balances synced (${d.updated ?? 0} invoices updated). Refreshing…`);
                                window.location.reload();
                              } catch {
                                toast.error("Sync failed — please try again.");
                              }
                            }}
                          >
                            Sync invoice balances
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                {!form.expenseRef && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
                    <Field label="Company">
                      <div className="relative">
                        <Building2
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <select
                          value={(() => {
                            const asNum = parseInt(form.company, 10);
                            if (
                              !isNaN(asNum) &&
                              String(asNum) === form.company.trim()
                            )
                              return String(asNum);
                            const matched = companyOptions.find(
                              (c) => c.label === form.company,
                            );
                            return matched ? String(matched.id) : "";
                          })()}
                          onChange={(e) => {
                            const id = e.target.value;
                            const label =
                              companyOptions.find((c) => String(c.id) === id)
                                ?.label || "";
                            set("company", label);
                            set("project", "");
                            set("projectSite", "");
                          }}
                          className="w-full appearance-none pl-8 pr-7 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select company…</option>
                          {companyOptions.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={11}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </Field>
                    <Field label="Project / Site">
                      <div className="relative">
                        <FolderKanban
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <select
                          value={(() => {
                            const matched = projectOptions.find(
                              (p) =>
                                p.label === form.project ||
                                p.label === form.projectSite,
                            );
                            return matched ? String(matched.id) : "";
                          })()}
                          onChange={(e) => {
                            const id = e.target.value;
                            const label =
                              projectOptions.find((p) => String(p.id) === id)
                                ?.label || "";
                            set("project", label);
                            set("projectSite", label);
                          }}
                          className="w-full appearance-none pl-8 pr-7 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select project…</option>
                          {(() => {
                            const asNum = parseInt(form.company, 10);
                            const companyId =
                              !isNaN(asNum) &&
                              String(asNum) === form.company.trim()
                                ? asNum
                                : (companyOptions.find(
                                    (c) => c.label === form.company,
                                  )?.id ?? null);
                            return (
                              companyId
                                ? projectOptions.filter(
                                    (p) => p.company_id === companyId,
                                  )
                                : projectOptions
                            ).map((p) => (
                              <option key={p.id} value={String(p.id)}>
                                {p.label}
                              </option>
                            ));
                          })()}
                        </select>
                        <ChevronDown
                          size={11}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {form.expenseRef && (
                  <AutoFillBanner
                    docNo={form.expenseRef}
                    onClear={clearExpenseLink}
                  />
                )}

                {form.expenseRef && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-1">
                    <Field label="Company">
                      <div className="flex items-center gap-2">
                        <Building2
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={(() => {
                            // form.company may be a raw ID string if ECompanyName was blank
                            const asNum = parseInt(form.company, 10);
                            if (
                              !isNaN(asNum) &&
                              String(asNum) === form.company.trim()
                            ) {
                              return (
                                companyOptions.find((c) => c.id === asNum)
                                  ?.label || form.company
                              );
                            }
                            return form.company;
                          })()}
                          placeholder="From expense booking"
                        />
                      </div>
                    </Field>
                    <Field label="Project / Site">
                      <div className="flex items-center gap-2">
                        <FolderKanban
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.projectSite}
                          placeholder="From linked GRN"
                        />
                      </div>
                    </Field>
                    <Field label="Supplier / Party">
                      <div className="flex items-center gap-2">
                        <FolderKanban
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={
                            expenseOptions.find((o) => o.id === form.expenseId)
                              ?.supplierName || form.paidTo || ""
                          }
                          placeholder="From expense booking"
                        />
                      </div>
                    </Field>
                    <Field label="Doc Type">
                      <div className="flex items-center gap-2">
                        <FileText
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.docType}
                          placeholder="From expense booking"
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {form.expenseRef && linkedGRNs.length > 0 && (
                  <div className="mt-3">
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-heading font-semibold text-teal-600 dark:text-teal-400">
                        <Truck size={12} /> Linked GRNs ({linkedGRNs.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {linkedGRNs.map((g) => (
                          <div
                            key={g.GRNID}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-teal-500/30 bg-background text-xs"
                          >
                            <Truck
                              size={11}
                              className="text-teal-500 shrink-0"
                            />
                            <span className="font-mono font-semibold text-teal-600 dark:text-teal-400">
                              {g.GRNNo}
                            </span>
                            {g.PONumber && (
                              <span className="text-muted-foreground hidden sm:inline">
                                · PO: {g.PONumber}
                              </span>
                            )}
                            {g.GRNDate && (
                              <span className="text-muted-foreground">
                                {g.GRNDate.slice(0, 10)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Outstanding Balance Card ── */}
              {form.expenseRef && (() => {
                const opt = expenseOptions.find((o) => o.id === form.expenseId || o.docNo === form.expenseRef);
                if (!opt || opt.type === "emi") return null;
                // Prefer the GRN item-level total (incl. GST) when breakdown has loaded;
                // grn.TotalAmount stored in the DB is often the pre-tax base only.
                const grnTotal = grnGstBreakdown?.totals?.totalInclGST ?? 0;
                const netAmt = grnTotal > 0 ? grnTotal : (opt.amount ?? 0);
                const paid = opt.totalPaid ?? 0;
                const remaining = opt.remainingAmount != null
                  ? (grnTotal > 0 ? Math.max(0, netAmt - paid) : opt.remainingAmount)
                  : Math.max(0, netAmt - paid);
                const bStatus = opt.billStatus ?? (paid >= netAmt && netAmt > 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Payment Due");
                return (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-primary flex items-center gap-1.5">
                        <Wallet size={9} /> Invoice Balance
                      </p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        bStatus === "Paid"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                          : bStatus === "Partially Paid"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                      }`}>
                        {bStatus}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Invoice Total</p>
                        <p className="font-mono text-xs font-bold text-foreground">{formatINR(netAmt)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Paid</p>
                        <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatINR(paid)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Outstanding</p>
                        <p className={`font-mono text-xs font-bold ${remaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {formatINR(remaining)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── 2. Payment Details ── */}
              <div className="space-y-3">
                <SectionHeader icon={Receipt} label="Payment Details" />
                {editingId && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Doc No">
                      <ReadOnlyField value={form.docNo} placeholder="—" />
                    </Field>
                    <Field label="Root ExB Doc No">
                      <ReadOnlyField
                        value={form.rootExBDocNo}
                        placeholder="Standalone payment"
                      />
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Payment Purpose" required>
                    <input
                      type="text"
                      value={form.paymentName}
                      onChange={(e) => set("paymentName", e.target.value)}
                      placeholder="e.g. Advance payment for cement"
                      className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60"
                    />
                  </Field>
                  <Field label="Payment Date" required>
                    <div className="relative">
                      <CalendarDays
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => set("date", e.target.value)}
                        className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                      />
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Amount (₹)"
                    required={isCashMode}
                    hint={
                      grnGstBreakdown
                        ? "Auto-filled from GRN item totals (incl. GST) — editable if needed."
                        : form.expenseRef
                          ? "Net amount from expense booking — editable if needed."
                          : undefined
                    }
                  >
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold pointer-events-none">
                        ₹
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.amount ?? ""}
                        onChange={(e) =>
                          set("amount", parseFloat(e.target.value) || null)
                        }
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-2 rounded-lg text-sm font-mono bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60"
                      />
                    </div>
                  </Field>
                  {(form.amount ?? 0) > 0 &&
                    (() => {
                      // Only render a breakdown when we have reliable GST data:
                      // either a GRN item-level breakdown OR explicit GST rates on the booking.
                      const hasGrnBreakdown = !!(
                        grnGstBreakdown &&
                        grnGstBreakdown.totals.totalInclGST > 0
                      );
                      const hasExplicitGst =
                        (form.cgstRate ?? 0) > 0 ||
                        (form.sgstRate ?? 0) > 0 ||
                        (form.igstRate ?? 0) > 0;
                      const hasBaseAmount = !!(
                        form.baseAmount && form.baseAmount > 0
                      );

                      // Don't render if we can't compute a meaningful breakdown
                      if (!hasGrnBreakdown && !hasExplicitGst && !hasBaseAmount)
                        return null;

                      const base = hasBaseAmount
                        ? form.baseAmount!
                        : (form.amount ?? 0);
                      const cgstRate = form.cgstRate ?? 0;
                      const sgstRate = form.sgstRate ?? 0;
                      const igstRate = form.igstRate ?? 0;

                      // Parse billing terms — must be an array of term objects.
                      // EDiscountData is a legacy flat discount object {applicable,type,value}
                      // and must NOT be treated as billing terms; skip it if not an array.
                      let billingTerms: {
                        masterTermName?: string;
                        type: string;
                        value: number;
                        appliedOn: string;
                        deductionType?: string;
                        applicable?: boolean;
                      }[] = [];
                      try {
                        if (form.billingTermsData) {
                          const parsed = JSON.parse(form.billingTermsData);
                          // Only treat as billing terms if it's a proper array
                          // with items that have an `appliedOn` field (billing term shape).
                          if (
                            Array.isArray(parsed) &&
                            parsed.length > 0 &&
                            parsed[0].appliedOn !== undefined
                          ) {
                            billingTerms = parsed.filter(
                              (t: any) => t.applicable !== false,
                            );
                          }
                        }
                      } catch {
                        /* ignore */
                      }

                      const preGst = billingTerms.filter(
                        (t) => t.appliedOn !== "post-gst",
                      );
                      const postGst = billingTerms.filter(
                        (t) => t.appliedOn === "post-gst",
                      );

                      // Apply pre-GST terms sequentially to taxable base, then
                      // recompute GST on adjusted base. Post-GST terms apply on gross.
                      let taxable = base;
                      const preGstRows: {
                        term: (typeof preGst)[0];
                        amt: number;
                      }[] = [];
                      for (const t of preGst) {
                        const amt =
                          t.type === "percentage"
                            ? (taxable * t.value) / 100
                            : t.value;
                        preGstRows.push({ term: t, amt });
                        if (t.deductionType === "Addition") taxable += amt;
                        else taxable = Math.max(0, taxable - amt);
                      }

                      // Derive effective GST rates from GRN breakdown to recompute
                      // GST correctly on the adjusted taxable base.
                      const effectiveCGSTRate =
                        grnGstBreakdown && grnGstBreakdown.totals.totalBase > 0
                          ? (grnGstBreakdown.totals.totalCGST /
                              grnGstBreakdown.totals.totalBase) *
                            100
                          : cgstRate;
                      const effectiveSGSTRate =
                        grnGstBreakdown && grnGstBreakdown.totals.totalBase > 0
                          ? (grnGstBreakdown.totals.totalSGST /
                              grnGstBreakdown.totals.totalBase) *
                            100
                          : sgstRate;

                      // When pre-GST terms exist, recompute GST on adjusted base.
                      // Otherwise use exact per-item sums from GRN breakdown.
                      const hasPreTerms = preGstRows.length > 0;
                      const cgst = hasPreTerms
                        ? (taxable * effectiveCGSTRate) / 100
                        : grnGstBreakdown
                          ? grnGstBreakdown.totals.totalCGST
                          : (taxable * cgstRate) / 100;
                      const sgst = hasPreTerms
                        ? (taxable * effectiveSGSTRate) / 100
                        : grnGstBreakdown
                          ? grnGstBreakdown.totals.totalSGST
                          : (taxable * sgstRate) / 100;
                      const igst = hasPreTerms
                        ? 0
                        : grnGstBreakdown
                          ? 0
                          : (taxable * igstRate) / 100;
                      let gross = hasPreTerms
                        ? taxable + cgst + sgst + igst
                        : grnGstBreakdown
                          ? grnGstBreakdown.totals.totalInclGST
                          : taxable + cgst + sgst + igst;

                      // Apply post-GST terms sequentially on gross
                      const postGstRows: {
                        term: (typeof postGst)[0];
                        amt: number;
                      }[] = [];
                      for (const t of postGst) {
                        const amt =
                          t.type === "percentage"
                            ? (gross * t.value) / 100
                            : t.value;
                        postGstRows.push({ term: t, amt });
                        if (t.deductionType === "Addition") gross += amt;
                        else gross = Math.max(0, gross - amt);
                      }

                      // Net Payable = gross after all term adjustments, rounded to nearest rupee
                      const net = Math.round(gross);
                      const roundOff = net - gross;

                      const hasGst = cgst + sgst + igst > 0;
                      const hasTerms =
                        preGstRows.length > 0 || postGstRows.length > 0;

                      const Row = ({
                        label,
                        sub,
                        value,
                        color,
                        bold,
                        large,
                      }: {
                        label: string;
                        sub?: string;
                        value: string;
                        color?: string;
                        bold?: boolean;
                        large?: boolean;
                      }) => (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span
                              className={`text-xs ${bold ? "font-heading font-semibold text-foreground" : "text-muted-foreground"}`}
                            >
                              {label}
                            </span>
                            {sub && (
                              <p className="text-[10px] text-muted-foreground/60">
                                {sub}
                              </p>
                            )}
                          </div>
                          <span
                            className={`font-mono shrink-0 ${large ? "text-base font-bold text-primary" : bold ? "text-sm font-semibold text-foreground" : `text-xs ${color ?? "text-muted-foreground"}`}`}
                          >
                            {value}
                          </span>
                        </div>
                      );

                      return (
                        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <TrendingUp
                              size={13}
                              className="text-primary shrink-0"
                            />
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                              Payment Breakdown
                            </p>
                          </div>

                          {/* ── GST Summary Cards (cumulative) ── */}
                          {grnGstBreakdown &&
                            grnGstBreakdown.totals.totalInclGST > 0 && (
                              <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                                  {[
                                    {
                                      label: "Base Amount",
                                      value: grnGstBreakdown.totals.totalBase,
                                      cls: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
                                    },
                                    {
                                      label: "CGST",
                                      value: grnGstBreakdown.totals.totalCGST,
                                      cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                                    },
                                    {
                                      label: "SGST",
                                      value: grnGstBreakdown.totals.totalSGST,
                                      cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                                    },
                                    {
                                      label: "Total GST",
                                      value: grnGstBreakdown.totals.totalGST,
                                      cls: "border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300",
                                    },
                                  ].map(({ label, value, cls }) => (
                                    <div
                                      key={label}
                                      className={`rounded-lg border px-3 py-2 ${cls}`}
                                    >
                                      <div className="text-[10px] font-heading uppercase tracking-wider opacity-70">
                                        {label}
                                      </div>
                                      <div className="text-sm font-mono font-bold mt-1">
                                        {formatINR(value)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="px-4 py-2.5 bg-muted/10 border border-blue-500/10 rounded-lg flex flex-wrap items-center gap-1.5 text-[11px] font-mono mb-2">
                                  <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalBase,
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    (base)
                                  </span>
                                  <span className="text-muted-foreground">
                                    +
                                  </span>
                                  <span className="text-violet-600 dark:text-violet-400 font-semibold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalCGST,
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    (CGST)
                                  </span>
                                  <span className="text-muted-foreground">
                                    +
                                  </span>
                                  <span className="text-violet-600 dark:text-violet-400 font-semibold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalSGST,
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    (SGST)
                                  </span>
                                  <span className="text-muted-foreground">
                                    =
                                  </span>
                                  <span className="text-foreground font-bold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalInclGST,
                                    )}
                                  </span>
                                </div>
                              </>
                            )}

                          <div className="space-y-1.5">
                            {/* Base — for GRN breakdown always show totalBase (pre-tax),
                                not form.baseAmount which may still hold the incl-GST figure
                                if the setForm override hasn't landed yet */}
                            <Row
                              label="Basic Amount"
                              sub={grnGstBreakdown ? "Excl. GST" : undefined}
                              value={formatINR(
                                grnGstBreakdown
                                  ? grnGstBreakdown.totals.totalBase
                                  : base,
                              )}
                            />

                            {/* Pre-GST billing terms */}
                            {preGstRows.map(({ term, amt }, i) => {
                              const isAdd = term.deductionType === "Addition";
                              return (
                                <Row
                                  key={i}
                                  label={term.masterTermName ?? `Term ${i + 1}`}
                                  sub={`${isAdd ? "Addition" : "Deduction"} · Before GST${term.type === "percentage" ? ` · ${term.value}%` : ""}`}
                                  value={(isAdd ? "+ " : "− ") + formatINR(amt)}
                                  color={
                                    isAdd
                                      ? "text-green-500"
                                      : "text-destructive"
                                  }
                                />
                              );
                            })}

                            {/* Taxable subtotal — only show if pre-GST terms changed it */}
                            {preGstRows.length > 0 && (
                              <>
                                <div className="border-t border-border/40 pt-1" />
                                <Row
                                  label="Taxable Amount"
                                  sub="After pre-GST adjustments"
                                  value={formatINR(taxable)}
                                  bold
                                />
                              </>
                            )}

                            {/* GST */}
                            {hasGst && (
                              <>
                                {preGstRows.length === 0 && (
                                  <div className="border-t border-border/40 pt-1" />
                                )}
                                {grnGstBreakdown ? (
                                  /* Cumulative GST totals */
                                  <>
                                    {grnGstBreakdown.totals.totalCGST > 0 && (
                                      <Row
                                        label="CGST"
                                        value={formatINR(
                                          grnGstBreakdown.totals.totalCGST,
                                        )}
                                        color="text-primary"
                                      />
                                    )}
                                    {grnGstBreakdown.totals.totalSGST > 0 && (
                                      <Row
                                        label="SGST"
                                        value={formatINR(
                                          grnGstBreakdown.totals.totalSGST,
                                        )}
                                        color="text-primary"
                                      />
                                    )}
                                  </>
                                ) : (
                                  /* Non-GRN: single averaged rate is the actual rate */
                                  <>
                                    {cgst > 0 && (
                                      <Row
                                        label={`CGST @ ${cgstRate}%`}
                                        value={formatINR(cgst)}
                                        color="text-primary"
                                      />
                                    )}
                                    {sgst > 0 && (
                                      <Row
                                        label={`SGST @ ${sgstRate}%`}
                                        value={formatINR(sgst)}
                                        color="text-primary"
                                      />
                                    )}
                                    {igst > 0 && (
                                      <Row
                                        label={`IGST @ ${igstRate}%`}
                                        value={formatINR(igst)}
                                        color="text-primary"
                                      />
                                    )}
                                  </>
                                )}
                              </>
                            )}

                            {/* Gross before post-GST — use the pre-computed `gross`
                                variable which equals totalInclGST when a GRN breakdown
                                is available, avoiding the double-count from
                                (inclGST base) + cgst + sgst */}
                            {(hasGst || hasTerms) && (
                              <>
                                <div className="border-t border-border/40 pt-1" />
                                <Row
                                  label="Gross Amount"
                                  sub={
                                    hasGst
                                      ? "Taxable + GST"
                                      : "Before post-GST adjustments"
                                  }
                                  value={formatINR(gross)}
                                  bold
                                />
                              </>
                            )}

                            {/* Post-GST billing terms */}
                            {postGstRows.map(({ term, amt }, i) => {
                              const isAdd = term.deductionType === "Addition";
                              return (
                                <Row
                                  key={i}
                                  label={term.masterTermName ?? `Term ${i + 1}`}
                                  sub={`${isAdd ? "Addition" : "Deduction"} · After GST${term.type === "percentage" ? ` · ${term.value}%` : ""}`}
                                  value={(isAdd ? "+ " : "− ") + formatINR(amt)}
                                  color={
                                    isAdd
                                      ? "text-green-500"
                                      : "text-destructive"
                                  }
                                />
                              );
                            })}

                            {/* Round off */}
                            {Math.abs(roundOff) >= 0.01 && (
                              <Row
                                label="Round Off"
                                value={
                                  (roundOff >= 0 ? "+ " : "− ") +
                                  formatINR(Math.abs(roundOff))
                                }
                              />
                            )}

                            {/* Net payable */}
                            <div className="border-t border-border/60 pt-1.5" />
                            <Row
                              label="Net Payable"
                              value={formatINR(net)}
                              bold
                              large
                            />

                            {/* ── Real-time partial/over-payment indicator ── */}
                            {(() => {
                              const entered = Number(form.amount ?? 0);
                              if (entered <= 0 || Math.abs(entered - net) < 0.01) return null;

                              const opt = expenseOptions.find(
                                (o) => o.id === form.expenseId || o.docNo === form.expenseRef,
                              );
                              // formKnownTotalPaid is set by "Pay Remaining" from live chain data,
                              // overriding stale ETotalPaid stored in DB (opt.totalPaid)
                              const prevPaid = formKnownTotalPaid ?? opt?.totalPaid ?? 0;
                              // Use the GRN breakdown total (incl. GST) when available —
                              // opt.amount is often the pre-tax base stored in the DB.
                              const invoiceTotal =
                                (grnGstBreakdown?.totals?.totalInclGST ?? 0) > 0
                                  ? grnGstBreakdown!.totals.totalInclGST
                                  : (opt?.amount ?? net);
                              const prevOutstanding = Math.max(0, invoiceTotal - prevPaid);
                              const afterThisPayment = Math.max(0, prevOutstanding - entered);
                              const isPartial = entered < prevOutstanding;
                              const isOver = entered > prevOutstanding;

                              return (
                                <div className={`mt-3 rounded-xl border px-4 py-4 space-y-2 ${
                                  isOver
                                    ? "border-amber-500/40 bg-amber-500/5"
                                    : "border-blue-500/40 bg-blue-500/5"
                                }`}>
                                  <p className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-3 ${
                                    isOver ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"
                                  }`}>
                                    {isOver ? <AlertTriangle size={11} /> : <TrendingUp size={11} />}
                                    {isOver ? "Overpayment" : "Partial Payment"}
                                  </p>
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center text-sm">
                                      <span className="text-muted-foreground">You're paying</span>
                                      <span className="font-mono font-bold text-foreground text-base">{formatINR(entered)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                      <span className="text-muted-foreground">Outstanding balance</span>
                                      <span className="font-mono text-muted-foreground">{formatINR(prevOutstanding)}</span>
                                    </div>
                                    <div className={`flex justify-between items-center text-sm font-bold border-t border-border/40 pt-2 ${
                                      isPartial ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                                    }`}>
                                      <span>{isPartial ? "Shortfall" : "Excess"}</span>
                                      <span className="font-mono text-base">{isPartial ? "− " : "+ "}{formatINR(Math.abs(entered - prevOutstanding))}</span>
                                    </div>
                                    {opt && prevOutstanding > 0 && (
                                      <div className={`flex justify-between items-center text-sm font-bold pt-0.5 ${
                                        afterThisPayment > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                                      }`}>
                                        <span>Remaining after payment</span>
                                        <span className="font-mono text-base">{formatINR(afterThisPayment)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}
                </div>
              </div>

              {/* ── Payment Chain (form view) ── */}
              {form.expenseRef && (formChainData?.payments?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-background/60">
                    <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <History size={9} /> Payment Chain
                    </p>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {formChainData!.payments.length} attempt{formChainData!.payments.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {loadingFormChain ? (
                      <p className="text-[11px] text-muted-foreground text-center py-2">Loading…</p>
                    ) : (
                      formChainData!.payments.map((p: PaymentChainItem, idx: number) => {
                        const ds = p.DisplayStatus;
                        const borderCls =
                          ds === "Success" || ds === "Cheque Cleared"
                            ? "border-emerald-500"
                            : ds === "Cheque Bounced"
                            ? "border-red-500"
                            : ds === "Reissued"
                            ? "border-violet-500"
                            : ds === "Cheque Issued"
                            ? "border-blue-500"
                            : ds === "Pending"
                            ? "border-amber-500"
                            : "border-border";
                        const badgeCls =
                          ds === "Success" || ds === "Cheque Cleared"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                            : ds === "Cheque Bounced"
                            ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
                            : ds === "Reissued"
                            ? "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                            : ds === "Cheque Issued"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                            : ds === "Pending"
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                            : "bg-muted text-muted-foreground border-border";
                        return (
                          <div key={p.PPaymentID} className={`flex gap-2.5 pl-3 border-l-2 ${borderCls}`}>
                            <div className="min-w-0 flex-1 py-0.5 space-y-0.5">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[11px] font-semibold text-foreground">
                                    {p.DocNo ?? `#${p.PPaymentID}`}
                                  </span>
                                  {idx === formChainData!.payments.length - 1 && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-semibold">LATEST</span>
                                  )}
                                </div>
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${badgeCls}`}>{ds}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                                <span>{p.PDate ? new Date(p.PDate).toLocaleDateString("en-IN") : "—"}</span>
                                <span>·</span>
                                <span className="font-mono font-semibold text-foreground">{formatINR(p.PAmount ?? 0)}</span>
                                <span>·</span>
                                <span>{p.PMode ?? "—"}</span>
                                {p.PChequeNo && <><span>·</span><span>Chq {p.PChequeNo}</span></>}
                              </div>
                              {p.BounceReason && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 italic">
                                  Bounced: {p.BounceReason}
                                  {p.BounceDate && <> on {new Date(p.BounceDate).toLocaleDateString("en-IN")}</>}
                                </p>
                              )}
                              {p.ReplacementDocNo && (
                                <p className="text-[10px] text-violet-600 dark:text-violet-400">
                                  Reissued as {p.ReplacementDocNo}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ── Re-issue banner ── */}
              {reissueCtx && (
                <div className="flex items-start gap-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/30 px-4 py-3">
                  <RefreshCw size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Re-issuing bounced payment
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Replaces <span className="font-mono font-medium">{reissueCtx.replacesDocNo}</span>
                      {reissueCtx.bounceReason && <> · <span className="italic">{reissueCtx.bounceReason}</span></>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Original amount: <span className="font-mono font-semibold">{formatINR(reissueCtx.amount)}</span>
                      {bounceCharge && parseFloat(bounceCharge) > 0 && (
                        <> + bounce charge: <span className="font-mono font-semibold text-red-500">{formatINR(parseFloat(bounceCharge))}</span>
                        {" "}= <span className="font-mono font-semibold text-foreground">{formatINR(reissueCtx.amount + parseFloat(bounceCharge))}</span></>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setReissueCtx(null); setBounceCharge(""); }}
                    className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Cancel re-issue"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* ── Bounce Charge (re-issue only) ── */}
              {reissueCtx && (
                <div className="space-y-3">
                  <SectionHeader icon={AlertTriangle} label="Bounce Charge" />
                  <Field label="Bank Bounce Charge" hint="Optional — added on top of the original payment amount">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold pointer-events-none">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={bounceCharge}
                        onChange={(e) => setBounceCharge(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60 font-mono"
                      />
                    </div>
                  </Field>
                </div>
              )}

              {/* ── 3. Payment Mode ── */}
              <div className="space-y-3">
                <SectionHeader icon={Wallet} label="Payment Mode" />
                <Field label="Mode" required>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_MODES.filter((m) => !reissueCtx || m !== "Cash").map((m) => {
                      const s = MODE_STYLE[m] ?? {
                        ring: "ring-border bg-muted",
                        text: "text-muted-foreground",
                        dot: "bg-muted-foreground",
                      };
                      const active = form.mode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleModeChange(m)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold border transition-all ring-1 ${
                            active
                              ? `${s.ring} ${s.text} border-transparent shadow-sm`
                              : "bg-background border-border text-muted-foreground ring-transparent hover:border-primary/40"
                          }`}
                        >
                          {active && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${s.dot}`}
                            />
                          )}
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {form.mode && <ModeInfoBanner mode={form.mode} />}
              </div>

              {/* ── 4. Bank Account ── */}
              <div className="space-y-3">
                <SectionHeader icon={Landmark} label="Bank Account" />
                <Field
                  label="Bank"
                  required={isChequeMode || isDigitalMode}
                  hint={
                    !form.mode
                      ? "Select a payment mode first."
                      : isCashMode
                        ? "Not applicable for cash payments."
                        : isChequeMode
                          ? "Required — used to filter cheque lots."
                          : "Bank account from which the transfer was made."
                  }
                >
                  <div
                    className={`relative ${isCashMode || !form.mode ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    <Landmark
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <select
                      value={form.bankId ? String(form.bankId) : ""}
                      onChange={(e) => handleBankSelect(e.target.value)}
                      disabled={isCashMode || !form.mode}
                      className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
                    >
                      <option value="">— Select bank account —</option>
                      {banks.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {!isCashMode &&
                    !!form.mode &&
                    form.bankId &&
                    (() => {
                      const selected = banks.find((b) => b.id === form.bankId);
                      if (!selected) return null;
                      const details = [
                        selected.ifscCode && `IFSC: ${selected.ifscCode}`,
                        selected.branch && `Branch: ${selected.branch}`,
                        selected.accountType && `Type: ${selected.accountType}`,
                      ].filter(Boolean);
                      if (!details.length) return null;
                      return (
                        <p className="text-[11px] text-muted-foreground/70 mt-1 pl-1">
                          {details.join(" · ")}
                        </p>
                      );
                    })()}
                </Field>
              </div>

              {/* ── 5. Mode-specific section ── */}

              {/* Cash — nothing extra, amount above is sufficient */}
              {isCashMode && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-2.5">
                  <Banknote size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Cash payment — enter the amount above and save.
                  </p>
                </div>
              )}

              {/* Cheque / Post-Dated Cheque */}
              {isChequeMode && (
                <div className="space-y-3">
                  <SectionHeader
                    icon={BookOpen}
                    label={
                      form.mode === "Post-Dated Cheque"
                        ? "Post-Dated Cheque Details"
                        : "Cheque Details"
                    }
                    badge={
                      form.mode === "Post-Dated Cheque" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20">
                          <CalendarClock size={9} /> Scheduled
                        </span>
                      ) : null
                    }
                  />
                  <ChequePanel
                    bankId={form.bankId}
                    form={form}
                    set={set}
                    isPostDated={form.mode === "Post-Dated Cheque"}
                  />
                </div>
              )}

              {/* NEFT / UPI / RTGS / IMPS / Card */}
              {isDigitalMode && (
                <div className="space-y-3">
                  <SectionHeader icon={Hash} label={`${form.mode} Reference`} />
                  {form.mode === "Card" && (
                    <CardPanel bankId={form.bankId} form={form} set={set} />
                  )}
                  <DigitalRefPanel mode={form.mode} form={form} set={set} />
                </div>
              )}

              {/* ── Save footer ── */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-border">
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
                    onClick={handleReset}
                    disabled={!isDirty && !editingId}
                    className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw size={12} />
                    {editingId ? "Cancel" : "Reset"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !canSave}
                    className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                  >
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : editingId ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {saving
                      ? "Saving…"
                      : editingId
                        ? "Update Payment"
                        : "Save Payment"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* LIST VIEW                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {view === "list" && (
          <>
            {/* ── Filter Panel ── */}
            {(() => {
              const hasActiveFilters = !!(
                companyFilter ||
                projectFilter ||
                finYearFilter ||
                docNumberFilter ||
                docDateFilter ||
                supplierFilter
              );
              const clearAll = () => {
                setCompanyFilter("");
                setCompanyNameFilter("");
                setProjectFilter("");
                setFinYearFilter("");
                setDocNumberFilter("");
                setDocDateFilter("");
                setSupplierFilter("");
                setPage(1);
              };
              return (
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  {/* Header / toggle */}
                  <button
                    type="button"
                    onClick={() => setShowFilters((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-5 h-5 rounded bg-primary/10">
                        <Search size={11} className="text-primary" />
                      </div>
                      <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
                        Filters
                      </span>
                      {hasActiveFilters && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-primary text-primary-foreground">
                          {
                            [
                              companyFilter,
                              projectFilter,
                              finYearFilter,
                              docNumberFilter,
                              docDateFilter,
                              supplierFilter,
                            ].filter(Boolean).length
                          }{" "}
                          active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {hasActiveFilters && (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearAll();
                          }}
                          className="text-[11px] text-destructive/70 hover:text-destructive font-heading transition-colors cursor-pointer"
                        >
                          Clear all
                        </span>
                      )}
                      <ChevronDown
                        size={13}
                        className={`text-muted-foreground transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>

                  {/* Collapsible grid */}
                  {showFilters && (
                    <div className="border-t border-border px-4 py-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        {/* 1. Company */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Building2 size={10} /> Company
                          </label>
                          <div className="relative">
                            <select
                              value={companyFilter}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCompanyFilter(val);
                                const label = val
                                  ? (companyOptions.find(
                                      (c) => String(c.id) === val,
                                    )?.label ?? val)
                                  : "";
                                setCompanyNameFilter(label);
                                // Clear project filter if it doesn't belong to new company
                                if (projectFilter && val) {
                                  const stillValid = projectOptions.some(
                                    (p) =>
                                      p.label === projectFilter &&
                                      (p.belongs_to === Number(val) ||
                                        p.company_id === Number(val)),
                                  );
                                  if (!stillValid) setProjectFilter("");
                                }
                                setPage(1);
                              }}
                              className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">All Companies</option>
                              {companyOptions.map((c) => (
                                <option key={c.id} value={String(c.id)}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                        </div>

                        {/* 2. Project */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <FolderKanban size={10} /> Project
                          </label>
                          <div className="relative">
                            <select
                              value={projectFilter}
                              onChange={(e) => {
                                setProjectFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">All Projects</option>
                              {(companyFilter
                                ? projectOptions.filter(
                                    (p) =>
                                      p.belongs_to === Number(companyFilter) ||
                                      p.company_id === Number(companyFilter),
                                  )
                                : projectOptions
                              ).map((p) => (
                                <option key={p.id} value={p.label}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                        </div>

                        {/* 3. Fin Year */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <CalendarDays size={10} /> Fin Year
                          </label>
                          <div className="relative">
                            <select
                              value={finYearFilter}
                              onChange={(e) => {
                                setFinYearFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">All Fin Years</option>
                              {finYearOptions.map((y) => (
                                <option key={y.id} value={y.label}>
                                  {y.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                        </div>

                        {/* 4. Document Number */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Hash size={10} /> Document Number
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="e.g. PAY-2024-001"
                              value={docNumberFilter}
                              onChange={(e) => {
                                setDocNumberFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            {docNumberFilter && (
                              <button
                                onClick={() => {
                                  setDocNumberFilter("");
                                  setPage(1);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 5. Document Date */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <FileText size={10} /> Document Date
                          </label>
                          <div className="relative">
                            <input
                              type="date"
                              value={docDateFilter}
                              onChange={(e) => {
                                setDocDateFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                            />
                            {docDateFilter && (
                              <button
                                onClick={() => {
                                  setDocDateFilter("");
                                  setPage(1);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 6. Supplier / Contractor */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Truck size={10} /> Supplier / Contractor
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search name…"
                              value={supplierFilter}
                              onChange={(e) => {
                                setSupplierFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            {supplierFilter && (
                              <button
                                onClick={() => {
                                  setSupplierFilter("");
                                  setPage(1);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Active filter chips — always visible when filters set */}
                  {hasActiveFilters && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-3 border-t border-border/50 pt-2.5">
                      {companyFilter &&
                        (() => {
                          const co = companyOptions.find(
                            (c) => String(c.id) === companyFilter,
                          );
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-primary/10 text-primary border border-primary/20">
                              <Building2 size={9} />
                              {co?.label || companyFilter}
                              <button
                                onClick={() => {
                                  setCompanyFilter("");
                                  setCompanyNameFilter("");
                                  setPage(1);
                                }}
                                className="ml-0.5 hover:text-destructive"
                              >
                                <X size={9} />
                              </button>
                            </span>
                          );
                        })()}
                      {projectFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-violet-500/10 text-violet-600 border border-violet-500/20">
                          <FolderKanban size={9} />
                          {projectFilter}
                          <button
                            onClick={() => {
                              setProjectFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {finYearFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-amber-500/10 text-amber-600 border border-amber-500/20">
                          <CalendarDays size={9} />
                          FY {finYearFilter}
                          <button
                            onClick={() => {
                              setFinYearFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {docNumberFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                          <Hash size={9} />
                          {docNumberFilter}
                          <button
                            onClick={() => {
                              setDocNumberFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {docDateFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-cyan-500/10 text-cyan-600 border border-cyan-500/20">
                          <FileText size={9} />
                          Date: {docDateFilter}
                          <button
                            onClick={() => {
                              setDocDateFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {supplierFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-teal-500/10 text-teal-600 border border-teal-500/20">
                          <Truck size={9} />
                          {supplierFilter}
                          <button
                            onClick={() => {
                              setSupplierFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {isLoading && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading payments…
              </div>
            )}

            {isError && (
              <div className="text-center py-16 text-destructive text-sm">
                Failed to load payments. Please log in and try again.
              </div>
            )}

            {!isLoading && !isError && (
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-border">
                  {records.length === 0 && (
                    <div className="text-center py-14 text-muted-foreground text-sm">
                      <AlertCircle
                        size={20}
                        className="mx-auto mb-2 opacity-30"
                      />
                      No payments yet.
                    </div>
                  )}
                  {records.map((rec) => (
                    <div key={rec.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-heading font-semibold text-sm text-foreground truncate">
                          {rec.paymentName}
                        </span>
                        <ModeBadge mode={rec.mode} />
                      </div>
                      {rec.paidTo && (
                        <p className="text-xs text-muted-foreground truncate">
                          Paid to{" "}
                          <span className="text-foreground font-medium">
                            {rec.paidTo}
                          </span>
                        </p>
                      )}
                      {rec.docNo && (
                        <span className="inline-block font-mono text-[11px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                          {rec.docNo}
                        </span>
                      )}
                      {rec.expenseRef && (
                        <span className="inline-block font-mono text-[11px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md">
                          {rec.expenseRef}
                        </span>
                      )}
                      {rec.chequeNo && (
                        <span className="inline-block font-mono text-[11px] bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-md">
                          Chq #{rec.chequeNo}
                        </span>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{rec.date}</span>
                        <span className="font-mono font-semibold text-foreground">
                          {formatINR(rec.amount ?? 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <ApprovalStatusChain
                            table="NewPayment"
                            recordId={rec.id}
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ApprovalActions
                            status={rec.status}
                            recordId={Number(rec.id)}
                            endpoint="/api/new-payment"
                            submitOnly
                            onSuccess={() => {
                              queryClient.invalidateQueries({
                                queryKey: ["payments"],
                                exact: false,
                              });
                              queryClient.invalidateQueries({
                                queryKey: ["expense-options-payment"],
                              });
                              refetchPayments();
                              window.dispatchEvent(
                                new CustomEvent("approval-action"),
                              );
                            }}
                          />
                          <button
                            onClick={() => openViewRec(rec)}
                            title="View details"
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Eye size={12} />
                          </button>
                          {rights.canEdit && (
                            <button
                              onClick={() => openEdit(rec)}
                              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                              <Edit size={12} />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button
                              onClick={() => setDeleteId(rec.id)}
                              className="p-1.5 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table — compact, no horizontal scroll */}
                <div className="hidden sm:block">
                  <table className="w-full text-sm table-fixed">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[22%]">
                          Payment Purpose
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[13%]">
                          Doc No
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[16%]">
                          Expense Ref
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[9%] hidden md:table-cell">
                          Mode
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[11%] hidden lg:table-cell">
                          Cheque / Ref
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[10%]">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[10%] hidden md:table-cell">
                          Bank
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[11%]">
                          Status
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[12%]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {records.length === 0 && (
                        <tr>
                          <td
                            colSpan={9}
                            className="text-center py-14 text-muted-foreground text-sm"
                          >
                            <AlertCircle
                              size={18}
                              className="mx-auto mb-2 opacity-30"
                            />
                            No payments yet. Click "New Payment" to get started.
                          </td>
                        </tr>
                      )}
                      {records.map((rec) => (
                        <tr
                          key={rec.id}
                          className="hover:bg-muted/20 transition-colors"
                        >
                          {/* Payment purpose + paid-to + date stacked */}
                          <td className="px-4 py-3">
                            <p className="font-heading font-medium text-foreground text-xs truncate">
                              {rec.paymentName || "—"}
                            </p>
                            {rec.paidTo && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                Paid to{" "}
                                <span className="text-foreground/80">
                                  {rec.paidTo}
                                </span>
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {rec.date || "—"}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {rec.docNo || "—"}
                            </span>
                          </td>
                          {/* Expense Ref + GRN stacked */}
                          <td className="px-4 py-3">
                            {rec.expenseRef ? (
                              <span className="font-mono text-[11px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md block w-fit truncate">
                                {rec.expenseRef}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                            <div className="mt-1">
                              <PaymentGRNBadges
                                expenseId={rec.expenseId || ""}
                              />
                            </div>
                          </td>
                          {/* Mode */}
                          <td className="px-4 py-3 hidden md:table-cell">
                            <ModeBadge mode={rec.mode} />
                          </td>
                          {/* Cheque / Ref */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {rec.chequeNo ? (
                              <div className="space-y-0.5">
                                <span className="font-mono text-xs bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-md whitespace-nowrap">
                                  #{rec.chequeNo}
                                </span>
                                {rec.isPostDated && rec.chequeDate && (
                                  <p className="text-[10px] text-indigo-500 font-mono">
                                    {rec.chequeDate}
                                  </p>
                                )}
                              </div>
                            ) : rec.neftNumber ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {rec.neftNumber}
                              </span>
                            ) : rec.upiTransactionId ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {rec.upiTransactionId}
                              </span>
                            ) : rec.rtgsReference ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {rec.rtgsReference}
                              </span>
                            ) : rec.impsReference ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {rec.impsReference}
                              </span>
                            ) : rec.cardReference ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {rec.cardDisplay ? `${rec.cardDisplay} · ` : ""}
                                {rec.cardReference}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </td>
                          {/* Amount */}
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-right whitespace-nowrap">
                            {formatINR(rec.amount ?? 0)}
                          </td>
                          {/* Bank */}
                          <td className="px-4 py-3 text-xs text-muted-foreground truncate hidden md:table-cell">
                            {rec.bankName || "—"}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {rec.displayStatus && rec.displayStatus !== rec.status ? (
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-semibold border ${
                                  rec.displayStatus === "Success" || rec.displayStatus === "Cheque Cleared"
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                  : rec.displayStatus === "Pending"
                                    ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                  : rec.displayStatus === "Cheque Issued"
                                    ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                                  : rec.displayStatus === "Cheque Bounced"
                                    ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                                  : rec.displayStatus === "Reissued"
                                    ? "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800"
                                  : "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-950/40 dark:text-gray-400 dark:border-gray-800"
                                }`}>
                                  {rec.displayStatus}
                                </span>
                              ) : (
                                <StatusBadge status={rec.status} />
                              )}
                              {rec.status === "Pending" && (
                                <ApprovalStatusChain
                                  table="NewPayment"
                                  recordId={rec.id}
                                />
                              )}
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 justify-end">
                              <ApprovalActions
                                status={rec.status}
                                recordId={Number(rec.id)}
                                endpoint="/api/new-payment"
                                submitOnly
                                onSuccess={() => {
                                  queryClient.invalidateQueries({
                                    queryKey: ["payments"],
                                    exact: false,
                                  });
                                  queryClient.invalidateQueries({
                                    queryKey: ["expense-options-payment"],
                                  });
                                  refetchPayments();
                                  window.dispatchEvent(
                                    new CustomEvent("approval-action"),
                                  );
                                }}
                              />
                              <button
                                onClick={() => openViewRec(rec)}
                                title="View details"
                                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Eye size={12} />
                              </button>
                              {rights.canEdit && (
                                <button
                                  onClick={() => openEdit(rec)}
                                  className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <Edit size={12} />
                                </button>
                              )}
                              {rights.canDelete && (
                                <button
                                  onClick={() => setDeleteId(rec.id)}
                                  className="p-1.5 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-2 px-1">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} · {totalRecords} total
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pg = page <= 3 ? i + 1 : page - 2 + i;
                    if (pg < 1 || pg > totalPages) return null;
                    return (
                      <button
                        key={pg}
                        onClick={() => setPage(pg)}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${pg === page ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                      >
                        {pg}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </FinanceShell>

      {/* Payment detail view modal */}
      {viewingRec && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setViewingRec(null);
            setViewingChain(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Receipt size={15} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-foreground text-sm">
                    Payment Details
                  </h3>
                  {viewingRec.docNo && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {viewingRec.docNo}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  setViewingRec(null);
                  setViewingChain(null);
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Tab strip */}
            {viewingRec.expenseRef && (
              <div className="flex border-b border-border px-5 bg-muted/10">
                {(["details", "chain"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDetailTab(t)}
                    className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      detailTab === t
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "details" ? "Details" : "Payment Chain"}
                    {t === "chain" && paymentChainData && (
                      <span className="ml-1.5 text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                        {paymentChainData.payments.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

              {/* ── Payment Chain Tab ── */}
              {detailTab === "chain" && viewingRec.expenseRef && (
                <div className="space-y-3">
                  {/* Invoice summary */}
                  {paymentChainData?.invoice && (() => {
                    // Use live GRN breakdown total when available (viewingGrnTotal), chain endpoint GrnTotalAmount as fallback
                    const chainInvoiceTotal = viewingGrnTotal > 0 ? viewingGrnTotal : Number(
                      (paymentChainData.invoice.ESourceType === "GRN" && paymentChainData.invoice.GrnTotalAmount)
                        ? paymentChainData.invoice.GrnTotalAmount
                        : (paymentChainData.invoice.ENetAmount ?? paymentChainData.invoice.EAmount ?? 0)
                    );
                    // Sum non-bounced Approved payments, subtract bounce charge (bank fee, not supplier payment)
                    const chainTotalPaid = (paymentChainData.payments ?? [])
                      .filter((p) => p.Status === "Approved" && !p.IsBounced)
                      .reduce((sum, p) => sum + (Number(p.PAmount ?? 0) - Number(p.BounceCharge ?? 0)), 0);
                    const chainBounceTotal = (paymentChainData.payments ?? [])
                      .filter((p) => p.Status === "Approved" && !p.IsBounced)
                      .reduce((sum, p) => sum + Number(p.BounceCharge ?? 0), 0);
                    const chainOutstanding = Math.max(0, chainInvoiceTotal - chainTotalPaid);
                    return (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                      <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-primary mb-2">
                        Invoice Summary
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase">Invoice Total</p>
                          <p className="font-mono text-xs font-bold text-foreground">
                            {formatINR(chainInvoiceTotal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase">Paid</p>
                          <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            {formatINR(chainTotalPaid)}
                          </p>
                          {chainBounceTotal > 0 && (
                            <p className="text-[8px] text-red-500 dark:text-red-400 font-mono">+{formatINR(chainBounceTotal)} bounce</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase">Outstanding</p>
                          <p className={`font-mono text-xs font-bold ${chainOutstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {formatINR(chainOutstanding)}
                          </p>
                        </div>
                      </div>
                    </div>
                    );
                  })()}

                  {/* Timeline */}
                  {loadingChain ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">Loading chain…</div>
                  ) : paymentChainData?.payments.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-6">No payments found for this invoice.</p>
                  ) : (
                    <div className="relative">
                      {/* Vertical line */}
                      <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                      <div className="space-y-3 pl-8">
                        {paymentChainData?.payments.map((p: PaymentChainItem) => {
                          const ds = p.DisplayStatus as DisplayStatus;
                          const borderColor =
                            ds === "Success" || ds === "Cheque Cleared" ? "border-l-emerald-500" :
                            ds === "Pending" ? "border-l-amber-500" :
                            ds === "Cheque Issued" ? "border-l-blue-500" :
                            ds === "Cheque Bounced" ? "border-l-red-500" :
                            ds === "Reissued" ? "border-l-violet-500" :
                            "border-l-gray-400";
                          const dotColor =
                            ds === "Success" || ds === "Cheque Cleared" ? "bg-emerald-500" :
                            ds === "Pending" ? "bg-amber-500" :
                            ds === "Cheque Issued" ? "bg-blue-500" :
                            ds === "Cheque Bounced" ? "bg-red-500" :
                            ds === "Reissued" ? "bg-violet-500" :
                            "bg-gray-400";
                          const badgeClass =
                            ds === "Success" || ds === "Cheque Cleared" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" :
                            ds === "Pending" ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400" :
                            ds === "Cheque Issued" ? "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400" :
                            ds === "Cheque Bounced" ? "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400" :
                            ds === "Reissued" ? "bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-400" :
                            "bg-gray-500/10 border-gray-500/20 text-gray-700 dark:text-gray-400";
                          return (
                            <div key={p.PPaymentID} className="relative">
                              {/* Dot */}
                              <div className={`absolute -left-5 top-3 w-2.5 h-2.5 rounded-full border-2 border-background ${dotColor}`} />
                              <div className={`rounded-lg border border-l-2 bg-card p-3 space-y-1.5 ${borderColor}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-[10px] font-semibold text-foreground">{p.DocNo ?? "—"}</span>
                                    {p.PDate && <span className="text-[10px] text-muted-foreground">· {p.PDate.slice(0, 10)}</span>}
                                  </div>
                                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                                    {ds}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                  <span className="font-mono font-semibold text-foreground text-xs">{formatINR(Number(p.PAmount ?? 0))}</span>
                                  {p.PMode && <span>· {p.PMode}</span>}
                                  {p.PChequeNo && <span>· Chq #{p.PChequeNo}</span>}
                                </div>
                                {p.BounceDate && (
                                  <div className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
                                    <AlertTriangle size={9} />
                                    Bounced {p.BounceDate.slice(0,10)}{p.BounceReason ? ` — ${p.BounceReason}` : ""}
                                  </div>
                                )}
                                {p.ReplacementDocNo && (
                                  <div className="text-[10px] text-violet-600 dark:text-violet-400 flex items-center gap-1">
                                    <RefreshCw size={9} /> Reissued as {p.ReplacementDocNo}
                                  </div>
                                )}
                                {p.OriginalDocNo && (
                                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <ArrowLeft size={9} /> Replaces {p.OriginalDocNo}
                                  </div>
                                )}
                                {p.BounceCharge && Number(p.BounceCharge) > 0 && (
                                  <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-dashed border-red-300 dark:border-red-800">
                                    <span className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
                                      <AlertTriangle size={9} /> Bounce charge (separate)
                                    </span>
                                    <span className="font-mono text-[11px] font-semibold text-red-600 dark:text-red-400">
                                      {formatINR(Number(p.BounceCharge))}
                                    </span>
                                  </div>
                                )}
                                {/* Reissue button for bounced payments with no replacement */}
                                {ds === "Cheque Bounced" && !p.ReplacementDocNo && (
                                  <button
                                    className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-1 mt-0.5"
                                    onClick={() => {
                                      setViewingRec(null);
                                      setViewingChain(null);
                                      setReissueCtx({
                                        replacesPaymentId: p.PPaymentID,
                                        replacesDocNo: p.DocNo ?? "",
                                        amount: Number(p.PAmount ?? 0),
                                        paymentName: "",
                                        companyName: viewingRec?.company ?? "",
                                        expenseRef: viewingRec?.expenseRef ?? null,
                                        bounceReason: p.BounceReason ?? null,
                                      });
                                      setBounceCharge("");
                                      setView("form");
                                    }}
                                  >
                                    <RefreshCw size={9} /> Reissue Payment
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Details Tab (default) ── */}
              {detailTab === "details" && (
                <>

              {/* Status + Mode row */}
              <div className="flex items-center gap-2">
                <StatusBadge status={viewingRec.status} />
                <ModeBadge mode={viewingRec.mode} />
                {viewingChain?.billStatus && (
                  <span
                    className={`flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg border ${
                      viewingChain.billStatus === "Paid"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                        : viewingChain.billStatus === "Partially Paid"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                    }`}
                  >
                    {viewingChain.billStatus === "Paid" ? (
                      <CheckCircle2 size={10} />
                    ) : viewingChain.billStatus === "Partially Paid" ? (
                      <Clock size={10} />
                    ) : (
                      <AlertCircle size={10} />
                    )}
                    {viewingChain.billStatus}
                  </span>
                )}
              </div>

              {/* Company info */}
              {viewingCompanyDetail && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 flex items-center gap-3">
                  {viewingCompanyDetail.logo ? (
                    <img
                      src={viewingCompanyDetail.logo}
                      alt="Company logo"
                      className="h-9 w-auto max-w-[110px] object-contain shrink-0"
                    />
                  ) : (
                    <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                      <Receipt size={14} className="text-primary" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-heading font-semibold text-foreground truncate">
                      {viewingCompanyDetail.name || viewingRec.company}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[
                        viewingCompanyDetail.address,
                        viewingCompanyDetail.city,
                        viewingCompanyDetail.state,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[
                        viewingCompanyDetail.phone_number,
                        viewingCompanyDetail.email,
                        viewingCompanyDetail.gst_no
                          ? `GSTIN: ${viewingCompanyDetail.gst_no}`
                          : null,
                        viewingCompanyDetail.pan_no
                          ? `PAN: ${viewingCompanyDetail.pan_no}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </p>
                  </div>
                </div>
              )}

              {/* Supplier / Vendor info */}
              {viewingChain?.supplier && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-1.5">
                  <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Building2 size={9} className="text-primary" /> Supplier /
                    Vendor
                  </p>
                  <p className="text-xs font-medium text-foreground">
                    {viewingChain.supplier.name}
                    {viewingChain.supplier.code ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · {viewingChain.supplier.code}
                      </span>
                    ) : null}
                  </p>
                  {viewingChain.supplier.address && (
                    <p className="text-[10px] text-muted-foreground">
                      {viewingChain.supplier.address}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {[
                      viewingChain.supplier.phone,
                      viewingChain.supplier.email,
                      viewingChain.supplier.gst
                        ? `GSTIN: ${viewingChain.supplier.gst}`
                        : null,
                      viewingChain.supplier.pan
                        ? `PAN: ${viewingChain.supplier.pan}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </p>
                </div>
              )}

              {/* Traceability chain */}
              {viewingChain && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-2.5">
                  <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <ArrowRight size={9} className="text-primary" /> Document
                    Chain
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {viewingChain.chain.mrDocNo && (
                      <>
                        <span className="bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400 px-2 py-1 rounded-md font-mono font-semibold">
                          MR: {viewingChain.chain.mrDocNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.workDoneRef && (
                      <>
                        <span className="bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-400 px-2 py-1 rounded-md font-mono font-semibold">
                          WD: {viewingChain.chain.workDoneRef}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.poNo && (
                      <>
                        <span className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-md font-mono font-semibold">
                          PO: {viewingChain.chain.poNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.grnNo && (
                      <>
                        <span className="bg-teal-500/10 border border-teal-500/20 text-teal-700 dark:text-teal-400 px-2 py-1 rounded-md font-mono font-semibold">
                          GRN: {viewingChain.chain.grnNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.expenseDocNo && (
                      <>
                        <span className="bg-primary/10 border border-primary/20 text-primary px-2 py-1 rounded-md font-mono font-semibold">
                          {viewingChain.chain.expenseDocNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded-md font-mono font-semibold">
                      {viewingRec.docNo || "This Payment"}
                    </span>
                  </div>

                  {/* Payment summary strip */}
                  {viewingChain.netAmount > 0 && (() => {
                    const grnTotal = viewingGrnTotal > 0 ? viewingGrnTotal
                      : paymentChainData?.invoice?.GrnTotalAmount
                        ? parseFloat(String(paymentChainData.invoice.GrnTotalAmount))
                        : 0;
                    const displayNet = grnTotal > 0 ? grnTotal : viewingChain.netAmount;
                    // Exclude bounce charges — they're bank fees, not supplier payments
                    const displayTotalPaid = paymentChainData?.payments?.length
                      ? (paymentChainData.payments)
                          .filter((p) => p.Status === "Approved" && !p.IsBounced)
                          .reduce((sum, p) => sum + (Number(p.PAmount ?? 0) - Number(p.BounceCharge ?? 0)), 0)
                      : viewingChain.totalPaid;
                    const displayBounceTotal = (paymentChainData?.payments ?? [])
                      .filter((p) => p.Status === "Approved" && !p.IsBounced)
                      .reduce((sum, p) => sum + Number(p.BounceCharge ?? 0), 0);
                    const displayRemaining = Math.max(0, displayNet - displayTotalPaid);
                    return (
                    <div className="flex items-center gap-2 pt-1 border-t border-border/60 mt-2">
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Net Payable
                        </p>
                        <p className="font-mono text-xs font-bold text-foreground">
                          {formatINR(displayNet)}
                        </p>
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Total Paid
                        </p>
                        <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          {formatINR(displayTotalPaid)}
                        </p>
                        {displayBounceTotal > 0 && (
                          <p className="text-[8px] text-red-500 dark:text-red-400 font-mono">+{formatINR(displayBounceTotal)} bounce</p>
                        )}
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Remaining
                        </p>
                        <p
                          className={`font-mono text-xs font-bold ${displayRemaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {formatINR(displayRemaining)}
                        </p>
                      </div>
                    </div>
                    );
                  })()}

                  {/* Vendor invoice if present */}
                  {viewingChain.chain.vendorInvoiceNo && (
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/60">
                      <FileText size={9} />
                      Vendor Invoice:
                      <span className="font-mono font-semibold text-foreground">
                        {viewingChain.chain.vendorInvoiceNo}
                      </span>
                      {viewingChain.chain.vendorInvoiceDate && (
                        <span className="text-muted-foreground">
                          ({viewingChain.chain.vendorInvoiceDate})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Grid of fields */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Payment Purpose", value: viewingRec.paymentName },
                  { label: "Paid To", value: viewingRec.paidTo || "—" },
                  { label: "Amount", value: formatINR(viewingRec.amount ?? 0) },
                  { label: "Date", value: viewingRec.date || "—" },
                  { label: "Mode", value: viewingRec.mode || "—" },
                  { label: "Company", value: viewingRec.company || "—" },
                  { label: "Project", value: viewingRec.project || "—" },
                  {
                    label: "Project Site",
                    value: viewingRec.projectSite || "—",
                  },
                  { label: "Expense Ref", value: viewingRec.expenseRef || "—" },
                  ...(viewingRec.bankName
                    ? [{ label: "Bank", value: viewingRec.bankName }]
                    : []),
                  ...(viewingRec.chequeNo
                    ? [
                        {
                          label: "Cheque No.",
                          value: `#${viewingRec.chequeNo}`,
                        },
                      ]
                    : []),
                  ...(viewingRec.chequeDate
                    ? [{ label: "Cheque Date", value: viewingRec.chequeDate }]
                    : []),
                  ...(viewingRec.chequeLotNumber
                    ? [
                        {
                          label: "Cheque Lot",
                          value: viewingRec.chequeLotNumber,
                        },
                      ]
                    : []),
                  ...(viewingRec.neftNumber
                    ? [{ label: "NEFT Ref.", value: viewingRec.neftNumber }]
                    : []),
                  ...(viewingRec.upiTransactionId
                    ? [
                        {
                          label: "UPI Txn ID",
                          value: viewingRec.upiTransactionId,
                        },
                      ]
                    : []),
                  ...(viewingRec.rtgsReference
                    ? [{ label: "RTGS Ref.", value: viewingRec.rtgsReference }]
                    : []),
                  ...(viewingRec.impsReference
                    ? [{ label: "IMPS Ref.", value: viewingRec.impsReference }]
                    : []),
                  ...(viewingRec.cardReference
                    ? [{ label: "Card Ref.", value: viewingRec.cardReference }]
                    : []),
                  ...(viewingRec.cardDisplay
                    ? [{ label: "Card Used", value: viewingRec.cardDisplay }]
                    : []),
                  ...(viewingRec.parentDocNo
                    ? [{ label: "Parent Doc", value: viewingRec.parentDocNo }]
                    : []),
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-xs font-medium text-foreground truncate">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
              {rights.canPrint && (
                <button
                  onClick={() =>
                    handlePrintPayment(
                      viewingRec,
                      viewingCompanyDetail,
                      viewingChain,
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <Printer size={12} /> Print / PDF
                </button>
              )}
              {rights.canEdit && (
                <button
                  onClick={() => {
                    setViewingRec(null);
                    setViewingChain(null);
                    openEdit(viewingRec);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <Edit size={12} /> Edit
                </button>
              )}
              {viewingRec && viewingChain && (() => {
                const _grnTotal = viewingGrnTotal > 0 ? viewingGrnTotal
                  : paymentChainData?.invoice?.GrnTotalAmount
                    ? parseFloat(String(paymentChainData.invoice.GrnTotalAmount)) : 0;
                const _displayNet = _grnTotal > 0 ? _grnTotal : viewingChain.netAmount;
                const _displayTotalPaid = paymentChainData?.payments?.length
                  ? (paymentChainData.payments)
                      .filter((p) => p.Status === "Approved" && !p.IsBounced)
                      .reduce((sum, p) => sum + (Number(p.PAmount ?? 0) - Number(p.BounceCharge ?? 0)), 0)
                  : viewingChain.totalPaid;
                const _displayRemaining = Math.max(0, _displayNet - _displayTotalPaid);
                return _displayRemaining > 0 &&
                  !["Reissued", "Failed", "Cancelled"].includes(viewingRec.displayStatus) && (
                <button
                  onClick={() => {
                    const rec = viewingRec;
                    const remaining = _displayRemaining;
                    setFormKnownTotalPaid(_displayTotalPaid);
                    setViewingRec(null);
                    setViewingChain(null);
                    handlePayRemaining(rec, remaining);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                >
                  <Plus size={12} /> Pay Remaining
                </button>
                );
              })()}
              <button
                onClick={() => {
                  setViewingRec(null);
                  setViewingChain(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium gradient-accent text-white shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-card border border-border shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
                <Trash2 size={16} className="text-destructive" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-foreground">
                  Delete Payment
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Are you sure you want to delete this payment? This cannot be
                  undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteId && handleDelete(deleteId)}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Payment;
