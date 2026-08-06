import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlassShell } from "@/components/dashboard/GlassShell";
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
} from "lucide-react";
import { MoneyRecive } from "iconsax-react";
import { getCompanyOptions, getBanks, type CompanyOption, type BankRecord } from "@/api/bankMasterApi";
import { friendlyErrorMessage } from "@/lib/friendlyError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getLoanSanctions,
  getLoanSchedule,
  createLoanSanction,
  updateLoanSanction,
  deleteLoanSanction,
  getCustomerOptions,
  getBankOptions,
  getCompanyExposure,
  getLoanPayments,
  uploadLoanNoc,
  getLoanDocuments,
  uploadLoanDocument,
  type LoanSanction,
  type LoanType,
  type InterestCalcType,
  type CustomerOption,
  type BankOption,
  type CompanyExposure,
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
  lenderBankId: "",
  // Inter-Company only — which specific bank account of the lender/borrower
  // company the funds moved between (distinct from lenderBankId, which is
  // only for the Bank Loan type where the lender IS the bank).
  lenderBankAccountId: "",
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
};

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const LOAN_TYPE_COLORS: Record<LoanType, string> = {
  "Inter-Company": "#3b82f6",
  "Bank Loan": "#0ea5e9",
  "Customer Loan": "#f59e0b",
};

export default function LoanSanctionPage() {
  const qc = useQueryClient();
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

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loan-sanctions"],
    queryFn: getLoanSanctions,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["company-options-loan"],
    queryFn: getCompanyOptions,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customer-options-loan"],
    queryFn: getCustomerOptions,
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-options-loan"],
    queryFn: getBankOptions,
  });

  // Full bank records (with each bank's own company tag) — used to scope
  // the Inter-Company Lender/Borrower Bank A/C pickers to only that party's
  // own banks, instead of every bank in the system.
  const { data: bankRecords = [] } = useQuery({
    queryKey: ["bank-records-loan"],
    queryFn: getBanks,
  });
  const banksForCompany = (companyLabel: string) =>
    bankRecords.filter(
      (b: BankRecord) => b.BStatus && (b.BCompanyName || "").trim().toLowerCase() === companyLabel.trim().toLowerCase(),
    );

  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["loan-schedule", viewingLoan?.LoanId],
    queryFn: () => getLoanSchedule(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["loan-payments", viewingLoan?.LoanId],
    queryFn: () => getLoanPayments(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
  });

  const { data: loanDocuments = [] } = useQuery({
    queryKey: ["loan-documents", viewingLoan?.LoanId],
    queryFn: () => getLoanDocuments(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
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

  // Auto-post the moment the preview has loaded and isn't already posted —
  // no manual "Post to GL" click, same as GRN's Posting tab.
  useEffect(() => {
    if (
      tab !== "posting" ||
      loanPostingLoading ||
      !loanPostingData ||
      loanPostingData.isPosted ||
      loanPosting ||
      !viewingLoan?.LoanId
    )
      return;
    setLoanPosting(true);
    setLoanPostingError(null);
    fetchWithAuth(`/api/loan-sanction/${viewingLoan.LoanId}/post-to-gl`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? "Posting failed");
        setLoanPostingData((prev: any) => ({ ...prev, isPosted: true, jvNo: body.jvNo, jvId: body.jvId }));
      })
      .catch((err: any) => setLoanPostingError(err.message ?? "Posting failed"))
      .finally(() => setLoanPosting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loanPostingLoading, loanPostingData, viewingLoan?.LoanId]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const companyName = (id: string) =>
    companies.find((c: CompanyOption) => String(c.id) === id)?.label ?? "";
  const customerName = (id: string) =>
    customers.find((c: CustomerOption) => String(c.id) === id)?.label ?? "";
  const bankName = (id: string) =>
    banks.find((b: BankOption) => String(b.id) === id)?.label ?? "";

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
        loanDate: editForm.loanDate,
        amount: editForm.amount,
        hasInterest: editForm.hasInterest,
        interestType: editForm.interestType,
        interestRate: editForm.hasInterest ? editForm.interestRate || null : null,
        tenureMonths: editForm.tenureMonths || null,
        dueDate: isInterCompany && !editForm.hasInterest ? editForm.dueDate || null : null,
      });
      toast.success("Loan details updated");
      setEditingDetails(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["loan-sanctions"] }),
        qc.invalidateQueries({ queryKey: ["loan-schedule", viewingLoan.LoanId] }),
        qc.invalidateQueries({ queryKey: ["loan-payments", viewingLoan.LoanId] }),
      ]);
      const fresh = await getLoanSanctions();
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

  const handleSave = async () => {
    const isCustomerLoan = form.loanType === "Customer Loan";
    const isBankLoan = form.loanType === "Bank Loan";
    if (isBankLoan && !form.lenderBankId) return toast.error("Select the lender bank");
    if (!isBankLoan && !form.lenderCompanyId) return toast.error("Select the lender company");
    if (isCustomerLoan && !form.borrowerCustomerId) return toast.error("Select the borrower customer");
    if (!isCustomerLoan && !form.borrowerCompanyId) return toast.error("Select the borrower company");
    if (!form.loanDate) return toast.error("Loan date is required");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter a valid amount");

    setSaving(true);
    try {
      const res = await createLoanSanction({
        loanType: form.loanType,
        loanDocNo: form.loanDocNo || null,
        lenderCompanyId: isBankLoan ? null : form.lenderCompanyId,
        lenderBankId: isBankLoan ? form.lenderBankId : null,
        lenderBankAccountId: isInterCompanyType ? form.lenderBankAccountId || null : null,
        borrowerCompanyId: isCustomerLoan ? null : form.borrowerCompanyId,
        borrowerCustomerId: isCustomerLoan ? form.borrowerCustomerId : null,
        borrowerCustomerSource: isCustomerLoan ? form.borrowerCustomerSource : null,
        borrowerBankAccountId: isInterCompanyType ? form.borrowerBankAccountId || null : null,
        loanDate: form.loanDate,
        amount: form.amount,
        hasInterest: form.hasInterest,
        interestType: form.interestType,
        interestRate: form.hasInterest ? form.interestRate || null : null,
        tenureMonths: form.tenureMonths || null,
        dueDate: isInterCompanyType && !form.hasInterest ? form.dueDate || null : null,
        purpose: form.purpose || null,
        remarks: form.remarks || null,
      });
      toast.success(`Loan ${res.loanNo} sanctioned`);
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
      const fresh = await getLoanSanctions();
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
        return (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              closed ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${closed ? "bg-border" : "bg-emerald-500"}`} />
            {row.original.Status}
          </span>
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

  const inputCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 placeholder:text-muted-foreground";
  const labelCls = "text-xs font-semibold uppercase tracking-widest text-muted-foreground";
  const readOnly = !!viewingLoan;
  const isInterCompanyType = (viewingLoan?.LoanType ?? form.loanType) === "Inter-Company";
  const isCustomerLoan = form.loanType === "Customer Loan";
  const isBankLoan = form.loanType === "Bank Loan";

  const displayLender = readOnly
    ? viewingLoan?.LenderCompanyName ?? viewingLoan?.LenderBankName ?? ""
    : isBankLoan
      ? bankName(form.lenderBankId)
      : companyName(form.lenderCompanyId);
  const displayBorrower = readOnly
    ? viewingLoan?.BorrowerCompanyName ?? viewingLoan?.BorrowerCustomerName ?? ""
    : isCustomerLoan
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

  const totalEmis = schedule.length;
  const paidEmis = schedule.filter((e) => e.IsPaid).length;
  const paidAmount = schedule.filter((e) => e.IsPaid).reduce((s, e) => s + Number(e.EMIAmount), 0);
  const outstandingAmount = schedule.filter((e) => !e.IsPaid).reduce((s, e) => s + Number(e.EMIAmount), 0);
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
      subtitle="Sanction inter-company, intra-company and customer loans"
      icon={MoneyRecive as any}
      accentColor={ACCENT}
      action={
        !showForm ? (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-green-400 text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} /> New Loan
          </button>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Loan", path: "/loan" }, { label: "Loan Sanction" }]} />

      {!showForm ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <DataTable
            columns={columns}
            data={loans}
            loading={isLoading}
            emptyMessage="No loans sanctioned yet. Click 'New Loan' to get started."
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
                {viewingLoan && viewingLoan.Status === "Closed" && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={10} /> Closed
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
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className={labelCls}>Loan Doc No.</label>
                            <input
                              className={inputCls}
                              value={editForm.loanDocNo}
                              onChange={(e) => setEditForm((f) => ({ ...f, loanDocNo: e.target.value }))}
                            />
                          </div>
                          {isInterCompanyType && (
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
                      <InfoCard label={isBankLoan ? "Lender (Bank)" : "Lender"} value={displayLender || "—"} />
                      <InfoCard
                        label={isCustomerLoan ? "Borrower (Customer)" : "Borrower (Company)"}
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
                    </div>

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
                    <div className="grid grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label className={labelCls}>
                          Lender {isBankLoan ? "Bank" : "Company"} <span className="text-red-500">*</span>
                        </label>
                        {isBankLoan ? (
                          <select
                            className={inputCls}
                            value={form.lenderBankId}
                            onChange={(e) => set("lenderBankId", e.target.value)}
                          >
                            <option value="">— Select —</option>
                            {banks.map((b: BankOption) => (
                              <option key={b.id} value={b.id}>
                                {b.label}
                              </option>
                            ))}
                          </select>
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
                      <div className="space-y-2">
                        <label className={labelCls}>Borrower {isCustomerLoan ? "Customer" : "Company"} <span className="text-red-500">*</span></label>
                        {isCustomerLoan ? (
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
                    </div>

                    {isInterCompanyType && (
                      <div className="grid grid-cols-2 gap-5">
                        <div className="space-y-2">
                          <label className={labelCls}>Lender Bank A/C</label>
                          <select
                            className={inputCls}
                            value={form.lenderBankAccountId}
                            onChange={(e) => set("lenderBankAccountId", e.target.value)}
                            disabled={!form.lenderCompanyId}
                          >
                            <option value="">
                              {form.lenderCompanyId ? "— No bank A/C tag —" : "— Select lender company first —"}
                            </option>
                            {banksForCompany(companyName(form.lenderCompanyId)).map((b: BankRecord) => (
                              <option key={b.BId} value={b.BId}>
                                {b.BName}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-muted-foreground">
                            Which of the lender's bank accounts the funds actually left from.
                            {form.lenderCompanyId && banksForCompany(companyName(form.lenderCompanyId)).length === 0 &&
                              " No banks tagged to this company in Bank Master."}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className={labelCls}>Borrower Bank A/C</label>
                          <select
                            className={inputCls}
                            value={form.borrowerBankAccountId}
                            onChange={(e) => set("borrowerBankAccountId", e.target.value)}
                            disabled={!form.borrowerCompanyId}
                          >
                            <option value="">
                              {form.borrowerCompanyId ? "— No bank A/C tag —" : "— Select borrower company first —"}
                            </option>
                            {banksForCompany(companyName(form.borrowerCompanyId)).map((b: BankRecord) => (
                              <option key={b.BId} value={b.BId}>
                                {b.BName}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-muted-foreground">
                            Which of the borrower's bank accounts the funds landed in.
                            {form.borrowerCompanyId && banksForCompany(companyName(form.borrowerCompanyId)).length === 0 &&
                              " No banks tagged to this company in Bank Master."}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-5">
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

                    {isInterCompanyType && !form.hasInterest && (
                      <div className="space-y-2 max-w-[220px]">
                        <label className={labelCls}>Repayment Due Date</label>
                        <input
                          type="date"
                          className={inputCls}
                          value={form.dueDate}
                          min={form.loanDate || undefined}
                          onChange={(e) => set("dueDate", e.target.value)}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          This loan isn't broken into EMIs — set when the whole amount is due back.
                        </p>
                      </div>
                    )}

                    {(!isInterCompanyType || form.hasInterest) && (
                      <div className="grid grid-cols-2 gap-5">
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
                    <div className="grid grid-cols-2 gap-5">
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
                        <th className="text-center px-3 py-2.5">Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {scheduleLoading ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-xs">
                            Loading…
                          </td>
                        </tr>
                      ) : schedule.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-xs">
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

                {/* Event timeline — sanction + actual payment transactions, all
                    settled exclusively via Finance → Payment (Loan EMIs tab) */}
                <div>
                  <ChainNode
                    icon={<MoneyRecive size={13} className="text-emerald-500" />}
                    title={`Loan Sanctioned — ${viewingLoan.LoanNo}`}
                    subtitle={`${fmt(viewingLoan.Amount)} disbursed to ${displayBorrower} on ${fmtDate(viewingLoan.LoanDate)}`}
                    done
                    isLast={payments.length === 0}
                  />
                  {payments.map((p, i, arr) => (
                    <ChainNode
                      key={p.PaymentId}
                      icon={<Receipt size={13} className="text-emerald-500" />}
                      title={`${p.PaymentType === "LumpSum" ? "Lump Sum Payment" : `${p.EmisCovered} EMI${p.EmisCovered === 1 ? "" : "s"} Paid`} — ${p.PaymentRef}`}
                      subtitle={`${fmt(p.TotalAmount)}${p.LateFee > 0 ? ` (incl. ${fmt(p.LateFee)} late fee)` : ""} · Paid ${fmtDate(p.PaymentDate)}${p.CreatedBy ? ` by ${p.CreatedBy}` : ""}${p.ExcessCredited > 0 ? ` · ${fmt(p.ExcessCredited)} excess credited to lender's on-account` : ""}${p.ClosedLoan ? " · Loan closed" : ""}`}
                      done
                      isLast={i === arr.length - 1 && viewingLoan.Status === "Closed"}
                    />
                  ))}
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
                  {viewingLoan.Status !== "Closed" && payments.length === 0 && (
                    <ChainNode
                      icon={<Circle size={13} className="text-amber-500" />}
                      title="No payments yet"
                      subtitle="Pay from Finance → Payment (Loan EMIs tab) — an installment or a lump sum."
                      done={false}
                      isLast
                    />
                  )}
                </div>
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
                        <CheckCircle2 size={10} /> Posted · {loanPostingData.jvNo || `JV-${loanPostingData.jvId}`}
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
                    ) : null
                  )}
                </div>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <th className="text-left px-3 py-2">Account</th>
                        <th className="text-left px-3 py-2">Account Group</th>
                        <th className="text-right px-3 py-2">Debit</th>
                        <th className="text-right px-3 py-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-3 py-2.5">
                          Loan — {displayBorrower || "Borrower"}
                          {readOnly && viewingLoan?.BorrowerLHeadCode && (
                            <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                              {viewingLoan.BorrowerLHeadCode}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {readOnly ? (
                            viewingLoan?.BorrowerGroupName ? (
                              <>
                                {viewingLoan.BorrowerParentGroupName && `${viewingLoan.BorrowerParentGroupName} / `}
                                {viewingLoan.BorrowerGroupName}
                              </>
                            ) : (
                              "—"
                            )
                          ) : (
                            "Loans and Advances"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmt(displayAmount)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2.5">
                          Loan — {displayLender || "Lender"}
                          {readOnly && viewingLoan?.LenderLHeadCode && (
                            <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                              {viewingLoan.LenderLHeadCode}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {readOnly ? (
                            viewingLoan?.LenderGroupName ? (
                              <>
                                {viewingLoan.LenderParentGroupName && `${viewingLoan.LenderParentGroupName} / `}
                                {viewingLoan.LenderGroupName}
                              </>
                            ) : (
                              "—"
                            )
                          ) : isBankLoan ? (
                            "Bank's own account group"
                          ) : (
                            "Loans and Advances"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmt(displayAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  All postings use system-generated GL accounts, auto-created per counterparty on
                  first use{isBankLoan ? " — for a Bank Loan, the lender's own existing GL account (and its real account group) is reused directly, not a shadow account" : ""}.
                  {readOnly
                    ? " This entry is posted to the General Ledger automatically and appears in Trial Balance."
                    : " Save the loan to generate this posting."}
                </p>
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="flex justify-end gap-3 px-7 sm:px-8 pb-7 sm:pb-8 pt-2">
              <button
                onClick={closeForm}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-green-400 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
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
            This cannot be undone. If any EMI has already been paid, deletion will be blocked —
            reverse those payments first.
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
        {!isLast && <div className="w-px flex-1 bg-border my-1" />}
      </div>
      <div className={`flex-1 flex items-center justify-between gap-3 ${isLast ? "pb-0" : "pb-5"}`}>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {action}
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
