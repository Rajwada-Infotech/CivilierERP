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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  Plus,
  CalendarIcon,
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
  ThumbsUp,
  ThumbsDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Landmark,
  Users,
} from "lucide-react";
import {
  getReceivedPayments,
  addReceivedPayment,
  updateReceivedPayment,
  deleteReceivedPayment,
  approveReceivedPayment,
} from "@/api/receivedPaymentApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { getEnterprises, type Enterprise } from "@/api/enterpriseApi";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
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

interface ProjectOption {
  id: number;
  name: string;
  belongsTo: number | null;
}
interface DocTypeOption {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix: string;
  Description: string;
  EntryType: string;
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
  docTypeId: "" as string,
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

// ─── Form Field ───────────────────────────────────────────────────────────────

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
  const [approveTarget, setApproveTarget] = useState<ReceivedPayment | null>(
    null,
  );
  const [rejectNote, setRejectNote] = useState("");
  const PAGE_SIZE = 20;

  // ── Form state ───────────────────────────────────────────────────────────────
  const [form, setForm] = useState(EMPTY_FORM);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calOpen, setCalOpen] = useState(false);
  const [docNoPreview, setDocNoPreview] = useState("");
  const [docNoLoading, setDocNoLoading] = useState(false);

  // ── Master data ───────────────────────────────────────────────────────────────
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [docTypes, setDocTypes] = useState<DocTypeOption[]>([]);

  const finYearOptions = finYears.filter((fy) => fy.status === "Active");
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || "";

  // Load masters
  useEffect(() => {
    getEnterprises()
      .then((data) => setEnterprises(data.filter((e) => !e.discontinue)))
      .catch(() => {});
    getBanks()
      .then((data) => setBanks(data.filter((b) => b.BStatus)))
      .catch(() => {});
    fetchWithAuth("/api/project-master")
      .then((r) => r.json())
      .then((data: any[]) =>
        setProjects(
          (Array.isArray(data) ? data : []).map((p) => ({
            id: p.Id ?? p.id,
            name: p.Name ?? p.name ?? "",
            belongsTo: p.belongs_to ?? null,
          })),
        ),
      )
      .catch(() => {});
    fetchWithAuth("/api/document-type")
      .then((r) => r.json())
      .then((data: any[]) => setDocTypes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // ── Filtered banks: only those linked to selected company ───────────────────
  const depositBanks = useMemo(() => {
    if (!form.companyName) return banks;
    return banks.filter(
      (b) => !b.BCompanyName || b.BCompanyName === form.companyName,
    );
  }, [banks, form.companyName]);

  // ── Projects filtered by selected company ────────────────────────────────────
  const filteredProjects = useMemo(() => {
    if (!form.companyId) return projects;
    const cid = Number(form.companyId);
    return projects.filter((p) => p.belongsTo === cid || p.belongsTo === null);
  }, [projects, form.companyId]);

  // ── Doc number preview ───────────────────────────────────────────────────────
  const refreshDocNo = useCallback(
    async (docTypeId: string, finYear: string) => {
      if (!docTypeId) {
        setDocNoPreview("");
        return;
      }
      setDocNoLoading(true);
      try {
        const next = await fetchNextDocNumber(
          Number(docTypeId),
          finYear || undefined,
        );
        setDocNoPreview(next);
      } catch {
        setDocNoPreview("");
      } finally {
        setDocNoLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!editingId) refreshDocNo(form.docTypeId, form.finYear);
  }, [form.docTypeId, form.finYear, editingId, refreshDocNo]);

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
            `RCP-${String(r.RPPaymentID).padStart(4, "0")}`,
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
      docTypeId: String(p.docTypeId ?? ""),
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
    if (!form.docTypeId) {
      toast.error("Document type is required");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error("Valid amount is required");
      return;
    }

    setActionLoading(true);
    const payload = {
      RPCompanyName: form.companyName,
      RPCompanyId: Number(form.companyId) || null,
      RPReceivedFrom: form.customerName.trim(),
      RPCustomerName: form.customerName.trim(),
      RPProjectName: form.projectName,
      RPProjectId: Number(form.projectId) || null,
      RPDocDate: date!.toISOString().slice(0, 10),
      RPFinYear: form.finYear,
      RPDocTypeId: Number(form.docTypeId) || null,
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

  const handleApprove = async (action: "approve" | "reject") => {
    if (!approveTarget) return;
    if (action === "reject" && !rejectNote.trim()) {
      toast.error("Rejection reason required");
      return;
    }
    setActionLoading(true);
    try {
      await approveReceivedPayment(
        Number(approveTarget.id),
        action,
        rejectNote || undefined,
      );
      toast.success(
        action === "approve" ? "Payment approved" : "Payment rejected",
      );
      setApproveTarget(null);
      setRejectNote("");
      await loadPayments(currentPage);
    } catch {
      toast.error("Action failed");
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
                              onClick={() => {
                                setApproveTarget(p);
                                setRejectNote("");
                              }}
                              title="Approve / Reject"
                              className="p-1.5 rounded-md text-muted-foreground/50 hover:text-green-500 hover:bg-green-500/10 transition-colors"
                            >
                              <ThumbsUp size={13} />
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
                          onClick={() => {
                            setApproveTarget(p);
                            setRejectNote("");
                          }}
                          className="p-1.5 text-muted-foreground/50 hover:text-green-500"
                        >
                          <ThumbsUp size={13} />
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

      {/* ── Add / Edit Dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={isOpen}
        onOpenChange={(o) => {
          if (!o) {
            setIsOpen(false);
            setEditingId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-base flex items-center gap-2">
              <ArrowDownCircle size={18} className="text-emerald-500" />
              {editingId ? "Edit Payment" : "Record Received Payment"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Fill in all required fields. Document number is auto-generated
              from the selected doc type.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Row 1: Company + Project */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel required>Company</FieldLabel>
                <Select
                  value={form.companyId}
                  onValueChange={(v) => {
                    const ent = enterprises.find((e) => String(e.id) === v);
                    setForm((f) => ({
                      ...f,
                      companyId: v,
                      companyName: ent?.name ?? "",
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
                    {enterprises.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel required>Project</FieldLabel>
                <Select
                  value={form.projectId}
                  disabled={!form.companyId}
                  onValueChange={(v) => {
                    const proj = filteredProjects.find(
                      (p) => String(p.id) === v,
                    );
                    setForm((f) => ({
                      ...f,
                      projectId: v,
                      projectName: proj?.name ?? "",
                    }));
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue
                      placeholder={
                        form.companyId
                          ? "Select project…"
                          : "Select company first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProjects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Fin Year + Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel required>Financial Year</FieldLabel>
                <Select
                  value={form.finYear}
                  onValueChange={(v) => {
                    setField("finYear", v);
                  }}
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
                <FieldLabel required>Date of Receipt</FieldLabel>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "w-full h-9 px-3 text-sm text-left flex items-center gap-2 rounded-md border border-input bg-background hover:bg-muted/40 transition-colors",
                        !date && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                      {date ? format(date, "dd MMM yyyy") : "Pick a date"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={date}
                      onSelect={(d) => {
                        setDate(d);
                        setCalOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Row 3: Customer name + Payment mode */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel required>Customer Name</FieldLabel>
                <div className="relative">
                  <Users
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    className="pl-8 h-9 text-sm"
                    placeholder="Customer / received from…"
                    value={form.customerName}
                    onChange={(e) => setField("customerName", e.target.value)}
                  />
                </div>
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
                          {modeIcon(m)}
                          {m}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4: Deposit Bank */}
            <div>
              <FieldLabel required>Deposit Bank</FieldLabel>
              <Select
                value={form.depositBankId}
                disabled={!form.companyId}
                onValueChange={(v) => {
                  const bank = depositBanks.find((b) => String(b.BId) === v);
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
                        <Landmark size={13} className="text-muted-foreground" />
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

            {/* Row 5: Doc Type + Doc No */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel required>Document Type</FieldLabel>
                <Select
                  value={form.docTypeId}
                  disabled={!!editingId}
                  onValueChange={(v) => {
                    const dt = docTypes.find(
                      (d) => String(d.TypeOfDocId) === v,
                    );
                    setForm((f) => ({ ...f, docTypeId: v }));
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select doc type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {docTypes.map((d) => (
                      <SelectItem
                        key={d.TypeOfDocId}
                        value={String(d.TypeOfDocId)}
                      >
                        {d.FullPrefix || d.Prefix} —{" "}
                        {d.Description || d.EntryType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel>Document Number</FieldLabel>
                <div className="relative">
                  <Hash
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  {docNoLoading ? (
                    <div className="pl-8 h-9 flex items-center text-sm text-muted-foreground border border-input rounded-md bg-muted/30 px-3">
                      <Loader2 size={13} className="animate-spin mr-1.5" />
                      Generating…
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "pl-8 h-9 flex items-center text-sm border rounded-md px-3",
                        docNoPreview || form.docNo
                          ? "border-primary/30 bg-primary/5 text-primary font-heading font-semibold"
                          : "border-input bg-muted/30 text-muted-foreground",
                      )}
                    >
                      {docNoPreview ||
                        form.docNo ||
                        (form.docTypeId
                          ? "Will be assigned on save"
                          : "Select a doc type first")}
                      {(docNoPreview || form.docNo) && !editingId && (
                        <button
                          onClick={() =>
                            refreshDocNo(form.docTypeId, form.finYear)
                          }
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          title="Refresh"
                        >
                          <RefreshCw size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Row 6: Amount */}
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

            {/* Row 7: Bank Ref (conditional) */}
            {needsBankRef && (
              <div className="grid grid-cols-2 gap-4">
                {form.mode === "Check" ? (
                  <div>
                    <FieldLabel>Cheque Number</FieldLabel>
                    <Input
                      className="h-9 text-sm"
                      placeholder="Cheque No."
                      value={form.checkNumber}
                      onChange={(e) => setField("checkNumber", e.target.value)}
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

            {/* Row 8: Remarks */}
            <div>
              <FieldLabel>Remarks</FieldLabel>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-[72px]"
                placeholder="Optional remarks or notes…"
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
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

      {/* ── Approve / Reject Dialog ────────────────────────────────────────────── */}
      <Dialog
        open={!!approveTarget}
        onOpenChange={(o) => {
          if (!o) setApproveTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">
              Approve or Reject Payment
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {approveTarget?.docNo} ·{" "}
              {approveTarget && fmt(approveTarget.amount)} ·{" "}
              {approveTarget?.customerName || approveTarget?.receivedFrom}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <FieldLabel>Rejection Reason (if rejecting)</FieldLabel>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-[64px]"
                placeholder="Reason for rejection…"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setApproveTarget(null)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleApprove("reject")}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 size={13} className="animate-spin mr-1" />
              ) : (
                <ThumbsDown size={13} className="mr-1" />
              )}
              Reject
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleApprove("approve")}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 size={13} className="animate-spin mr-1" />
              ) : (
                <ThumbsUp size={13} className="mr-1" />
              )}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
