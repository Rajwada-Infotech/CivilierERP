import React from "react";
import { useState, useCallback, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPayments,
  addPayment,
  updatePayment,
  deletePayment,
} from "@/api/newPaymentApi";
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
} from "lucide-react";
import type { ExportColumn } from "@/lib/export";

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
  PCompany: string | null;
  PExpenseRef: string | null;
  DocNo?: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  Status?: string;
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
}

interface BankOption {
  id: number;
  label: string;
  accountNumber?: string | null;
  ifscCode?: string | null;
  branch?: string | null;
  accountType?: string | null;
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
}

interface ExpenseDetail {
  Eid: number;
  EDocNo: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  EProjectName: string | null;
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
  // GST breakdown from linked expense
  baseAmount: number | null;
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;
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
  return res.json();
};

const fetchExpenseOptions = async (): Promise<ExpenseOption[]> => {
  const res = await fetchWithAuth("/api/expense-booking/options");
  if (!res.ok) return [];
  return res.json();
};

const fetchExpenseDetail = async (
  id: string,
): Promise<ExpenseDetail | null> => {
  if (!id) return null;
  const res = await fetchWithAuth(`/api/expense-booking/${id}`);
  if (!res.ok) return null;
  return res.json();
};

const fetchExpenseGRNs = async (expenseId: string): Promise<GRNRef[]> => {
  if (!expenseId) return [];
  const res = await fetchWithAuth(`/api/expense-booking/${expenseId}/grns`);
  if (!res.ok) return [];
  const data = await res.json();
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
  return res.json();
};

const fetchChequeNumbers = async (
  lotId: number,
): Promise<{ number: string; used: boolean }[]> => {
  const res = await fetchWithAuth(`/api/new-payment/cheque-numbers/${lotId}`);
  if (!res.ok) return [];
  return res.json();
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
  return res.json();
};

const fetchCompanyOptions = async (): Promise<
  { id: number; label: string }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json();
};

const fetchProjectOptions = async (): Promise<string[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  const data: { id: number; label: string }[] = await res.json();
  return data.map((p) => p.label).sort();
};

const fetchFinYears = async (): Promise<string[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data: { FId: number; FName: string | null }[] = await res.json();
  return data
    .filter((f) => f.FName)
    .map((f) => f.FName as string)
    .sort()
    .reverse();
};

const fetchSupplierOptions = async (): Promise<string[]> => {
  const res = await fetchWithAuth("/api/account-head/options?type=S");
  if (!res.ok) return [];
  const data: { id: number; label: string }[] = await res.json();
  return data.map((s) => s.label).sort();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankForm(): Omit<PaymentRecord, "id"> {
  return {
    paymentName: "",
    mode: "",
    amount: null,
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
    baseAmount: null,
    cgstRate: null,
    sgstRate: null,
    igstRate: null,
  };
}

function dbToRecord(item: DbPayment): PaymentRecord {
  return {
    id: String(item.PPaymentID),
    paymentName: item.PPaymentName || "",
    mode: item.PMode || "",
    amount: item.PAmount ?? null,
    date: item.PDate?.slice(0, 10) || "",
    bankId: item.PBankID ?? null,
    bankName: item.PBankName || "",
    project: item.PProject || "",
    projectSite: item.PProject || "",
    company: item.PCompany || "",
    expenseRef: item.PExpenseRef || "",
    expenseId: "",
    docNo: item.DocNo || "",
    parentDocNo: item.ParentDocNo || "",
    rootExBDocNo: item.RootExBDocNo || "",
    docType: item.PDocType || "",
    status: (item as any).Status || "Draft",
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
    baseAmount: null,
    cgstRate: null,
    sgstRate: null,
    igstRate: null,
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
  return (
    <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
        <Icon size={12} className="text-primary" />
      </div>
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
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

// ─── PartyFilterCombobox ──────────────────────────────────────────────────────

function PartyFilterCombobox({
  partyNames,
  value,
  onChange,
  expenseOptions,
}: {
  partyNames: string[];
  value: string;
  onChange: (val: string) => void;
  expenseOptions: ExpenseOption[];
}) {
  const [search, setSearch] = React.useState("");
  const [tab, setTab] = React.useState<"suppliers" | "others">("suppliers");

  const suppliers = partyNames.filter((n) =>
    expenseOptions.some(
      (o) => o.supplierName === n && o.supplierName !== o.partyName,
    ),
  );
  const others = partyNames.filter((n) => !suppliers.includes(n));

  const activeList = tab === "suppliers" ? suppliers : others;
  const filtered = activeList.filter((n) =>
    n.toLowerCase().includes(search.toLowerCase()),
  );

  const totalCount = expenseOptions.length;
  const filteredCount = value
    ? expenseOptions.filter((o) => o.supplierName === value).length
    : totalCount;

  // Switch tab if selected value belongs to the other group
  React.useEffect(() => {
    if (!value) return;
    if (suppliers.includes(value) && tab !== "suppliers") setTab("suppliers");
    if (others.includes(value) && tab !== "others") setTab("others");
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground">
          Filter by Party
        </label>
        <span className="text-[10px] text-muted-foreground/60 font-heading normal-case tracking-normal">
          — narrows the booking list below
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setTab("suppliers")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-heading font-semibold transition-colors border-b-2 ${
              tab === "suppliers"
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Truck size={11} />
            Suppliers
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-heading ${tab === "suppliers" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
            >
              {suppliers.length}
            </span>
          </button>
          <div className="w-px bg-border" />
          <button
            type="button"
            onClick={() => setTab("others")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-heading font-semibold transition-colors border-b-2 ${
              tab === "others"
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <FileText size={11} />
            Others
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-heading ${tab === "others" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
            >
              {others.length}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder={`Search ${tab}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
          {filtered.length === 0 && (
            <div className="px-4 py-5 text-center text-xs text-muted-foreground">
              No {tab} match "{search}"
            </div>
          )}

          {filtered.map((name) => {
            const count = expenseOptions.filter(
              (o) => o.supplierName === name,
            ).length;
            const isSelected = value === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChange(isSelected ? "" : name)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 ${isSelected ? "bg-primary/5" : ""}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isSelected ? (
                    <div className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-primary flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    </div>
                  ) : (
                    <div className="w-3.5 h-3.5 shrink-0 rounded-full border border-border" />
                  )}
                  <span
                    className={`text-xs truncate ${isSelected ? "font-semibold text-primary" : "text-foreground"}`}
                  >
                    {name}
                  </span>
                </div>
                <span className="text-[10px] font-heading text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active filter chip */}
        {value && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-primary/5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Truck size={11} className="text-primary shrink-0" />
              <span className="text-xs font-medium text-primary truncate">
                {value}
              </span>
              <span className="text-[10px] text-primary/60 font-heading shrink-0">
                · {filteredCount} booking{filteredCount !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onChange("")}
              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
// ─── FilterBar ────────────────────────────────────────────────────────────────

type BookingFilters = {
  company: string;
  project: string;
  year: string;
  supplier: string;
};

function FilterBar({
  expenseOptions,
  filters,
  onChange,
}: {
  expenseOptions: ExpenseOption[];
  filters: BookingFilters;
  onChange: (key: keyof BookingFilters, value: string) => void;
}) {
  const [projects, setProjects] = React.useState<string[]>([]);
  const [finYears, setFinYears] = React.useState<string[]>([]);
  const [suppliers, setSuppliers] = React.useState<string[]>([]);

  React.useEffect(() => {
    fetchProjectOptions()
      .then(setProjects)
      .catch(() => {});
    fetchFinYears()
      .then(setFinYears)
      .catch(() => {});
    fetchSupplierOptions()
      .then(setSuppliers)
      .catch(() => {});
  }, []);

  // Company — derived from expenseOptions (already resolved per option)
  const companies = React.useMemo(
    () =>
      Array.from(
        new Set(
          expenseOptions
            .map((o) => o.companyName)
            .filter((v): v is string => !!v && v.trim() !== ""),
        ),
      ).sort(),
    [expenseOptions],
  );

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

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-5 h-5 rounded bg-muted">
            <Search size={11} className="text-muted-foreground" />
          </div>
          <span className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
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
        Select Expense Booking
      </label>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Selecting a booking auto-fills project, company, amount &amp; doc type.
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
            <span className="text-muted-foreground">
              — Choose expense booking —
            </span>
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
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [expenseId]);
  if (!grns.length)
    return <span className="text-muted-foreground text-xs">—</span>;
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
  { header: "Payment Name", accessor: "paymentName" },
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
  };
  const m = msgs[mode];
  if (!m) return null;
  const Icon = m.icon;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg bg-${m.color}-500/5 border border-${m.color}-500/20 px-4 py-3`}
    >
      <Icon size={14} className={`text-${m.color}-500 shrink-0 mt-0.5`} />
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
    { number: string; used: boolean }[]
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
  const availableCheques = chequeNumbers.filter((c) => !c.used);

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

  return (
    <div className="space-y-4">
      {/* Lot info — static display, not a dropdown */}
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
      ) : (
        <>
          {/* Lot number shown as a static info chip */}
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
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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

// ─── Main component ───────────────────────────────────────────────────────────

const Payment: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
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
  const [viewingRec, setViewingRec] = useState<PaymentRecord | null>(null);
  const [viewingCompanyDetail, setViewingCompanyDetail] =
    useState<CompanyDetail | null>(null);
  const [viewingChain, setViewingChain] = useState<ChainSummary | null>(null);

  // Open the detail modal and eagerly fetch the company logo
  const openViewRec = async (rec: PaymentRecord) => {
    setViewingRec(rec);
    setViewingCompanyDetail(null);
    setViewingChain(null);
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
    }
  };

  // Print/PDF payment voucher
  const handlePrintPayment = (
    rec: PaymentRecord,
    companyDetail: CompanyDetail | null,
  ) => {
    const logoHtml = companyDetail?.logo
      ? `<img src="${companyDetail.logo}" alt="Logo" style="height:60px;max-width:180px;object-fit:contain;" />`
      : `<span style="font-size:18px;font-weight:800;color:#4f46e5;">${companyDetail?.name ?? rec.company ?? "—"}</span>`;

    const companyAddress = [
      companyDetail?.address,
      companyDetail?.city,
      companyDetail?.state,
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
            <td style="padding:7px 12px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;width:140px;">${label}</td>
            <td style="padding:7px 12px;font-size:13px;font-weight:500;color:#111827;">${value}</td>
           </tr>`
        : "";

    const rows = [
      field("Payment Ref", rec.docNo || "—"),
      field("Payment Name", rec.paymentName),
      field("Amount", formatINR(rec.amount ?? 0)),
      field("Date", rec.date || "—"),
      field("Mode", rec.mode || "—"),
      field("Company", rec.company || "—"),
      field("Project", rec.project || "—"),
      field("Project Site", rec.projectSite || null),
      field("Expense Ref", rec.expenseRef || null),
      field("Parent Doc", rec.parentDocNo || null),
      field("Bank", rec.bankName || null),
      field("Cheque No.", rec.chequeNo ? `#${rec.chequeNo}` : null),
      field("Cheque Date", rec.chequeDate || null),
      field("Cheque Lot", rec.chequeLotNumber || null),
      field("NEFT Ref.", rec.neftNumber || null),
      field("UPI Txn ID", rec.upiTransactionId || null),
      field("RTGS Ref.", rec.rtgsReference || null),
      field("IMPS Ref.", rec.impsReference || null),
    ].join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payment Voucher — ${rec.docNo || rec.paymentName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111827; padding: 36px; font-size: 13px; }
    table { border-collapse: collapse; }
    tr:nth-child(even) { background: #f9fafb; }
    @media print { body { padding: 16px; } button { display: none !important; } }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #4f46e5;margin-bottom:24px;">
    <div>
      ${logoHtml}
      ${companyAddress ? `<div style="margin-top:6px;font-size:11px;color:#6b7280;">${companyAddress}</div>` : ""}
      ${companyDetail?.email ? `<div style="font-size:11px;color:#6b7280;">${companyDetail.email}</div>` : ""}
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PAYMENT VOUCHER</div>
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
  <div style="margin-bottom:24px;padding:16px 20px;background:linear-gradient(135deg,#4f46e510,#7c3aed10);border-radius:12px;border:1px solid #4f46e520;display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Payment Amount</div>
      <div style="font-size:28px;font-weight:800;color:#4f46e5;font-family:monospace;">${formatINR(rec.amount ?? 0)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Payment Date</div>
      <div style="font-size:16px;font-weight:700;color:#111827;">${rec.date || "—"}</div>
    </div>
  </div>

  <!-- Details table -->
  <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <table style="width:100%;">
      <tbody>${rows}</tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="margin-top:36px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
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
  const [supplierBookingFilter, setSupplierBookingFilter] = useState("");
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
      companyFilter,
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
        companyFilter,
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

  const dbItems: DbPayment[] = Array.isArray(dbData?.data) ? dbData.data : [];
  const totalPages: number = dbData?.totalPages ?? 1;
  const totalRecords: number = dbData?.total ?? 0;
  const records: PaymentRecord[] = dbItems.map(dbToRecord);

  // Derive unique project names and fin-years from all loaded records for filter dropdowns
  const projectOptions: string[] = Array.from(
    new Set(
      dbItems
        .map((p) => p.PProject)
        .filter((v): v is string => !!v && v.trim() !== ""),
    ),
  ).sort();

  // Generate financial year options: current year ± 3, formatted as "YYYY"
  const currentYear = new Date().getFullYear();
  const finYearOptions: number[] = Array.from(
    { length: 7 },
    (_, i) => currentYear - 3 + i,
  );

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
      ? expenseOptions.find((o) => o.label.startsWith(rest.expenseRef))
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
      ...(!["NEFT", "UPI", "RTGS", "IMPS"].includes(newMode)
        ? {
            neftNumber: "",
            upiTransactionId: "",
            rtgsReference: "",
            impsReference: "",
          }
        : {}),
    }));
  };

  // ── Expense booking selection → auto-fill ──────────────────────────────────

  const handleExpenseSelect = useCallback(
    async (expenseId: string) => {
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
          company:
            selectedOption.companyName ||
            String(selectedOption.companyId ?? ""),
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
          project: detail.EProjectName || "",
          company:
            (detail as any).ECompanyName || String(detail.ECompanyId ?? ""),
          amount: detail.ENetAmount ?? detail.EAmount ?? null,
          docType: detail.DocTypeName || detail.EDocumentType || "",
          baseAmount: detail.EAmount ?? null,
          cgstRate: detail.ECgstRate ?? null,
          sgstRate: detail.ESgstRate ?? null,
          igstRate: detail.EIgstRate ?? null,
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
        }
      } catch {
        toast.error("Could not load expense booking details.");
      } finally {
        setLoadingExpense(false);
      }
    },
    [expenseOptions],
  );

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
    }));
    setLinkedGRNs([]);
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
  };

  // ── Validation ─────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    if (!form.paymentName.trim()) {
      toast.error("Payment name is required.");
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
    const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS"].includes(form.mode);

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
    }

    return true;
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;

    const payload = {
      PPaymentName: form.paymentName || null,
      PMode: form.mode || null,
      PAmount: form.amount ?? null,
      PDocType: form.docType || null,
      PDate: form.date || null,
      PBankID: form.bankId ?? null,
      PBankName: form.bankName || null,
      PProject: form.projectSite || form.project || null,
      PCompany: form.company || null,
      PExpenseRef: form.expenseRef || null,
      parentDocNo: form.parentDocNo || null,
      rootExBDocNo: form.rootExBDocNo || null,
      // Cheque
      PChequeNo: form.chequeNo || null,
      PChequeLotId: form.chequeLotId ?? null,
      PChequeLotNumber: form.chequeLotNumber || null,
      PChequeDate: form.chequeDate || null,
      PChequeAccountNumber: form.chequeAccountNumber || null,
      PChequeIfsc: form.chequeIfsc || null,
      PIsPostDated: form.isPostDated,
      // Digital
      PNeftNumber: form.neftNumber || null,
      PUpiTransactionId: form.upiTransactionId || null,
      PRtgsReference: form.rtgsReference || null,
      PImpsReference: form.impsReference || null,
    };

    try {
      setSaving(true);
      if (editingId) {
        await updatePayment(editingId, payload);
        toast.success("Payment updated.");
      } else {
        await addPayment(payload);
        toast.success("Payment saved.");
      }
      queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
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
      setDeleteId(null);
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const isChequeMode =
    form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS"].includes(form.mode);
  const isCashMode = form.mode === "Cash";

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Payments"]} />
      <div className="space-y-5">
        {/* ── Page header ── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Payment Management
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Record and track payments linked to expense bookings
            </p>
          </div>
          <div className="flex items-center gap-2">
            {view === "list" && (
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
              />
            )}
            {view === "list" && (
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white shadow-sm"
              >
                <Plus size={13} /> New Payment
              </button>
            )}
          </div>
        </div>

        {/* ── Summary stats ── */}
        {view === "list" && !isLoading && dbItems.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              {
                label: "Total Paid",
                value: formatINR(totalAmount),
                icon: Banknote,
                color: "text-primary bg-primary/10",
              },
              {
                label: "By Cheque",
                value: chequeCount,
                icon: Clock,
                color: "text-amber-600 bg-amber-500/10",
              },
              {
                label: "By Cash",
                value: cashCount,
                icon: CheckCircle2,
                color: "text-emerald-600 bg-emerald-500/10",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl bg-card border border-border p-4 flex items-center gap-3"
              >
                <div className={`p-2 rounded-lg shrink-0 ${s.color}`}>
                  <s.icon size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider truncate">
                    {s.label}
                  </p>
                  <p className="text-base font-bold font-mono text-foreground mt-0.5">
                    {s.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* FORM VIEW                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {view === "form" && (
          <div className="rounded-xl border border-border bg-card shadow-sm">
            {/* Card header */}
            <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <button
                  onClick={cancelForm}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <span className="text-border/60">|</span>
                <h2 className="text-base font-heading font-semibold text-foreground">
                  {editingId ? "Edit Payment" : "New Payment"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelForm}
                  className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white disabled:opacity-60"
                >
                  {saving ? "Saving…" : editingId ? "Update" : "Save Payment"}
                </button>
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
                          expenseOptions={expenseOptions}
                          filters={bookingFilters}
                          onChange={(key, val) =>
                            setBookingFilters((prev) => ({
                              ...prev,
                              [key]: val,
                            }))
                          }
                        />
                        <ExpenseBookingPicker
                          options={filteredOptions}
                          value={form.expenseId}
                          onChange={handleExpenseSelect}
                          loading={loadingExpense}
                        />
                      </div>
                    );
                  })()}

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
                          value={form.company}
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
                              ?.supplierName || ""
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
                  <Field label="Payment Name" required>
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
                        className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Amount (₹)"
                    required={isCashMode}
                    hint={
                      form.expenseRef
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
                      const base = form.baseAmount ?? form.amount ?? 0;
                      const cgst = form.cgstRate
                        ? (base * form.cgstRate) / 100
                        : 0;
                      const sgst = form.sgstRate
                        ? (base * form.sgstRate) / 100
                        : 0;
                      const igst = form.igstRate
                        ? (base * form.igstRate) / 100
                        : 0;
                      const gstTotal = cgst + sgst + igst;
                      const hasGst = gstTotal > 0;

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
                          <div className="space-y-1.5">
                            {hasGst && (
                              <>
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>Base Amount</span>
                                  <span className="font-mono">
                                    {formatINR(base)}
                                  </span>
                                </div>
                                {cgst > 0 && (
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>CGST ({form.cgstRate}%)</span>
                                    <span className="font-mono">
                                      {formatINR(cgst)}
                                    </span>
                                  </div>
                                )}
                                {sgst > 0 && (
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>SGST ({form.sgstRate}%)</span>
                                    <span className="font-mono">
                                      {formatINR(sgst)}
                                    </span>
                                  </div>
                                )}
                                {igst > 0 && (
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>IGST ({form.igstRate}%)</span>
                                    <span className="font-mono">
                                      {formatINR(igst)}
                                    </span>
                                  </div>
                                )}
                                <div className="border-t border-border/60 pt-1.5" />
                              </>
                            )}
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-heading font-semibold text-foreground">
                                Net Payable
                              </span>
                              <span className="font-mono text-base font-bold text-primary">
                                {formatINR(form.amount ?? 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                </div>
              </div>

              {/* ── 3. Bank Account ── */}
              <div className="space-y-3">
                <SectionHeader icon={Landmark} label="Bank Account" />
                <Field
                  label="Bank"
                  required={isChequeMode || isDigitalMode}
                  hint={
                    isChequeMode
                      ? "Required — used to filter cheque lots."
                      : isDigitalMode
                        ? "Bank account from which the transfer was made."
                        : "Optional for cash payments."
                  }
                >
                  <div className="relative">
                    <Landmark
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <select
                      value={form.bankId ? String(form.bankId) : ""}
                      onChange={(e) => handleBankSelect(e.target.value)}
                      className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
                  {form.bankId &&
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

              {/* ── 4. Payment Mode ── */}
              <div className="space-y-3">
                <SectionHeader icon={Wallet} label="Payment Mode" />
                <Field label="Mode" required>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_MODES.map((m) => {
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

              {/* NEFT / UPI / RTGS / IMPS */}
              {isDigitalMode && (
                <div className="space-y-3">
                  <SectionHeader icon={Hash} label={`${form.mode} Reference`} />
                  <DigitalRefPanel mode={form.mode} form={form} set={set} />
                </div>
              )}

              {/* ── Save footer ── */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  onClick={cancelForm}
                  className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-60"
                >
                  {saving
                    ? "Saving…"
                    : editingId
                      ? "Update Payment"
                      : "Save Payment"}
                </button>
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
                                setCompanyFilter(e.target.value);
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
                              {projectOptions.map((p) => (
                                <option key={p} value={p}>
                                  {p}
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
                                <option key={y} value={String(y)}>
                                  {y}–{y + 1}
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
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
                          FY {finYearFilter}–{parseInt(finYearFilter) + 1}
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
                        <StatusBadge status={rec.status} />
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
                              refetchPayments();
                            }}
                          />
                          <button
                            onClick={() => openViewRec(rec)}
                            title="View details"
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Eye size={12} />
                          </button>
                          <button
                            onClick={() => openEdit(rec)}
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Edit size={12} />
                          </button>
                          <button
                            onClick={() => setDeleteId(rec.id)}
                            className="p-1.5 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table — compact, no horizontal scroll */}
                <div className="hidden sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[22%]">
                          Payment
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[14%]">
                          Doc No
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[18%]">
                          Expense Ref
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[10%] hidden md:table-cell">
                          Mode
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[12%] hidden lg:table-cell">
                          Cheque / Ref
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[12%]">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[10%] hidden md:table-cell">
                          Bank
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[8%]">
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
                          {/* Payment name + date stacked */}
                          <td className="px-4 py-2.5">
                            <p className="font-heading font-medium text-foreground text-xs truncate max-w-[180px]">
                              {rec.paymentName || "—"}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {rec.date || "—"}
                            </p>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {rec.docNo || "—"}
                            </span>
                          </td>
                          {/* Expense Ref + GRN stacked */}
                          <td className="px-4 py-2.5">
                            {rec.expenseRef ? (
                              <span className="font-mono text-[11px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md block w-fit max-w-[160px] truncate">
                                {rec.expenseRef}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                            <div className="mt-0.5">
                              <PaymentGRNBadges
                                expenseId={rec.expenseId || ""}
                              />
                            </div>
                          </td>
                          {/* Mode */}
                          <td className="px-4 py-2.5 hidden md:table-cell">
                            <ModeBadge mode={rec.mode} />
                          </td>
                          {/* Cheque / Ref */}
                          <td className="px-4 py-2.5 hidden lg:table-cell">
                            {rec.chequeNo ? (
                              <div className="space-y-0.5">
                                <span className="font-mono text-xs bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-md">
                                  # {rec.chequeNo}
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
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </td>
                          {/* Amount */}
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-right whitespace-nowrap">
                            {formatINR(rec.amount ?? 0)}
                          </td>
                          {/* Bank */}
                          <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[100px] truncate hidden md:table-cell">
                            {rec.bankName || "—"}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-2.5">
                            <StatusBadge status={rec.status} />
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1 justify-end">
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
                                  refetchPayments();
                                }}
                              />
                              <button
                                onClick={() => openViewRec(rec)}
                                title="View details"
                                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Eye size={12} />
                              </button>
                              <button
                                onClick={() => openEdit(rec)}
                                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              >
                                <Edit size={12} />
                              </button>
                              <button
                                onClick={() => setDeleteId(rec.id)}
                                className="p-1.5 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
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
      </div>

      {/* Payment detail view modal */}
      {viewingRec && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
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

            {/* Body */}
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
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
                  {viewingChain.netAmount > 0 && (
                    <div className="flex items-center gap-2 pt-1 border-t border-border/60 mt-2">
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Net Payable
                        </p>
                        <p className="font-mono text-xs font-bold text-foreground">
                          {formatINR(viewingChain.netAmount)}
                        </p>
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Total Paid
                        </p>
                        <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          {formatINR(viewingChain.totalPaid)}
                        </p>
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Remaining
                        </p>
                        <p
                          className={`font-mono text-xs font-bold ${viewingChain.remaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {formatINR(viewingChain.remaining)}
                        </p>
                      </div>
                    </div>
                  )}

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
                  { label: "Payment Name", value: viewingRec.paymentName },
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
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
              <button
                onClick={() =>
                  handlePrintPayment(viewingRec, viewingCompanyDetail)
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
              >
                <Printer size={12} /> Print / PDF
              </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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
