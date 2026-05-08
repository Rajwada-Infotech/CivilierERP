import React, { useState, useCallback, useEffect } from "react";
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
  Download,
  FileText,
  FileSpreadsheet,
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
} from "lucide-react";
import { exportToCsv, exportToPdf } from "@/lib/export";
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
  amount?: number;
  companyId?: number | null;
  installmentNo?: number;
  refNumber?: string | null;
  dueDate?: string | null;
  status?: string;
  parentDocNo?: string;
}

interface ExpenseDetail {
  Eid: number;
  EDocNo: string | null;
  EProjectName: string | null;
  ECompanyId: number | null;
  EAmount: number | null;
  ENetAmount: number | null;
  EDocumentType: string | null;
  DocTypeName: string | null;
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
  expenseRef: string;
  expenseId: string;
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
    company: "",
    expenseRef: "",
    expenseId: "",
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
    company: item.PCompany || "",
    expenseRef: item.PExpenseRef || "",
    expenseId: "",
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

function ExportButton({ data }: { data: PaymentRecord[] }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
      >
        <Download size={13} /> Export{" "}
        <ChevronDown
          size={11}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-50 py-1">
          <button
            onClick={() => {
              exportToCsv(data as any, EXPORT_COLUMNS, "payments");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <FileSpreadsheet size={13} /> Export CSV
          </button>
          <button
            onClick={() => {
              exportToPdf(data as any, EXPORT_COLUMNS, {
                title: "Payment Management",
                filename: "payments",
              });
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <FileText size={13} /> Export PDF
          </button>
        </div>
      )}
    </div>
  );
}

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
  const PAGE_SIZE = 20;

  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<PaymentRecord, "id">>(blankForm());
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loadingExpense, setLoadingExpense] = useState(false);
  const [linkedGRNs, setLinkedGRNs] = useState<GRNRef[]>([]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: dbData, isLoading } = useQuery({
    queryKey: ["payments", page],
    queryFn: () => getPayments(page, PAGE_SIZE),
  });

  const { data: banks = [] } = useQuery<BankOption[]>({
    queryKey: ["bank-options-payment"],
    queryFn: fetchBankOptions,
  });

  const { data: expenseOptions = [] } = useQuery<ExpenseOption[]>({
    queryKey: ["expense-options-payment"],
    queryFn: fetchExpenseOptions,
  });

  const dbItems: DbPayment[] = Array.isArray(dbData?.data) ? dbData.data : [];
  const totalPages: number = dbData?.totalPages ?? 1;
  const totalRecords: number = dbData?.total ?? 0;
  const records: PaymentRecord[] = dbItems.map(dbToRecord);

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
    setView("form");
  };

  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm(blankForm());
    setLinkedGRNs([]);
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
          project: "",
          company: "",
          amount: null,
          docType: "",
        }));
        return;
      }

      const selectedOption = expenseOptions.find((o) => o.id === expenseId);
      if (selectedOption?.type === "emi") {
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
          project: selectedOption.projectName || "",
          company: String(selectedOption.companyId ?? ""),
          amount: selectedOption.amount ?? null,
          docType: `EMI-${padded}`,
        }));
        if (selectedOption.expenseBookingId) {
          fetchExpenseGRNs(String(selectedOption.expenseBookingId))
            .then(setLinkedGRNs)
            .catch(() => setLinkedGRNs([]));
        }
        return;
      }

      setLoadingExpense(true);
      try {
        const detail = await fetchExpenseDetail(expenseId);
        if (!detail) throw new Error("Not found");
        setForm((prev) => ({
          ...prev,
          expenseId,
          expenseRef: detail.EDocNo || "",
          project: detail.EProjectName || "",
          company: String(detail.ECompanyId ?? ""),
          amount: detail.ENetAmount ?? detail.EAmount ?? null,
          docType: detail.DocTypeName || detail.EDocumentType || "",
          baseAmount: detail.EAmount ?? null,
          cgstRate: detail.ECgstRate ?? null,
          sgstRate: detail.ESgstRate ?? null,
          igstRate: detail.EIgstRate ?? null,
        }));
        const grns = await fetchExpenseGRNs(expenseId);
        setLinkedGRNs(grns);
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
      PProject: form.project || null,
      PCompany: form.company || null,
      PExpenseRef: form.expenseRef || null,
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
            {view === "list" && <ExportButton data={records} />}
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
                {form.expenseRef ? (
                  <AutoFillBanner
                    docNo={form.expenseRef}
                    onClear={clearExpenseLink}
                  />
                ) : (
                  <ExpenseBookingPicker
                    options={expenseOptions}
                    value={form.expenseId}
                    onChange={handleExpenseSelect}
                    loading={loadingExpense}
                  />
                )}

                {form.expenseRef && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-1">
                    <Field label="Project / Site">
                      <div className="flex items-center gap-2">
                        <FolderKanban
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.project}
                          placeholder="From expense booking"
                        />
                      </div>
                    </Field>
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

              {/* ── 3. Payment Mode ── */}
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

              {/* ── 4. Bank Account ── */}
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
            {isLoading && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading payments…
              </div>
            )}

            {!isLoading && (
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
                            onSuccess={() =>
                              queryClient.invalidateQueries({
                                queryKey: ["payments"],
                                exact: false,
                              })
                            }
                          />
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
                            colSpan={8}
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
                                onSuccess={() =>
                                  queryClient.invalidateQueries({
                                    queryKey: ["payments"],
                                    exact: false,
                                  })
                                }
                              />
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
