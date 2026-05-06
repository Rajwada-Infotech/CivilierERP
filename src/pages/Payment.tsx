import React, { useState, useCallback } from "react";
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
  CreditCard,
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
  Package,
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
}

interface BankOption {
  id: number;
  label: string;
  accountNumber?: string | null;
  ifscCode?: string | null;
  branch?: string | null;
  accountType?: string | null;
}

interface ExpenseOption {
  id: string;
  value: string;
  label: string;
  // Present on all options
  type?: "booking" | "emi";
  expenseBookingId?: number;
  docNo?: string;
  projectName?: string;
  amount?: number;
  companyId?: number | null;
  // EMI-specific
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
}

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

interface GRNRef {
  GRNID: number;
  GRNNo: string;
  GRNDate?: string;
  SupplierName?: string;
  PONumber?: string;
  Status?: string;
}

const fetchExpenseGRNs = async (expenseId: string): Promise<GRNRef[]> => {
  if (!expenseId) return [];
  const res = await fetchWithAuth(`/api/expense-booking/${expenseId}/grns`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_MODES = [
  "Cash",
  "Cheque",
  "UPI",
  "Card",
  "NEFT",
  "RTGS",
] as const;

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
  };

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

// ─── GRN badges for payment list ─────────────────────────────────────────────
function PaymentGRNBadges({
  expenseId,
  expenseRef,
}: {
  expenseId: string;
  expenseRef: string;
}) {
  const [grns, setGrns] = React.useState<GRNRef[]>([]);
  React.useEffect(() => {
    if (!expenseId && !expenseRef) return;
    // Try by expenseId first; if missing, skip (we can't do a number lookup)
    if (!expenseId) return;
    fetchWithAuth(`/api/expense-booking/${expenseId}/grns`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [expenseId, expenseRef]);

  if (grns.length === 0)
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
  };
}

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
  };
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

// ─── Form field wrapper ───────────────────────────────────────────────────────

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

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
        <Icon size={12} className="text-primary" />
      </div>
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// ─── Auto-fill banner ─────────────────────────────────────────────────────────

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

// ─── Read-only display field ──────────────────────────────────────────────────

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
          {placeholder ?? "Auto-filled from expense booking"}
        </span>
      )}
    </div>
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
  const chequeCount = dbItems.filter((p) => p.PMode === "Cheque").length;
  const cashCount = dbItems.filter((p) => p.PMode === "Cash").length;

  // ── Form helpers ───────────────────────────────────────────────────────────

  const set = <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const openNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setView("form");
  };

  const openEdit = (rec: PaymentRecord) => {
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    // Resolve expenseId from the stored expenseRef doc number so the banner stays linked
    const matchedOption = rest.expenseRef
      ? expenseOptions.find((o) => o.label.startsWith(rest.expenseRef))
      : undefined;
    setForm({ ...rest, expenseId: matchedOption?.id ?? "" });
    setView("form");
  };

  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm(blankForm());
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

      // EMI installment options have id like "emi-{bookingId}-{no}".
      // The detail endpoint only accepts numeric booking IDs, so for EMI options
      // we auto-fill directly from the option data without any API call.
      const selectedOption = expenseOptions.find((o) => o.id === expenseId);
      if (selectedOption?.type === "emi") {
        // Build the installment-specific ref: either the stored refNumber, or
        // derive it from parentDocNo + installment number (matching backend SQL logic:
        // CONCAT(parentDocNo, '-EMI-', RIGHT('00' + CAST(installmentNo AS VARCHAR), 2)))
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
        // Derive a short doc type from the ref: "CI/WO/000001/2025-2026-EMI-01" → "WO/EMI-01"
        const emiTag = `EMI-${padded}`;
        const woTag =
          (ref.match(/\/(WO|PO|OTH)\//)?.[1] ?? ref.match(/\/(WO|PO|OTH)\//))
            ? ""
            : "EXP";
        const shortDocType = woTag ? `${woTag}/${emiTag}` : emiTag;
        setForm((prev) => ({
          ...prev,
          expenseId,
          expenseRef: ref,
          project: selectedOption.projectName || "",
          company: String(selectedOption.companyId ?? ""),
          amount: selectedOption.amount ?? null,
          docType: shortDocType,
        }));
        // Fetch GRNs linked to the parent expense booking
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
        }));
        // Fetch linked GRNs for this expense booking
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
    // Store just the base name (before the " — accountNumber" suffix)
    set("bankName", bank?.label?.split(" — ")[0] ?? "");
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.paymentName.trim()) {
      toast.error("Payment name is required.");
      return;
    }
    if (!form.mode) {
      toast.error("Please select a payment mode.");
      return;
    }
    if (!form.bankId) {
      toast.error("Please select a bank account.");
      return;
    }
    if (!form.date) {
      toast.error("Payment date is required.");
      return;
    }

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

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Payments"]} />
      <div className="space-y-5">
        {/* ── Page header ──────────────────────────────────────────────────── */}
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

        {/* ── Summary stats (list only) ─────────────────────────────────────── */}
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
              {/* ── 1. Link Expense Booking ─────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader icon={Link2} label="Expense Booking" />

                {form.expenseRef ? (
                  <AutoFillBanner
                    docNo={form.expenseRef}
                    onClear={clearExpenseLink}
                  />
                ) : (
                  <Field
                    label="Select Expense Booking"
                    hint="Selecting a booking auto-fills project, company, amount & doc type."
                  >
                    <div className="relative">
                      <select
                        value={form.expenseId}
                        onChange={(e) => handleExpenseSelect(e.target.value)}
                        disabled={loadingExpense}
                        className="w-full appearance-none px-3 py-2 pr-9 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-wait"
                      >
                        <option value="">— Choose expense booking —</option>
                        {expenseOptions.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.label}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                        {loadingExpense ? (
                          <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </div>
                    </div>
                  </Field>
                )}

                {/* Auto-filled read-only fields */}
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
                          placeholder="Fetched from expense booking"
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
                          placeholder="Fetched from expense booking"
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
                          placeholder="Fetched from expense booking"
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {/* GRN linkage panel — only shown when there are linked GRNs */}
                {form.expenseRef && linkedGRNs.length > 0 && (
                  <div className="mt-3">
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-heading font-semibold text-teal-600 dark:text-teal-400">
                        <Truck size={12} />
                        Linked GRNs ({linkedGRNs.length})
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
                            {g.Status && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-muted text-muted-foreground border border-border/50">
                                {g.Status}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 2. Payment Details ──────────────────────────────────── */}
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

                {/* Amount — auto-filled if expense linked, else manual */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Amount (₹)"
                    required
                    hint={
                      form.expenseRef
                        ? "Net amount fetched from expense booking — editable if needed."
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

                  {/* Net amount highlight if set */}
                  {(form.amount ?? 0) > 0 && (
                    <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/20 px-4 py-2 self-end mb-0.5">
                      <TrendingUp size={14} className="text-primary shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                          Net Payable
                        </p>
                        <p className="font-mono text-base font-bold text-primary">
                          {formatINR(form.amount ?? 0)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── 3. Payment Mode ─────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader icon={Wallet} label="Payment Mode" />
                <Field label="Mode" required>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_MODES.map((m) => {
                      const s = MODE_STYLE[m];
                      const active = form.mode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => set("mode", m)}
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
              </div>

              {/* ── 4. Bank ─────────────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader icon={Landmark} label="Bank Account" />
                <Field
                  label="Bank"
                  hint="Required for Cheque / NEFT / RTGS payments."
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

              {/* ── Save footer ──────────────────────────────────────────── */}
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
                {/* ── Mobile cards ── */}
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

                {/* ── Desktop table ── */}
                <div className="hidden sm:block overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        {[
                          "Payment Name",
                          "Expense Ref",
                          "GRN(s)",
                          "Project",
                          "Mode",
                          "Date",
                          "Amount",
                          "Bank",
                          "Status",
                          "Actions",
                        ].map((h) => (
                          <th
                            key={h}
                            className={`px-4 py-3 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground whitespace-nowrap${h === "GRN(s)" ? " hidden lg:table-cell" : ""}`}
                          >
                            {h}
                          </th>
                        ))}
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
                          <td className="px-4 py-3 font-heading font-medium text-foreground max-w-[160px] truncate">
                            {rec.paymentName || "—"}
                          </td>
                          <td className="px-4 py-3">
                            {rec.expenseRef ? (
                              <span className="font-mono text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md">
                                {rec.expenseRef}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <PaymentGRNBadges
                              expenseId={rec.expenseId || ""}
                              expenseRef={rec.expenseRef}
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">
                            {rec.project || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <ModeBadge mode={rec.mode} />
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {rec.date || "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold whitespace-nowrap">
                            {formatINR(rec.amount ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[100px] truncate">
                            {rec.bankName || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <StatusBadge status={rec.status} />
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
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
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

      {/* ── Delete confirm dialog ────────────────────────────────────────── */}
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
                  Are you sure you want to delete this payment? This action
                  cannot be undone.
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
