import React, { useState, useEffect, useMemo } from "react";
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
  Layers,
  Check,
} from "lucide-react";
import {
  getReceivedPayments,
  addReceivedPayment,
  deleteReceivedPayment,
} from "@/api/receivedPaymentApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { getEnterprises } from "@/api/enterpriseApi";
import { getWorkOrders } from "@/api/workOrderApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaymentMode =
  | "Cash"
  | "Check"
  | "UPI"
  | "NEFT"
  | "RTGS"
  | "Card"
  | "EMI";

export type EmiInstallment = {
  emiNo: number;
  dueDate: string;
  amount: number;
  paid: boolean;
};

export type ReceivedPayment = {
  id: string;
  companyName: string;
  receivedFrom: string;
  projectName: string;
  docDate: string;
  mode: PaymentMode;
  amount: number;
  bankName?: string;
  transactionId?: string;
  checkNumber?: string;
  remarks?: string;
  status: "pending" | "cleared";
  createdAt: string;
  isEmi?: boolean;
  emiTotal?: number;
  emiMonths?: number;
  emiStartDate?: string;
  emiSchedule?: EmiInstallment[];
  emiPaying?: number[];
};

// ─── Static Data ──────────────────────────────────────────────────────────────

const PAYMENT_MODES: PaymentMode[] = [
  "Cash",
  "Check",
  "UPI",
  "NEFT",
  "RTGS",
  "Card",
  "EMI",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const generateEmiSchedule = (
  total: number,
  months: number,
  startDate: string,
): EmiInstallment[] => {
  const emiAmt = parseFloat((total / months).toFixed(2));
  const start = new Date(startDate);
  return Array.from({ length: months }, (_, i) => {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    return {
      emiNo: i + 1,
      dueDate: due.toISOString().slice(0, 10),
      amount:
        i === months - 1
          ? parseFloat((total - emiAmt * (months - 1)).toFixed(2))
          : emiAmt,
      paid: false,
    };
  });
};

const modeIcon = (mode: string) => {
  if (mode === "Cash")
    return <Banknote size={13} className="text-emerald-500" />;
  if (mode === "Check") return <FileText size={13} className="text-blue-500" />;
  if (mode === "UPI")
    return <Smartphone size={13} className="text-violet-500" />;
  if (mode === "Card")
    return <CreditCard size={13} className="text-orange-500" />;
  if (mode === "EMI") return <Layers size={13} className="text-primary" />;
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

// ─── EMI Schedule Table — calm neutral palette ────────────────────────────────

function EmiScheduleTable({
  schedule,
  payingNos,
  onToggle,
}: {
  schedule: EmiInstallment[];
  payingNos: number[];
  onToggle: (emiNo: number) => void;
}) {
  const totalAmount = schedule.reduce((s, e) => s + e.amount, 0);
  const payingTotal = schedule
    .filter((e) => payingNos.includes(e.emiNo))
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Summary banner — neutral tones */}
      <div className="grid grid-cols-3 divide-x divide-border bg-muted/40 border-b border-border">
        <div className="px-3 py-2.5 text-center">
          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide font-semibold">
            Total Amount
          </p>
          <p className="text-xs font-bold text-foreground font-mono">
            {fmt(totalAmount)}
          </p>
        </div>
        <div className="px-3 py-2.5 text-center">
          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide font-semibold">
            Instalments
          </p>
          <p className="text-xs font-bold text-foreground">
            {schedule.length} months
          </p>
        </div>
        <div className="px-3 py-2.5 text-center">
          <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide font-semibold">
            Per EMI
          </p>
          <p className="text-xs font-bold text-foreground font-mono">
            {fmt(schedule[0]?.amount ?? 0)}
          </p>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[20px_48px_1fr_80px] gap-2 items-center px-3 py-2 bg-muted/20 border-b border-border">
        <div />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          No.
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Due Date
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide text-right">
          Amount
        </span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border max-h-52 overflow-y-auto">
        {schedule.map((e) => {
          const isPaying = payingNos.includes(e.emiNo);
          const isOverdue = new Date(e.dueDate) < new Date() && !e.paid;
          return (
            <button
              key={e.emiNo}
              type="button"
              onClick={() => onToggle(e.emiNo)}
              className={`w-full grid grid-cols-[20px_48px_1fr_80px] gap-2 items-center px-3 py-2.5 text-left transition-colors
                ${isPaying ? "bg-muted/50" : "hover:bg-muted/30"}`}
            >
              {/* Checkbox — plain, no loud color */}
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                ${isPaying ? "bg-foreground border-foreground" : "border-border bg-background"}`}
              >
                {isPaying && <Check size={10} className="text-background" />}
              </div>

              <span className="text-xs font-mono font-semibold text-muted-foreground">
                #{e.emiNo}
              </span>

              <span className="text-xs text-foreground flex items-center gap-1.5">
                {format(new Date(e.dueDate), "dd MMM yyyy")}
                {isOverdue && (
                  <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium border border-border">
                    Overdue
                  </span>
                )}
              </span>

              <span
                className={`text-xs font-semibold text-right ${isPaying ? "text-foreground" : "text-muted-foreground"}`}
              >
                {fmt(e.amount)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {payingNos.length > 0 ? (
        <div className="px-3 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Paying{" "}
            <span className="font-semibold text-foreground">
              {payingNos.length}
            </span>{" "}
            instalment{payingNos.length !== 1 ? "s" : ""}
            <span className="text-muted-foreground/60 ml-1">
              (#{payingNos.join(", #")})
            </span>
          </span>
          <span className="text-sm font-bold text-foreground">
            {fmt(payingTotal)}
          </span>
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-border bg-muted/10 text-center text-[11px] text-muted-foreground">
          Select instalment(s) to mark as paying
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const EMPTY_FORM = {
  companyName: "",
  receivedFrom: "",
  projectName: "",
  mode: "NEFT" as PaymentMode,
  amount: "",
  bankName: "",
  transactionId: "",
  checkNumber: "",
  remarks: "",
};

export default function ReceivedPaymentPage() {
  const [payments, setPayments] = useState<ReceivedPayment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  const [form, setForm] = useState(EMPTY_FORM);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calOpen, setCalOpen] = useState(false);

  const [emiSchedule, setEmiSchedule] = useState<EmiInstallment[]>([]);
  const [emiPayingNos, setEmiPayingNos] = useState<number[]>([]);
  const [emiFetching, setEmiFetching] = useState(false);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);

  // Auto-generate transaction ID: TXN-YYYYMMDD-XXXXXX
  const generateTxnId = () => {
    const d = new Date();
    const datePart = d.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).toUpperCase().slice(2, 8);
    return `TXN-${datePart}-${rand}`;
  };

  useEffect(() => {
    getBanks()
      .then((data) => setBanks(data.filter((b) => b.BStatus)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getEnterprises()
      .then((data: any[]) =>
        setCompanies(
          data
            .filter((e) => !e.discontinue && e.status !== "Inactive")
            .map((e) => ({ id: e.id, name: e.name }))
        )
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    getWorkOrders()
      .then((res: any) => {
        const rows = Array.isArray(res) ? res : res.data ?? [];
        const seen = new Set<string>();
        const unique: { id: number; name: string }[] = [];
        for (const wo of rows) {
          if (wo.ProjectName && !seen.has(wo.ProjectName)) {
            seen.add(wo.ProjectName);
            unique.push({ id: wo.ProjectId, name: wo.ProjectName });
          }
        }
        setProjects(unique);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (form.mode === "EMI" && form.projectName) {
      setEmiFetching(true);
      setEmiSchedule([]);
      setEmiPayingNos([]);
      const project = projects.find((p) => p.name === form.projectName);
      if (!project) {
        setEmiFetching(false);
        return;
      }
      getWorkOrders()
        .then((res: any) => {
          const rows = Array.isArray(res) ? res : res.data ?? [];
          // Find the most recent work order for this project
          const wo = rows.find((w: any) => w.ProjectId === project.id || w.ProjectName === form.projectName);
          if (wo && wo.TotalAmount && wo.DocumentDate) {
            // Default to 6 months if no EMI months stored
            const months = wo.EmiMonths ?? wo.emiMonths ?? 6;
            const total = Number(wo.TotalAmount);
            const startDate = wo.DocumentDate.slice(0, 10);
            setEmiSchedule(generateEmiSchedule(total, months, startDate));
          } else {
            setEmiSchedule([]);
          }
        })
        .catch(() => setEmiSchedule([]))
        .finally(() => setEmiFetching(false));
    } else {
      setEmiSchedule([]);
      setEmiPayingNos([]);
    }
  }, [form.mode, form.projectName, projects]);

  // ── API-backed data layer ────────────────────────────────────────────
  const [apiLoading, setApiLoading] = useState(false);

  const loadPayments = React.useCallback(async () => {
    setApiLoading(true);
    try {
      // getReceivedPayments imported statically above
      let page = 1, totalPages = 1;
      const all: ReceivedPayment[] = [];
      while (page <= totalPages) {
        const res = await getReceivedPayments(page, 100);
        totalPages = res.totalPages;
        for (const r of res.data) {
          all.push({
            id: String(r.RPPaymentID),
            companyName: r.RPCompanyName ?? '',
            receivedFrom: r.RPReceivedFrom,
            projectName: r.RPProjectName,
            docDate: r.RPDocDate,
            mode: r.RPMode as ReceivedPayment['mode'],
            amount: Number(r.RPAmount),
            bankName: r.RPBankName ?? undefined,
            transactionId: r.RPTransactionId ?? undefined,
            checkNumber: r.RPCheckNumber ?? undefined,
            remarks: r.RPRemarks ?? undefined,
            status: (r.RPStatus === "Approved" || r.RPStatus === "cleared") ? "cleared" : "pending",
            createdAt: r.RPCreatedAt,
            isEmi: Boolean(r.RPIsEmi),
            emiTotal: r.RPEmiTotal ?? undefined,
            emiMonths: r.RPEmiMonths ?? undefined,
            emiStartDate: r.RPEmiStartDate ?? undefined,
            emiSchedule: r.RPEmiSchedule ? JSON.parse(r.RPEmiSchedule) : undefined,
            emiPaying: r.RPEmiPaying ? JSON.parse(r.RPEmiPaying) : undefined,
          });
        }
        page++;
      }
      setPayments(all);
    } catch (err) {
      toast.error('Failed to load received payments');
      console.error(err);
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => { loadPayments(); }, [loadPayments]);


  const setField = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleEmiNo = (no: number) =>
    setEmiPayingNos((prev) =>
      prev.includes(no) ? prev.filter((n) => n !== no) : [...prev, no],
    );

  const emiPayingAmount = useMemo(
    () =>
      emiSchedule
        .filter((e) => emiPayingNos.includes(e.emiNo))
        .reduce((s, e) => s + e.amount, 0),
    [emiSchedule, emiPayingNos],
  );

  const handleSubmit = async () => {
    if (!form.companyName) {
      toast.error("Company name is required");
      return;
    }
    if (!form.receivedFrom.trim()) {
      toast.error("Received from is required");
      return;
    }
    if (!form.projectName) {
      toast.error("Project is required");
      return;
    }
    if (!date) {
      toast.error("Date is required");
      return;
    }
    const isEmi = form.mode === "EMI";
    if (isEmi) {
      if (!emiSchedule.length) {
        toast.error("No EMI schedule found for this project");
        return;
      }
      if (!emiPayingNos.length) {
        toast.error("Select at least one EMI instalment");
        return;
      }
    } else {
      if (!form.amount || Number(form.amount) <= 0) {
        toast.error("Valid amount is required");
        return;
      }
    }

    const newPay: ReceivedPayment = {
      id: `RCP${String(payments.length + 1).padStart(4, "0")}`,
      companyName: form.companyName,
      receivedFrom: form.receivedFrom.trim(),
      projectName: form.projectName,
      docDate: date.toISOString().slice(0, 10),
      mode: form.mode,
      amount: isEmi ? emiPayingAmount : Number(form.amount),
      bankName: form.bankName || undefined,
      transactionId: form.transactionId || undefined,
      checkNumber: form.checkNumber || undefined,
      remarks: form.remarks || undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
      isEmi,
      emiTotal: isEmi
        ? emiSchedule.reduce((s, e) => s + e.amount, 0)
        : undefined,
      emiMonths: isEmi ? emiSchedule.length : undefined,
      emiStartDate: isEmi ? emiSchedule[0]?.dueDate : undefined,
      emiSchedule: isEmi ? emiSchedule : undefined,
      emiPaying: isEmi ? emiPayingNos : undefined,
    };

    // POST to API
    // addReceivedPayment imported statically above
    try {
      await addReceivedPayment({
        RPCompanyName:  newPay.companyName,
        RPReceivedFrom: newPay.receivedFrom,
        RPProjectName:  newPay.projectName,
        RPDocDate:      newPay.docDate,
        RPMode:         newPay.mode,
        RPAmount:       newPay.amount,
        RPBankName:     newPay.bankName,
        RPTransactionId:newPay.transactionId,
        RPCheckNumber:  newPay.checkNumber,
        RPRemarks:      newPay.remarks,
        RPStatus:       newPay.status,
        RPIsEmi:        newPay.isEmi,
        RPEmiTotal:     newPay.emiTotal,
        RPEmiMonths:    newPay.emiMonths,
        RPEmiStartDate: newPay.emiStartDate,
        RPEmiSchedule:  newPay.emiSchedule ?? null,
        RPEmiPaying:    newPay.emiPaying ?? null,
      });
      toast.success('Payment recorded successfully');
      await loadPayments();
    } catch (err) {
      toast.error('Failed to save payment');
      console.error(err);
      return;
    }
    setForm(EMPTY_FORM);
    setDate(new Date());
    setEmiSchedule([]);
    setEmiPayingNos([]);
    setIsOpen(false);
  };

  const deletePayment = async (id: string) => {
    try {
      // deleteReceivedPayment imported statically above
      await deleteReceivedPayment(Number(id));
      toast.success('Payment deleted');
      await loadPayments();
    } catch (err) {
      toast.error('Failed to delete payment');
      console.error(err);
    }
  };

  const filtered = payments.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      p.receivedFrom.toLowerCase().includes(q) ||
      p.projectName.toLowerCase().includes(q) ||
      p.companyName.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q);
    const matchMode = filterMode === "All" || p.mode === filterMode;
    const matchStatus = filterStatus === "All" || p.status === filterStatus;
    return matchSearch && matchMode && matchStatus;
  });

  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);
  const cleared = payments.filter((p) => p.status === "cleared").length;
  const pending = payments.filter((p) => p.status === "pending").length;

  const stats = [
    {
      label: "Total Received",
      value: fmt(totalReceived),
      icon: IndianRupee,
      color: "hsl(142, 71%, 45%)",
    },
    {
      label: "Total Entries",
      value: String(payments.length),
      icon: ArrowDownCircle,
      color: "hsl(var(--primary))",
    },
    {
      label: "Cleared",
      value: String(cleared),
      icon: CheckCircle2,
      color: "hsl(142, 71%, 45%)",
    },
    {
      label: "Pending",
      value: String(pending),
      icon: Clock,
      color: "hsl(38, 92%, 50%)",
    },
  ];

  const isEmiMode = form.mode === "EMI";

  return (
    <>
      <Breadcrumbs items={["Finance", "Received Payments"]} />

      {/* Header — single Add Payment button */}
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
        <Button size="sm" onClick={() => {
          setForm({ ...EMPTY_FORM, transactionId: generateTxnId() });
          setIsOpen(true);
        }} className="shrink-0">
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
          placeholder="Search by party, company, project, ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs max-w-64 flex-1 min-w-0 sm:flex-none"
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
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
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

        {payments.length === 0 ? (
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
                      "Company",
                      "Received From",
                      "Project",
                      "Mode",
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
                        {p.id}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {format(new Date(p.docDate), "dd/MM/yyyy")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate">
                        {p.companyName}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground max-w-[130px] truncate">
                        {p.receivedFrom}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[110px] truncate">
                        {p.projectName}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading w-fit ${modeColor[p.mode]}`}
                        >
                          {modeIcon(p.mode)}
                          {p.mode}
                        </span>
                        {p.isEmi && p.emiPaying && (
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            EMI {p.emiPaying.join(", ")} of {p.emiMonths}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-heading font-semibold text-emerald-600 whitespace-nowrap">
                        +{fmt(p.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-heading ${p.status === "cleared" ? "bg-green-500/15 text-green-600" : "bg-yellow-500/15 text-yellow-600"}`}
                        >
                          {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deletePayment(p.id)}
                          className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
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
                        {p.id}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {p.companyName}
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        {p.receivedFrom}
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
                        className={`px-2 py-0.5 rounded-full text-xs font-heading ${p.status === "cleared" ? "bg-green-500/15 text-green-600" : "bg-yellow-500/15 text-yellow-600"}`}
                      >
                        {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading w-fit ${modeColor[p.mode]}`}
                      >
                        {modeIcon(p.mode)}
                        {p.mode}
                      </span>
                      {p.isEmi && p.emiPaying && (
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                          EMI {p.emiPaying.join(", ")} of {p.emiMonths}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deletePayment(p.id)}
                      className="p-1.5 text-muted-foreground/50 hover:text-destructive"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownCircle size={18} className="text-emerald-500" />
              Record Received Payment
            </DialogTitle>
            <DialogDescription>
              Log an inbound payment received from a client or customer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Company */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Company Name <span className="text-red-500">*</span>
              </label>
              <Select
                value={form.companyName}
                onValueChange={(v) => setField("companyName", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company…" />
                </SelectTrigger>
                <SelectContent>
                  {companies.length === 0 ? (
                    <SelectItem value="__none__" disabled>No companies found</SelectItem>
                  ) : (
                    companies.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Received From */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Received From <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Client / Customer name"
                value={form.receivedFrom}
                onChange={(e) => setField("receivedFrom", e.target.value)}
              />
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Project <span className="text-red-500">*</span>
              </label>
              <Select
                value={form.projectName}
                onValueChange={(v) => setField("projectName", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <SelectItem value="__none__" disabled>No projects found</SelectItem>
                  ) : (
                    projects.map((p) => (
                      <SelectItem key={p.id} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Date + Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Date <span className="text-red-500">*</span>
                </label>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-between font-normal text-sm",
                        !date && "text-muted-foreground",
                      )}
                    >
                      {date ? format(date, "dd/MM/yyyy") : "Pick date"}
                      <CalendarIcon size={14} className="opacity-50" />
                    </Button>
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

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Payment Mode <span className="text-red-500">*</span>
                </label>
                <Select
                  value={form.mode}
                  onValueChange={(v) => setField("mode", v)}
                >
                  <SelectTrigger>
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

            {/* Amount (non-EMI) */}
            {!isEmiMode && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Amount (₹) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                    ₹
                  </span>
                  <Input
                    className="pl-7 font-mono"
                    placeholder="0"
                    value={form.amount}
                    onChange={(e) =>
                      setField("amount", e.target.value.replace(/[^0-9.]/g, ""))
                    }
                  />
                </div>
              </div>
            )}

            {/* EMI section — calm neutral palette, no loud rose */}
            {isEmiMode && (
              <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Layers size={13} className="text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    EMI Schedule
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    Loaded from project record
                  </span>
                </div>

                {!form.projectName && (
                  <div className="rounded-lg bg-background border border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    Select a project above to load its EMI schedule.
                  </div>
                )}

                {form.projectName && emiFetching && (
                  <div className="rounded-lg bg-background border border-border px-3 py-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
                    Loading EMI schedule…
                  </div>
                )}

                {form.projectName && !emiFetching && emiSchedule.length > 0 && (
                  <EmiScheduleTable
                    schedule={emiSchedule}
                    payingNos={emiPayingNos}
                    onToggle={toggleEmiNo}
                  />
                )}
              </div>
            )}

            {/* Bank / TxnID */}
            {form.mode !== "Cash" && form.mode !== "EMI" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Bank Name
                  </label>
                  <Select
                    value={form.bankName}
                    onValueChange={(v) => setField("bankName", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select bank…" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          No banks found
                        </SelectItem>
                      ) : (
                        banks.map((b) => (
                          <SelectItem key={b.BId} value={b.BName ?? String(b.BId)}>
                            <span className="flex flex-col">
                              <span>{b.BName}</span>
                              {b.BBranch && (
                                <span className="text-[10px] text-muted-foreground">
                                  {b.BBranch}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {form.mode === "Check" ? "Check No." : "Transaction ID"}
                  </label>
                  {form.mode === "Check" ? (
                    <Input
                      placeholder="CHK001"
                      value={form.checkNumber}
                      onChange={(e) => setField("checkNumber", e.target.value)}
                    />
                  ) : (
                    <div className="relative">
                      <Input
                        readOnly
                        value={form.transactionId}
                        className="font-mono text-xs bg-muted/40 cursor-default select-all"
                      />
                      <button
                        type="button"
                        onClick={() => setField("transactionId", generateTxnId())}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground transition-colors font-medium"
                        title="Regenerate"
                      >
                        ↻
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Remarks */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Remarks
              </label>
              <Input
                placeholder="Optional note…"
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} className="gap-1.5">
              <ArrowDownCircle size={14} />
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}