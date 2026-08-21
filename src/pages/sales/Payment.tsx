import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SalesShell } from "@/components/sales/SalesShell";
import {
  IndianRupee,
  CreditCard,
  RefreshCw,
  ChevronDown,
  Banknote,
  Smartphone,
  FileText,
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  Eye,
  X,
  Send,
  Landmark,
  Receipt,
  Hash,
} from "lucide-react";
import { toast } from "sonner";
import { getSaleOrders, type SaleOrder } from "@/api/saleOrdersApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import {
  createReceivedPayment,
  getReceivedPayments,
  type ReceivedPaymentRecord,
} from "@/api/receivedPaymentApi";
import { useFinYear } from "@/contexts/FinYearContext";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtAmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n ?? 0);

const fmtDate = (d: string) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMode = "Cash" | "UPI" | "NEFT" | "RTGS" | "Check" | "Card";

const PAYMENT_MODES: {
  value: PaymentMode;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "Cash",
    label: "Cash",
    icon: <Banknote size={14} className="text-emerald-500" />,
  },
  {
    value: "UPI",
    label: "UPI",
    icon: <Smartphone size={14} className="text-violet-500" />,
  },
  {
    value: "NEFT",
    label: "NEFT",
    icon: <Building2 size={14} className="text-sky-500" />,
  },
  {
    value: "RTGS",
    label: "RTGS",
    icon: <Building2 size={14} className="text-cyan-500" />,
  },
  {
    value: "Check",
    label: "Cheque",
    icon: <FileText size={14} className="text-blue-500" />,
  },
  {
    value: "Card",
    label: "Card",
    icon: <CreditCard size={14} className="text-orange-500" />,
  },
];

const MODE_COLOR: Record<string, string> = {
  Cash: "bg-emerald-500/10 text-emerald-600",
  UPI: "bg-violet-500/10 text-violet-600",
  NEFT: "bg-sky-500/10 text-sky-600",
  RTGS: "bg-cyan-500/10 text-cyan-600",
  Check: "bg-blue-500/10 text-blue-600",
  Card: "bg-orange-500/10 text-orange-600",
};

const STATUS_CONFIG: Record<
  string,
  { cls: string; icon: React.ReactNode; label: string }
> = {
  Draft: {
    cls: "bg-slate-500/10 text-slate-600",
    icon: <Clock size={11} />,
    label: "Draft",
  },
  Pending: {
    cls: "bg-amber-500/10 text-amber-600",
    icon: <Clock size={11} />,
    label: "Pending",
  },
  Approved: {
    cls: "bg-emerald-500/10 text-emerald-600",
    icon: <CheckCircle2 size={11} />,
    label: "Approved",
  },
  Rejected: {
    cls: "bg-red-500/10 text-red-600",
    icon: <AlertCircle size={11} />,
    label: "Rejected",
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-[11px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function SelectBox({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 pr-9 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none appearance-none transition-colors focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
        style={{ colorScheme: "dark" }}
      >
        {children}
      </select>
      <ChevronDown
        size={13}
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
      />
    </div>
  );
}

// ─── Sale Order Picker ────────────────────────────────────────────────────────

function SaleOrderPicker({
  orders,
  selected,
  onSelect,
}: {
  orders: SaleOrder[];
  selected: SaleOrder | null;
  onSelect: (o: SaleOrder | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.DocNo.toLowerCase().includes(q) ||
        o.FromProjectName?.toLowerCase().includes(q) ||
        o.ToProjectName?.toLowerCase().includes(q),
    );
  }, [orders, search]);

  return (
    <div className="relative">
      <FieldLabel required>Sale Order (Doc No)</FieldLabel>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-border bg-background text-sm outline-none transition-colors hover:border-violet-400/50 focus:ring-2 focus:ring-violet-500/30"
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0">
            <Hash size={13} className="text-violet-500 shrink-0" />
            <span className="font-mono font-semibold text-foreground">
              {selected.DocNo}
            </span>
            <span className="text-muted-foreground text-xs truncate">
              · {selected.FromProjectName} → {selected.ToProjectName}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">Select a sale order…</span>
        )}
        <ChevronDown size={13} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/50">
              <Search size={13} className="text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by doc no, project…"
                className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
              />
              {search && (
                <button onClick={() => setSearch("")}>
                  <X size={12} className="text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No orders found
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.SaleOrderID}
                  type="button"
                  onClick={() => {
                    onSelect(o);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-4 py-3 hover:bg-muted transition-colors border-b border-border/40 last:border-0 ${selected?.SaleOrderID === o.SaleOrderID ? "bg-violet-500/5" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-foreground">
                        {o.DocNo}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {o.FromProjectName} · {o.FromGodownName} →{" "}
                        {o.ToProjectName} · {o.ToGodownName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-foreground">
                        {fmtAmt(o.TotalAmount)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fmtDate(o.OrderDate)}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Payment History Table ────────────────────────────────────────────────────

function PaymentHistoryTable({
  records,
}: {
  records: ReceivedPaymentRecord[];
}) {
  const [viewing, setViewing] = useState<ReceivedPaymentRecord | null>(null);

  // Filter only sale-payment records (tagged via RPRemarks containing "[SalePayment]")
  const salePayments = records.filter(
    (r) =>
      r.RPRemarks?.includes("[SalePayment]") ||
      r.RPReceivedFrom?.startsWith("SO-"),
  );

  if (salePayments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
        <Receipt size={32} className="text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          No payments recorded yet
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Payments against sale orders will appear here
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {[
                "Doc No",
                "Sale Order",
                "Date",
                "Bank",
                "Mode",
                "Amount",
                "Status",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {salePayments.map((r) => {
              const cfg = STATUS_CONFIG[r.RPStatus] ?? STATUS_CONFIG["Draft"];
              return (
                <tr
                  key={r.RPPaymentID}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-violet-600 font-semibold whitespace-nowrap">
                    {r.RPDocNo || (
                      <span className="text-muted-foreground/50 text-[10px] italic">
                        No doc no
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground whitespace-nowrap">
                    {r.RPReceivedFrom}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                    {fmtDate(r.RPDocDate)}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">
                    {r.RPDepositBankName || r.RPBankName || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${MODE_COLOR[r.RPMode] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {r.RPMode}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                    {fmtAmt(r.RPAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.cls}`}
                    >
                      {cfg.icon} {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setViewing(r)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                      title="View"
                    >
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
                  Payment Receipt
                </p>
                <p className="font-mono font-bold text-foreground">
                  {viewing.RPDocNo || (
                    <span className="text-muted-foreground italic text-sm">
                      No doc no
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setViewing(null)}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                    Sale Order
                  </p>
                  <p className="font-mono font-semibold">
                    {viewing.RPReceivedFrom}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                    Date
                  </p>
                  <p>{fmtDate(viewing.RPDocDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                    Bank
                  </p>
                  <p>
                    {viewing.RPDepositBankName || viewing.RPBankName || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                    Mode
                  </p>
                  <p>{viewing.RPMode}</p>
                </div>
                {viewing.RPTransactionID && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      Transaction / UTR
                    </p>
                    <p className="font-mono text-xs">
                      {viewing.RPTransactionID}
                    </p>
                  </div>
                )}
                {viewing.RPCheckNumber && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      Cheque No.
                    </p>
                    <p>{viewing.RPCheckNumber}</p>
                  </div>
                )}
                {viewing.RPRemarks && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      Remarks
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {viewing.RPRemarks.replace("[SalePayment] ", "")}
                    </p>
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-violet-500/5 border border-violet-400/20 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Amount Received
                </span>
                <span className="text-lg font-bold text-foreground">
                  {fmtAmt(viewing.RPAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Payment() {
  usePageRights("sales-payment");
  const qc = useQueryClient();
  const { finYears } = useFinYear();

  const activeFinYear = useMemo(
    () => finYears.find((f) => f.status === "Active")?.year ?? "",
    [finYears],
  );

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: soData, isLoading: soLoading } = useQuery({
    queryKey: ["sale-orders"],
    queryFn: () => getSaleOrders({ limit: 500 }),
    staleTime: 60_000,
  });
  const orders: SaleOrder[] = soData?.data ?? [];
  const { data: paymentsData, isLoading: paymentsLoading } = useQuery({
    queryKey: ["received-payments"],
    queryFn: () => getReceivedPayments(1, 100),
    staleTime: 30_000,
  });
  const paymentHistory: ReceivedPaymentRecord[] = paymentsData?.data ?? [];

  // Doc numbers of sale orders that already have an active (non-Rejected) payment
  const paidSaleOrderDocNos = useMemo(() => {
    const s = new Set<string>();
    paymentHistory.forEach((r) => {
      if (
        (r.RPRemarks?.includes("[SalePayment]") ||
          r.RPReceivedFrom?.startsWith("SO-")) &&
        r.RPStatus !== "Rejected"
      ) {
        if (r.RPReceivedFrom) s.add(r.RPReceivedFrom);
      }
    });
    return s;
  }, [paymentHistory]);

  // Only approved orders that don't already have an active payment
  const eligibleOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.Status?.includes("Approved") && !paidSaleOrderDocNos.has(o.DocNo),
      ),
    [orders, paidSaleOrderDocNos],
  );

  const { data: banksRaw, isLoading: banksLoading } = useQuery({
    queryKey: ["bank-master"],
    queryFn: getBanks,
    staleTime: 120_000,
  });
  const banks: BankRecord[] = (banksRaw ?? []).filter((b) => b.BStatus);

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedOrder, setSelectedOrder] = useState<SaleOrder | null>(null);
  const [bankId, setBankId] = useState("");
  const [mode, setMode] = useState<PaymentMode>("NEFT");
  const [amount, setAmount] = useState("");
  const [txnRef, setTxnRef] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");

  // Auto-fill amount from order
  useEffect(() => {
    if (selectedOrder) {
      setAmount(String(selectedOrder.TotalAmount));
    } else {
      setAmount("");
    }
  }, [selectedOrder]);

  const selectedBank = banks.find((b) => String(b.BId) === bankId) ?? null;

  // ── Mutation ──────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof createReceivedPayment>[0]) =>
      createReceivedPayment(payload),
    onSuccess: () => {
      toast.success("Payment recorded and posted to bank account");
      qc.invalidateQueries({ queryKey: ["received-payments"] });
      // Reset form
      setSelectedOrder(null);
      setBankId("");
      setMode("NEFT");
      setAmount("");
      setTxnRef("");
      setChequeNo("");
      setPayDate(new Date().toISOString().slice(0, 10));
      setRemarks("");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to record payment"),
  });

  const canSubmit =
    !!selectedOrder &&
    !!bankId &&
    !!mode &&
    parseFloat(amount) > 0 &&
    !!payDate &&
    !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !selectedOrder || !selectedBank) return;
    mutation.mutate({
      RPReceivedFrom: selectedOrder.DocNo,
      RPCustomerName: selectedOrder.ToCompanyName,
      RPProjectName: selectedOrder.ToProjectName,
      RPCompanyName: selectedOrder.FromCompanyName,
      RPCompanyId: selectedOrder.FromCompanyID ?? null,
      RPProjectId: selectedOrder.ToProjectID ?? null,
      RPDocDate: payDate,
      RPMode: mode,
      RPAmount: parseFloat(amount),
      RPBankName: selectedBank.BName ?? null,
      RPDepositBankId: selectedBank.BId,
      RPDepositBankName: selectedBank.BName ?? null,
      RPTransactionID: txnRef || null,
      RPCheckNumber: chequeNo || null,
      RPRemarks: `[SalePayment] ${remarks}`.trim(),
      RPStatus: "Draft",
      RPFinYear: activeFinYear || null,
      RPDocTypeId: null,
      RPIsEmi: false,
      RPEmiTotal: null,
      RPEmiMonths: null,
      RPEmiStartDate: null,
      RPEmiSchedule: null,
      RPEmiPaying: null,
      RPCreatedBy: null,
      RPUpdatedBy: null,
      RPApprovedBy: null,
      RPRejectedBy: null,
      RPRejectionNote: null,
    } as any);
  };

  const needsTxn = ["NEFT", "RTGS", "UPI"].includes(mode);
  const needsCheque = mode === "Check";

  // ── Account group badge ───────────────────────────────────────────────────
  const accountGroupLabel = selectedBank?.BLBelongsTo
    ? `Account Group #${selectedBank.BLBelongsTo}`
    : null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Module", "Payment"]} />

      <SalesShell
        title="Payment"
        subtitle="Record payment against a sale order — posts directly to bank ledger in Trial Balance"
        icon={CreditCard}
      >
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left: Form ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-5">
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center gap-2">
              <Receipt size={15} className="text-violet-500" />
              <p className="font-heading font-semibold text-sm text-foreground">
                New Payment Entry
              </p>
            </div>

            <div className="p-6 space-y-5">
              {/* Sale Order picker */}
              {soLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw size={13} className="animate-spin" /> Loading sale
                  orders…
                </div>
              ) : (
                <SaleOrderPicker
                  orders={eligibleOrders}
                  selected={selectedOrder}
                  onSelect={setSelectedOrder}
                />
              )}

              {/* Order summary card */}
              {selectedOrder && (
                <div className="rounded-xl bg-violet-500/5 border border-violet-400/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      From
                    </p>
                    <p className="font-medium text-foreground text-xs">
                      {selectedOrder.FromProjectName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {selectedOrder.FromGodownName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      To
                    </p>
                    <p className="font-medium text-foreground text-xs">
                      {selectedOrder.ToProjectName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {selectedOrder.ToGodownName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      Order Date
                    </p>
                    <p className="font-medium text-foreground text-xs">
                      {fmtDate(selectedOrder.OrderDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                      Order Value
                    </p>
                    <p className="font-bold text-foreground">
                      {fmtAmt(selectedOrder.TotalAmount)}
                    </p>
                  </div>
                </div>
              )}

              {/* Bank + Payment Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>Deposit Bank</FieldLabel>
                  {banksLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <RefreshCw size={12} className="animate-spin" /> Loading
                      banks…
                    </div>
                  ) : (
                    <SelectBox value={bankId} onChange={setBankId}>
                      <option value="">Select bank…</option>
                      {banks.map((b) => (
                        <option key={b.BId} value={String(b.BId)}>
                          {b.BName}
                          {b.BBranch ? ` — ${b.BBranch}` : ""}
                          {b.BAccountNumber
                            ? ` (${b.BAccountNumber.slice(-4)})`
                            : ""}
                        </option>
                      ))}
                    </SelectBox>
                  )}
                  {/* Account group badge */}
                  {selectedBank && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Landmark size={11} className="text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">
                        {accountGroupLabel
                          ? `Linked to ${accountGroupLabel} · posts to Trial Balance`
                          : "No account group linked — won't appear in Trial Balance"}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <FieldLabel required>Payment Mode</FieldLabel>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PAYMENT_MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMode(m.value)}
                        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          mode === m.value
                            ? "border-violet-500 bg-violet-500/10 text-violet-700"
                            : "border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-muted/50"
                        }`}
                      >
                        {m.icon}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Amount + Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>Amount (₹)</FieldLabel>
                  <div className="relative">
                    <IndianRupee
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-500/30 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel required>Payment Date</FieldLabel>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-500/30 transition-colors"
                    style={{ colorScheme: "dark" }}
                  />
                </div>
              </div>

              {/* Mode-specific fields */}
              {needsTxn && (
                <div>
                  <FieldLabel>Transaction / UTR Reference</FieldLabel>
                  <input
                    type="text"
                    value={txnRef}
                    onChange={(e) => setTxnRef(e.target.value)}
                    placeholder="e.g. UTR123456789012"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-500/30 transition-colors"
                  />
                </div>
              )}

              {needsCheque && (
                <div>
                  <FieldLabel>Cheque Number</FieldLabel>
                  <input
                    type="text"
                    value={chequeNo}
                    onChange={(e) => setChequeNo(e.target.value)}
                    placeholder="Cheque number"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-violet-500/30 transition-colors"
                  />
                </div>
              )}

              {/* Remarks */}
              <div>
                <FieldLabel>Remarks</FieldLabel>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Optional notes about this payment"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-2 focus:ring-violet-500/30 transition-colors"
                />
              </div>

              {/* Submit */}
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  Amount will credit the selected bank account in Trial Balance
                </p>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {mutation.isPending ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />{" "}
                      Recording…
                    </>
                  ) : (
                    <>
                      <Send size={14} /> Record Payment
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Quick summary ────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {/* How it works */}
          <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              How it works
            </p>
            <ol className="space-y-3">
              {[
                {
                  n: "1",
                  text: "Pick an approved sale order — its doc number and value are pulled automatically.",
                },
                {
                  n: "2",
                  text: "Choose the bank account where you received the payment. The bank's account group drives the Trial Balance entry.",
                },
                {
                  n: "3",
                  text: "Set the mode, amount, and any transaction reference.",
                },
                {
                  n: "4",
                  text: "Recording creates a Received Payment entry. Once approved, the amount credits that bank's ledger in Trial Balance.",
                },
              ].map(({ n, text }) => (
                <li
                  key={n}
                  className="flex gap-3 text-xs text-muted-foreground"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-600 text-[10px] font-bold">
                    {n}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Eligible orders quick count */}
          <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Eligible Sale Orders
            </p>
            {soLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw size={12} className="animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {eligibleOrders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No approved sale orders found.
                  </p>
                ) : (
                  eligibleOrders.map((o) => (
                    <button
                      key={o.SaleOrderID}
                      onClick={() => setSelectedOrder(o)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors text-xs ${
                        selectedOrder?.SaleOrderID === o.SaleOrderID
                          ? "border-violet-500 bg-violet-500/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-foreground">
                          {o.DocNo}
                        </span>
                        <span className="font-bold text-foreground">
                          {fmtAmt(o.TotalAmount)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 truncate">
                        {o.FromProjectName} → {o.ToProjectName}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── History ──────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading font-semibold text-foreground">
              Payment History
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              All payments recorded against sale orders
            </p>
          </div>
          {paymentsLoading && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw size={12} className="animate-spin" /> Refreshing…
            </span>
          )}
        </div>
        <PaymentHistoryTable records={paymentHistory} />
      </div>
      </SalesShell>
    </>
  );
}
