import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
} from "lucide-react";
import {
  getReceivedPayments,
  addReceivedPayment,
  updateReceivedPayment,
  deleteReceivedPayment,
} from "@/api/receivedPaymentApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  fetchDocTypes,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { formatINR } from "@/utils/formatCurrency";

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
  remarks?: string;
  status: "Draft" | "Approved" | "Rejected";
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
  remarks: "",
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
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <ArrowDownCircle size={30} className="text-primary" />
      </div>
      <h3 className="font-heading font-semibold text-foreground text-base mb-1">
        No received payments yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Use the{" "}
        <span className="font-semibold text-foreground">Add Payment</span>{" "}
        button above to record your first payment.
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReceivedPaymentPage() {
  const { finYears } = useFinYear();

  const [payments, setPayments] = useState<ReceivedPayment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
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
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  // TypeOfDocId for the RECP doc type — resolved once on mount via module filter
  const [recDocTypeId, setRecDocTypeId] = useState<number | null>(null);

  const finYearOptions = finYears.filter((fy) => fy.status === "Active");
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || "";

  // Load masters
  useEffect(() => {
    // Companies: enterprise table WHERE business_type = 'C'
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json())
      .then((data: any[]) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => {});

    getBanks()
      .then((data) => setBanks(data.filter((b) => b.BStatus)))
      .catch(() => {});

    // Projects: enterprise table WHERE business_type = 'P', with belongs_to for company filter
    fetchWithAuth("/api/enterprises/options?business_type=P")
      .then((r) => r.json())
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
      .then((r) => r.json())
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
    return banks.filter(
      (b) => !b.BCompanyName || b.BCompanyName === selectedCompanyLabel,
    );
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
          transactionId: r.RPTransactionId ?? undefined,
          checkNumber: r.RPCheckNumber ?? undefined,
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

  const setField = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // ── Open add dialog ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, finYear: activeFinYear });
    setDate(new Date());
    setDocNoPreview("");
    setIsOpen(true);
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
      remarks: p.remarks ?? "",
    });
    setDate(p.docDate ? new Date(p.docDate) : new Date());
    setDocNoPreview(p.docNo);
    setIsOpen(true);
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
      RPTransactionId: form.transactionId || null,
      RPCheckNumber: form.checkNumber || null,
      RPRemarks: form.remarks || null,
      RPDepositBankId: Number(form.depositBankId) || null,
      RPDepositBankName: form.depositBankName || null,
    };

    try {
      if (editingId) {
        await updateReceivedPayment(Number(editingId), payload as any);
        toast.success("Payment updated");
      } else {
        await addReceivedPayment(payload as any);
        toast.success("Payment recorded successfully");
      }
      setIsOpen(false);
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
    } catch {
      toast.error("Failed to delete payment");
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
  const pending = payments.filter((p) => p.status === "Draft").length;

  const stats = [
    {
      label: "Total Received",
      value: fmt(totalReceived),
      icon: IndianRupee,
      color: "hsl(142,71%,45%)",
    },
    {
      label: "Total Entries",
      value: String(totalCount),
      icon: ArrowDownCircle,
      color: "hsl(var(--primary))",
    },
    {
      label: "Cleared",
      value: String(approved),
      icon: CheckCircle2,
      color: "hsl(142,71%,45%)",
    },
    {
      label: "Pending",
      value: String(pending),
      icon: Clock,
      color: "hsl(38,92%,50%)",
    },
  ];

  const needsBankRef = ["Check", "UPI", "NEFT", "RTGS", "Card"].includes(
    form.mode,
  );

  return (
    <>
      <Breadcrumbs items={["Finance", "Received Payments"]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <ArrowDownCircle size={20} className="text-emerald-500" />
            Received Payments
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
            All inbound payments received from clients &amp; customers
          </p>
        </div>
        <Button size="sm" onClick={openAdd} className="shrink-0">
          <Plus size={15} className="mr-1" />
          Add Payment
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-card border border-border p-4 flex items-center gap-3"
            style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
          >
            <div
              className="p-2 rounded-lg shrink-0"
              style={{ background: `${s.color}20` }}
            >
              <s.icon size={18} style={{ color: s.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-heading truncate">
                {s.label}
              </p>
              <p className="text-base font-heading font-bold text-foreground truncate">
                {s.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Search by customer, company, project, doc no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs max-w-72 flex-1 min-w-0 sm:flex-none"
        />
        <Select value={filterMode} onValueChange={setFilterMode}>
          <SelectTrigger className="h-8 text-xs w-32">
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
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
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
                        {format(new Date(p.docDate), "dd/MM/yyyy")}
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
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                            p.status === "Approved"
                              ? "bg-green-500/15 text-green-600"
                              : p.status === "Rejected"
                                ? "bg-red-500/15 text-red-600"
                                : "bg-yellow-500/15 text-yellow-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {p.status === "Draft" && (
                            <button
                              onClick={() => openEdit(p)}
                              title="Edit"
                              className="p-1.5 rounded-md text-muted-foreground/50 hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
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
                          <button
                            onClick={() => deletePayment(p.id)}
                            title="Delete"
                            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
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
                        {format(new Date(p.docDate), "dd/MM/yyyy")}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-heading font-bold text-emerald-600">
                        +{fmt(p.amount)}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                          p.status === "Approved"
                            ? "bg-green-500/15 text-green-600"
                            : p.status === "Rejected"
                              ? "bg-red-500/15 text-red-600"
                              : "bg-yellow-500/15 text-yellow-600"
                        }`}
                      >
                        {p.status}
                      </span>
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
                      {p.status === "Draft" && (
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 text-muted-foreground/50 hover:text-blue-500"
                        >
                          <Pencil size={13} />
                        </button>
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
                      <button
                        onClick={() => deletePayment(p.id)}
                        className="p-1.5 text-muted-foreground/50 hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
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

      {/* ── Add / Edit Dialog ────────────────────────────────────────────────── */}
      <Dialog
        open={isOpen}
        onOpenChange={(o) => {
          if (!o) {
            setIsOpen(false);
            setEditingId(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0">
          {/* Header */}
          <DialogHeader className="px-7 pt-6 pb-4 border-b border-border bg-muted/20">
            <DialogTitle className="font-heading text-lg flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-500/10">
                <ArrowDownCircle size={18} className="text-emerald-500" />
              </div>
              {editingId ? "Edit Received Payment" : "Record Received Payment"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Fill in all required fields. Document number is auto-generated
              (REC/XXXXXX/YYYY-YYYY).
            </DialogDescription>
          </DialogHeader>

          <div className="px-7 py-6">
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
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
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

          <DialogFooter className="px-7 py-4 border-t border-border bg-muted/10 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={actionLoading}>
              {actionLoading ? (
                <Loader2 size={14} className="animate-spin mr-1.5" />
              ) : null}
              {editingId ? "Update Payment" : "Save Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  );
}
