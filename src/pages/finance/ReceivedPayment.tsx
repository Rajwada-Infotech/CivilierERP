import React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus,
  AlertCircle,
  ArrowLeft,
  RotateCcw,
  ArrowDownCircle,
  CheckCircle2,
  Clock,
  IndianRupee,
  Building2,
  Banknote,
  CreditCard,
  Smartphone,
  FileText,
  Trash2,
  Hash,
  Pencil,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Landmark,
  ChevronsUpDown,
  Check,
  SendHorizontal,
  X,
  Eye,
  Printer,
} from "lucide-react";
import {
  getReceivedPayments,
  addReceivedPayment,
  updateReceivedPayment,
  deleteReceivedPayment,
} from "@/api/receivedPaymentApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { getContractOptions, type ContractOption } from "@/api/contractApi";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  fetchDocTypes,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { formatINR } from "@/utils/formatCurrency";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { usePageRights } from "@/hooks/usePageRights";
import { EditOrAmendButton } from "@/components/EditOrAmendButton";
import { AmendedBadge } from "@/components/AmendedBadge";
import { useAmendmentStatus } from "@/hooks/useAmendmentStatus";

// ─── Export ───────────────────────────────────────────────────────────────────

// Mirrors the visible table's own column order (Doc No → Date → Fin Year →
// Company → Project → Customer → Mode → Deposit Bank → Amount → Status)
// so the export reads like the page it came from.
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "docNo" },
  { header: "Date", accessor: "docDate" },
  { header: "Fin Year", accessor: (r) => String((r as any).finYear || "—") },
  { header: "Company", accessor: "companyName" },
  { header: "Project", accessor: "projectName" },
  { header: "Customer", accessor: (r) => String(r.customerName || r.receivedFrom || "—") },
  { header: "Mode", accessor: "mode" },
  { header: "Deposit Bank", accessor: "depositBankName" },
  { header: "Amount", accessor: (r) => formatINR(Number(r.amount || 0)) },
  { header: "Status", accessor: "status" },
  { header: "Transaction / Cheque Ref", accessor: (r) => String(r.transactionId || r.checkNumber || "") },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaymentMode =
  | "Cash"
  | "Check"
  | "UPI"
  | "NEFT"
  | "RTGS"
  | "Card"
  | "EMI";

export type ReceivedPayment = {
  id: string;
  docNo: string;
  companyId?: number;
  companyName: string;
  projectId?: number;
  projectName: string;
  finYear?: string;
  docTypeId?: number;
  receivedFrom: string;
  customerName?: string;
  depositBankId?: number;
  depositBankName?: string;
  docDate: string;
  mode: PaymentMode;
  amount: number;
  bankName?: string;
  transactionId?: string;
  checkNumber?: string;
  chequeDate?: string;
  isPostDated?: boolean;
  remarks?: string;
  status: "Draft" | "Pending" | "Approved" | "Rejected";
  createdAt: string;
};

interface CustomerOption {
  id: number;
  label: string;
}

const PAYMENT_MODES: PaymentMode[] = [
  "Cash",
  "Check",
  "UPI",
  "NEFT",
  "RTGS",
  "Card",
  "EMI",
];

const fmt = (n: number) => formatINR(n, { decimals: 2 });

const normalizeCompanyName = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const modeIcon = (mode: string) => {
  if (mode === "Cash")
    return <Banknote size={13} className="text-emerald-500" />;
  if (mode === "Check") return <FileText size={13} className="text-blue-500" />;
  if (mode === "UPI")
    return <Smartphone size={13} className="text-violet-500" />;
  if (mode === "Card")
    return <CreditCard size={13} className="text-orange-500" />;
  if (mode === "EMI") return <IndianRupee size={13} className="text-primary" />;
  return <Building2 size={13} className="text-sky-500" />;
};

const modeColor: Record<string, string> = {
  Cash: "bg-emerald-500/10 text-emerald-600",
  Check: "bg-blue-500/10 text-blue-600",
  UPI: "bg-violet-500/10 text-violet-600",
  NEFT: "bg-sky-500/10 text-sky-600",
  RTGS: "bg-cyan-500/10 text-cyan-600",
  Card: "bg-orange-500/10 text-orange-600",
  EMI: "bg-primary/10 text-primary",
};

const EMPTY_FORM = {
  companyId: "" as string,
  companyName: "",
  projectId: "" as string,
  projectName: "",
  finYear: "",
  docNo: "",
  customerName: "",
  depositBankId: "" as string,
  depositBankName: "",
  mode: "NEFT" as PaymentMode,
  amount: "",
  bankName: "",
  transactionId: "",
  checkNumber: "",
  chequeDate: "" as string,
  isPostDated: false,
  remarks: "",
  // Optional: tags this payment as an on-account advance against a
  // Contract when no invoice exists yet (backend/services/contractLedger.js).
  contractId: "" as string,
};

// ─── Form Field Label ──────────────────────────────────────────────────────────

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-[11px] uppercase tracking-widest font-heading font-semibold text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

// ─── Customer Combobox ────────────────────────────────────────────────────────

function CustomerCombobox({
  value,
  onChange,
  customers,
}: {
  value: string;
  onChange: (v: string) => void;
  customers: CustomerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return customers.slice(0, 80);
    const q = query.toLowerCase();
    return customers
      .filter((c) => c.label.toLowerCase().includes(q))
      .slice(0, 80);
  }, [customers, query]);

  useEffect(() => {
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
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className={cn(
          "w-full h-9 px-3 text-sm text-left flex items-center justify-between gap-2 rounded-md border border-input bg-background hover:bg-muted/40 transition-colors",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate">{value || "Select customer…"}</span>
        <ChevronsUpDown size={13} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <input
              autoFocus
              className="w-full px-2 py-1.5 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search account head…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No customers found
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange(c.label);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted transition-colors",
                    value === c.label &&
                      "bg-primary/5 text-primary font-medium",
                  )}
                >
                  <Check
                    size={11}
                    className={value === c.label ? "opacity-100" : "opacity-0"}
                  />
                  {c.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-14 text-muted-foreground text-sm">
      <AlertCircle size={18} className="mx-auto mb-2 opacity-30" />
      No received payments yet. Click "Add Payment" to get started.
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReceivedPaymentPage() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const { finYears } = useFinYear();
  const rights = usePageRights("received-payment");

  const [payments, setPayments] = useState<ReceivedPayment[]>([]);
  const [view, setView] = useState<"list" | "form">("list");
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [apiLoading, setApiLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<ReceivedPayment | null>(
    null,
  );
  const [viewingPayment, setViewingPayment] = useState<ReceivedPayment | null>(
    null,
  );
  const viewingAmendmentStatus = useAmendmentStatus(
    "ReceivedPayment",
    viewingPayment?.id,
    viewingPayment?.status,
  );
  const PAGE_SIZE = 20;

  // ── Form state ───────────────────────────────────────────────────────────────
  const [form, setForm] = useState(EMPTY_FORM);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [docNoPreview, setDocNoPreview] = useState("");
  const [docNoLoading, setDocNoLoading] = useState(false);
  const [companies, setCompanies] = useState<{ id: number; label: string }[]>(
    [],
  );
  const [projects, setProjects] = useState<
    { id: number; label: string; belongsTo: number | null }[]
  >([]);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  // TypeOfDocId for the RECP doc type — resolved once on mount via module filter
  const [recDocTypeId, setRecDocTypeId] = useState<number | null>(null);

  const finYearOptions = finYears.filter((fy) => fy.status === "Active" && !fy.locked);
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || "";

  // Load masters
  useEffect(() => {
    // Companies: enterprise table WHERE business_type = 'C'
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json().catch(() => ({})))
      .then((data: any[]) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => {});

    getBanks()
      .then((data) => setBanks(data.filter((b) => b.BStatus)))
      .catch(() => {});

    getContractOptions()
      .then(setContracts)
      .catch(() => {});

    // Projects: enterprise table WHERE business_type = 'P', with belongs_to for company filter
    fetchWithAuth("/api/enterprises/options?business_type=P")
      .then((r) => r.json().catch(() => ({})))
      .then((data: any[]) =>
        setProjects(
          (Array.isArray(data) ? data : []).map((p) => ({
            id: p.id,
            label: p.label,
            belongsTo: p.belongs_to ?? null,
          })),
        ),
      )
      .catch(() => {});

    // Customers: AccountHeadMaster WHERE LHeadType = 'A'
    fetchWithAuth("/api/account-head/options?type=A")
      .then((r) => r.json().catch(() => ({})))
      .then((data: any[]) =>
        setCustomers(
          (Array.isArray(data) ? data : []).map((x) => ({
            id: x.id ?? x.LHeadId,
            label: x.label ?? x.LHeadName ?? "",
          })),
        ),
      )
      .catch(() => {});

    // Resolve RECP doc type ID using the module= filter (Stage 3 backend)
    // fetchDocTypes passes ?module=RECP → backend filters by links_to LIKE '%Received Payment%'
    fetchDocTypes("RECP")
      .then((data) => {
        if (data.length > 0) setRecDocTypeId(data[0].TypeOfDocId);
      })
      .catch(() => {});
  }, []);

  // ── Filtered banks: only those linked to selected company ───────────────────
  const selectedCompanyLabel =
    companies.find((c) => String(c.id) === form.companyId)?.label ?? "";
  const depositBanks = useMemo(() => {
    if (!selectedCompanyLabel) return banks;

    const selectedCompany = normalizeCompanyName(selectedCompanyLabel);
    const matchedBanks = banks.filter((b) => {
      const bankCompany = normalizeCompanyName(b.BCompanyName);
      return !bankCompany || bankCompany === selectedCompany;
    });

    return matchedBanks.length > 0 ? matchedBanks : banks;
  }, [banks, selectedCompanyLabel]);

  // ── Projects — independent selection, show all ───────────────────────────────
  const filteredProjects = projects;

  // ── Doc number preview ───────────────────────────────────────────────────────
  const refreshDocNo = useCallback(
    async (docTypeId: number | null, finYear: string) => {
      if (!docTypeId) {
        setDocNoPreview("");
        return;
      }
      setDocNoLoading(true);
      try {
        const next = await fetchNextDocNumber(docTypeId, finYear || undefined);
        setDocNoPreview(next);
      } catch {
        setDocNoPreview("");
      } finally {
        setDocNoLoading(false);
      }
    },
    [],
  );

  // Auto-refresh doc number when fin year or resolved doc type changes
  useEffect(() => {
    if (!editingId && recDocTypeId) {
      refreshDocNo(recDocTypeId, form.finYear || activeFinYear);
    }
  }, [form.finYear, recDocTypeId, editingId, activeFinYear, refreshDocNo]);

  // ── Load payments ─────────────────────────────────────────────────────────────
  const loadPayments = useCallback(async (page = 1) => {
    setApiLoading(true);
    try {
      const res = await getReceivedPayments(page, PAGE_SIZE);
      setTotalPages(res.totalPages);
      setTotalCount(res.total);
      setCurrentPage(page);
      setPayments(
        res.data.map((r) => ({
          id: String(r.RPPaymentID),
          docNo:
            (r as any).RPDocNo ||
            `REC/${String(r.RPPaymentID).padStart(6, "0")}`,
          companyId: (r as any).RPCompanyId ?? undefined,
          companyName: r.RPCompanyName ?? "",
          projectId: (r as any).RPProjectId ?? undefined,
          projectName: r.RPProjectName,
          finYear: (r as any).RPFinYear ?? undefined,
          docTypeId: (r as any).RPDocTypeId ?? undefined,
          receivedFrom: r.RPReceivedFrom,
          customerName: (r as any).RPCustomerName ?? undefined,
          depositBankId: (r as any).RPDepositBankId ?? undefined,
          depositBankName: (r as any).RPDepositBankName ?? undefined,
          docDate: r.RPDocDate,
          mode: r.RPMode as ReceivedPayment["mode"],
          amount: Number(r.RPAmount),
          bankName: r.RPBankName ?? undefined,
          transactionId: r.RPTransactionID ?? undefined,
          checkNumber: r.RPCheckNumber ?? undefined,
          chequeDate: r.RPChequeDate
            ? String(r.RPChequeDate).slice(0, 10)
            : undefined,
          isPostDated: !!r.RPIsPostDated,
          remarks: r.RPRemarks ?? undefined,
          status: (r.RPStatus as ReceivedPayment["status"]) || "Draft",
          createdAt: r.RPCreatedAt,
        })),
      );
    } catch {
      toast.error("Failed to load received payments");
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPayments(1);
  }, [loadPayments]);

  const setField = (key: keyof typeof EMPTY_FORM, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const formDefaults: Record<string, any> = { ...EMPTY_FORM as Record<string, any>, finYear: activeFinYear ?? "" };
  const isDirty = Object.keys(EMPTY_FORM).some(
    (k) => String((form as Record<string, any>)[k] ?? "") !== String(formDefaults[k] ?? ""),
  );

  const canSave = !!(
    form.companyId &&
    form.projectId &&
    date &&
    form.finYear &&
    form.mode &&
    form.customerName &&
    form.depositBankId &&
    Number(form.amount) > 0
  );

  const handleReset = () => {
    setForm({ ...EMPTY_FORM, finYear: activeFinYear });
    setDate(new Date());
    setDocNoPreview("");
  };

  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm({ ...EMPTY_FORM, finYear: activeFinYear });
  };

  // ── Open add form ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, finYear: activeFinYear });
    setDate(new Date());
    setDocNoPreview("");
    setView("form");
  };

  // ── Open edit dialog ──────────────────────────────────────────────────────────
  const openEdit = (p: ReceivedPayment) => {
    setEditingId(p.id);
    setForm({
      companyId: String(p.companyId ?? ""),
      companyName: p.companyName,
      projectId: String(p.projectId ?? ""),
      projectName: p.projectName,
      finYear: p.finYear ?? "",
      docNo: p.docNo,
      customerName: p.customerName ?? "",
      depositBankId: String(p.depositBankId ?? ""),
      depositBankName: p.depositBankName ?? "",
      mode: p.mode,
      amount: String(p.amount),
      bankName: p.bankName ?? "",
      transactionId: p.transactionId ?? "",
      checkNumber: p.checkNumber ?? "",
      chequeDate: p.chequeDate ?? "",
      isPostDated: !!p.isPostDated,
      remarks: p.remarks ?? "",
      contractId: String((p as { ContractId?: number }).ContractId ?? ""),
    });
    setDate(p.docDate ? new Date(p.docDate) : new Date());
    setDocNoPreview(p.docNo);
    setView("form");
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.companyId) {
      toast.error("Company is required");
      return;
    }
    if (!form.projectId) {
      toast.error("Project is required");
      return;
    }
    if (!form.finYear) {
      toast.error("Financial year is required");
      return;
    }
    if (!date) {
      toast.error("Date of receipt is required");
      return;
    }
    if (!form.customerName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (!form.depositBankId) {
      toast.error("Deposit bank is required");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error("Valid amount is required");
      return;
    }

    setActionLoading(true);
    const payload = {
      RPCompanyName: selectedCompanyLabel || form.companyName,
      RPCompanyId: Number(form.companyId) || null,
      RPReceivedFrom: form.customerName.trim(),
      RPCustomerName: form.customerName.trim(),
      RPProjectName: form.projectName,
      RPProjectId: Number(form.projectId) || null,
      RPDocDate: date!.toISOString().slice(0, 10),
      RPFinYear: form.finYear || activeFinYear,
      RPDocTypeId: recDocTypeId,
      RPMode: form.mode,
      RPAmount: Number(form.amount),
      RPBankName: form.bankName || null,
      RPTransactionID: form.transactionId || null,
      RPCheckNumber: form.checkNumber || null,
      RPChequeDate: form.chequeDate || null,
      RPIsPostDated: !!form.isPostDated,
      RPRemarks: form.remarks || null,
      RPDepositBankId: Number(form.depositBankId) || null,
      RPDepositBankName: form.depositBankName || null,
      ContractId: form.contractId ? Number(form.contractId) : null,
    };

    try {
      if (editingId) {
        await updateReceivedPayment(Number(editingId), payload as any);
        toast.success("Payment updated");
      } else {
        await addReceivedPayment(payload as any);
        toast.success("Payment recorded successfully");
      }
      setView("list");
      setEditingId(null);
      await loadPayments(currentPage);
    } catch {
      toast.error(
        editingId ? "Failed to update payment" : "Failed to save payment",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!submitTarget) return;
    setActionLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/received-payment/${submitTarget.id}/submit`,
        { method: "PATCH" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Submit failed");
      }
      toast.success("Sent to Approval Inbox ✓");
      setSubmitTarget(null);
      await loadPayments(currentPage);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit");
    } finally {
      setActionLoading(false);
    }
  };

  const deletePayment = async (id: string) => {
    try {
      await deleteReceivedPayment(Number(id));
      toast.success("Payment deleted");
      await loadPayments(currentPage);
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete payment");
    }
  };

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filtered = payments.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      p.customerName?.toLowerCase().includes(q) ||
      p.receivedFrom.toLowerCase().includes(q) ||
      p.projectName.toLowerCase().includes(q) ||
      p.companyName.toLowerCase().includes(q) ||
      p.docNo.toLowerCase().includes(q) ||
      p.id.includes(q);
    return (
      matchSearch &&
      (filterMode === "All" || p.mode === filterMode) &&
      (filterStatus === "All" || p.status === filterStatus)
    );
  });

  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);
  const approved = payments.filter((p) => p.status === "Approved").length;
  const submitted = payments.filter((p) => p.status === "Pending").length;


  const stats = [
    {
      label: "Total Received",
      value: fmt(totalReceived),
      sub: "total inbound",
      icon: IndianRupee,
      ring: "ring-emerald-500/20",
      bg: "bg-emerald-500/10",
      blob: "bg-emerald-500",
      borderL: "border-l-emerald-500",
      color: "text-emerald-500",
    },
    {
      label: "Total Entries",
      value: String(totalCount),
      sub: "all records",
      icon: ArrowDownCircle,
      ring: "ring-primary/20",
      bg: "bg-primary/10",
      blob: "bg-primary",
      borderL: "border-l-primary",
      color: "text-primary",
    },
    {
      label: "Cleared",
      value: String(approved),
      sub: "approved",
      icon: CheckCircle2,
      ring: "ring-emerald-500/20",
      bg: "bg-emerald-500/10",
      blob: "bg-emerald-500",
      borderL: "border-l-emerald-500",
      color: "text-emerald-500",
    },
    {
      label: "Submitted",
      value: String(submitted),
      sub: "awaiting approval",
      icon: Clock,
      ring: "ring-amber-500/20",
      bg: "bg-amber-500/10",
      blob: "bg-amber-500",
      borderL: "border-l-amber-500",
      color: "text-amber-500",
    },
  ];

  const needsBankRef = ["Check", "UPI", "NEFT", "RTGS", "Card"].includes(
    form.mode,
  );

  // ── Print receipt ─────────────────────────────────────────────────────────────
  const handlePrintPayment = (p: ReceivedPayment) => {
    const statusColor: Record<string, string> = {
      Draft: "#64748b",
      Pending: "#d97706",
      Approved: "#059669",
      Rejected: "#dc2626",
    };
    const sColor = statusColor[p.status] ?? "#64748b";

    const field = (label: string, value: string | null | undefined) =>
      value
        ? `<tr>
            <td style="padding:7px 12px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;width:160px;">${label}</td>
            <td style="padding:7px 12px;font-size:13px;font-weight:500;color:#111827;">${value}</td>
           </tr>`
        : "";

    const rows = [
      field("Received From", p.customerName || p.receivedFrom),
      field("Financial Year", p.finYear || "—"),
      field("Company", p.companyName),
      field("Project", p.projectName),
      field("Deposit Bank", p.depositBankName || "—"),
      field("Customer Bank", p.bankName || "—"),
      field("Cheque No.", p.checkNumber || null),
      field("Transaction ID", p.transactionId || null),
      field("Remarks", p.remarks || null),
    ].join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt — ${p.docNo || ""}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111827; padding: 36px; }
    table { border-collapse: collapse; width: 100%; }
    tr:nth-child(even) { background: #f9fafb; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #10b981;margin-bottom:20px;">
    <div>
      <div style="font-size:18px;font-weight:800;color:#111827;">${p.companyName || "—"}</div>
      <div style="font-size:13px;font-weight:600;font-family:monospace;color:#6b7280;margin-top:2px;">${p.docNo || ""}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:20px;font-weight:800;color:#10b981;letter-spacing:-0.5px;">RECEIPT</div>
      <div style="margin-top:6px;">
        <span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${sColor}18;color:${sColor};border:1px solid ${sColor}40;">${p.status}</span>
      </div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">${p.docDate ? new Date(p.docDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;padding:16px 20px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Amount Received</div>
      <div style="font-size:28px;font-weight:800;color:#10b981;font-family:monospace;">+${fmt(p.amount)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Mode</div>
      <div style="font-size:15px;font-weight:700;color:#111827;">${p.mode}</div>
    </div>
  </div>
  <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <table><tbody>${rows}</tbody></table>
  </div>
  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "width=800,height=680");
    if (!win) {
      URL.revokeObjectURL(url);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Received Payments"]} />
      <FinanceShell
        title="Received Payments"
        subtitle="All inbound payments received from clients & customers"
        icon={Banknote}
        action={
          view === "list" ? (
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {rights.canCreate && (
                <Button
                  onClick={openAdd}
                  className="shrink-0 gradient-accent text-white shadow-sm font-heading font-semibold px-3 sm:px-4 py-1.5 text-xs h-auto"
                >
                  <Plus size={13} className="sm:mr-1" />
                  <span className="hidden sm:inline">Add Payment</span>
                </Button>
              )}
              <ExportMenu
                data={payments as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Received Payments"
                filename="received-payments"
                disabled={apiLoading || payments.length === 0 || !rights.canExport}
              />
              <button
                onClick={() => loadPayments(1)}
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

        {view === "list" && <>
        {/* ── Stats ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${s.ring} ${s.borderL}`}
            >
              <div className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${s.blob}`} />
              <div className={`p-2 rounded-lg ${s.bg} ${s.color} shrink-0`}>
                <s.icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold font-heading text-foreground leading-none">
                  {s.value}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                  {s.label}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                  {s.sub}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-4">
          <Input
            placeholder="Search by customer, company, project, doc no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs w-full sm:max-w-72 sm:flex-1 sm:min-w-0"
          />
          <div className="flex gap-2">
            <Select value={filterMode} onValueChange={setFilterMode}>
              <SelectTrigger className="h-8 text-xs flex-1 sm:w-32">
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Modes</SelectItem>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs flex-1 sm:w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Pending">Pending Approval</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="font-heading font-semibold text-foreground text-sm">
              All Received Payments
            </h2>
            <span className="text-xs text-muted-foreground">
              {filtered.length} entries
            </span>
          </div>

          {apiLoading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground text-sm">
              <Loader2 size={18} className="animate-spin" />
              Loading payments…
            </div>
          ) : payments.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              No results match your filters.
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        "Doc No.",
                        "Date",
                        "Fin Year",
                        "Company",
                        "Project",
                        "Customer",
                        "Mode",
                        "Deposit Bank",
                        "Amount (₹)",
                        "Status",
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => (
                      <tr
                        key={p.id}
                        className={`border-b border-border hover:bg-muted/50 transition-colors ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                      >
                        <td className="px-4 py-3 text-primary font-heading text-xs font-medium whitespace-nowrap">
                          {p.docNo}
                        </td>
                        <td className="px-4 py-3 text-foreground whitespace-nowrap text-xs">
                          {p.docDate ? format(new Date(p.docDate), "dd/MM/yyyy") : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {p.finYear || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[110px] truncate">
                          {p.companyName}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[110px] truncate">
                          {p.projectName}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground text-xs max-w-[120px] truncate">
                          {p.customerName || p.receivedFrom}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading w-fit ${modeColor[p.mode]}`}
                          >
                            {modeIcon(p.mode)}
                            {p.mode}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[110px] truncate">
                          {p.depositBankName || "—"}
                        </td>
                        <td className="px-4 py-3 font-heading font-semibold text-emerald-600 whitespace-nowrap text-xs">
                          +{fmt(p.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setViewingPayment(p)}
                              title="View"
                              className="p-1.5 rounded-md text-muted-foreground/50 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                            >
                              <Eye size={13} />
                            </button>
                            {rights.canPrint && (
                              <button
                                onClick={() => handlePrintPayment(p)}
                                title="Print"
                                className="p-1.5 rounded-md text-muted-foreground/50 hover:text-sky-600 hover:bg-sky-500/10 transition-colors"
                              >
                                <Printer size={13} />
                              </button>
                            )}
                            {(p.status === "Draft" || p.status === "Approved") && (
                              <EditOrAmendButton
                                refDocType="ReceivedPayment"
                                refDocId={p.id}
                                docStatus={p.status}
                                docNo={p.docNo}
                                projectName={p.projectName}
                                companyName={p.companyName}
                                totalAmount={p.amount}
                                amendTab="RECEIVED_PAYMENT"
                                amendMenuPath="/material/amendment-menu"
                                canEdit={rights.canEdit}
                                onEdit={() => openEdit(p)}
                              />
                            )}
                            {p.status === "Draft" && (
                              <button
                                onClick={() => setSubmitTarget(p)}
                                title="Submit for Approval"
                                className="p-1.5 rounded-md text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <SendHorizontal size={13} />
                              </button>
                            )}
                            {p.status === "Pending" && (
                              <span
                                title="Awaiting admin approval"
                                className="p-1.5 rounded-md text-amber-500/60 cursor-default inline-flex"
                              >
                                <Clock size={13} />
                              </span>
                            )}
                            {rights.canDelete && (
                              <button
                                onClick={() => deletePayment(p.id)}
                                title="Delete"
                                className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="sm:hidden divide-y divide-border">
                {filtered.map((p) => (
                  <div key={p.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-primary font-heading font-medium">
                          {p.docNo}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.companyName} · {p.finYear}
                        </p>
                        <p className="text-sm font-semibold text-foreground">
                          {p.customerName || p.receivedFrom}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.projectName} ·{" "}
                          {p.docDate ? format(new Date(p.docDate), "dd/MM/yyyy") : "—"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-heading font-bold text-emerald-600">
                          +{fmt(p.amount)}
                        </p>
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading w-fit ${modeColor[p.mode]}`}
                      >
                        {modeIcon(p.mode)}
                        {p.mode}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewingPayment(p)}
                          className="p-1.5 text-muted-foreground/50 hover:text-emerald-600"
                          title="View"
                        >
                          <Eye size={13} />
                        </button>
                        {rights.canPrint && (
                          <button
                            onClick={() => handlePrintPayment(p)}
                            className="p-1.5 text-muted-foreground/50 hover:text-sky-600"
                            title="Print"
                          >
                            <Printer size={13} />
                          </button>
                        )}
                        {(p.status === "Draft" || p.status === "Approved") && (
                          <EditOrAmendButton
                            refDocType="ReceivedPayment"
                            refDocId={p.id}
                            docStatus={p.status}
                            docNo={p.docNo}
                            projectName={p.projectName}
                            companyName={p.companyName}
                            totalAmount={p.amount}
                            amendTab="RECEIVED_PAYMENT"
                            amendMenuPath="/material/amendment-menu"
                            canEdit={rights.canEdit}
                            onEdit={() => openEdit(p)}
                          />
                        )}
                        {p.status === "Draft" && (
                          <button
                            onClick={() => setSubmitTarget(p)}
                            className="p-1.5 text-muted-foreground/50 hover:text-primary"
                            title="Submit for Approval"
                          >
                            <SendHorizontal size={13} />
                          </button>
                        )}
                        {p.status === "Pending" && (
                          <span
                            title="Awaiting admin approval"
                            className="p-1.5 text-amber-500/60 cursor-default inline-flex"
                          >
                            <Clock size={13} />
                          </span>
                        )}
                        {rights.canDelete && (
                          <button
                            onClick={() => deletePayment(p.id)}
                            className="p-1.5 text-muted-foreground/50 hover:text-destructive"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages} · {totalCount} total
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadPayments(currentPage - 1)}
                disabled={currentPage <= 1 || apiLoading}
                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => loadPayments(currentPage + 1)}
                disabled={currentPage >= totalPages || apiLoading}
                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
        </>}

        {/* ── Inline Add / Edit Form ──────────────────────────────────────────── */}
        {view === "form" && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: isDark ? "rgba(12,14,22,0.55)" : "rgba(255,255,255,0.80)",
              border: isDark ? "1px solid rgba(99,102,241,0.20)" : "1px solid rgba(99,102,241,0.18)",
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
                background: isDark ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.06)",
                borderBottom: isDark ? "1px solid rgba(99,102,241,0.18)" : "1px solid rgba(99,102,241,0.14)",
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-0.5"
                style={{ background: "linear-gradient(to bottom, transparent 10%, #6366f1 30%, #6366f1 70%, transparent 90%)" }}
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
                <span style={{ color: isDark ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.3)" }}>|</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.30)" }}
                  >
                    <ArrowDownCircle size={12} style={{ color: "#818cf8" }} />
                  </div>
                  <h2
                    className="text-sm font-heading font-bold"
                    style={{ color: isDark ? "#e0e7ff" : "#3730a3" }}
                  >
                    {editingId ? "Edit Received Payment" : "Record Received Payment"}
                  </h2>
                </div>
              </div>
            </div>

          <div className="px-5 sm:px-6 py-6">
            {/* ── Two-column layout: form left, calendar right ── */}
            <div className="grid grid-cols-1 gap-8">
              {/* LEFT — form fields */}
              <div className="space-y-5">
                {/* Row 1: Company + Project */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Company</FieldLabel>
                    <Select
                      value={form.companyId}
                      onValueChange={(v) => {
                        const co = companies.find((c) => String(c.id) === v);
                        setForm((f) => ({
                          ...f,
                          companyId: v,
                          companyName: co?.label ?? "",
                          projectId: "",
                          projectName: "",
                          depositBankId: "",
                          depositBankName: "",
                        }));
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select company…" />
                      </SelectTrigger>
                      <SelectContent>
                        {companies.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel required>Project</FieldLabel>
                    <Select
                      value={form.projectId}
                      onValueChange={(v) => {
                        const proj = filteredProjects.find(
                          (p) => String(p.id) === v,
                        );
                        setForm((f) => ({
                          ...f,
                          projectId: v,
                          projectName: proj?.label ?? "",
                        }));
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select project…" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredProjects.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Date of Receipt */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Date of Receipt</FieldLabel>
                    <input
                      type="date"
                      value={date ? format(date, "yyyy-MM-dd") : ""}
                      onChange={(e) =>
                        setDate(
                          e.target.value ? new Date(e.target.value) : undefined,
                        )
                      }
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    />
                  </div>
                </div>

                {/* Row 2: Fin Year + Payment Mode */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Financial Year</FieldLabel>
                    <Select
                      value={form.finYear}
                      onValueChange={(v) => setField("finYear", v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select fin year…" />
                      </SelectTrigger>
                      <SelectContent>
                        {finYearOptions.map((fy) => (
                          <SelectItem key={fy.id} value={fy.year}>
                            {fy.year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel required>Payment Type</FieldLabel>
                    <Select
                      value={form.mode}
                      onValueChange={(v) => setField("mode", v as PaymentMode)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            <span className="flex items-center gap-2">
                              {modeIcon(m)} {m}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Row 3: Customer + Deposit Bank */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Customer Name</FieldLabel>
                    <CustomerCombobox
                      value={form.customerName}
                      onChange={(v) => setField("customerName", v)}
                      customers={customers}
                    />
                  </div>
                  <div>
                    <FieldLabel required>Deposit Bank</FieldLabel>
                    <Select
                      value={form.depositBankId}
                      disabled={!form.companyId}
                      onValueChange={(v) => {
                        const bank = depositBanks.find(
                          (b) => String(b.BId) === v,
                        );
                        setForm((f) => ({
                          ...f,
                          depositBankId: v,
                          depositBankName: bank
                            ? `${bank.BName}${bank.BBranch ? ` – ${bank.BBranch}` : ""}`
                            : "",
                        }));
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue
                          placeholder={
                            form.companyId
                              ? "Select deposit bank…"
                              : "Select company first"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {depositBanks.map((b) => (
                          <SelectItem key={b.BId} value={String(b.BId)}>
                            <span className="flex items-center gap-2">
                              <Landmark
                                size={13}
                                className="text-muted-foreground"
                              />
                              {b.BName}
                              {b.BBranch ? ` – ${b.BBranch}` : ""}
                              {b.BAccountNumber ? (
                                <span className="text-muted-foreground text-[10px]">
                                  ···{b.BAccountNumber.slice(-4)}
                                </span>
                              ) : null}
                            </span>
                          </SelectItem>
                        ))}
                        {depositBanks.length === 0 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            No active banks found for this company
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Row 3b: Contract (optional) — tags this payment as an
                    on-account advance when no invoice exists yet. */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Contract (optional)</FieldLabel>
                    <Select
                      value={form.contractId}
                      onValueChange={(v) => setField("contractId", v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Not linked to a contract" />
                      </SelectTrigger>
                      <SelectContent>
                        {contracts.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Row 4: Amount + Doc No */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Amount (₹)</FieldLabel>
                    <div className="relative">
                      <IndianRupee
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        type="number"
                        className="pl-8 h-9 text-sm font-mono"
                        placeholder="0.00"
                        value={form.amount}
                        onChange={(e) => setField("amount", e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Document Number</FieldLabel>
                    {docNoLoading ? (
                      <div className="h-9 flex items-center gap-2 px-3 text-sm text-muted-foreground border border-input rounded-md bg-muted/30">
                        <Loader2 size={13} className="animate-spin shrink-0" />
                        Generating…
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "h-9 flex items-center justify-between gap-2 px-3 rounded-md border font-heading font-semibold text-sm",
                          docNoPreview || form.docNo
                            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                            : "border-input bg-muted/30 text-muted-foreground font-normal",
                        )}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Hash size={13} className="shrink-0 opacity-60" />
                          <span className="truncate">
                            {docNoPreview ||
                              form.docNo ||
                              (recDocTypeId ? "Auto-assigned" : "Resolving…")}
                          </span>
                        </span>
                        {(docNoPreview || form.docNo) && !editingId && (
                          <button
                            onClick={() =>
                              refreshDocNo(
                                recDocTypeId,
                                form.finYear || activeFinYear,
                              )
                            }
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            title="Refresh"
                          >
                            <RefreshCw size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                      REC / 000001 / {form.finYear || activeFinYear} — locked on
                      save
                    </p>
                  </div>
                </div>

                {/* Row 5: Bank ref (conditional) */}
                {needsBankRef && (
                  <div className="grid grid-cols-2 gap-4">
                    {form.mode === "Check" ? (
                      <div>
                        <FieldLabel>Cheque Number</FieldLabel>
                        <Input
                          className="h-9 text-sm"
                          placeholder="Cheque No."
                          value={form.checkNumber}
                          onChange={(e) =>
                            setField("checkNumber", e.target.value)
                          }
                        />
                        <div className="flex items-end gap-2 mt-2">
                          <div className="flex-1">
                            <FieldLabel>Cheque Date</FieldLabel>
                            <Input
                              type="date"
                              className="h-9 text-sm"
                              value={form.chequeDate ?? ""}
                              onChange={(e) => {
                                const date = e.target.value;
                                setField("chequeDate", date);
                                // Auto-flag as post-dated when the cheque date
                                // is in the future — same convention the
                                // outgoing Payment page already uses for
                                // PIsPostDated, applied here for parity.
                                const today = new Date().toISOString().slice(0, 10);
                                setField("isPostDated", !!date && date > today);
                              }}
                            />
                          </div>
                          <label className="flex items-center gap-1.5 h-9 text-xs text-muted-foreground select-none">
                            <input
                              type="checkbox"
                              checked={form.isPostDated}
                              onChange={(e) => setField("isPostDated", e.target.checked)}
                            />
                            Post-dated
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <FieldLabel>Transaction / UTR Ref</FieldLabel>
                        <Input
                          className="h-9 text-sm"
                          placeholder="Transaction ID / UTR"
                          value={form.transactionId}
                          onChange={(e) =>
                            setField("transactionId", e.target.value)
                          }
                        />
                      </div>
                    )}
                    <div>
                      <FieldLabel>Customer Bank Name</FieldLabel>
                      <Input
                        className="h-9 text-sm"
                        placeholder="Bank of customer"
                        value={form.bankName}
                        onChange={(e) => setField("bankName", e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Row 6: Remarks */}
                <div>
                  <FieldLabel>Remarks</FieldLabel>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-[80px]"
                    placeholder="Optional remarks or notes…"
                    value={form.remarks}
                    onChange={(e) => setField("remarks", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground hidden sm:block">
              {canSave
                ? <span className="text-emerald-500 font-medium">Ready to save</span>
                : "Fill in the required fields to save"}
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
                onClick={handleSubmit}
                disabled={!canSave || actionLoading}
                className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
              >
                {actionLoading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : editingId ? (
                  <Check size={14} />
                ) : (
                  <Plus size={14} />
                )}
                {actionLoading ? "Saving…" : editingId ? "Update Payment" : "Save Payment"}
              </button>
            </div>
          </div>
          </div>
        )}
      </FinanceShell>

      {/* ── Submit for Approval Confirm ─────────────────────────────────────── */}
      <Dialog
        open={!!submitTarget}
        onOpenChange={(o) => {
          if (!o) setSubmitTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base flex items-center gap-2">
              <SendHorizontal size={16} className="text-primary" />
              Submit for Approval
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              This will send the payment to the admin Approval Inbox. You won't
              be able to edit it until it's reviewed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1">
              <p className="text-xs text-muted-foreground font-heading uppercase tracking-wide">
                Payment
              </p>
              <p className="text-sm font-semibold text-foreground">
                {submitTarget?.docNo}
              </p>
              <p className="text-xs text-muted-foreground">
                {submitTarget?.customerName || submitTarget?.receivedFrom}
              </p>
              <p className="text-sm font-mono font-bold text-emerald-600">
                +{submitTarget ? fmt(submitTarget.amount) : ""}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubmitTarget(null)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitForApproval}
              disabled={actionLoading}
              className="gap-1.5"
            >
              {actionLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <SendHorizontal size={13} />
              )}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Receipt Modal ───────────────────────────────────────────────── */}
      {viewingPayment && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setViewingPayment(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/10">
                  <ArrowDownCircle size={15} className="text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-foreground text-sm">
                    {viewingPayment.companyName || "Received Payment"}
                  </h3>
                  {viewingPayment.docNo && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {viewingPayment.docNo}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {rights.canPrint && (
                  <button
                    onClick={() => handlePrintPayment(viewingPayment)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
                    title="Print"
                  >
                    <Printer size={12} /> Print
                  </button>
                )}
                <button
                  onClick={() => setViewingPayment(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Amount highlight */}
            <div className="px-5 pt-4 pb-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-heading uppercase tracking-wider text-emerald-600/70 mb-1">
                    Amount Received
                  </p>
                  <p className="text-2xl font-heading font-bold text-emerald-600">
                    +{fmt(viewingPayment.amount)}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[11px] text-muted-foreground">
                    {viewingPayment.docDate
                      ? new Date(viewingPayment.docDate).toLocaleDateString(
                          "en-IN",
                          {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          },
                        )
                      : "—"}
                  </p>
                  <StatusBadge status={viewingPayment.status} />
                  <span
                    className={`ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading ${modeColor[viewingPayment.mode]}`}
                  >
                    {modeIcon(viewingPayment.mode)}
                    {viewingPayment.mode}
                  </span>
                </div>
              </div>
            </div>

            {/* Fields grid */}
            <div className="px-5 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                {
                  label: "Received From",
                  value:
                    viewingPayment.customerName || viewingPayment.receivedFrom,
                },
                {
                  label: "Financial Year",
                  value: viewingPayment.finYear || "—",
                },
                { label: "Company", value: viewingPayment.companyName },
                { label: "Project", value: viewingPayment.projectName },
                {
                  label: "Deposit Bank",
                  value: viewingPayment.depositBankName || "—",
                },
                {
                  label: "Customer Bank",
                  value: viewingPayment.bankName || "—",
                },
                ...(viewingPayment.checkNumber
                  ? [{ label: "Cheque No.", value: viewingPayment.checkNumber }]
                  : []),
                ...(viewingPayment.transactionId
                  ? [
                      {
                        label: "Transaction ID",
                        value: viewingPayment.transactionId,
                      },
                    ]
                  : []),
              ].map(({ label, value }) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-xs font-medium text-foreground truncate">
                    {value || "—"}
                  </p>
                </div>
              ))}
            </div>

            {/* Remarks */}
            {viewingPayment.remarks && (
              <div className="px-5 pb-3">
                <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-1">
                  Remarks
                </p>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-foreground">
                  {viewingPayment.remarks}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {viewingAmendmentStatus.isAmended && <AmendedBadge />}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Created{" "}
                {viewingPayment.createdAt
                  ? new Date(viewingPayment.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </p>
              {viewingPayment.status === "Pending" && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-600 font-heading font-medium">
                  <Clock size={12} className="text-amber-500 animate-pulse" />
                  Awaiting admin approval
                </span>
              )}
              {viewingPayment.status === "Draft" && (
                <div className="flex items-center gap-2">
                  {rights.canEdit && (
                    <button
                      onClick={() => {
                        setViewingPayment(null);
                        openEdit(viewingPayment);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const p = viewingPayment;
                      setViewingPayment(null);
                      setSubmitTarget(p);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <SendHorizontal size={12} /> Submit
                  </button>
                </div>
              )}
              {viewingPayment.status === "Approved" && rights.canEdit && (
                <EditOrAmendButton
                  refDocType="ReceivedPayment"
                  refDocId={viewingPayment.id}
                  docStatus={viewingPayment.status}
                  docNo={viewingPayment.docNo}
                  projectName={viewingPayment.projectName}
                  companyName={viewingPayment.companyName}
                  totalAmount={viewingPayment.amount}
                  amendTab="RECEIVED_PAYMENT"
                  amendMenuPath="/material/amendment-menu"
                  canEdit={rights.canEdit}
                  size="sm"
                  onEdit={() => {}}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}