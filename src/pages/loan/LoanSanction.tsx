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
} from "lucide-react";
import { MoneyRecive } from "iconsax-react";
import { getCompanyOptions, type CompanyOption } from "@/api/bankMasterApi";
import { friendlyErrorMessage } from "@/lib/friendlyError";
import {
  getLoanSanctions,
  getLoanSchedule,
  createLoanSanction,
  toggleEmiPaid,
  deleteLoanSanction,
  getCustomerOptions,
  type LoanSanction,
  type LoanEMI,
  type LoanType,
  type CustomerOption,
} from "@/api/loanSanctionApi";

const ACCENT = "#22c55e";
const LOAN_TYPES: LoanType[] = ["Inter-Company", "Intra-Company", "Customer Loan"];

// Common lending benchmarks — shown as quick picks in the dropdown-cum-text
// field, but the field always accepts a typed custom value too.
const STANDARD_INTEREST_RATES = [6, 8, 9, 10, 12, 15, 18];
const STANDARD_TENURES = [3, 6, 12, 18, 24, 36, 48, 60];

// Mirrors backend/routes/loanSanction.js's buildEmiSchedule EMI formula —
// this is only a live estimate shown while filling the form; the real
// schedule is generated server-side on sanction.
function estimateEmi(amount: number, annualRatePct: number, tenureMonths: number): number {
  const n = Math.max(1, tenureMonths || 1);
  if (!annualRatePct || annualRatePct <= 0) return amount / n;
  const r = annualRatePct / 12 / 100;
  return (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

const EMPTY_FORM = {
  loanType: "Inter-Company" as LoanType,
  lenderCompanyId: "",
  borrowerCompanyId: "",
  borrowerCustomerId: "",
  borrowerCustomerSource: "AH" as "AH" | "CRM",
  loanDate: new Date().toISOString().slice(0, 10),
  amount: "",
  interestRate: "",
  tenureMonths: "",
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
  "Intra-Company": "#22c55e",
  "Customer Loan": "#f59e0b",
};

export default function LoanSanctionPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [viewingLoan, setViewingLoan] = useState<LoanSanction | null>(null);
  const [tab, setTab] = useState<"overview" | "schedule" | "chain" | "posting">("overview");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LoanSanction | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["loan-schedule", viewingLoan?.LoanId],
    queryFn: () => getLoanSchedule(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
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

  const set = (key: keyof typeof form, value: string) =>
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
  };

  const openView = (loan: LoanSanction) => {
    setViewingLoan(loan);
    setTab("overview");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setViewingLoan(null);
  };

  const handleSave = async () => {
    const isCustomerLoan = form.loanType === "Customer Loan";
    if (!form.lenderCompanyId) return toast.error("Select the lender company");
    if (isCustomerLoan && !form.borrowerCustomerId) return toast.error("Select the borrower customer");
    if (!isCustomerLoan && !form.borrowerCompanyId) return toast.error("Select the borrower company");
    if (!form.loanDate) return toast.error("Loan date is required");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter a valid amount");

    setSaving(true);
    try {
      const res = await createLoanSanction({
        loanType: form.loanType,
        lenderCompanyId: form.lenderCompanyId,
        borrowerCompanyId: isCustomerLoan ? null : form.borrowerCompanyId,
        borrowerCustomerId: isCustomerLoan ? form.borrowerCustomerId : null,
        borrowerCustomerSource: isCustomerLoan ? form.borrowerCustomerSource : null,
        loanDate: form.loanDate,
        amount: form.amount,
        interestRate: form.interestRate || null,
        tenureMonths: form.tenureMonths || null,
        purpose: form.purpose || null,
        remarks: form.remarks || null,
      });
      toast.success(`Loan ${res.loanNo} sanctioned`);
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      closeForm();
    } catch (e: any) {
      toast.error(e.message ?? "Could not sanction this loan");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePaid = async (emi: LoanEMI) => {
    if (!viewingLoan) return;
    try {
      await toggleEmiPaid(viewingLoan.LoanId, emi.EMIId, !emi.IsPaid);
      await qc.invalidateQueries({ queryKey: ["loan-schedule", viewingLoan.LoanId] });
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      toast.success(emi.IsPaid ? "EMI marked unpaid" : "EMI marked paid");
    } catch (e: any) {
      toast.error(e.message ?? "Could not update this EMI");
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
      cell: ({ row }) => <span className="text-sm text-foreground">{row.original.LenderCompanyName || "—"}</span>,
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
  const isCustomerLoan = form.loanType === "Customer Loan";

  const displayLender = readOnly ? viewingLoan?.LenderCompanyName ?? "" : companyName(form.lenderCompanyId);
  const displayBorrower = readOnly
    ? viewingLoan?.BorrowerCompanyName ?? viewingLoan?.BorrowerCustomerName ?? ""
    : isCustomerLoan
      ? customerName(form.borrowerCustomerId)
      : companyName(form.borrowerCompanyId);
  const displayAmount = readOnly ? viewingLoan?.Amount ?? null : Number(form.amount) || null;
  const estimatedEmi = estimateEmi(
    Number(form.amount) || 0,
    Number(form.interestRate) || 0,
    Number(form.tenureMonths) || 1,
  );

  const totalEmis = schedule.length;
  const paidEmis = schedule.filter((e) => e.IsPaid).length;
  const paidAmount = schedule.filter((e) => e.IsPaid).reduce((s, e) => s + Number(e.EMIAmount), 0);
  const outstandingAmount = schedule.filter((e) => !e.IsPaid).reduce((s, e) => s + Number(e.EMIAmount), 0);
  const nextDue = schedule.find((e) => !e.IsPaid) ?? null;

  const tabs: { id: typeof tab; label: string; icon: typeof FileText }[] = [
    { id: "overview", label: "Overview", icon: FileText },
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
              </div>
            </div>
            {viewingLoan && (
              <button
                type="button"
                onClick={() => setDeleteTarget(viewingLoan)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors shrink-0"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-6 sm:px-8 pt-2 border-b border-border bg-card overflow-x-auto">
            {tabs.map((t) => {
              const disabled = !viewingLoan && (t.id === "schedule" || t.id === "chain");
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-5 py-3.5 text-xs font-semibold rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
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
                  <div className="space-y-2">
                    <label className={labelCls}>Loan Type <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-3 gap-3">
                      {LOAN_TYPES.map((lt) => (
                        <button
                          key={lt}
                          type="button"
                          onClick={() => set("loanType", lt)}
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
                )}

                {readOnly ? (
                  <>
                    {/* Parties */}
                    <SectionLabel icon={Building2} label="Parties" />
                    <div className="grid grid-cols-2 gap-3">
                      <InfoCard label="Lender" value={displayLender || "—"} />
                      <InfoCard
                        label={isCustomerLoan ? "Borrower (Customer)" : "Borrower (Company)"}
                        value={displayBorrower || "—"}
                      />
                    </div>

                    {/* Terms */}
                    <SectionLabel icon={MoneyRecive as any} label="Loan Terms" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <InfoCard label="Amount" value={fmt(displayAmount)} accent />
                      <InfoCard label="Loan Date" value={fmtDate(viewingLoan?.LoanDate)} />
                      <InfoCard
                        label="Interest Rate"
                        value={viewingLoan?.InterestRate != null ? `${viewingLoan.InterestRate}% p.a.` : "—"}
                      />
                      <InfoCard
                        label="Tenure"
                        value={viewingLoan?.TenureMonths != null ? `${viewingLoan.TenureMonths} months` : "—"}
                      />
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
                        <label className={labelCls}>Lender Company <span className="text-red-500">*</span></label>
                        <select
                          className={inputCls}
                          value={form.lenderCompanyId}
                          onChange={(e) => set("lenderCompanyId", e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {companies.map((c: CompanyOption) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
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
                            onChange={(e) => set("borrowerCompanyId", e.target.value)}
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
                    <div className="grid grid-cols-2 gap-5">
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
                    {(form.interestRate || form.tenureMonths) && form.amount && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5 flex items-center gap-2">
                        <Percent size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          Estimated EMI:{" "}
                          <span className="font-semibold text-foreground">
                            {fmt(estimatedEmi)}
                          </span>{" "}
                          / month for {form.tenureMonths || 1} month
                          {Number(form.tenureMonths) === 1 ? "" : "s"}
                          {form.interestRate ? ` at ${form.interestRate}% p.a.` : " (flat, no interest)"} — full
                          breakdown generated on sanctioning.
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

                <div className="rounded-xl border border-border overflow-hidden">
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
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono">{fmt(emi.PrincipalComponent)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                {fmt(emi.InterestComponent)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-medium">{fmt(emi.EMIAmount)}</td>
                              <td className="px-3 py-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={emi.IsPaid}
                                  onChange={() => handleTogglePaid(emi)}
                                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
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

                {/* Event timeline — sanction + only PAID events (actual history) */}
                <div>
                  <ChainNode
                    icon={<MoneyRecive size={13} className="text-emerald-500" />}
                    title={`Loan Sanctioned — ${viewingLoan.LoanNo}`}
                    subtitle={`${fmt(viewingLoan.Amount)} disbursed to ${displayBorrower} on ${fmtDate(viewingLoan.LoanDate)}`}
                    done
                    isLast={paidEmis === 0}
                  />
                  {schedule
                    .filter((e) => e.IsPaid)
                    .map((emi, i, arr) => (
                      <ChainNode
                        key={emi.EMIId}
                        icon={<CheckCircle2 size={13} className="text-emerald-500" />}
                        title={`EMI ${emi.InstallmentNo} Paid`}
                        subtitle={`${fmt(emi.EMIAmount)} · Paid ${fmtDate(emi.PaidDate)}${emi.PaidBy ? ` by ${emi.PaidBy}` : ""}`}
                        done
                        isLast={i === arr.length - 1 && !!nextDue === false}
                      />
                    ))}
                  {nextDue && (
                    <ChainNode
                      icon={<Circle size={13} className="text-amber-500" />}
                      title={`EMI ${nextDue.InstallmentNo} Pending`}
                      subtitle={`${fmt(nextDue.EMIAmount)} due ${fmtDate(nextDue.DueDate)}`}
                      done={false}
                      isLast
                      action={
                        <button
                          onClick={() => handleTogglePaid(nextDue)}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                        >
                          Mark Paid
                        </button>
                      }
                    />
                  )}
                </div>
              </div>
            )}

            {/* Posting tab */}
            {tab === "posting" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet size={14} className="text-emerald-600" />
                  <span className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                    Journal Entry — Loan Posting
                  </span>
                </div>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <th className="text-left px-3 py-2">Account</th>
                        <th className="text-right px-3 py-2">Debit</th>
                        <th className="text-right px-3 py-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-3 py-2.5">Loan — {displayBorrower || "Borrower"}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmt(displayAmount)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2.5">Loan — {displayLender || "Lender"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmt(displayAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  All postings use system-generated GL accounts, auto-created per counterparty on
                  first use. Additional posting fields will be added here later.
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
