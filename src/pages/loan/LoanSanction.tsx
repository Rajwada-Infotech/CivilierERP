import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  FileText,
  Wallet,
  ArrowLeft,
  Eye,
  Trash2,
  CalendarClock,
  History,
  CheckCircle2,
  Circle,
  Building2,
  Clock,
  StickyNote,
  TrendingDown,
  AlertCircle,
  AlertTriangle,
  Percent,
  ChevronDown,
  Scale,
  TrendingUp,
  Landmark,
  Upload,
  FileCheck2,
  Receipt,
  Pencil,
  Save,
  X as XIcon,
  Search,
  Filter,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { MoneyRecive } from "iconsax-react";
import { getCompanyOptions, getBanks, type CompanyOption, type BankRecord } from "@/api/bankMasterApi";
import { CompanyFilterCombo } from "@/components/CompanyFilterCombo";
import { friendlyErrorMessage } from "@/lib/friendlyError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fetchChequeLots, fetchChequeNumbers, deductChequeFromLot } from "@/pages/finance/payment/api";
import { PAYMENT_MODES } from "@/pages/finance/payment/types";
import type { ChequeLot } from "@/pages/finance/payment/types";
import { MODE_STYLE } from "@/pages/finance/payment/constants";
import { BankNamePicker } from "@/components/finance/BankNamePicker";

// A Bank Loan is disbursed by an external bank, not paid out through any of
// our own cash-handling modes — scoped down from the full PAYMENT_MODES
// list (which includes Cash/UPI/Card/IMPS, none of which make sense for a
// bank-to-company loan) to just the modes a bank would actually use.
const LOAN_BANK_PAYMENT_MODES = ["NEFT", "RTGS", "Demand Draft", "Cheque"] as const;
import {
  getLoanSanctions,
  getLoanSchedule,
  createLoanSanction,
  updateLoanSanction,
  deleteLoanSanction,
  getCustomerOptions,
  getCompanyExposure,
  getLoanPayments,
  uploadLoanNoc,
  getLoanDocuments,
  uploadLoanDocument,
  closeLoan,
  type LoanSanction,
  type LoanType,
  type InterestCalcType,
  type CustomerOption,
  type CompanyExposure,
  type LoanPayment,
} from "@/api/loanSanctionApi";

const ACCENT = "#22c55e";
const LOAN_TYPES: LoanType[] = ["Inter-Company", "Bank Loan", "Customer Loan"];

// Common lending benchmarks — shown as quick picks in the dropdown-cum-text
// field, but the field always accepts a typed custom value too.
const STANDARD_INTEREST_RATES = [6, 8, 9, 10, 12, 15, 18];
const STANDARD_TENURES = [3, 6, 12, 18, 24, 36, 48, 60];

// Mirrors backend/routes/loanSanction.js's buildEmiSchedule EMI formula —
// this is only a live estimate shown while filling the form; the real
// schedule is generated server-side on sanction.
function estimateEmi(
  amount: number,
  annualRatePct: number,
  tenureMonths: number,
  interestType: InterestCalcType = "CI",
): number {
  const n = Math.max(1, tenureMonths || 1);
  if (!annualRatePct || annualRatePct <= 0) return amount / n;
  if (interestType === "SI") {
    const totalInterest = amount * (annualRatePct / 100) * (n / 12);
    return amount / n + totalInterest / n;
  }
  const r = annualRatePct / 12 / 100;
  return (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

const EMPTY_FORM = {
  loanType: "Inter-Company" as LoanType,
  loanDocNo: "",
  lenderCompanyId: "",
  // Bank Loan only — the external lending bank's name (free-typed, or
  // picked from the Major/Minor list — same picker Received Payment uses
  // for a customer's bank). Not one of OUR OWN registered bank accounts;
  // the lender can be any bank, whether or not we happen to also have an
  // account there.
  lenderBankName: "",
  // Inter-Company only — which specific bank account of the lender/borrower
  // company the funds moved between (distinct from lenderBankName, which is
  // only for the Bank Loan type where the lender IS an external bank).
  lenderBankAccountId: "",
  // Customer Loan's second direction — "Customer to Company" (a customer
  // lends TO us), mirroring Bank Loan's shape rather than the original
  // "Company to Customer" one. "toCustomer" (the original, default)
  // preserves existing behavior for anyone not touching this toggle.
  customerLoanDirection: "toCustomer" as "toCustomer" | "toCompany",
  lenderCustomerId: "",
  lenderCustomerSource: "AH" as "AH" | "CRM",
  // Descriptive only (which bank the money came from) — same BankNamePicker
  // Received Payment/Bank Loan use; the customer itself gets a real GL head
  // via ensureLoanLedgerHead regardless of which bank they used.
  lenderCustomerBankName: "",
  borrowerCompanyId: "",
  borrowerCustomerId: "",
  borrowerCustomerSource: "AH" as "AH" | "CRM",
  borrowerBankAccountId: "",
  loanDate: new Date().toISOString().slice(0, 10),
  amount: "",
  hasInterest: false,
  interestType: "CI" as InterestCalcType,
  interestRate: "",
  tenureMonths: "",
  // Only used for a no-breakdown loan (Inter-Company simple transfer, no
  // interest/tenure) — the single overall repayment due date.
  dueDate: "",
  purpose: "",
  remarks: "",
  paymentMode: "Cash" as string,
  chequeLotId: "",
  chequeLotNumber: "",
  chequeNo: "",
  chequeDate: "",
  isPostDated: false,
  digitalRefNumber: "",
  // Demand Draft carries its own ref number + date, same as Cheque has
  // chequeNo/chequeDate, rather than sharing the single generic
  // digitalRefNumber field NEFT/RTGS use.
  demandDraftNo: "",
  demandDraftDate: "",
};

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

// What a repayment was actually paid WITH — a Loan EMI is always settled
// through Finance > Payment first (see migration 340's NewPaymentId link),
// which is where mode/cheque/bank/reference are genuinely captured.
// Returns:
//   string  — a human-readable description of the instrument (cheque/NEFT/UPI etc.)
//   null    — PaymentMode is empty even though NewPaymentId is set (not expected)
//   "NOT_ON_FILE" — NewPaymentId is null: this row pre-dates migration 340;
//                   the caller should render "Payment mode not on file" in muted style.
// What the loan's own disbursement was paid WITH (distinct from
// paymentInstrumentLabel below, which is for a repayment) — LoanSanction
// carries its own PaymentMode/ChequeNo directly, no NewPayment link needed.
function sanctionInstrumentLabel(loan: LoanSanction): string | null {
  if (!loan.PaymentMode) return null;
  if (loan.PaymentMode === "Cheque" || loan.PaymentMode === "Post-Dated Cheque") {
    return loan.ChequeNo
      ? `Cheque #${loan.ChequeNo}${loan.ChequeDate ? ` dated ${new Date(loan.ChequeDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}`
      : loan.PaymentMode;
  }
  return loan.DigitalRefNumber ? `${loan.PaymentMode} (Ref: ${loan.DigitalRefNumber})` : loan.PaymentMode;
}

// Same info as sanctionInstrumentLabel, compressed for the list table's
// narrow Status column — "#353123 · 19 Aug" instead of "Cheque #353123
// dated 19 Aug 2026". Truncating the full label there cut off the date
// (the actually useful half) rather than the redundant filler words.
function sanctionInstrumentLabelCompact(loan: LoanSanction): string | null {
  if (!loan.PaymentMode) return null;
  if (loan.PaymentMode === "Cheque" || loan.PaymentMode === "Post-Dated Cheque") {
    if (!loan.ChequeNo) return loan.PaymentMode;
    const date = loan.ChequeDate
      ? new Date(loan.ChequeDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : null;
    return `#${loan.ChequeNo}${date ? ` · ${date}` : ""}`;
  }
  return loan.DigitalRefNumber ? `${loan.PaymentMode} · ${loan.DigitalRefNumber}` : loan.PaymentMode;
}

function paymentInstrumentLabel(p: LoanPayment): string | null | "NOT_ON_FILE" {
  // BUG 3 FIX: distinguish "no NewPaymentId at all" from "has one but mode blank"
  if (p.NewPaymentId == null) return "NOT_ON_FILE";
  if (!p.PaymentMode) return null;
  if (p.PaymentMode === "Cheque" || p.PaymentMode === "Post-Dated Cheque") {
    const chequeInfo = p.ChequeNo ? `Cheque #${p.ChequeNo}${p.ChequeDate ? ` dated ${new Date(p.ChequeDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}${p.BankName ? ` (${p.BankName})` : ""}` : p.PaymentMode;
    return chequeInfo;
  }
  const ref = p.NeftNumber || p.UpiTransactionId || p.RtgsReference || p.ImpsReference;
  if (ref) return `${p.PaymentMode} (Ref: ${ref})${p.BankName ? ` — ${p.BankName}` : ""}`;
  return p.BankName ? `${p.PaymentMode} — ${p.BankName}` : p.PaymentMode;
}

const LOAN_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Loan No", accessor: "LoanNo" },
  { header: "Type", accessor: "LoanType" },
  { header: "Lender", accessor: (r: any) => r.LenderCompanyName || r.LenderBankName || "—" },
  { header: "Borrower", accessor: (r: any) => r.BorrowerCompanyName || r.BorrowerCustomerName || "—" },
  { header: "Loan Date", accessor: (r: any) => fmtDate(r.LoanDate) },
  { header: "Amount", accessor: (r: any) => fmt(r.Amount) },
  { header: "Interest Rate", accessor: (r: any) => (r.HasInterest && r.InterestRate != null ? `${r.InterestRate}%` : "—") },
  { header: "Tenure (Months)", accessor: (r: any) => r.TenureMonths ?? "—" },
  { header: "EMI Progress", accessor: (r: any) => `${r.PaidEMIs ?? 0}/${r.TotalEMIs ?? 0}` },
  { header: "Status", accessor: "Status" },
  { header: "Purpose", accessor: (r: any) => r.Purpose || "—" },
];

const LOAN_TYPE_COLORS: Record<LoanType, string> = {
  "Inter-Company": "#3b82f6",
  "Bank Loan": "#0ea5e9",
  "Customer Loan": "#f59e0b",
};

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 placeholder:text-muted-foreground";
const labelCls = "text-xs font-semibold uppercase tracking-widest text-muted-foreground";

// Cheque Lot / Cheque Number picker for the disbursement's Cheque or
// Post-Dated Cheque mode — same fetchChequeLots/fetchChequeNumbers/
// deductChequeFromLot API Finance > Payment's ChequePanel uses, so a
// cheque picked here is deducted from the same shared lot and can't be
// reused by both flows. LoanSanction has no bank-account column of its
// own for disbursement (only the lender's bank, when the loan type IS a
// bank), so bankId is optional — fetchChequeLots(null) returns every
// active lot when there's nothing to filter by.
function LoanChequePicker({
  bankId,
  chequeLotId,
  chequeNo,
  chequeDate,
  isPostDated,
  onLotChange,
  onChequeNoChange,
  onChequeDateChange,
}: {
  bankId: number | null;
  chequeLotId: string;
  chequeNo: string;
  chequeDate: string;
  isPostDated: boolean;
  onLotChange: (lot: ChequeLot) => void;
  onChequeNoChange: (chequeNo: string) => void;
  onChequeDateChange: (date: string) => void;
}) {
  const [lots, setLots] = useState<ChequeLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [chequeNumbers, setChequeNumbers] = useState<{ number: string; used: boolean; bounced: boolean }[]>([]);
  const [loadingCheques, setLoadingCheques] = useState(false);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    // No bank picked yet — don't fetch at all, let alone show every active
    // lot across every bank. The picker stays hidden until there's an
    // actual bank to scope it to (see the bankId == null render guard).
    if (!bankId) {
      setLots([]);
      return;
    }
    setLoadingLots(true);
    fetchChequeLots(bankId)
      .then((fetched) => {
        setLots(fetched);
        if (fetched.length > 0 && !chequeLotId) onLotChange(fetched[0]);
      })
      .catch(() => setLots([]))
      .finally(() => setLoadingLots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  useEffect(() => {
    const lotIdNum = chequeLotId ? Number(chequeLotId) : null;
    if (!lotIdNum) {
      setChequeNumbers([]);
      return;
    }
    setLoadingCheques(true);
    fetchChequeNumbers(lotIdNum)
      .then(setChequeNumbers)
      .catch(() => setChequeNumbers([]))
      .finally(() => setLoadingCheques(false));
  }, [chequeLotId]);

  const activeLot = lots.find((l) => String(l.CId) === chequeLotId) ?? null;
  const availableCheques = chequeNumbers.filter((c) => !c.used && !c.bounced);

  const handleChequeSelect = async (nextChequeNo: string) => {
    onChequeNoChange(nextChequeNo);
    const lotIdNum = chequeLotId ? Number(chequeLotId) : null;
    if (!nextChequeNo || !lotIdNum) return;
    setValidating(true);
    try {
      await deductChequeFromLot(lotIdNum, nextChequeNo);
    } catch (err: any) {
      toast.error(err.message);
      onChequeNoChange("");
    } finally {
      setValidating(false);
    }
  };

  // Nothing to scope a cheque lot to yet — stay out of the way entirely
  // rather than showing every lot across every bank, or an explanatory
  // "select a bank first" placeholder.
  if (!bankId) return null;

  return (
    <>
      <div className="space-y-2">
        <label className={labelCls}>Cheque Lot</label>
        {loadingLots ? (
          <div className={`${inputCls} flex items-center text-xs text-muted-foreground`}>Loading lots…</div>
        ) : lots.length === 0 ? (
          <div className={`${inputCls} flex items-center text-xs text-amber-600`}>No active cheque lots found.</div>
        ) : (
          <select
            className={inputCls}
            value={chequeLotId}
            onChange={(e) => {
              const lot = lots.find((l) => String(l.CId) === e.target.value);
              if (lot) onLotChange(lot);
            }}
          >
            <option value="">— Select lot —</option>
            {lots.map((lot) => (
              <option key={lot.CId} value={String(lot.CId)}>
                {lot.ChequeLotNumber}
                {lot.RemainingCheques != null ? ` (${lot.RemainingCheques} left)` : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="space-y-2">
        <label className={labelCls}>Cheque Number</label>
        <select
          className={inputCls}
          value={chequeNo}
          onChange={(e) => handleChequeSelect(e.target.value)}
          disabled={!activeLot || loadingCheques || validating}
        >
          <option value="">— Select cheque number —</option>
          {availableCheques.map((c) => (
            <option key={c.number} value={c.number}>
              # {c.number}
            </option>
          ))}
        </select>
        {activeLot && availableCheques.length === 0 && !loadingCheques && (
          <p className="text-[11px] text-amber-600">No available cheques left in this lot.</p>
        )}
      </div>
      <div className="space-y-2">
        <label className={labelCls}>{isPostDated ? "Post-Dated Cheque Date" : "Cheque Date"}</label>
        <input
          type="date"
          className={inputCls}
          value={chequeDate}
          min={isPostDated ? new Date().toISOString().slice(0, 10) : undefined}
          max={isPostDated ? undefined : new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChequeDateChange(e.target.value)}
        />
      </div>
    </>
  );
}

export default function LoanSanctionPage() {
  const qc = useQueryClient();
  usePageRights("loan-sanction");
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [showForm, setShowForm] = useState(false);
  const [viewingLoan, setViewingLoan] = useState<LoanSanction | null>(null);
  const [tab, setTab] = useState<"overview" | "exposure" | "schedule" | "chain" | "posting">("overview");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LoanSanction | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Editing the safe administrative fields on an already-sanctioned loan —
  // deliberately separate from the create form's state — everything here
  // is editable except the parties' identity (loan type, lender/borrower
  // company/bank/customer), which the backend also refuses to touch.
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState({
    loanDocNo: "",
    purpose: "",
    remarks: "",
    lenderBankAccountId: "",
    borrowerBankAccountId: "",
    loanDate: "",
    amount: "",
    hasInterest: false,
    interestType: "CI" as InterestCalcType,
    interestRate: "",
    tenureMonths: "",
    dueDate: "",
  });
  const [savingDetails, setSavingDetails] = useState(false);

  const [uploadingNoc, setUploadingNoc] = useState(false);

  // GL posting — mirrors GRN's Posting tab: fetch the live preview when the
  // tab opens, then auto-post it to the real ledger (dbo.GeneralLedgerEntry)
  // the moment it's not already posted, so the loan actually shows up in
  // Trial Balance instead of only ever being a client-side preview.
  const [loanPostingData, setLoanPostingData] = useState<any | null>(null);
  const [loanPostingLoading, setLoanPostingLoading] = useState(false);
  const [loanPosting, setLoanPosting] = useState(false);
  const [loanPostingError, setLoanPostingError] = useState<string | null>(null);
  const nocInputRef = useRef<HTMLInputElement>(null);

  // Loan document attachment (agreement / sanction letter etc.)
  const [pendingDocumentFile, setPendingDocumentFile] = useState<File | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const documentInputRef = useRef<HTMLInputElement>(null);

  // Explicit loan closure — separate deliberate step from payment recording
  const [closingLoan, setClosingLoan] = useState(false);

  // null = "All companies" — the dashboard default. Picking one just narrows
  // the same list to loans where that company is lender or borrower.
  const [listCompanyId, setListCompanyId] = useState<number | null>(null);

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loan-sanctions", listCompanyId],
    queryFn: () => getLoanSanctions(listCompanyId),
    staleTime: 30_000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["company-options-loan"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60_000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customer-options-loan"],
    queryFn: getCustomerOptions,
    staleTime: 5 * 60_000,
  });

  // Full bank records (with each bank's own company tag) — used to scope
  // the Inter-Company Lender/Borrower Bank A/C pickers to only that party's
  // own banks, instead of every bank in the system.
  const { data: bankRecords = [] } = useQuery({
    queryKey: ["bank-records-loan"],
    queryFn: getBanks,
    staleTime: 5 * 60_000,
  });
  const banksForCompany = (companyLabel: string) =>
    bankRecords.filter(
      (b: BankRecord) => b.BStatus && (b.BCompanyName || "").trim().toLowerCase() === companyLabel.trim().toLowerCase(),
    );

  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["loan-schedule", viewingLoan?.LoanId],
    queryFn: () => getLoanSchedule(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
    staleTime: 30_000,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["loan-payments", viewingLoan?.LoanId],
    queryFn: () => getLoanPayments(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
    staleTime: 30_000,
  });

  const { data: loanDocuments = [] } = useQuery({
    queryKey: ["loan-documents", viewingLoan?.LoanId],
    queryFn: () => getLoanDocuments(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
    staleTime: 30_000,
  });

  // Exposure tab — live lookup of what's already lent/owed by whichever
  // company is currently selected as Lender / Borrower (create mode) or was
  // sanctioned against (view mode).
  const exposureLenderCompanyId = viewingLoan
    ? viewingLoan.LenderCompanyId
    : form.loanType !== "Bank Loan"
      ? form.lenderCompanyId
      : null;
  const exposureBorrowerCompanyId = viewingLoan
    ? viewingLoan.BorrowerCompanyId
    : form.loanType !== "Customer Loan"
      ? form.borrowerCompanyId
      : null;

  const { data: lenderExposure, isLoading: lenderExposureLoading } = useQuery({
    queryKey: ["loan-company-exposure", exposureLenderCompanyId],
    queryFn: () => getCompanyExposure(Number(exposureLenderCompanyId)),
    enabled: !!exposureLenderCompanyId,
  });
  const { data: borrowerExposure, isLoading: borrowerExposureLoading } = useQuery({
    queryKey: ["loan-company-exposure", exposureBorrowerCompanyId],
    queryFn: () => getCompanyExposure(Number(exposureBorrowerCompanyId)),
    enabled: !!exposureBorrowerCompanyId,
  });

  // Deep-link support for the Reminder Bell ("/loan/sanction?view=<id>")
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewId = params.get("view");
    if (viewId && loans.length) {
      const match = loans.find((l) => String(l.LoanId) === viewId);
      if (match) openView(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans]);

  // Fetch live posting data when the Posting tab opens (mirrors GRN.tsx).
  useEffect(() => {
    if (tab !== "posting" || !viewingLoan?.LoanId) return;
    setLoanPostingLoading(true);
    setLoanPostingData(null);
    fetchWithAuth(`/api/loan-sanction/${viewingLoan.LoanId}/posting`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLoanPostingData(d ?? null))
      .catch(() => setLoanPostingData(null))
      .finally(() => setLoanPostingLoading(false));
  }, [tab, viewingLoan?.LoanId]);

  // No auto-post for ANY loan type — disbursement is always a deliberate
  // action now: Inter-Company from Finance > Payment's "Loan Disbursement"
  // picker (POST /:id/post-to-gl), Customer Loan from the same picker
  // (POST /:id/disburse backing a real NewPayment), Bank Loan from
  // Received Payment's "Disburse a Bank Loan" picker (POST /:id/disburse
  // backing a real ReceivedPayment). This used to auto-fire for Bank
  // Loan/Customer Loan the moment anyone opened this tab, silently posting
  // the loan-ledger side with no real bank-side record behind it — see
  // migration 401's writeup for the resulting data-integrity gap it fixed.

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const companyName = (id: string) =>
    companies.find((c: CompanyOption) => String(c.id) === id)?.label ?? "";
  const customerName = (id: string) =>
    customers.find((c: CustomerOption) => String(c.id) === id)?.label ?? "";

  const openCreate = () => {
    setViewingLoan(null);
    setForm(EMPTY_FORM);
    setTab("overview");
    setShowForm(true);
    setPendingDocumentFile(null);
  };

  const openView = (loan: LoanSanction) => {
    setViewingLoan(loan);
    setTab("overview");
    setShowForm(true);
    setEditingDetails(false);
  };

  const openEditDetails = async (loan: LoanSanction) => {
    setViewingLoan(loan);
    setTab("overview");
    setShowForm(true);
    setEditForm({
      loanDocNo: loan.LoanDocNo || "",
      purpose: loan.Purpose || "",
      remarks: loan.Remarks || "",
      lenderBankAccountId: loan.LenderBankAccountId ? String(loan.LenderBankAccountId) : "",
      borrowerBankAccountId: loan.BorrowerBankAccountId ? String(loan.BorrowerBankAccountId) : "",
      loanDate: loan.LoanDate ? loan.LoanDate.slice(0, 10) : "",
      amount: loan.Amount != null ? String(loan.Amount) : "",
      hasInterest: loan.HasInterest !== false,
      interestType: (loan.InterestType as InterestCalcType) || "CI",
      interestRate: loan.InterestRate != null ? String(loan.InterestRate) : "",
      tenureMonths: loan.TenureMonths != null ? String(loan.TenureMonths) : "",
      dueDate: "",
    });
    setEditingDetails(true);
    // No-breakdown loans (Inter-Company simple transfer) keep their due
    // date on the single EMI row rather than the loan itself — pull it in
    // for the edit form so it isn't blank.
    if (loan.LoanType === "Inter-Company" && loan.HasInterest === false) {
      try {
        const sched = await getLoanSchedule(loan.LoanId);
        if (sched.length === 1) {
          setEditForm((f) => ({ ...f, dueDate: sched[0].DueDate.slice(0, 10) }));
        }
      } catch {
        // non-fatal — the field just stays blank
      }
    }
  };

  const handleSaveDetails = async () => {
    if (!viewingLoan) return;
    setSavingDetails(true);
    try {
      const isInterCompany = viewingLoan.LoanType === "Inter-Company";
      await updateLoanSanction(viewingLoan.LoanId, {
        loanDocNo: editForm.loanDocNo || null,
        purpose: editForm.purpose || null,
        remarks: editForm.remarks || null,
        lenderBankAccountId: editForm.lenderBankAccountId || null,
        borrowerBankAccountId: editForm.borrowerBankAccountId || null,
        // Financial-core fields are only sent when repayment hasn't started
        // yet — the backend treats their mere presence in the body as "the
        // caller wants to touch the financial core" and 409s once any EMI
        // is paid, so admin-only edits after that point must omit them
        // entirely rather than resend the unchanged (disabled) values.
        ...(paidEmis === 0
          ? {
              loanDate: editForm.loanDate,
              amount: editForm.amount,
              hasInterest: editForm.hasInterest,
              interestType: editForm.interestType,
              interestRate: editForm.hasInterest ? editForm.interestRate || null : null,
              tenureMonths: editForm.tenureMonths || null,
              dueDate: isInterCompany && !editForm.hasInterest ? editForm.dueDate || null : null,
            }
          : {}),
      });
      toast.success("Loan details updated");
      setEditingDetails(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["loan-sanctions"] }),
        qc.invalidateQueries({ queryKey: ["loan-schedule", viewingLoan.LoanId] }),
        qc.invalidateQueries({ queryKey: ["loan-payments", viewingLoan.LoanId] }),
      ]);
      const fresh = await getLoanSanctions(listCompanyId);
      const updated = fresh.find((l) => l.LoanId === viewingLoan.LoanId);
      if (updated) setViewingLoan(updated);
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not update loan details"));
    } finally {
      setSavingDetails(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setViewingLoan(null);
    setEditingDetails(false);
  };

  // Explicit loan closure — called only when the user deliberately clicks
  // "Close Loan". Backend validates all EMIs are paid and total paid >= schedule.
  const handleCloseLoan = async () => {
    if (!viewingLoan) return;
    setClosingLoan(true);
    try {
      const result = await closeLoan(viewingLoan.LoanId);
      toast.success(result.message || `Loan ${viewingLoan.LoanNo} has been closed.`);
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      const fresh = await getLoanSanctions(listCompanyId);
      const updated = fresh.find((l) => l.LoanId === viewingLoan.LoanId);
      if (updated) setViewingLoan(updated);
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not close loan"));
    } finally {
      setClosingLoan(false);
    }
  };

  const handleSave = async () => {
    const isCustomerLoan = form.loanType === "Customer Loan";
    const isBankLoan = form.loanType === "Bank Loan";
    const isCustomerToCompany = isCustomerLoan && form.customerLoanDirection === "toCompany";
    const isExternalLenderLoan = isBankLoan || isCustomerToCompany;
    if (isBankLoan && !form.lenderBankName.trim()) return toast.error("Select or enter the lender bank");
    if (isCustomerToCompany && !form.lenderCustomerId) return toast.error("Select the lender customer");
    if (!isBankLoan && !isCustomerToCompany && !form.lenderCompanyId) return toast.error("Select the lender company");
    if (isCustomerLoan && !isCustomerToCompany && !form.borrowerCustomerId) return toast.error("Select the borrower customer");
    if ((!isCustomerLoan || isCustomerToCompany) && !form.borrowerCompanyId) return toast.error("Select the borrower company");
    if (!form.loanDate) return toast.error("Loan date is required");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter a valid amount");

    setSaving(true);
    try {
      const res = await createLoanSanction({
        loanType: form.loanType,
        loanDocNo: form.loanDocNo || null,
        lenderCompanyId: (isBankLoan || isCustomerToCompany) ? null : form.lenderCompanyId,
        lenderBankName: isBankLoan ? form.lenderBankName.trim() : null,
        lenderCustomerId: isCustomerToCompany ? form.lenderCustomerId : null,
        lenderCustomerSource: isCustomerToCompany ? form.lenderCustomerSource : null,
        lenderCustomerBankName: isCustomerToCompany ? form.lenderCustomerBankName.trim() || null : null,
        lenderBankAccountId: (isInterCompanyType || (isCustomerLoan && !isCustomerToCompany)) ? form.lenderBankAccountId || null : null,
        borrowerCompanyId: (isCustomerLoan && !isCustomerToCompany) ? null : form.borrowerCompanyId,
        borrowerCustomerId: (isCustomerLoan && !isCustomerToCompany) ? form.borrowerCustomerId : null,
        borrowerCustomerSource: (isCustomerLoan && !isCustomerToCompany) ? form.borrowerCustomerSource : null,
        borrowerBankAccountId: (isInterCompanyType || isExternalLenderLoan) ? form.borrowerBankAccountId || null : null,
        loanDate: form.loanDate,
        amount: form.amount,
        hasInterest: form.hasInterest,
        interestType: form.interestType,
        interestRate: form.hasInterest ? form.interestRate || null : null,
        tenureMonths: form.tenureMonths || null,
        dueDate: isInterCompanyType && !form.hasInterest ? form.dueDate || null : null,
        purpose: form.purpose || null,
        remarks: form.remarks || null,
        paymentMode: form.paymentMode || null,
        chequeLotId: form.chequeLotId || null,
        chequeLotNumber: form.chequeLotNumber || null,
        chequeNo: form.chequeNo || null,
        chequeDate: form.chequeDate || null,
        isPostDated: form.isPostDated,
        digitalRefNumber: form.digitalRefNumber || null,
        demandDraftNo: form.demandDraftNo || null,
        demandDraftDate: form.demandDraftDate || null,
      });
      toast.success(`Loan ${res.loanNo} sanctioned`);
      if (res.glError) {
        toast.error(res.glError);
      }
      if (pendingDocumentFile) {
        try {
          await uploadLoanDocument(res.loanId, pendingDocumentFile);
          toast.success("Document attached");
        } catch (docErr: any) {
          toast.error(`Loan sanctioned, but the document could not be attached: ${docErr.message}. Attach it from the loan's detail view.`);
        }
      }
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      closeForm();
    } catch (e: any) {
      toast.error(e.message ?? "Could not sanction this loan");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadNoc = async (file: File) => {
    if (!viewingLoan) return;
    setUploadingNoc(true);
    try {
      await uploadLoanNoc(viewingLoan.LoanId, file);
      toast.success("NOC uploaded — available in Records module");
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      const fresh = await getLoanSanctions(listCompanyId);
      const updated = fresh.find((l) => l.LoanId === viewingLoan.LoanId);
      if (updated) setViewingLoan(updated);
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not upload NOC"));
    } finally {
      setUploadingNoc(false);
      if (nocInputRef.current) nocInputRef.current.value = "";
    }
  };

  const handleUploadDocument = async (file: File) => {
    if (!viewingLoan) return;
    setUploadingDocument(true);
    try {
      await uploadLoanDocument(viewingLoan.LoanId, file);
      toast.success("Document uploaded — available in Records module");
      await qc.invalidateQueries({ queryKey: ["loan-documents", viewingLoan.LoanId] });
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not upload document"));
    } finally {
      setUploadingDocument(false);
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLoanSanction(deleteTarget.LoanId);
      toast.success(`Loan ${deleteTarget.LoanNo} deleted`);
      setDeleteTarget(null);
      if (viewingLoan?.LoanId === deleteTarget.LoanId) closeForm();
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
    } catch (e) {
      toast.error(
        friendlyErrorMessage(e, "Couldn't delete this loan. Please try again."),
      );
    } finally {
      setDeleting(false);
    }
  };

  const columns: ColumnDef<LoanSanction, unknown>[] = [
    {
      id: "loanNo",
      header: "Loan No",
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium text-foreground">{row.original.LoanNo}</span>
      ),
    },
    {
      id: "loanType",
      header: "Type",
      cell: ({ row }) => {
        const c = LOAN_TYPE_COLORS[row.original.LoanType];
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: `${c}18`, color: c }}>
            {row.original.LoanType}
          </span>
        );
      },
    },
    {
      id: "lender",
      header: "Lender",
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.LenderCompanyName || row.original.LenderBankName || "—"}
        </span>
      ),
    },
    {
      id: "borrower",
      header: "Borrower",
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.BorrowerCompanyName || row.original.BorrowerCustomerName || "—"}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <span className="font-medium text-foreground">{fmt(row.original.Amount)}</span>,
    },
    {
      id: "emi",
      header: "EMI Progress",
      cell: ({ row }) => {
        const total = row.original.TotalEMIs ?? 0;
        const paid = row.original.PaidEMIs ?? 0;
        const pct = total ? Math.round((paid / total) * 100) : 0;
        return (
          <div className="flex items-center gap-2 w-28">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {paid}/{total}
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const closed = row.original.Status === "Closed";
        // Same three real states as the detail modal's header pill
        // (Closed / Paid / Sanctioned) — this cell used to show the
        // literal text "Sanctioned" specifically when Status==="Closed",
        // inverted from what it should say (row.original.Status IS
        // already "Sanctioned" or "Closed", so that ternary was both
        // redundant and backwards).
        const fullyPaid = (row.original.TotalEMIs ?? 0) > 0 && row.original.PaidEMIs === row.original.TotalEMIs;
        const label = closed ? "Closed" : fullyPaid ? "Paid" : "Sanctioned";
        const dotColor = closed ? "bg-slate-400" : fullyPaid ? "bg-emerald-500" : "bg-blue-500";
        const textColor = closed
          ? "text-slate-600 dark:text-slate-400"
          : fullyPaid
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-blue-600 dark:text-blue-400";
        const instrument = sanctionInstrumentLabelCompact(row.original);
        const instrumentFull = sanctionInstrumentLabel(row.original);
        return (
          <div className="flex flex-col gap-0.5">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${textColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${dotColor}`} />
              {label}
            </span>
            {instrument && (
              <span
                title={instrumentFull ?? undefined}
                className="inline-block w-fit whitespace-nowrap text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full"
              >
                {instrument}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openView(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={() => openEditDetails(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Edit details"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setDeleteTarget(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  const readOnly = !!viewingLoan;
  const isInterCompanyType = (viewingLoan?.LoanType ?? form.loanType) === "Inter-Company";
  // Combined create+edit flag, same shape as isInterCompanyType — a
  // Customer Loan's lender bank account matters too (it's who actually
  // receives the repayment), just never the borrower's, since the borrower
  // is external and has no bank account of ours to tag.
  const isCustomerLoanType = (viewingLoan?.LoanType ?? form.loanType) === "Customer Loan";
  // Same view-aware pattern for Bank Loan — read-only display (the Parties
  // labels, GL posting help text) must reflect the loan actually being
  // VIEWED, not whatever form.loanType happens to still hold from the last
  // time the create form was open (it doesn't reset when opening a view).
  const isBankLoanType = (viewingLoan?.LoanType ?? form.loanType) === "Bank Loan";
  const isCustomerLoan = form.loanType === "Customer Loan";
  const isBankLoan = form.loanType === "Bank Loan";
  // Customer Loan's "Customer to Company" direction (migration 402) — a
  // customer as LENDER instead of borrower, same shape as Bank Loan. View
  // mode infers direction from the loaded loan's own LenderCustomerId
  // (can't rely on form.customerLoanDirection there — it doesn't reset for
  // a loaded view the way viewingLoan's own fields do), same pattern
  // isBankLoanType already uses for viewingLoan?.LoanType.
  const isCustomerToCompany = isCustomerLoan && form.customerLoanDirection === "toCompany";
  const isCustomerToCompanyType = isCustomerLoanType && !!(viewingLoan ? viewingLoan.LenderCustomerId : isCustomerToCompany);
  // Bank Loan and Customer-to-Company are the same shape end to end — an
  // external lender, us as borrower, money coming in — so every place that
  // branches on isBankLoan for payment mode / cheque handling / GL posting
  // help text also needs Customer-to-Company. One combined flag instead of
  // repeating "isBankLoan || isCustomerToCompany" everywhere.
  const isExternalLenderLoan = isBankLoan || isCustomerToCompany;

  const displayLender = readOnly
    ? viewingLoan?.LenderCompanyName ?? viewingLoan?.LenderBankName ?? viewingLoan?.LenderCustomerName ?? ""
    : isBankLoan
      ? form.lenderBankName
      : isCustomerToCompany
        ? customerName(form.lenderCustomerId)
        : companyName(form.lenderCompanyId);
  const displayBorrower = readOnly
    ? viewingLoan?.BorrowerCompanyName ?? viewingLoan?.BorrowerCustomerName ?? ""
    : isCustomerLoan && !isCustomerToCompany
      ? customerName(form.borrowerCustomerId)
      : companyName(form.borrowerCompanyId);
  const displayAmount = readOnly ? viewingLoan?.Amount ?? null : Number(form.amount) || null;
  const displayHasInterest = readOnly ? viewingLoan?.HasInterest !== false : form.hasInterest;
  const displayInterestType = readOnly ? viewingLoan?.InterestType ?? "CI" : form.interestType;
  const estimatedEmi = estimateEmi(
    Number(form.amount) || 0,
    form.hasInterest ? Number(form.interestRate) || 0 : 0,
    Number(form.tenureMonths) || 1,
    form.interestType,
  );
  const estimatedTotalRepayable = estimatedEmi * (Number(form.tenureMonths) || 1);
  const estimatedTotalInterest = Math.max(0, estimatedTotalRepayable - (Number(form.amount) || 0));

  const chequeByPaymentId = new Map(
    payments
      .filter((p: any) => p.ChequeNo)
      .map((p: any) => [p.PaymentId, { chequeNo: p.ChequeNo, chequeDate: p.ChequeDate }]),
  );
  const totalEmis = schedule.length;
  const paidEmis = schedule.filter((e) => e.IsPaid).length;
  // BUG 8 FIX: paidAmount from actual LoanPayment records (authoritative) when
  // they exist. Falls back to summing IsPaid EMI rows for loans whose repayments
  // pre-date the LoanPayment table — those old rows won't appear in payments[]
  // at all, so we must use the EMI schedule to avoid wrongly showing ₹0 paid.
  // A loan with no EMI schedule at all (a simple Inter-Company transfer,
  // no interest/tenure) has schedule.length === 0, so summing it gives 0 —
  // which made outstandingAmount always compute to 0 regardless of whether
  // anything was actually paid, since Math.max(0, 0 - paid) is 0 either
  // way. Falls back to the loan's own Amount as the target when there's no
  // schedule to sum against.
  const totalScheduledAmount = schedule.length > 0
    ? schedule.reduce((s, e) => s + Number(e.EMIAmount), 0)
    : Number(displayAmount ?? 0);
  const paidAmount = payments.length > 0
    ? payments.reduce((s, p) => s + Number(p.PrincipalInterestAmount), 0)
    : schedule.filter((e) => e.IsPaid).reduce((s, e) => s + Number(e.EMIAmount), 0);
  const outstandingAmount = Math.max(0, Math.round((totalScheduledAmount - paidAmount) * 100) / 100);
  const nextDue = schedule.find((e) => !e.IsPaid) ?? null;

  const tabs: { id: typeof tab; label: string; icon: typeof FileText }[] = [
    { id: "overview", label: "Overview", icon: FileText },
    { id: "exposure", label: "Exposure", icon: Scale },
    { id: "schedule", label: "EMI Schedule", icon: CalendarClock },
    { id: "chain", label: "Repayment History", icon: History },
    { id: "posting", label: "Posting", icon: Wallet },
  ];

  return (
    <GlassShell
      title="Loan Sanction"
      subtitle="Sanction inter-company, bank and customer loans"
      icon={MoneyRecive as any}
      accentColor={ACCENT}
      action={
        !showForm ? (
          <div className="flex items-center gap-2">
            <ExportMenu
              data={loans as unknown as Record<string, unknown>[]}
              columns={LOAN_EXPORT_COLUMNS}
              title="Loan Sanction"
              filename="loan-sanctions"
              disabled={isLoading || !loans.length}
            />
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-emerald-500 via-green-500 to-lime-500 transition-all"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">New Loan</span>
            </button>
          </div>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Loan", path: "/loan" }, { label: "Loan Sanction" }]} />

      {!showForm && (
        <div
          className="rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-3"
          style={{
            background: isDark ? "rgba(15,17,26,0.4)" : "rgba(248,250,252,0.72)",
            border: isDark ? "1px solid rgba(34,197,94,0.14)" : "1px solid rgba(34,197,94,0.14)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
              style={{ background: "rgba(34,197,94,0.15)" }}
            >
              <Filter size={12} style={{ color: ACCENT }} />
            </div>
            <span className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
              Filter loans
            </span>
          </div>

          <CompanyFilterCombo companies={companies} value={listCompanyId} onChange={setListCompanyId} />

          {listCompanyId != null && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              {companies.find((c) => c.id === listCompanyId)?.label ?? "1 company"}
              <button
                type="button"
                onClick={() => setListCompanyId(null)}
                className="text-emerald-600/60 dark:text-emerald-400/60 hover:text-destructive transition-colors"
              >
                <XIcon size={9} />
              </button>
            </span>
          )}

          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            <span className="font-heading font-semibold text-foreground tabular-nums">{loans.length}</span>
            <span>{loans.length === 1 ? "loan" : "loans"}</span>
          </div>
        </div>
      )}

      {!showForm ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <DataTable
            columns={columns}
            data={loans}
            loading={isLoading}
            emptyMessage={listCompanyId ? "No loans sanctioned yet for this company. Click 'New Loan' to get started." : "No loans sanctioned yet. Click 'New Loan' to get started."}
          />
        </div>
      ) : (
        <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
          {/* Header */}
          <div className="relative overflow-hidden flex items-center justify-between gap-3 px-6 sm:px-8 py-5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={closeForm}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft size={15} />
                <span className="hidden sm:inline">Back</span>
              </button>
              <span className="text-emerald-500/40">|</span>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
                  <MoneyRecive size={12} className="text-emerald-500" />
                </div>
                <h2 className="text-sm font-heading font-bold text-foreground truncate">
                  {viewingLoan ? `Loan ${viewingLoan.LoanNo}` : "Sanction New Loan"}
                </h2>
                {viewingLoan && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                    style={{
                      background: `${LOAN_TYPE_COLORS[viewingLoan.LoanType]}18`,
                      color: LOAN_TYPE_COLORS[viewingLoan.LoanType],
                    }}
                  >
                    {viewingLoan.LoanType}
                  </span>
                )}
                {/* BUG 9 FIX: perspective badge — tells the user which direction
                    the money flowed from OUR company's point of view.
                    Customer Loan (Company to Customer, the original
                      direction) → we are the lender → "Loan Given"
                    Customer Loan (Customer to Company, migration 402) and
                    Bank Loan → we are the borrower → "Loan Received"
                    Inter-Company → could be either; show both party labels */}
                {viewingLoan && viewingLoan.LoanType === "Customer Loan" && !viewingLoan.LenderCustomerId && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    <TrendingUp size={9} /> Loan Given
                  </span>
                )}
                {viewingLoan && (viewingLoan.LoanType === "Bank Loan" || (viewingLoan.LoanType === "Customer Loan" && !!viewingLoan.LenderCustomerId)) && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-purple-500/15 text-purple-600 dark:text-purple-400">
                    <TrendingDown size={9} /> Loan Received
                  </span>
                )}
                {/* Lifecycle badge — three real states, not just Sanctioned
                    vs Closed: a loan can be Sanctioned (still repaying),
                    fully repaid but not yet formally closed ("Paid" — see
                    the matching "Fully repaid" text on the Repayment
                    History tab), or Closed (NOC issued). This used to show
                    a "Sanctioned" label specifically when Status==="Closed",
                    inverted from what it should say. */}
                {viewingLoan && viewingLoan.Status === "Closed" && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-slate-500/15 text-slate-600 dark:text-slate-400">
                    <FileCheck2 size={10} /> Closed
                  </span>
                )}
                {viewingLoan && viewingLoan.Status !== "Closed" && totalEmis > 0 && paidEmis === totalEmis && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={10} /> Paid
                  </span>
                )}
                {viewingLoan && viewingLoan.Status !== "Closed" && !(totalEmis > 0 && paidEmis === totalEmis) && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    <MoneyRecive size={10} /> Sanctioned
                  </span>
                )}
                {viewingLoan && viewingLoan.Status !== "Closed" && nextDue && (
                  <span
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                      new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                        ? "bg-red-500/15 text-red-600 dark:text-red-400"
                        : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    <Clock size={10} />
                    Due {fmtDate(nextDue.DueDate)}
                    {new Date(nextDue.DueDate) < new Date(new Date().toDateString()) ? " · OVERDUE" : ""}
                  </span>
                )}
              </div>
            </div>
            {viewingLoan && (
              <div className="flex items-center gap-2 shrink-0">
                {!editingDetails && (
                  <button
                    type="button"
                    onClick={() => openEditDetails(viewingLoan)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(viewingLoan)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex flex-wrap items-center gap-0.5 sm:gap-1 px-2 sm:px-8 pt-2 border-b border-border bg-card">
            {tabs.map((t) => {
              const disabled = !viewingLoan && (t.id === "schedule" || t.id === "chain");
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-5 py-2.5 sm:py-3.5 text-[11px] sm:text-xs font-semibold rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                    disabled
                      ? "opacity-40 cursor-not-allowed border-transparent text-muted-foreground"
                      : tab === t.id
                        ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  <t.icon size={12} />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="p-7 sm:p-8 space-y-8">
            {/* Overview tab — General + Loan Details merged into one clean view */}
            {tab === "overview" && (
              <div className="space-y-8">
                {!readOnly && (
                  <>
                    <div className="space-y-2">
                      <label className={labelCls}>Loan Type <span className="text-red-500">*</span></label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {LOAN_TYPES.map((lt) => (
                          <button
                            key={lt}
                            type="button"
                            onClick={() => {
                              set("loanType", lt);
                              // Inter-Company defaults to a simple transfer —
                              // interest & tenure only apply once explicitly toggled on.
                              if (lt === "Inter-Company") {
                                set("hasInterest", false);
                              } else if (form.loanType === "Inter-Company") {
                                set("hasInterest", true);
                              }
                              // Bank Loan's payment mode is scoped to
                              // LOAN_BANK_PAYMENT_MODES (NEFT/RTGS/Demand
                              // Draft/Cheque) — "Cash" (the form's overall
                              // default) isn't one of them, so switching
                              // into Bank Loan without resetting would leave
                              // every mode button unselected. Customer Loan
                              // only needs the same reset once its
                              // direction toggle (below) picks "Customer to
                              // Company" — handled there, not here.
                              if (lt === "Bank Loan" && !(LOAN_BANK_PAYMENT_MODES as readonly string[]).includes(form.paymentMode)) {
                                set("paymentMode", "NEFT");
                              }
                            }}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              form.loanType === lt
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "border-border text-muted-foreground hover:bg-muted/40"
                            }`}
                          >
                            {lt}
                          </button>
                        ))}
                      </div>
                    </div>
                    {form.loanType === "Customer Loan" && (
                      <div className="space-y-2">
                        <label className={labelCls}>Direction</label>
                        <div className="grid grid-cols-2 gap-3">
                          {(
                            [
                              { key: "toCustomer", label: "Company → Customer", hint: "We lend to the customer" },
                              { key: "toCompany", label: "Customer → Company", hint: "The customer lends to us" },
                            ] as const
                          ).map((d) => (
                            <button
                              key={d.key}
                              type="button"
                              onClick={() => {
                                set("customerLoanDirection", d.key);
                                if (d.key === "toCompany" && !(LOAN_BANK_PAYMENT_MODES as readonly string[]).includes(form.paymentMode)) {
                                  set("paymentMode", "NEFT");
                                }
                              }}
                              className={`px-3 py-2 rounded-lg text-left text-sm font-medium border transition-colors ${
                                form.customerLoanDirection === d.key
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "border-border text-muted-foreground hover:bg-muted/40"
                              }`}
                            >
                              <span className="block">{d.label}</span>
                              <span className="block text-[11px] font-normal opacity-75">{d.hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className={labelCls}>Loan Doc No.</label>
                      <div className="flex items-center gap-2">
                        <input
                          className={inputCls}
                          placeholder="e.g. an external reference or agreement number"
                          value={form.loanDocNo}
                          onChange={(e) => set("loanDocNo", e.target.value)}
                        />
                        <input
                          ref={documentInputRef}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) setPendingDocumentFile(f);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => documentInputRef.current?.click()}
                          title="Attach loan document (agreement, sanction letter etc.)"
                          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                            pendingDocumentFile
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-border text-muted-foreground hover:bg-muted/40"
                          }`}
                        >
                          <Upload size={12} />
                          {pendingDocumentFile ? "Attached" : "Attach"}
                        </button>
                      </div>
                      {pendingDocumentFile && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <FileText size={11} /> {pendingDocumentFile.name}
                          <button
                            type="button"
                            onClick={() => setPendingDocumentFile(null)}
                            className="text-muted-foreground hover:text-destructive underline underline-offset-2"
                          >
                            remove
                          </button>
                        </p>
                      )}
                    </div>
                  </>
                )}

                {readOnly ? (
                  <>
                    {editingDetails && (
                      <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4 space-y-4">
                        <SectionLabel icon={Pencil} label="Edit Loan Details" />
                        {paidEmis > 0 && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 -mt-2">
                            <AlertTriangle size={11} /> This loan already has repayments recorded — amount, interest, tenure and dates are locked. Only Loan Doc No, Purpose, Remarks, and bank A/C tags can be edited.
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className={labelCls}>Loan Doc No.</label>
                            <input
                              className={inputCls}
                              value={editForm.loanDocNo}
                              onChange={(e) => setEditForm((f) => ({ ...f, loanDocNo: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className={labelCls}>Loan Date</label>
                            <input
                              type="date"
                              className={inputCls}
                              disabled={paidEmis > 0}
                              value={editForm.loanDate}
                              onChange={(e) => setEditForm((f) => ({ ...f, loanDate: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className={labelCls}>Amount</label>
                            <input
                              type="number"
                              className={inputCls}
                              disabled={paidEmis > 0}
                              value={editForm.amount}
                              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className={labelCls}>Tenure (months)</label>
                            <input
                              type="number"
                              className={inputCls}
                              disabled={paidEmis > 0}
                              value={editForm.tenureMonths}
                              onChange={(e) => setEditForm((f) => ({ ...f, tenureMonths: e.target.value.replace(/[^0-9]/g, "") }))}
                            />
                          </div>
                          <div className="space-y-1.5 col-span-2 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
                            <span className="text-sm font-medium text-foreground">Interest-bearing loan</span>
                            <button
                              type="button"
                              disabled={paidEmis > 0}
                              onClick={() => setEditForm((f) => ({ ...f, hasInterest: !f.hasInterest }))}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                                editForm.hasInterest ? "bg-emerald-500" : "bg-muted"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                                  editForm.hasInterest ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </div>
                          {editForm.hasInterest && (
                            <div className="space-y-1.5">
                              <label className={labelCls}>Interest Rate (% p.a.)</label>
                              <input
                                type="number"
                                className={inputCls}
                                disabled={paidEmis > 0}
                                value={editForm.interestRate}
                                onChange={(e) => setEditForm((f) => ({ ...f, interestRate: e.target.value.replace(/[^0-9.]/g, "") }))}
                              />
                            </div>
                          )}
                          {isInterCompanyType && !editForm.hasInterest && (
                            <div className="space-y-1.5">
                              <label className={labelCls}>Repayment Due Date</label>
                              <input
                                type="date"
                                className={inputCls}
                                disabled={paidEmis > 0}
                                value={editForm.dueDate}
                                min={editForm.loanDate || undefined}
                                onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                              />
                            </div>
                          )}
                          {(isInterCompanyType || isCustomerLoanType) && (
                            <>
                              <div className="space-y-1.5">
                                <label className={labelCls}>Lender Bank A/C</label>
                                <select
                                  className={inputCls}
                                  value={editForm.lenderBankAccountId}
                                  onChange={(e) => setEditForm((f) => ({ ...f, lenderBankAccountId: e.target.value }))}
                                >
                                  <option value="">— No bank A/C tag —</option>
                                  {banksForCompany(viewingLoan?.LenderCompanyName || "").map((b: BankRecord) => (
                                    <option key={b.BId} value={b.BId}>{b.BName}</option>
                                  ))}
                                </select>
                              </div>
                              {/* Borrower Bank A/C only applies to
                                  Inter-Company — a Customer Loan's borrower
                                  is external, with no bank account of ours
                                  to tag. */}
                              {isInterCompanyType && (
                                <div className="space-y-1.5">
                                  <label className={labelCls}>Borrower Bank A/C</label>
                                  <select
                                    className={inputCls}
                                    value={editForm.borrowerBankAccountId}
                                    onChange={(e) => setEditForm((f) => ({ ...f, borrowerBankAccountId: e.target.value }))}
                                  >
                                    <option value="">— No bank A/C tag —</option>
                                    {banksForCompany(viewingLoan?.BorrowerCompanyName || "").map((b: BankRecord) => (
                                      <option key={b.BId} value={b.BId}>{b.BName}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </>
                          )}
                          <div className="space-y-1.5 col-span-2">
                            <label className={labelCls}>Purpose</label>
                            <input
                              className={inputCls}
                              value={editForm.purpose}
                              onChange={(e) => setEditForm((f) => ({ ...f, purpose: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5 col-span-2">
                            <label className={labelCls}>Remarks</label>
                            <input
                              className={inputCls}
                              value={editForm.remarks}
                              onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingDetails(false)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
                          >
                            <XIcon size={12} /> Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveDetails}
                            disabled={savingDetails}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                          >
                            <Save size={12} /> {savingDetails ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Parties */}
                    <SectionLabel icon={Building2} label="Parties" />
                    <div className="grid grid-cols-2 gap-3">
                      <InfoCard
                        label={isBankLoanType ? "Lender (Bank)" : isCustomerToCompanyType ? "Lender (Customer)" : "Lender"}
                        value={displayLender || "—"}
                      />
                      <InfoCard
                        label={isCustomerLoanType && !isCustomerToCompanyType ? "Borrower (Customer)" : "Borrower (Company)"}
                        value={displayBorrower || "—"}
                      />
                      {isInterCompanyType && (
                        <>
                          <InfoCard label="Lender Bank A/C" value={viewingLoan?.LenderBankAccountName || "—"} />
                          <InfoCard label="Borrower Bank A/C" value={viewingLoan?.BorrowerBankAccountName || "—"} />
                        </>
                      )}
                    </div>

                    {/* Terms */}
                    <SectionLabel icon={MoneyRecive as any} label="Loan Terms" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <InfoCard label="Amount" value={fmt(displayAmount)} accent />
                      <InfoCard label="Loan Date" value={fmtDate(viewingLoan?.LoanDate)} />
                      <InfoCard label="Loan Doc No." value={viewingLoan?.LoanDocNo || "—"} />
                      <InfoCard
                        label="Tenure"
                        value={viewingLoan?.TenureMonths != null ? `${viewingLoan.TenureMonths} months` : "—"}
                      />
                      <InfoCard
                        label="Interest"
                        value={
                          displayHasInterest
                            ? `${viewingLoan?.InterestRate ?? "—"}% p.a. (${displayInterestType === "SI" ? "Simple" : "Compound"})`
                            : "Interest-free"
                        }
                      />
                      <InfoCard
                        label="Total Interest"
                        value={fmt(schedule.reduce((s, e) => s + Number(e.InterestComponent), 0))}
                      />
                      <InfoCard
                        label="Total Repayable"
                        value={fmt(schedule.reduce((s, e) => s + Number(e.EMIAmount), 0))}
                        accent
                      />
                      {viewingLoan?.PaymentMode && (
                        <InfoCard
                          label="Disbursed Via"
                          value={
                            viewingLoan.PaymentMode === "Cheque" || viewingLoan.PaymentMode === "Post-Dated Cheque"
                              ? `${viewingLoan.PaymentMode} #${viewingLoan.ChequeNo || "—"}${viewingLoan.ChequeDate ? ` (${fmtDate(viewingLoan.ChequeDate)})` : ""}`
                              : ["Cash"].includes(viewingLoan.PaymentMode)
                                ? viewingLoan.PaymentMode
                                : `${viewingLoan.PaymentMode} (Ref: ${viewingLoan.DigitalRefNumber || "—"})`
                          }
                        />
                      )}
                    </div>

                    {/* Repayment Status — live financial state of the loan.
                        Shows how much has been paid, what's outstanding, and
                        the EMI progress at a glance without switching tabs. */}
                    {schedule.length > 0 && (
                      <>
                        <SectionLabel icon={Receipt} label="Repayment Status" />
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <InfoCard
                            label="Amount Paid"
                            value={fmt(paidAmount)}
                            accent={paidAmount > 0}
                          />
                          <InfoCard
                            label="Outstanding"
                            value={fmt(outstandingAmount)}
                            accent={outstandingAmount > 0}
                          />
                          <InfoCard
                            label="EMIs Paid"
                            value={totalEmis ? `${paidEmis} / ${totalEmis}` : "—"}
                          />
                          <InfoCard
                            label="Next Due"
                            value={
                              viewingLoan?.Status === "Closed"
                                ? "Closed ✓"
                                : nextDue
                                  ? `${fmt(nextDue.EMIAmount)} on ${fmtDate(nextDue.DueDate)}`
                                  : totalEmis > 0
                                    ? "All paid"
                                    : "—"
                            }
                          />
                        </div>
                        {/* Amount progress bar */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>Repayment progress</span>
                            <span>
                              {totalScheduledAmount > 0
                                ? `${Math.min(100, Math.round((paidAmount / totalScheduledAmount) * 100))}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-500"
                              style={{
                                width: `${totalScheduledAmount > 0
                                  ? Math.min(100, (paidAmount / totalScheduledAmount) * 100)
                                  : 0}%`,
                              }}
                            />
                          </div>
                          {nextDue && viewingLoan?.Status !== "Closed" && (
                            <p className={`text-[11px] flex items-center gap-1 ${
                              new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                                ? "text-red-600 dark:text-red-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}>
                              <AlertCircle size={11} />
                              {new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                                ? `Next EMI overdue — ${fmt(nextDue.EMIAmount)} was due ${fmtDate(nextDue.DueDate)}`
                                : `Next EMI: ${fmt(nextDue.EMIAmount)} due ${fmtDate(nextDue.DueDate)}`}
                            </p>
                          )}
                        </div>
                        {/* Close Loan CTA — shown only when all EMIs are paid
                            and loan is still Sanctioned (not yet formally closed).
                            The backend double-checks this before closing. */}
                        {viewingLoan?.Status !== "Closed" && (totalEmis === 0 || paidEmis === totalEmis) && outstandingAmount <= 0 && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 flex items-center justify-between gap-4">
                            <div className="space-y-0.5">
                              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                All installments paid — ready to close
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Formally closing the loan updates its status, records the closure date,
                                and enables NOC upload. This step requires your confirmation.
                              </p>
                            </div>
                            <button
                              onClick={handleCloseLoan}
                              disabled={closingLoan}
                              className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
                            >
                              <CheckCircle2 size={14} />
                              {closingLoan ? "Closing…" : "Close Loan"}
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {/* Documents — the agreement/sanction letter attached against Loan Doc No. */}
                    <SectionLabel icon={FileText} label="Documents" />
                    <div className="space-y-2">
                      {loanDocuments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No documents attached yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {loanDocuments.map((d) => (
                            <a
                              key={d.AttachmentId}
                              href={`/api/loan-sanction/document/${d.AttachmentId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/40 transition-colors"
                            >
                              <FileText size={12} className="text-muted-foreground shrink-0" />
                              <span className="flex-1 truncate font-medium text-foreground">{d.FileName}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{d.DocType}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <input
                        ref={documentInputRef}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadDocument(f);
                        }}
                      />
                      <button
                        type="button"
                        disabled={uploadingDocument}
                        onClick={() => documentInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
                      >
                        <Upload size={12} /> {uploadingDocument ? "Uploading…" : "Attach Document"}
                      </button>
                    </div>

                    {(viewingLoan?.Purpose || viewingLoan?.Remarks) && (
                      <>
                        <SectionLabel icon={StickyNote} label="Notes" />
                        <div className="grid grid-cols-2 gap-3">
                          <InfoCard label="Purpose" value={viewingLoan?.Purpose || "—"} />
                          <InfoCard label="Remarks" value={viewingLoan?.Remarks || "—"} />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <label className={labelCls}>
                          Lender {isBankLoan ? "Bank" : isCustomerToCompany ? "Customer" : "Company"} <span className="text-red-500">*</span>
                        </label>
                        {isBankLoan ? (
                          // Any bank the loan is actually from — not
                          // restricted to one of our own registered
                          // company-linked bank accounts (those are a
                          // different thing entirely: where WE bank, not
                          // who lent US money). Same Major/Minor bank
                          // picker Received Payment uses for a customer's
                          // bank, since this is exactly the same kind of
                          // field — a bank identified by name only.
                          <BankNamePicker
                            value={form.lenderBankName}
                            onChange={(v) => set("lenderBankName", v)}
                            placeholder="Select the lending bank…"
                            otherPlaceholder="Lending bank's name"
                            className={inputCls}
                          />
                        ) : isCustomerToCompany ? (
                          <CustomerComboField
                            customers={customers as CustomerOption[]}
                            value={form.lenderCustomerId}
                            onChange={(id, source) => {
                              set("lenderCustomerId", id);
                              setForm((f) => ({ ...f, lenderCustomerSource: source }));
                            }}
                            inputClassName={inputCls}
                          />
                        ) : (
                          <select
                            className={inputCls}
                            value={form.lenderCompanyId}
                            onChange={(e) => {
                              set("lenderCompanyId", e.target.value);
                              // A bank A/C picked for the previous company no
                              // longer applies once the company changes.
                              set("lenderBankAccountId", "");
                            }}
                          >
                            <option value="">— Select —</option>
                            {companies.map((c: CompanyOption) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {/* Which bank the customer actually sent the money
                          from — descriptive only (same role as Bank Loan's
                          own lender-bank field), not itself a GL account. */}
                      {isCustomerToCompany && (
                        <div className="space-y-2">
                          <label className={labelCls}>Customer's Bank</label>
                          <BankNamePicker
                            value={form.lenderCustomerBankName}
                            onChange={(v) => set("lenderCustomerBankName", v)}
                            placeholder="Select the customer's bank…"
                            otherPlaceholder="Customer's bank name"
                            className={inputCls}
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <label className={labelCls}>Borrower {isCustomerLoan && !isCustomerToCompany ? "Customer" : "Company"} <span className="text-red-500">*</span></label>
                        {isCustomerLoan && !isCustomerToCompany ? (
                          <CustomerComboField
                            customers={customers as CustomerOption[]}
                            value={form.borrowerCustomerId}
                            onChange={(id, source) => {
                              set("borrowerCustomerId", id);
                              setForm((f) => ({ ...f, borrowerCustomerSource: source }));
                            }}
                            inputClassName={inputCls}
                          />
                        ) : (
                          <select
                            className={inputCls}
                            value={form.borrowerCompanyId}
                            onChange={(e) => {
                              set("borrowerCompanyId", e.target.value);
                              set("borrowerBankAccountId", "");
                            }}
                          >
                            <option value="">— Select —</option>
                            {companies.map((c: CompanyOption) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Lender Bank A/C — which of the lender COMPANY's own
                          bank accounts the funds left from. Only meaningful
                          when the lender actually is one of our companies
                          (Inter-Company, or Customer Loan's original
                          Company-to-Customer direction) — Bank Loan's lender
                          is external (own field above), and Customer-to-
                          Company's lender is a customer, neither has a bank
                          account of ours to tag here. */}
                      {(isInterCompanyType || (isCustomerLoan && !isCustomerToCompany)) && (
                        <div className="space-y-2">
                          <label className={labelCls}>Lender Bank A/C</label>
                          <select
                            className={inputCls}
                            value={form.lenderBankAccountId}
                            onChange={(e) => set("lenderBankAccountId", e.target.value)}
                            disabled={!form.lenderCompanyId}
                          >
                            <option value="">— Select —</option>
                            {banksForCompany(companyName(form.lenderCompanyId)).map((b: BankRecord) => (
                              <option key={b.BId} value={b.BId}>
                                {b.BName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {/* Borrower Bank A/C — which of the borrower COMPANY's
                          own bank accounts receives the funds. Applies to
                          Inter-Company AND every "external lender, we're
                          the borrower" shape (Bank Loan, Customer-to-
                          Company) — the original Customer Loan direction's
                          borrower is external and has no bank account of
                          ours to tag. */}
                      {(isInterCompanyType || isExternalLenderLoan) && (
                        <div className="space-y-2">
                          <label className={labelCls}>Borrower Bank A/C</label>
                          <select
                            className={inputCls}
                            value={form.borrowerBankAccountId}
                            onChange={(e) => set("borrowerBankAccountId", e.target.value)}
                            disabled={!form.borrowerCompanyId}
                          >
                            <option value="">— Select —</option>
                            {banksForCompany(companyName(form.borrowerCompanyId)).map((b: BankRecord) => (
                              <option key={b.BId} value={b.BId}>
                                {b.BName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className={labelCls}>Loan Date <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          className={inputCls}
                          value={form.loanDate}
                          onChange={(e) => set("loanDate", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelCls}>Amount <span className="text-red-500">*</span></label>
                        <input
                          type="number"
                          className={inputCls}
                          placeholder="0.00"
                          value={form.amount}
                          onChange={(e) => set("amount", e.target.value)}
                        />
                      </div>
                      {isInterCompanyType && !form.hasInterest && (
                        <div className="space-y-2">
                          <label className={labelCls}>Repayment Due Date</label>
                          <input
                            type="date"
                            className={inputCls}
                            value={form.dueDate}
                            min={form.loanDate || undefined}
                            onChange={(e) => set("dueDate", e.target.value)}
                          />
                          <p className="text-[11px] text-muted-foreground">
                            No EMIs — whole amount due back on this date.
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {isInterCompanyType ? "Activate Interest & Tenure" : "Interest-bearing loan"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isInterCompanyType
                            ? "Off = a simple transfer with no schedule; on = structured with interest and a repayment tenure"
                            : "Turn off for an interest-free loan"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => set("hasInterest", !form.hasInterest)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                          form.hasInterest ? "bg-emerald-500" : "bg-muted"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                            form.hasInterest ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>

                    {(!isInterCompanyType || form.hasInterest) && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {form.hasInterest && (
                          <div className="space-y-2">
                            <label className={labelCls}>Interest Rate (% p.a.)</label>
                            <ComboField
                              value={form.interestRate}
                              onChange={(v) => set("interestRate", v.replace(/[^0-9.]/g, ""))}
                              options={STANDARD_INTEREST_RATES.map((r) => ({ value: String(r), label: `${r}% p.a.` }))}
                              placeholder="Select or type a rate"
                              inputClassName={inputCls}
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <label className={labelCls}>Tenure (months)</label>
                          <ComboField
                            value={form.tenureMonths}
                            onChange={(v) => set("tenureMonths", v.replace(/[^0-9]/g, ""))}
                            options={STANDARD_TENURES.map((t) => ({ value: String(t), label: `${t} months` }))}
                            placeholder="Select or type a tenure"
                            inputClassName={inputCls}
                          />
                        </div>
                      </div>
                    )}
                    {(form.interestRate || form.tenureMonths) && form.amount && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Percent size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <p className="text-xs text-muted-foreground">
                            Estimated EMI:{" "}
                            <span className="font-semibold text-foreground">{fmt(estimatedEmi)}</span> / month for{" "}
                            {form.tenureMonths || 1} month{Number(form.tenureMonths) === 1 ? "" : "s"}
                            {form.hasInterest && form.interestRate ? ` at ${form.interestRate}% p.a.` : " (flat, no interest)"}.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-emerald-500/15">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              Total Interest
                            </p>
                            <p className="text-sm font-semibold text-foreground">{fmt(estimatedTotalInterest)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              Total Repayable
                            </p>
                            <p className="text-sm font-semibold text-foreground">{fmt(estimatedTotalRepayable)}</p>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Full installment-by-installment breakdown is generated on sanctioning.
                        </p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className={labelCls}>Payment Mode</label>
                      <div className="flex flex-wrap gap-2">
                        {(isExternalLenderLoan ? LOAN_BANK_PAYMENT_MODES : PAYMENT_MODES).map((m) => {
                          const s = MODE_STYLE[m] ?? { ring: "ring-border bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" };
                          const active = form.paymentMode === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                set("paymentMode", m);
                                set("isPostDated", m === "Post-Dated Cheque");
                                if (m !== "Cheque" && m !== "Post-Dated Cheque") {
                                  set("chequeLotId", "");
                                  set("chequeLotNumber", "");
                                  set("chequeNo", "");
                                  set("chequeDate", "");
                                }
                                // Demand Draft gets its own ref+date pair
                                // below, not the shared Reference Number
                                // field NEFT/RTGS/UPI use.
                                if (["Cash", "Cheque", "Post-Dated Cheque", "Demand Draft"].includes(m)) {
                                  set("digitalRefNumber", "");
                                }
                                if (m !== "Demand Draft") {
                                  set("demandDraftNo", "");
                                  set("demandDraftDate", "");
                                }
                              }}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold border transition-all ring-1 ${
                                active
                                  ? `${s.ring} ${s.text} border-transparent shadow-sm`
                                  : "bg-background border-border text-muted-foreground ring-transparent hover:border-primary/40"
                              }`}
                            >
                              {active && <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />}
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {(() => {
                      const isChequeMode = form.paymentMode === "Cheque" || form.paymentMode === "Post-Dated Cheque";
                      const isDemandDraftMode = form.paymentMode === "Demand Draft";
                      // Inter-Company/Customer Loan (Company-to-Customer
                      // direction) only: the lender company's own tagged
                      // bank A/C (which bank the funds actually left from)
                      // — cheque lots are scoped to that specific bank, not
                      // shown at all until it's picked. Bank Loan and
                      // Customer-to-Company's cheque doesn't come from any
                      // lot of ours at all (see the isExternalLenderLoan
                      // branch below) — the external party issues it, not us.
                      const chequeLotBankId = isExternalLenderLoan
                        ? null
                        : (form.lenderBankAccountId ? Number(form.lenderBankAccountId) : null);
                      // Nothing to show for Cash, and (for Inter-Company/
                      // Customer Loan) nothing to show for Cheque mode
                      // until a bank is actually picked — skip the grid
                      // entirely rather than leaving an empty gap. Bank
                      // Loan/Customer-to-Company's cheque fields don't need
                      // a bank picked first (they're free-typed), so this
                      // guard doesn't apply to them.
                      if (form.paymentMode === "Cash" || (isChequeMode && !isExternalLenderLoan && !chequeLotBankId)) return null;
                      return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {isChequeMode && isExternalLenderLoan && (
                        // A cheque disbursed BY an external bank/customer
                        // isn't drawn from any cheque lot of ours —
                        // free-typed fields, same as the Reference Number
                        // field below handles NEFT/RTGS.
                        <>
                          <div className="space-y-2">
                            <label className={labelCls}>Cheque Number</label>
                            <input
                              className={inputCls}
                              placeholder="Cheque number"
                              value={form.chequeNo}
                              onChange={(e) => set("chequeNo", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className={labelCls}>Cheque Date</label>
                            <input
                              type="date"
                              className={inputCls}
                              value={form.chequeDate}
                              onChange={(e) => set("chequeDate", e.target.value)}
                            />
                          </div>
                        </>
                      )}
                      {isChequeMode && !isExternalLenderLoan && (
                        <LoanChequePicker
                          bankId={chequeLotBankId}
                          chequeLotId={form.chequeLotId}
                          chequeNo={form.chequeNo}
                          chequeDate={form.chequeDate}
                          isPostDated={form.isPostDated}
                          onLotChange={(lot) => {
                            set("chequeLotId", String(lot.CId));
                            set("chequeLotNumber", lot.ChequeLotNumber);
                            set("chequeNo", "");
                          }}
                          onChequeNoChange={(v) => set("chequeNo", v)}
                          onChequeDateChange={(v) => set("chequeDate", v)}
                        />
                      )}

                      {/* Demand Draft carries its own ref number + date,
                          same as Cheque has a number + date, rather than
                          sharing the single generic Reference Number field
                          NEFT/RTGS use below. */}
                      {isDemandDraftMode && (
                        <>
                          <div className="space-y-2">
                            <label className={labelCls}>DD Reference Number</label>
                            <input
                              className={inputCls}
                              placeholder="Demand Draft number"
                              value={form.demandDraftNo}
                              onChange={(e) => set("demandDraftNo", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className={labelCls}>DD Date</label>
                            <input
                              type="date"
                              className={inputCls}
                              value={form.demandDraftDate}
                              onChange={(e) => set("demandDraftDate", e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      {!isChequeMode && !isDemandDraftMode && (
                        <div className="space-y-2">
                          <label className={labelCls}>Reference Number</label>
                          <input
                            className={inputCls}
                            placeholder="UTR / Ref No"
                            value={form.digitalRefNumber}
                            onChange={(e) => set("digitalRefNumber", e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                      );
                    })()}
                    <div className="grid grid-cols-2 gap-5 mt-5">
                      <div className="space-y-2">
                        <label className={labelCls}>Purpose</label>
                        <input
                          className={inputCls}
                          placeholder="e.g. Working capital support"
                          value={form.purpose}
                          onChange={(e) => set("purpose", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelCls}>Remarks</label>
                        <input
                          className={inputCls}
                          placeholder="Optional notes…"
                          value={form.remarks}
                          onChange={(e) => set("remarks", e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Exposure tab — live lender/borrower lookup: how much a company
                has already lent out (+ any EMI due to them), and how much a
                company already owes (+ their next due EMI). Updates live as
                the Lender/Borrower Company is picked in Overview. */}
            {tab === "exposure" && (
              <div className="space-y-6">
                {!exposureLenderCompanyId && !exposureBorrowerCompanyId ? (
                  <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                    Select a Lender and/or Borrower Company in Overview to see their loan exposure here.
                  </div>
                ) : (
                  <>
                    {exposureLenderCompanyId && (
                      <div className="space-y-3">
                        <SectionLabel icon={TrendingUp} label={`${displayLender || "Lender"} — as Lender`} />
                        {lenderExposureLoading ? (
                          <p className="text-xs text-muted-foreground">Loading…</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <InfoCard label="Total Lent (all loans)" value={fmt(lenderExposure?.asLender.totalLent ?? 0)} accent />
                            <InfoCard label="Currently Outstanding" value={fmt(lenderExposure?.asLender.totalOutstanding ?? 0)} />
                            <InfoCard
                              label="Next EMI Receivable"
                              value={
                                lenderExposure?.asLender.nextDue
                                  ? `${fmt(lenderExposure.asLender.nextDue.EMIAmount)} on ${fmtDate(lenderExposure.asLender.nextDue.DueDate)}`
                                  : "None due"
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {exposureBorrowerCompanyId && (
                      <div className="space-y-3">
                        <SectionLabel icon={TrendingDown} label={`${displayBorrower || "Borrower"} — as Borrower`} />
                        {borrowerExposureLoading ? (
                          <p className="text-xs text-muted-foreground">Loading…</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <InfoCard label="Total Borrowed (all loans)" value={fmt(borrowerExposure?.asBorrower.totalBorrowed ?? 0)} accent />
                            <InfoCard label="Currently Owed" value={fmt(borrowerExposure?.asBorrower.totalOutstanding ?? 0)} />
                            <InfoCard
                              label="Next EMI Payable"
                              value={
                                borrowerExposure?.asBorrower.nextDue
                                  ? `${fmt(borrowerExposure.asBorrower.nextDue.EMIAmount)} on ${fmtDate(borrowerExposure.asBorrower.nextDue.DueDate)}`
                                  : "None due"
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* EMI Schedule tab — the full repayment PLAN (all installments, editable) */}
            {tab === "schedule" && viewingLoan && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatTile icon={CalendarClock} label="Installments" value={`${paidEmis}/${totalEmis}`} accent="#3b82f6" />
                  <StatTile icon={CheckCircle2} label="Paid" value={fmt(paidAmount)} accent="#22c55e" />
                  <StatTile icon={TrendingDown} label="Outstanding" value={fmt(outstandingAmount)} accent="#f59e0b" />
                  <StatTile
                    icon={Clock}
                    label="Next Due"
                    value={nextDue ? fmtDate(nextDue.DueDate) : "All settled"}
                    accent={nextDue ? "#ef4444" : "#22c55e"}
                  />
                </div>

                {viewingLoan.Status !== "Closed" && (
                  <div className="rounded-xl border border-border bg-muted/10 p-3.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Wallet size={13} className="shrink-0" />
                    EMIs are paid from the <span className="font-semibold text-foreground">Finance → Payment</span> page (Loan EMIs tab) — this view is read-only.
                  </div>
                )}

                <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <th className="text-left px-3 py-2.5">#</th>
                        <th className="text-left px-3 py-2.5">Due Date</th>
                        <th className="text-right px-3 py-2.5">Principal</th>
                        <th className="text-right px-3 py-2.5">Interest</th>
                        <th className="text-right px-3 py-2.5">EMI Amount</th>
                        <th className="text-left px-3 py-2.5">Cheque No.</th>
                        <th className="text-center px-3 py-2.5">Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {scheduleLoading ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">
                            Loading…
                          </td>
                        </tr>
                      ) : schedule.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">
                            No EMI installments for this loan.
                          </td>
                        </tr>
                      ) : (
                        schedule.map((emi) => {
                          const isNext = nextDue?.EMIId === emi.EMIId;
                          const isOverdue = !emi.IsPaid && new Date(emi.DueDate) < new Date(new Date().toDateString());
                          return (
                            <tr
                              key={emi.EMIId}
                              className={
                                emi.IsPaid ? "bg-emerald-500/5" : isNext ? "bg-amber-500/5" : undefined
                              }
                            >
                              <td className="px-3 py-2.5 text-muted-foreground">{emi.InstallmentNo}</td>
                              <td className="px-3 py-2.5">
                                <span className="flex items-center gap-1.5">
                                  {fmtDate(emi.DueDate)}
                                  {isNext && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                      NEXT
                                    </span>
                                  )}
                                  {isOverdue && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400">
                                      OVERDUE
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono">{fmt(emi.PrincipalComponent)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                {fmt(emi.InterestComponent)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-medium">{fmt(emi.EMIAmount)}</td>
                              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                                {chequeByPaymentId.get(emi.PaymentId)?.chequeNo ?? "—"}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {emi.IsPaid ? (
                                  <CheckCircle2 size={15} className="text-emerald-500 inline-block" />
                                ) : (
                                  <Circle size={15} className="text-muted-foreground/40 inline-block" />
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {viewingLoan.Status === "Closed" && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <FileCheck2 size={16} className="text-emerald-500 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">Loan fully repaid and closed</p>
                        <p className="text-[11px] text-muted-foreground">
                          {viewingLoan.NOCFileName
                            ? `NOC on file: ${viewingLoan.NOCFileName}`
                            : "Upload the No Objection Certificate (NOC) once received."}
                        </p>
                      </div>
                    </div>
                    {viewingLoan.NOCFileName ? (
                      <a
                        href={`/api/loan-sanction/noc/${viewingLoan.NOCAttachmentId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted/40 transition-colors"
                      >
                        <FileText size={12} /> View NOC
                      </a>
                    ) : (
                      <>
                        <input
                          ref={nocInputRef}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadNoc(f);
                          }}
                        />
                        <button
                          type="button"
                          disabled={uploadingNoc}
                          onClick={() => nocInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
                        >
                          <Upload size={12} /> {uploadingNoc ? "Uploading…" : "Upload NOC"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Repayment History tab — narrative HISTORY: what's actually happened so far */}
            {tab === "chain" && viewingLoan && (
              <div className="space-y-5">
                {/* Progress bar */}
                <div className="rounded-xl border border-border p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Repayment Progress</span>
                    <span className="text-muted-foreground">
                      {totalEmis ? `${paidEmis} of ${totalEmis} installments paid` : "No EMI schedule"}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all"
                      style={{ width: `${totalEmis ? (paidEmis / totalEmis) * 100 : 0}%` }}
                    />
                  </div>
                  {nextDue ? (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 pt-1">
                      <AlertCircle size={12} />
                      Next EMI ({fmt(nextDue.EMIAmount)}) due {fmtDate(nextDue.DueDate)}
                    </div>
                  ) : totalEmis > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 pt-1">
                      <CheckCircle2 size={12} />
                      Fully repaid
                    </div>
                  ) : null}
                </div>

                {/* Event timeline — repayments only (money coming BACK from
                    the borrower/lender). Disbursement (money going OUT) is
                    not a repayment and belongs on Overview's "Disbursed Via"
                    card instead — showing it here as the chain's first node
                    used to make an outgoing loan read as if it were itself
                    the first incoming repayment. */}
                <div>
                  {payments.map((p, i, arr) => (
                    <ChainNode
                      key={p.PaymentId}
                      icon={<Receipt size={13} className="text-emerald-500" />}
                      title={`${p.PaymentType === "LumpSum" ? "Lump Sum Payment" : `${p.EmisCovered} EMI${p.EmisCovered === 1 ? "" : "s"} Paid`} — ${p.PaymentRef}`}
                      subtitle={(() => {
                        const instrLabel = paymentInstrumentLabel(p);
                        const instrPart = instrLabel === "NOT_ON_FILE"
                          ? " · Payment mode not on file"
                          : instrLabel
                            ? ` · ${instrLabel}`
                            : "";
                        const docNoPart = p.PaymentDocNo ? ` · Finance ref: ${p.PaymentDocNo}` : "";
                        return `${fmt(p.TotalAmount)}${p.LateFee > 0 ? ` (incl. ${fmt(p.LateFee)} late fee)` : ""} · Paid ${fmtDate(p.PaymentDate)}${instrPart}${docNoPart}${p.CreatedBy ? ` by ${p.CreatedBy}` : ""}${p.ExcessCredited > 0 ? ` · ${fmt(p.ExcessCredited)} excess credited to lender's on-account` : ""}${p.ClosedLoan && viewingLoan.Status !== "Closed" ? " · All installments settled" : ""}`;
                      })()}
                      done
                      isLast={i === arr.length - 1 && viewingLoan.Status === "Closed"}
                    />
                  ))}
                  {/* EMIs can be marked paid (IsPaid=1 on LoanEMISchedule)
                      with no matching dbo.LoanPayment row — pre-dates the
                      Payment-page-only repayment flow, or was set directly
                      rather than through it. Surfacing this honestly (with
                      whatever PaidDate is on file) instead of either hiding
                      it or showing the contradictory "No payments yet" next
                      to a progress bar that's clearly already moved. */}
                  {payments.length === 0 && paidEmis > 0 && (
                    <ChainNode
                      icon={<Receipt size={13} className="text-amber-500" />}
                      title={`${paidEmis} installment${paidEmis === 1 ? "" : "s"} marked paid`}
                      subtitle={`Payment details not on record for ${paidEmis === 1 ? "this installment" : "these installments"} — recorded before the repayment system was updated.${schedule.find((e) => e.IsPaid)?.PaidDate ? ` Earliest paid: ${fmtDate(schedule.find((e) => e.IsPaid)!.PaidDate!)}.` : ""}`}
                      done
                      isLast={viewingLoan.Status !== "Closed"}
                    />
                  )}
                  {viewingLoan.Status === "Closed" && (
                    <ChainNode
                      icon={<FileCheck2 size={13} className="text-emerald-500" />}
                      title="Loan Fully Repaid — Closed"
                      subtitle={
                        viewingLoan.NOCFileName
                          ? `NOC on file: ${viewingLoan.NOCFileName}`
                          : viewingLoan.ClosedAt
                            ? `Closed ${fmtDate(viewingLoan.ClosedAt)} — NOC not yet uploaded`
                            : "NOC not yet uploaded"
                      }
                      done
                      isLast
                    />
                  )}
                  {viewingLoan.Status !== "Closed" && payments.length === 0 && paidEmis === 0 && (
                    <ChainNode
                      icon={<Circle size={13} className="text-amber-500" />}
                      title="No payments yet"
                      subtitle="Pay from Finance → Payment (Loan EMIs tab) — an installment or a lump sum."
                      done={false}
                      isLast
                    />
                  )}
                </div>

                {/* Close Loan CTA in Repayment History tab — same logic as in
                    Overview: show only when all EMIs paid and loan still open */}
                {viewingLoan.Status !== "Closed" && (totalEmis === 0 || paidEmis === totalEmis) && outstandingAmount <= 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        All installments paid — ready to close
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Click to formally close this loan, record the closure date, and unlock NOC upload.
                      </p>
                    </div>
                    <button
                      onClick={handleCloseLoan}
                      disabled={closingLoan}
                      className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
                    >
                      <CheckCircle2 size={14} />
                      {closingLoan ? "Closing…" : "Close Loan"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Posting tab */}
            {tab === "posting" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Wallet size={14} className="text-emerald-600" />
                    <span className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                      Journal Entry — Loan Posting
                    </span>
                  </div>
                  {readOnly && (
                    loanPostingLoading ? (
                      <span className="text-[10px] text-muted-foreground">Loading…</span>
                    ) : loanPostingData?.isPosted ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <CheckCircle2 size={10} /> Posted · {loanPostingData.jvNo || viewingLoan?.LoanNo}
                      </span>
                    ) : loanPosting ? (
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-2.5 h-2.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        Posting…
                      </span>
                    ) : loanPostingError ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20">
                        <AlertCircle size={10} /> {loanPostingError}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        <AlertCircle size={10} /> Not disbursed
                      </span>
                    )
                  )}
                </div>
                {readOnly && (loanPostingData?.postings?.length ?? 0) > 1 ? (
                  // Inter-Company: two separate company-scoped entries were
                  // actually posted (see POST / in loanSanction.js) — show
                  // each company's own books as its own card, same Dr/Cr
                  // layout as the invoice Payment page's own Posting tab
                  // (Payment.tsx "GL Postings — Full Payment Chain"), rather
                  // than the plain single-JV table below (which only
                  // applies when there's just one posting, i.e. Bank/
                  // Customer loans).
                  <div className="space-y-4">
                    {loanPostingData.postings.map((p: any, i: number) => (
                      <PostingCard key={p.companyId ?? i} p={p} />
                    ))}
                  </div>
                ) : (() => {
                  // Same debit/credit grid + colored side-dot styling as
                  // GRN's Posting tab (GRN.tsx "Journal Entry — GRN
                  // Posting"), instead of a plain <table> — kept visually
                  // identical across the app's posting views.
                  const gridCols = "grid-cols-[minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,2.2fr)_1.2fr_1fr_1fr]";
                  const borrowerGroup = readOnly
                    ? viewingLoan?.BorrowerGroupName
                      ? `${viewingLoan.BorrowerParentGroupName ? `${viewingLoan.BorrowerParentGroupName} / ` : ""}${viewingLoan.BorrowerGroupName}`
                      : "—"
                    : "Loans and Advances";
                  const lenderGroup = readOnly
                    ? viewingLoan?.LenderGroupName
                      ? `${viewingLoan.LenderParentGroupName ? `${viewingLoan.LenderParentGroupName} / ` : ""}${viewingLoan.LenderGroupName}`
                      : "—"
                    : isBankLoan
                      ? "Bank's own account group"
                      : "Loans and Advances";
                  return (
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className={`grid ${gridCols} bg-muted/40 border-b border-border px-2 sm:px-4 py-2.5 text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground font-semibold gap-1 sm:gap-2`}>
                        <span>Account</span>
                        <span>Account Group</span>
                        <span className="text-right">Debit (₹)</span>
                        <span className="text-right">Credit (₹)</span>
                      </div>
                      <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-border/50 items-center gap-1 sm:gap-2`}>
                        <div className="flex items-center gap-2 min-w-0 pl-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500" />
                          <span className="text-[11px] sm:text-xs text-foreground break-words sm:truncate min-w-0">
                            Loan — {displayBorrower || "Borrower"}
                            {readOnly && viewingLoan?.BorrowerLHeadCode && ` (${viewingLoan.BorrowerLHeadCode})`}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground truncate">{borrowerGroup}</span>
                        <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">{fmt(displayAmount)}</span>
                        <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400" />
                      </div>
                      <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-border/50 items-center gap-1 sm:gap-2`}>
                        <div className="flex items-center gap-2 min-w-0 pl-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-500" />
                          <span className="text-[11px] sm:text-xs text-foreground break-words sm:truncate min-w-0">
                            Loan — {displayLender || "Lender"}
                            {readOnly && viewingLoan?.LenderLHeadCode && ` (${viewingLoan.LenderLHeadCode})`}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground truncate">{lenderGroup}</span>
                        <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400" />
                        <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">{fmt(displayAmount)}</span>
                      </div>
                      <div className={`grid ${gridCols} px-2 sm:px-4 py-3 bg-muted/30 border-t-2 border-border text-xs font-bold gap-1 sm:gap-2`}>
                        <span className="uppercase tracking-widest text-muted-foreground text-[10px]">Total</span>
                        <span />
                        <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmt(displayAmount)}</span>
                        <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmt(displayAmount)}</span>
                      </div>
                    </div>
                  );
                })()}

                <p className="text-xs text-muted-foreground">
                  All postings use system-generated GL accounts, auto-created per counterparty on first use.
                </p>

                {/* Posted / posting / error status banner — same layout as
                    GRN's Posting tab status banner. */}
                {readOnly && !loanPostingLoading && (
                  loanPostingData?.isPosted ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                      <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        Posted to General Ledger as <span className="font-semibold">{loanPostingData.jvNo || viewingLoan?.LoanNo}</span>. Entries are visible in the Trial Balance.
                      </p>
                    </div>
                  ) : loanPostingError ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                      <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                      <p className="text-xs text-destructive">Auto-posting failed: {loanPostingError}</p>
                    </div>
                  ) : loanPosting ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 px-4 py-3">
                      <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">Posting to General Ledger…</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                      <AlertCircle size={13} className="text-amber-600 flex-shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {viewingLoan?.LoanType === "Bank Loan"
                          ? <>Not yet disbursed — go to Finance &gt; Received Payment's "Disburse a Bank Loan" picker to record it.</>
                          : <>Not yet disbursed — go to Finance &gt; Payment's "Loan Disbursement" picker to record it.</>}
                      </p>
                    </div>
                  )
                )}
                {!readOnly && (
                  <p className="text-xs text-muted-foreground">Save the loan to generate this posting.</p>
                )}

                {/* Repayment postings — each repayment (see POST /:id/pay)
                    posts its own reversing two-sided entry; list them below
                    the sanction entry the same way Payment.tsx lists every
                    transaction in an invoice's "Full Payment Chain", instead
                    of only ever showing the one-off sanction posting. */}
                {readOnly && (loanPostingData?.repaymentPostings?.length ?? 0) > 0 && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-2">
                      <Receipt size={14} className="text-emerald-600" />
                      <span className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                        Repayment Postings
                      </span>
                    </div>
                    {loanPostingData.repaymentPostings.map((rp: any) => (
                      <div key={rp.paymentId} className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                          <span className="font-mono">{rp.paymentRef}</span>
                          <span>·</span>
                          <span>{fmtDate(rp.paymentDate)}</span>
                          <span>·</span>
                          <span>{rp.paymentType === "LumpSum" ? "Lump Sum" : "EMI"}</span>
                          <span>·</span>
                          <span className="font-mono">{fmt(rp.amount)}</span>
                        </div>
                        <div className="space-y-4">
                          {rp.postings.map((p: any, i: number) => (
                            <PostingCard key={p.companyId ?? i} p={p} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="flex justify-end gap-3 px-7 sm:px-8 pb-7 sm:pb-8 pt-2">
              <button
                onClick={closeForm}
                className="px-3.5 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {saving ? "Sanctioning…" : "Sanction Loan"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={16} /> Delete Loan
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            This will permanently delete <strong>{deleteTarget?.LoanNo}</strong> ({fmt(deleteTarget?.Amount)}).
            This cannot be undone. Deletion is blocked if any EMI has been marked paid or any
            repayment transaction exists — reverse those payments first.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {deleting ? "Deleting…" : "Delete Loan"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </GlassShell>
  );
}

function SectionLabel({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="flex items-center gap-2 -mb-2">
      <Icon size={12} className="text-emerald-600 dark:text-emerald-400" />
      <span className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

function InfoCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-3">
      <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm ${accent ? "font-bold text-emerald-600 dark:text-emerald-400 text-base" : "font-medium text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3.5" style={{ borderColor: `${accent}30` }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} style={{ color: accent }} />
        <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      <p className="text-base font-bold text-foreground">{value}</p>
    </div>
  );
}

function ChainNode({
  icon,
  title,
  subtitle,
  done,
  isLast,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  done: boolean;
  isLast: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${
            done ? "bg-emerald-500/15 border-emerald-500/40" : "bg-amber-500/10 border-amber-500/30"
          }`}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border my-1.5" />}
      </div>
      <div className={`flex-1 flex items-center justify-between gap-3 ${isLast ? "pb-0" : "pb-8"}`}>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

// ── PostingCard ─────────────────────────────────────────────────────────────
// One company's own books for one posted GL entry (sanction or a single
// repayment) — same Dr/Cr card layout as Payment.tsx's own "GL Postings —
// Full Payment Chain" Posting tab, reused so the loan's sanction entry and
// every repayment entry render identically.
function PostingCard({ p }: { p: { companyId: number | null; companyName: string | null; voucherNo: string; lines: any[] } }) {
  const total = p.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/40 border-border">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {p.companyName || "Company"}'s Books
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{p.voucherNo}</span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium whitespace-nowrap">
          ✓ Posted
        </span>
      </div>
      <div className="divide-y divide-border/50">
        <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground font-semibold gap-2">
          <span>Account</span>
          <span className="text-right">Debit (₹)</span>
          <span className="text-right">Credit (₹)</span>
        </div>
        {p.lines.map((l: any, li: number) => (
          <div key={li} className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-2.5 items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${l.debit > 0 ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span className="text-xs text-foreground truncate">
                {l.lHeadName || `Head #${l.lHeadId}`}{l.groupName ? ` (${l.groupName})` : ""}
              </span>
            </div>
            <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">
              {l.debit > 0 ? fmt(l.debit) : ""}
            </span>
            <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">
              {l.credit > 0 ? fmt(l.credit) : ""}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-2 bg-muted/30 text-xs font-bold gap-2">
          <span className="uppercase tracking-widest text-muted-foreground text-[10px]">Total</span>
          <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmt(total)}</span>
          <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── CustomerComboField ─────────────────────────────────────────────────────
// Searchable customer picker that shows a CRM / AH source pill beside each
// option and fires onChange(id, source) so the form can track which table the
// customer belongs to.
// Panel is portalled to document.body so overflow:hidden on ancestors never
// clips it.
function CustomerComboField({
  customers,
  value,
  onChange,
  inputClassName,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string, source: "AH" | "CRM") => void;
  inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open, updateRect]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        panelRef.current  && !panelRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = customers.find((c) => String(c.id) === value);
  const filtered = query
    ? customers.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : customers;

  const PANEL_MAX = 256;
  const GAP = 8;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP : 0;
  const spaceAbove = rect ? rect.top - GAP : 0;
  const openUpward = spaceAbove > spaceBelow;
  const maxHeight  = Math.min(PANEL_MAX, openUpward ? spaceAbove : spaceBelow);

  const panel = open && rect && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }
        ),
        left: rect.left,
        width: rect.width,
        maxHeight,
        zIndex: 9999,
      }}
      className="overflow-y-auto rounded-lg border border-border bg-card shadow-2xl py-1"
    >
      {filtered.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground text-center">No customers found</p>
      ) : (
        filtered.map((c) => (
          <button
            key={`${c.source}-${c.id}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(String(c.id), c.source); setOpen(false); setQuery(""); }}
            className={`w-full text-left px-4 py-3 text-sm hover:bg-muted/60 transition-colors flex items-center justify-between gap-2 ${
              String(c.id) === value && selected?.source === c.source
                ? "text-emerald-600 dark:text-emerald-400 font-medium"
                : "text-foreground"
            }`}
          >
            <span className="truncate">{c.label}</span>
            <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${
              c.source === "CRM"
                ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
            }`}>
              {c.source}
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`${inputClassName} pr-8`}
          placeholder="Search customer…"
          value={open ? query : (selected?.label ?? "")}
          onFocus={() => { setOpen(true); setQuery(""); updateRect(); }}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((o) => !o); updateRect(); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {panel}
    </div>
  );
}

// Dropdown-cum-text field — pick a standard value from an app-styled panel,
// or just type a custom one. Panel portalled to document.body so it is never
// clipped by overflow:hidden on ancestor containers.
function ComboField({
  value,
  onChange,
  options,
  placeholder,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open, updateRect]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        panelRef.current  && !panelRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const PANEL_MAX = 224;
  const GAP = 8;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP : 0;
  const spaceAbove = rect ? rect.top - GAP : 0;
  const openUpward = spaceAbove > spaceBelow;
  const maxHeight  = Math.min(PANEL_MAX, openUpward ? spaceAbove : spaceBelow);

  const panel = open && rect && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }
        ),
        left: rect.left,
        width: rect.width,
        maxHeight,
        zIndex: 9999,
      }}
      className="overflow-y-auto rounded-lg border border-border bg-card shadow-2xl py-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onChange(o.value); setOpen(false); }}
          className={`w-full text-left px-4 py-3 text-sm hover:bg-muted/60 transition-colors ${
            value === o.value ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`${inputClassName} pr-8`}
          placeholder={placeholder}
          value={value}
          onFocus={() => { setOpen(true); updateRect(); }}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((o) => !o); updateRect(); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {panel}
    </div>
  );
}
