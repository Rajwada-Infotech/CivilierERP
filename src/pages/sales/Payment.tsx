import React, { useState, useMemo, useEffect } from "react";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ServerPager } from "@/components/ServerPager";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { KEY_INK } from "@/components/sheet/sheetParts";
import { HR_NUM } from "@/components/hrpayroll/HrUi";
import { SheetBox, TH, TD, ICON_ACT, TAG } from "@/components/maintenance/maintParts";
import {
  IndianRupee,
  CreditCard,
  RefreshCw,
  ChevronDown,
  Banknote,
  Smartphone,
  FileText,
  Building2,
  Search,
  Eye,
  X,
  Send,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import { getSaleOrders, type SaleOrder } from "@/api/saleOrdersApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import {
  createReceivedPayment,
  getReceivedPayments,
  getPaidSaleOrderDocNos,
  type ReceivedPaymentRecord,
} from "@/api/receivedPaymentApi";
import { useFinYear } from "@/contexts/FinYearContext";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";

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
  { value: "Cash", label: "Cash", icon: <Banknote size={13} /> },
  { value: "UPI", label: "UPI", icon: <Smartphone size={13} /> },
  { value: "NEFT", label: "NEFT", icon: <Building2 size={13} /> },
  { value: "RTGS", label: "RTGS", icon: <Building2 size={13} /> },
  { value: "Check", label: "Cheque", icon: <FileText size={13} /> },
  { value: "Card", label: "Card", icon: <CreditCard size={13} /> },
];

// The stored PaymentMode value is still literally "Check" (renaming it
// would mean a DB migration for every historical row's RPMode) — the
// dropdown already shows the friendly "Cheque" label instead of the raw
// value, but the list/table below used to render r.RPMode directly,
// showing the raw "Check" spelling. This is the same {value, label}
// lookup PAYMENT_MODES already carries, just applied where the badge
// renders too.
const MODE_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_MODES.map((m) => [m.value, m.label]),
);

// Status as a sheet mark: empty = draft, hatched = waiting, solid = approved, red = rejected.
const STATUS_CONFIG: Record<string, { tone: MarkTone; label: string }> = {
  Draft: { tone: "draft", label: "Draft" },
  Pending: { tone: "waiting", label: "Pending" },
  Approved: { tone: "done", label: "Approved" },
  Rejected: { tone: "stopped", label: "Rejected" },
};

// ─── Sheet styles (docs/DESIGN.md) ────────────────────────────────────────────
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const INPUT =
  "w-full h-9 px-3 border border-foreground/30 bg-card text-sm text-foreground outline-none focus:border-foreground disabled:opacity-50 rounded-none";

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className={`block ${LBL} mb-1.5`}>
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
        className={`${INPUT} pr-9 appearance-none`}
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
        o.ToProjectName?.toLowerCase().includes(q) ||
        o.BuyerName?.toLowerCase().includes(q),
    );
  }, [orders, search]);

  return (
    <div className="relative">
      <FieldLabel required>Sale Order (Doc No)</FieldLabel>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${INPUT} flex items-center justify-between gap-2 text-left`}
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className={`${HR_NUM} font-semibold text-foreground`}>{selected.DocNo}</span>
            <span className="text-muted-foreground text-xs truncate">
              · {selected.BuyerName ? `${selected.FromProjectName} → ${selected.BuyerName}` : `${selected.FromProjectName} → ${selected.ToProjectName}`}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">Select a sale order…</span>
        )}
        <ChevronDown size={13} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full border border-foreground bg-card overflow-hidden">
          <div className="p-2 border-b border-foreground/20">
            <div className="flex items-center gap-2 px-2 h-8 border border-foreground/30">
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
              <p className="text-xs text-muted-foreground text-center py-6">No orders found</p>
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
                  className={`w-full text-left px-4 py-3 hover:bg-primary/10 transition-colors border-b border-foreground/10 last:border-0 ${selected?.SaleOrderID === o.SaleOrderID ? "bg-primary/10" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`${HR_NUM} text-sm font-semibold text-foreground`}>{o.DocNo}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {o.FromProjectName} · {o.FromGodownName} → {o.BuyerName || `${o.ToProjectName} · ${o.ToGodownName}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`${HR_NUM} text-sm font-bold text-foreground`}>{fmtAmt(o.TotalAmount)}</p>
                      <p className={`${HR_NUM} text-[0.625rem] text-muted-foreground mt-0.5`}>{fmtDate(o.OrderDate)}</p>
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
      <div className="m-4 border border-dashed border-foreground/30 py-14 text-center">
        <p className="text-sm text-foreground">No payments recorded yet</p>
        <p className="text-xs text-muted-foreground mt-1">Payments against sale orders will appear here</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {["Doc No", "Sale Order", "Date", "Bank", "Mode", "Amount", "Status", ""].map((h) => (
                <th key={h} className={`${TH} ${h === "Amount" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {salePayments.map((r) => {
              const cfg = STATUS_CONFIG[r.RPStatus] ?? STATUS_CONFIG["Draft"];
              return (
                <tr key={r.RPPaymentID} className="hover:bg-primary/5 transition-colors">
                  <td className={`${TD} ${HR_NUM} font-semibold text-foreground whitespace-nowrap`}>
                    {r.RPDocNo || <span className="text-muted-foreground text-[0.625rem] italic">No doc no</span>}
                  </td>
                  <td className={`${TD} ${HR_NUM} text-foreground whitespace-nowrap`}>{r.RPReceivedFrom}</td>
                  <td className={`${TD} ${HR_NUM} text-muted-foreground whitespace-nowrap`}>{fmtDate(r.RPDocDate)}</td>
                  <td className={`${TD} text-foreground`}>{r.RPDepositBankName || r.RPBankName || "—"}</td>
                  <td className={TD}>
                    <span className={TAG}>{MODE_LABEL[r.RPMode] ?? r.RPMode}</span>
                  </td>
                  <td className={`${TD} ${HR_NUM} font-semibold text-foreground whitespace-nowrap text-right`}>
                    {fmtAmt(r.RPAmount)}
                  </td>
                  <td className={TD}>
                    <SheetMark text={cfg.label} tone={cfg.tone} />
                  </td>
                  <td className={TD}>
                    <button data-row-view onClick={() => setViewing(r)} className={ICON_ACT} title="View">
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
        <BodyPortal>
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/40 p-4">
            <div role="dialog" className="bg-card border border-foreground w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-foreground">
                <div>
                  <p className={`${LBL} mb-0.5`}>Payment Receipt</p>
                  <p className={`${HR_NUM} font-bold text-lg tracking-tight text-foreground`}>
                    {viewing.RPDocNo || <span className="text-muted-foreground italic text-sm">No doc no</span>}
                  </p>
                </div>
                <button onClick={() => setViewing(null)} className={ICON_ACT} title="Close">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 border-t border-l border-foreground/20 text-sm">
                  {[
                    { label: "Sale Order", value: viewing.RPReceivedFrom, num: true },
                    { label: "Date", value: fmtDate(viewing.RPDocDate), num: true },
                    { label: "Bank", value: viewing.RPDepositBankName || viewing.RPBankName || "—" },
                    { label: "Mode", value: MODE_LABEL[viewing.RPMode] ?? viewing.RPMode },
                    ...(viewing.RPTransactionID
                      ? [{ label: "Transaction / UTR", value: viewing.RPTransactionID, num: true, wide: true }]
                      : []),
                    ...(viewing.RPCheckNumber ? [{ label: "Cheque No.", value: viewing.RPCheckNumber, num: true }] : []),
                    ...(viewing.RPRemarks
                      ? [{ label: "Remarks", value: viewing.RPRemarks.replace("[SalePayment] ", ""), wide: true }]
                      : []),
                  ].map((c: { label: string; value: React.ReactNode; num?: boolean; wide?: boolean }) => (
                    <div
                      key={c.label}
                      className={`px-3 py-2.5 border-r border-b border-foreground/20 min-w-0 ${c.wide ? "col-span-2" : ""}`}
                    >
                      <p className={`${LBL} mb-0.5`}>{c.label}</p>
                      <p className={`text-xs font-semibold text-foreground break-words ${c.num ? HR_NUM : ""}`}>{c.value}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-foreground pt-3 flex items-baseline justify-between">
                  <span className={LBL}>Amount Received</span>
                  <span className={`text-xl font-bold text-foreground ${HR_NUM}`}>{fmtAmt(viewing.RPAmount)}</span>
                </div>
              </div>
            </div>
          </div>
        </BodyPortal>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Payment() {
  const rights = usePageRights("sales-payment");
  const qc = useQueryClient();
  const { finYears } = useFinYear();

  const activeFinYear = useMemo(
    () => finYears.find((f) => f.status === "Active")?.year ?? "",
    [finYears],
  );

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: soData, isLoading: soLoading } = useQuery({
    queryKey: ["sale-orders"],
    queryFn: async () => ({ data: await fetchAllPages((page, limit) => getSaleOrders({ page, limit }), { limit: 500 }) }),
    staleTime: 60_000,
  });
  const orders: SaleOrder[] = soData?.data ?? [];
  // Payment History: server-paged, sale payments only (the server applies the same "[SalePayment]" / "SO-" test).
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const { data: paymentsData, isLoading: paymentsLoading, isFetching: paymentsFetching } = useQuery({
    queryKey: ["received-payments", "sale-history", historyPage, historyPageSize],
    queryFn: () => getReceivedPayments(historyPage, historyPageSize, { salePayment: true }),
    staleTime: 30_000,
    placeholderData: keepPreviousData, // keep the current rows on screen while the next page loads
  });
  const paymentHistory: ReceivedPaymentRecord[] = paymentsData?.data ?? [];
  const paymentTotal = Number(paymentsData?.total ?? 0);
  // A page past the end (rows removed since it was opened) comes back empty - go back to the first page.
  useEffect(() => {
    if (!paymentsFetching && historyPage > 1 && paymentsData && paymentHistory.length === 0) setHistoryPage(1);
  }, [paymentsFetching, historyPage, paymentsData, paymentHistory.length]);

  // Doc numbers of sale orders that already have an active (non-Rejected) payment - worked out on the server
  // across every payment, not just the history page on screen.
  const { data: paidDocNos } = useQuery({
    queryKey: ["received-payments", "sale-order-paid"],
    queryFn: getPaidSaleOrderDocNos,
    staleTime: 30_000,
  });
  const paidSaleOrderDocNos = useMemo(() => new Set<string>(paidDocNos ?? []), [paidDocNos]);

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
    rights.canCreate &&
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
      // A sale to a buyer: the buyer pays, against the project the goods were sold from. An older transfer order:
      // the receiving project pays.
      RPCustomerName: selectedOrder.BuyerName ?? selectedOrder.ToCompanyName,
      RPProjectName: selectedOrder.BuyerName ? selectedOrder.FromProjectName : selectedOrder.ToProjectName,
      RPCompanyName: selectedOrder.FromCompanyName,
      RPCompanyId: selectedOrder.FromCompanyID ?? null,
      RPProjectId: selectedOrder.BuyerName ? selectedOrder.FromProjectID ?? null : selectedOrder.ToProjectID ?? null,
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
      <Breadcrumbs items={["Dashboard", "Sales Module", "Received Payment"]} />

      <SheetShell
        eyebrow="CivilierERP · Sales"
        title="Received Payment"
        subtitle="Record payment against a sale order — posts directly to bank ledger in Trial Balance"
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* ── Left: Form ────────────────────────────────────────────────────── */}
          <div className="lg:col-span-3">
            <SheetBox title="New Payment Entry">
              <div className="space-y-5">
                {/* Sale Order picker */}
                {soLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw size={13} className="animate-spin" /> Loading sale orders…
                  </div>
                ) : (
                  <SaleOrderPicker orders={eligibleOrders} selected={selectedOrder} onSelect={setSelectedOrder} />
                )}

                {/* Order summary */}
                {selectedOrder && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-l border-foreground/20">
                    {[
                      { label: "From", value: selectedOrder.FromProjectName, sub: selectedOrder.FromGodownName },
                      selectedOrder.BuyerName
                        ? { label: "Buyer", value: selectedOrder.BuyerName, sub: undefined }
                        : { label: "To", value: selectedOrder.ToProjectName, sub: selectedOrder.ToGodownName },
                      { label: "Order Date", value: fmtDate(selectedOrder.OrderDate), num: true },
                      { label: "Order Value", value: fmtAmt(selectedOrder.TotalAmount), num: true, big: true },
                    ].map((c) => (
                      <div key={c.label} className="px-3 py-2.5 border-r border-b border-foreground/20 min-w-0">
                        <p className={`${LBL} mb-0.5`}>{c.label}</p>
                        <p className={`text-foreground ${c.big ? "text-sm font-bold" : "text-xs font-medium"} ${c.num ? HR_NUM : ""}`}>
                          {c.value}
                        </p>
                        {c.sub && <p className="text-[0.625rem] text-muted-foreground">{c.sub}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Bank + Payment Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required>Deposit Bank</FieldLabel>
                    {banksLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                        <RefreshCw size={12} className="animate-spin" /> Loading banks…
                      </div>
                    ) : (
                      <SelectBox value={bankId} onChange={setBankId}>
                        <option value="">Select bank…</option>
                        {banks.map((b) => (
                          <option key={b.BId} value={String(b.BId)}>
                            {b.BName}
                            {b.BBranch ? ` — ${b.BBranch}` : ""}
                            {b.BAccountNumber ? ` (${b.BAccountNumber.slice(-4)})` : ""}
                          </option>
                        ))}
                      </SelectBox>
                    )}
                    {selectedBank && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Landmark size={11} className="text-muted-foreground" />
                        <span className={`text-[0.6875rem] ${accountGroupLabel ? "text-muted-foreground" : "text-destructive"}`}>
                          {accountGroupLabel
                            ? `Linked to ${accountGroupLabel} · posts to Trial Balance`
                            : "No account group linked — won't appear in Trial Balance"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <FieldLabel required>Payment Mode</FieldLabel>
                    <div className="grid grid-cols-3 border-t border-l border-foreground/30">
                      {PAYMENT_MODES.map((m) => {
                        const on = mode === m.value;
                        return (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setMode(m.value)}
                            aria-pressed={on}
                            className={`flex items-center justify-center gap-1.5 h-9 px-2 border-r border-b border-foreground/30 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
                              on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"
                            }`}
                            style={on ? { boxShadow: "inset 0 -2px 0 hsl(var(--foreground))" } : undefined}
                          >
                            {m.icon}
                            {m.label}
                          </button>
                        );
                      })}
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
                        className={`${INPUT} pl-8 ${HR_NUM}`}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel required>Payment Date</FieldLabel>
                    <DateInput value={payDate} onChange={(e) => setPayDate(e.target.value)} className={INPUT} />
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
                      className={INPUT}
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
                      className={INPUT}
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
                    className="w-full px-3 py-2 border border-foreground/30 bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:border-foreground rounded-none"
                  />
                </div>

                {/* Submit */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-foreground/20">
                  <p className="text-xs text-muted-foreground">
                    Amount will credit the selected bank account in Trial Balance
                  </p>
                  <button onClick={handleSubmit} disabled={!canSubmit} className={`${KEY_INK} h-9 px-5`}>
                    {mutation.isPending ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" /> Recording…
                      </>
                    ) : (
                      <>
                        <Send size={13} /> Record Payment
                      </>
                    )}
                  </button>
                </div>
              </div>
            </SheetBox>
          </div>

          {/* ── Right: Quick summary ────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-5">
            <SheetBox title="How it works">
              <ol className="space-y-3">
                {[
                  "Pick an approved sale order — its doc number and value are pulled automatically.",
                  "Choose the bank account where you received the payment. The bank's account group drives the Trial Balance entry.",
                  "Set the mode, amount, and any transaction reference.",
                  "Recording creates a Received Payment entry. Once approved, the amount credits that bank's ledger in Trial Balance.",
                ].map((text, i) => (
                  <li key={i} className="flex gap-3 text-xs text-muted-foreground">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center border border-foreground text-[0.625rem] font-bold text-foreground ${HR_NUM}`}
                    >
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </SheetBox>

            <SheetBox title="Eligible Sale Orders" note={soLoading ? undefined : eligibleOrders.length}>
              {soLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw size={12} className="animate-spin" /> Loading…
                </div>
              ) : eligibleOrders.length === 0 ? (
                <p className="text-xs text-muted-foreground">No approved sale orders found.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto -mx-4 -my-4">
                  {eligibleOrders.map((o) => (
                    <button
                      key={o.SaleOrderID}
                      onClick={() => setSelectedOrder(o)}
                      className={`w-full text-left px-4 py-2.5 border-b border-foreground/10 last:border-0 transition-colors text-xs ${
                        selectedOrder?.SaleOrderID === o.SaleOrderID ? "bg-primary/10" : "hover:bg-primary/5"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`${HR_NUM} font-semibold text-foreground`}>{o.DocNo}</span>
                        <span className={`${HR_NUM} font-bold text-foreground`}>{fmtAmt(o.TotalAmount)}</span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 truncate">
                        {o.FromProjectName} → {o.BuyerName || o.ToProjectName}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </SheetBox>
          </div>
        </div>

        {/* ── History ──────────────────────────────────────────────────────────── */}
        <SheetBox
          title="Payment History"
          note={paymentTotal ? `${paymentTotal.toLocaleString("en-IN")} payments` : undefined}
          flush
          action={
            paymentsLoading ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw size={12} className="animate-spin" /> Refreshing…
              </span>
            ) : undefined
          }
        >
          <p className="px-4 pt-3 pb-2 text-xs text-muted-foreground">All payments recorded against sale orders</p>
          <PaymentHistoryTable records={paymentHistory} />
          <ServerPager
            page={historyPage}
            pageSize={historyPageSize}
            total={paymentTotal}
            onPageChange={setHistoryPage}
            onPageSizeChange={setHistoryPageSize}
          />
        </SheetBox>
      </SheetShell>
    </>
  );
}
