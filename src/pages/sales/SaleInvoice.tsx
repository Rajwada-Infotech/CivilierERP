import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { HR_NUM } from "@/components/hrpayroll/HrUi";
import { SheetBox, TH, TD, ICON_ACT } from "@/components/maintenance/maintParts";
import {
  Banknote,
  Send,
  ChevronDown,
  Search,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  IndianRupee,
  Eye,
  Printer,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import type { SaleOrderItem } from "@/api/saleOrdersApi";
import {
  getSaleInvoices,
  getSaleInvoiceById,
  getEligibleSaleOrders,
  createSaleInvoice,
  type EligibleSaleOrder,
  type SaleInvoice as SaleInvoiceDoc,
} from "@/api/saleInvoicesApi";
import { createReceivedPayment } from "@/api/receivedPaymentApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { useFinYear } from "@/contexts/FinYearContext";
import { DateInput } from "@/components/ui/date-input";
import { ServerPager } from "@/components/ServerPager";

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

// Payment status as a sheet mark: solid blue = settled, hatched = waiting.
const STATUS_CONFIG: Record<string, { tone: MarkTone; label: string }> = {
  "Pending Payment": { tone: "waiting", label: "Pending Payment" },
  Paid: { tone: "done", label: "Paid" },
};
const statusMark = (s: string) => {
  const cfg = STATUS_CONFIG[s] ?? STATUS_CONFIG["Pending Payment"];
  return <SheetMark text={cfg.label} tone={cfg.tone} />;
};

// ─── Sheet styles (docs/DESIGN.md) ────────────────────────────────────────────
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const INPUT =
  "w-full h-9 px-3 border border-foreground/30 bg-card text-sm text-foreground outline-none focus:border-foreground disabled:opacity-50 rounded-none";
const OVERLAY = "fixed inset-0 z-[70] flex items-stretch sm:items-center justify-center bg-foreground/40 p-0 sm:p-4";

// ─── Field label ──────────────────────────────────────────────────────────────

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

// ─── Eligible Sale Order Picker ────────────────────────────────────────────────

function EligibleOrderPicker({
  orders,
  selected,
  onSelect,
}: {
  orders: EligibleSaleOrder[];
  selected: EligibleSaleOrder | null;
  onSelect: (o: EligibleSaleOrder | null) => void;
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
        o.ToCompanyName?.toLowerCase().includes(q) ||
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
            <span className="text-muted-foreground text-xs truncate">· {selected.BuyerName || selected.ToCompanyName}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">Select an approved sale order…</span>
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
                placeholder="Search by doc no, customer, project…"
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
              <p className="text-xs text-muted-foreground text-center py-6">No eligible sale orders found</p>
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
                        {o.BuyerName
                          ? `${o.BuyerName} · from ${o.FromProjectName}`
                          : `${o.ToCompanyName} · ${o.FromProjectName} → ${o.ToProjectName}`}
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

// ─── Sale lines (the order's items, as invoiced) ───────────────────────────────

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
/** A line's figures; older orders saved only qty × rate. */
const lineFigures = (it: SaleOrderItem) => {
  const amount = it.amount != null ? Number(it.amount) : r2((Number(it.qty) || 0) * (Number(it.rate) || 0));
  const tax = it.taxAmount != null ? Number(it.taxAmount) : r2((amount * (Number(it.gstRate) || 0)) / 100);
  return { amount, tax, total: it.total != null ? Number(it.total) : r2(amount + tax) };
};

const NUM_HEADS = ["Qty", "Rate", "Amount", "GST %", "GST", "Total"];

function SaleLinesTable({
  items,
  basic,
  tax,
  total,
}: {
  items: SaleOrderItem[];
  basic?: number | null;
  tax?: number | null;
  total: number;
}) {
  const sums = items.reduce(
    (t, it) => {
      const f = lineFigures(it);
      return { amount: t.amount + f.amount, tax: t.tax + f.tax };
    },
    { amount: 0, tax: 0 },
  );
  const basicAmt = basic ?? r2(sums.amount);
  const taxAmt = tax ?? r2(sums.tax);
  const NUMC = `${TD} ${HR_NUM} text-right whitespace-nowrap`;
  return (
    <div className="border border-foreground/20">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {["#", "Item", ...NUM_HEADS.slice(0, 1), "UOM", ...NUM_HEADS.slice(1)].map((h) => (
                <th key={h} className={`${TH} ${NUM_HEADS.includes(h) ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                  No line items on this sale order.
                </td>
              </tr>
            ) : (
              items.map((it, i) => {
                const f = lineFigures(it);
                return (
                  <tr key={i}>
                    <td className={`${TD} ${HR_NUM} text-muted-foreground`}>{i + 1}</td>
                    <td className={`${TD} text-foreground`}>
                      {it.itemName || it.itemId}
                      {it.remarks && <span className="block text-[0.625rem] text-muted-foreground">{it.remarks}</span>}
                    </td>
                    <td className={NUMC}>{Number(it.qty) || 0}</td>
                    <td className={`${TD} text-muted-foreground whitespace-nowrap`}>{it.uom || "—"}</td>
                    <td className={NUMC}>{fmtAmt(Number(it.rate) || 0)}</td>
                    <td className={NUMC}>{fmtAmt(f.amount)}</td>
                    <td className={NUMC}>{Number(it.gstRate) || 0}%</td>
                    <td className={NUMC}>{fmtAmt(f.tax)}</td>
                    <td className={`${NUMC} font-semibold text-foreground`}>{fmtAmt(f.total)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-3 border-t border-foreground/20">
        {[
          { label: "Taxable value", value: basicAmt },
          { label: "GST", value: taxAmt },
          { label: "Invoice total", value: total, big: true },
        ].map((c) => (
          <div key={c.label} className="px-3 py-2.5 border-r border-foreground/20 last:border-r-0 text-right">
            <p className={`${LBL} mb-0.5`}>{c.label}</p>
            <p className={`${HR_NUM} text-foreground ${c.big ? "text-sm font-bold" : "text-xs font-semibold"}`}>{fmtAmt(c.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Collect Payment Modal (cash-only, Dummy Bank) ─────────────────────────────

function CollectPaymentModal({
  invoice,
  dummyBank,
  onClose,
}: {
  invoice: SaleInvoiceDoc;
  dummyBank: BankRecord | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = useMemo(
    () => finYears.find((f) => f.status === "Active")?.year ?? "",
    [finYears],
  );

  const remaining = Math.max(
    invoice.TotalAmount - (invoice.AmountReceived || 0),
    0,
  );
  const [amount, setAmount] = useState(String(remaining));
  const [payDate, setPayDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [remarks, setRemarks] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof createReceivedPayment>[0]) =>
      createReceivedPayment(payload),
    onSuccess: () => {
      toast.success(`Cash payment recorded for ${invoice.DocNo}`);
      qc.invalidateQueries({ queryKey: ["sale-invoices"] });
      qc.invalidateQueries({ queryKey: ["received-payments"] });
      onClose();
    },
    onError: (e: Error) =>
      toast.error(e.message || "Failed to record payment"),
  });

  const canSubmit =
    parseFloat(amount) > 0 && !!payDate && !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutation.mutate({
      RPReceivedFrom: invoice.DocNo,
      RPCustomerName: invoice.ToCompanyName,
      RPProjectName: invoice.ToProjectName,
      RPCompanyName: invoice.FromCompanyName,
      RPCompanyId: invoice.FromCompanyID ?? null,
      RPProjectId: invoice.ToProjectID ?? null,
      RPDocDate: payDate,
      RPMode: "Cash",
      RPAmount: parseFloat(amount),
      RPBankName: dummyBank?.BName ?? "Dummy Bank",
      RPDepositBankId: dummyBank?.BId ?? null,
      RPDepositBankName: dummyBank?.BName ?? "Dummy Bank",
      RPTransactionID: null,
      RPCheckNumber: null,
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
      SourceSaleInvoiceId: invoice.SaleInvoiceID,
    });
  };

  return createPortal(
    <div className={OVERLAY}>
      <div
        role="dialog"
        className="bg-card border border-foreground w-full max-w-md h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-foreground">
          <div>
            <p className={`${LBL} mb-0.5`}>Collect Payment</p>
            <p className={`${HR_NUM} font-bold text-lg tracking-tight text-foreground`}>{invoice.DocNo}</p>
          </div>
          <button onClick={onClose} className={ICON_ACT} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="border border-foreground/20 bg-foreground/5 px-4 py-3 flex items-start gap-2">
            <Banknote size={15} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-foreground">
              Sale invoice payments are cash only and settle through the
              Dummy Bank account — all other modes are disabled for this
              workflow.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className={`${LBL} mb-0.5`}>Customer</p>
              <p className="font-medium text-foreground text-xs">{invoice.ToCompanyName}</p>
            </div>
            <div>
              <p className={`${LBL} mb-0.5`}>Invoice Amount</p>
              <p className={`${HR_NUM} font-bold text-foreground text-sm`}>{fmtAmt(invoice.TotalAmount)}</p>
            </div>
          </div>

          <div>
            <FieldLabel>Deposit Account</FieldLabel>
            <div className="flex items-center gap-2 h-9 px-3 border border-dashed border-foreground/30">
              <Landmark size={13} className="text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold text-foreground">
                {dummyBank?.BName ?? "Dummy Bank"} (auto-selected)
              </span>
            </div>
          </div>

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
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${INPUT} pl-8 ${HR_NUM}`}
                />
              </div>
            </div>
            <div>
              <FieldLabel required>Payment Date</FieldLabel>
              <DateInput
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Remarks</FieldLabel>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="Optional notes about this receipt"
              className="w-full px-3 py-2 border border-foreground/30 bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:border-foreground rounded-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={!canSubmit} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              {mutation.isPending ? (
                <>
                  <RefreshCw size={13} className="animate-spin" /> Recording…
                </>
              ) : (
                <>
                  <Banknote size={13} /> Record Cash Receipt
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Generate Invoice Tab ───────────────────────────────────────────────────────

function GenerateInvoiceTab() {
  const rights = usePageRights("sale-invoice");
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedOrder, setSelectedOrder] = useState<EligibleSaleOrder | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [remarks, setRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Approved sale orders not invoiced yet, each with its lines and totals.
  const { data: eligibleOrders = [], isLoading: loading } = useQuery({
    queryKey: ["sale-invoices", "eligible-orders"],
    queryFn: getEligibleSaleOrders,
    staleTime: 30_000,
  });

  const pickOrder = (o: EligibleSaleOrder | null) => {
    setSelectedOrder(o);
    setErrorMsg("");
    setRemarks(o ? `Against sale order ${o.DocNo}` : "");
  };
  const dateBeforeOrder = !!selectedOrder && !!invoiceDate && invoiceDate < String(selectedOrder.OrderDate).slice(0, 10);

  const createMut = useMutation({
    mutationFn: createSaleInvoice,
    onSuccess: (res) => {
      setSuccessMsg(
        `Sale invoice ${res.DocNo} generated — ${fmtAmt(res.TotalAmount)} pending payment.`,
      );
      setErrorMsg("");
      pickOrder(null);
      setInvoiceDate(today);
      qc.invalidateQueries({ queryKey: ["sale-invoices"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const handleSubmit = () => {
    if (!selectedOrder || dateBeforeOrder) return;
    setErrorMsg("");
    createMut.mutate({ SaleOrderID: selectedOrder.SaleOrderID, InvoiceDate: invoiceDate, Remarks: remarks.trim() || undefined });
  };

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="px-4 py-3 bg-primary/10 text-primary border border-primary/30 flex items-center gap-2 text-sm">
          <CheckCircle2 size={15} /> {successMsg}
          <button onClick={() => setSuccessMsg("")} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="px-4 py-3 bg-destructive/10 text-destructive border border-destructive/30 flex items-center gap-2 text-sm">
          <AlertCircle size={15} /> {errorMsg}
          <button onClick={() => setErrorMsg("")} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}

      <SheetBox title="Generate Sale Invoice">
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw size={13} className="animate-spin" /> Loading sale orders…
            </div>
          ) : eligibleOrders.length === 0 ? (
            <div className="border border-dashed border-foreground/30 py-14 text-center">
              <p className="text-sm text-foreground">No approved sale orders awaiting invoicing.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Approve a sale order first. Invoices already generated are listed below.
              </p>
            </div>
          ) : (
            <>
              <EligibleOrderPicker orders={eligibleOrders} selected={selectedOrder} onSelect={pickOrder} />

              {selectedOrder && (
                <>
                {/* Bill To is the invoice's main party: twice the width and larger type than Sold From. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 border-t border-l border-foreground/20">
                  <div className="sm:col-span-3 xl:col-span-2 px-4 py-3 border-r border-b border-foreground/20 min-w-0 bg-foreground/[0.03]">
                    <p className={`${LBL} mb-1`}>{selectedOrder.BuyerName ? "Bill To (Buyer)" : "Bill To"}</p>
                    <p className="text-lg font-bold tracking-tight text-foreground break-words leading-snug">
                      {selectedOrder.BuyerName || selectedOrder.ToCompanyName || "—"}
                    </p>
                    {!selectedOrder.BuyerName && selectedOrder.ToProjectName && (
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedOrder.ToProjectName}</p>
                    )}
                  </div>
                  {[
                    {
                      label: "Sold From",
                      value: selectedOrder.FromCompanyName,
                      sub: [selectedOrder.FromProjectName, selectedOrder.FromGodownName].filter(Boolean).join(" · "),
                    },
                    { label: "Order", value: `${selectedOrder.DocNo} · ${fmtDate(selectedOrder.OrderDate)}`, num: true },
                    { label: "Invoice Amount", value: fmtAmt(selectedOrder.TotalAmount), num: true, big: true },
                  ].map((c: { label: string; value: React.ReactNode; sub?: string | null; num?: boolean; big?: boolean }) => (
                    <div key={c.label} className="px-3 py-2.5 border-r border-b border-foreground/20 min-w-0">
                      <p className={`${LBL} mb-0.5`}>{c.label}</p>
                      <p className={`text-foreground ${c.big ? "text-sm font-bold" : "text-xs font-medium"} ${c.num ? HR_NUM : ""} ${c.big ? "whitespace-nowrap" : ""}`}>
                        {c.value}
                      </p>
                      {c.sub && <p className="text-[0.625rem] text-muted-foreground">{c.sub}</p>}
                    </div>
                  ))}
                </div>

                <SaleLinesTable
                  items={selectedOrder.SaleItems ?? []}
                  basic={selectedOrder.BasicAmount}
                  tax={selectedOrder.TaxAmount}
                  total={selectedOrder.TotalAmount}
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <FieldLabel required>Invoice Date</FieldLabel>
                    <DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={INPUT} />
                    {dateBeforeOrder && (
                      <p className="text-[0.6875rem] text-destructive mt-1">
                        Can't be before the order date ({fmtDate(selectedOrder.OrderDate)}).
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel>Remarks</FieldLabel>
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} className={INPUT} />
                  </div>
                </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-foreground/20">
                <p className="text-xs text-muted-foreground">
                  The lines and amount come from the sale order and can't be changed here. The invoice starts as Pending Payment.
                </p>
                {rights.canCreate && (
                  <button
                    onClick={handleSubmit}
                    disabled={!selectedOrder || !invoiceDate || dateBeforeOrder || createMut.isPending}
                    className={`${KEY_INK} h-9 px-5`}
                  >
                    {createMut.isPending ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" /> Generating…
                      </>
                    ) : (
                      <>
                        <Send size={13} /> Generate Sale Invoice
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </SheetBox>
    </div>
  );
}

// ─── Sale Invoice History ───────────────────────────────────────────────────────

function SaleInvoiceHistory({ dummyBank }: { dummyBank: BankRecord | null }) {
  const rights = usePageRights("sale-invoice");
  // Server-paged: one page of invoices per request (newest first), however many exist.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-invoices", "history", page, pageSize],
    queryFn: () => getSaleInvoices({ page, limit: pageSize }),
    staleTime: 30_000,
    placeholderData: keepPreviousData, // keep the current rows on screen while the next page loads
  });
  const invoices: SaleInvoiceDoc[] = data?.data ?? [];
  const total = Number(data?.total ?? 0);
  // A page past the end (rows removed since it was opened) comes back empty - go back to the first page.
  React.useEffect(() => {
    if (!isFetching && page > 1 && data && invoices.length === 0) setPage(1);
  }, [isFetching, page, data, invoices.length]);
  const [viewingInvoice, setViewingInvoice] = useState<SaleInvoiceDoc | null>(
    null,
  );
  // The invoice's lines come from its sale order (loaded when the invoice is opened).
  const { data: viewingDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["sale-invoices", "detail", viewingInvoice?.SaleInvoiceID],
    queryFn: () => getSaleInvoiceById(viewingInvoice!.SaleInvoiceID),
    enabled: !!viewingInvoice,
    staleTime: 30_000,
  });
  const [payingInvoice, setPayingInvoice] = useState<SaleInvoiceDoc | null>(
    null,
  );

  return (
    <SheetBox
      title="Sale Invoice History"
      note={total ? `${total.toLocaleString("en-IN")} invoices` : undefined}
      flush
      action={
        <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-8 px-3`}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <p className="px-4 pt-3 text-xs text-muted-foreground">Invoices generated from approved sale orders</p>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {["Doc No", "Sale Order", "Customer", "Date", "Amount", "Received", "Status", "By", ""].map((h) => (
                <th key={h} className={`${TH} ${h === "Amount" || h === "Received" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className={TD}>
                      <div className="h-3 bg-foreground/10 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  No sale invoices yet.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.SaleInvoiceID} className="hover:bg-primary/5 transition-colors">
                  <td className={`${TD} ${HR_NUM} font-semibold text-foreground whitespace-nowrap`}>{inv.DocNo}</td>
                  <td className={`${TD} ${HR_NUM} text-muted-foreground whitespace-nowrap`}>{inv.SaleOrderDocNo}</td>
                  <td className={`${TD} text-foreground whitespace-nowrap`}>{inv.ToCompanyName}</td>
                  <td className={`${TD} ${HR_NUM} text-muted-foreground whitespace-nowrap`}>{fmtDate(inv.InvoiceDate)}</td>
                  <td className={`${TD} ${HR_NUM} font-semibold text-foreground whitespace-nowrap text-right`}>
                    {fmtAmt(inv.TotalAmount)}
                  </td>
                  <td className={`${TD} ${HR_NUM} text-muted-foreground whitespace-nowrap text-right`}>
                    {fmtAmt(inv.AmountReceived || 0)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{statusMark(inv.PaymentStatus)}</td>
                  <td className={`${TD} text-muted-foreground truncate max-w-[120px]`}>
                    {inv.CreatedBy?.split("@")[0] || "—"}
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-1">
                      <button data-row-view onClick={() => setViewingInvoice(inv)} className={ICON_ACT} title="View">
                        <Eye size={14} />
                      </button>
                      {inv.PaymentStatus === "Pending Payment" && (
                        <button onClick={() => setPayingInvoice(inv)} className={ICON_ACT} title="Collect Payment">
                          <Banknote size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ServerPager page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      {/* ── View modal ────────────────────────────────────────────────────── */}
      {viewingInvoice && createPortal(
        <div className={OVERLAY}>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .si-print-modal, .si-print-modal * { visibility: visible; }
              .si-print-modal {
                position: absolute !important;
                inset: 0 !important;
                margin: 0 !important;
                width: 100% !important;
                max-width: none !important;
                max-height: none !important;
                overflow: visible !important;
                box-shadow: none !important;
                border: none !important;
                border-radius: 0 !important;
                background: white !important;
              }
              .si-print-modal .sticky { position: static !important; }
            }
          `}</style>
          <div
            role="dialog"
            className="si-print-modal bg-card border border-foreground w-full max-w-3xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[88vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-foreground">
              <div>
                <p className={LBL}>Sale Invoice</p>
                <h2 className={`font-heading font-bold text-lg tracking-tight mt-0.5 ${HR_NUM}`}>{viewingInvoice.DocNo}</h2>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                {rights.canPrint && (
                  <button onClick={() => window.print()} title="Print Invoice" className={`${KEY_LINE} h-8 px-3`}>
                    <Printer size={12} /> Print
                  </button>
                )}
                <button onClick={() => setViewingInvoice(null)} className={ICON_ACT} title="Close">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* Sold To is the invoice's main party: full width, larger type; Sold From sits beside the doc details. */}
              <div className="grid grid-cols-2 sm:grid-cols-5 border-t border-l border-foreground/20">
                <div className="col-span-2 sm:col-span-5 px-4 py-3 border-r border-b border-foreground/20 min-w-0 bg-foreground/[0.03]">
                  <p className={`${LBL} mb-1`}>Sold To</p>
                  <p className="text-lg font-bold tracking-tight text-foreground break-words leading-snug">
                    {viewingInvoice.ToCompanyName || "—"}
                  </p>
                </div>
                {[
                  { label: "Sold From", value: viewingInvoice.FromCompanyName },
                  { label: "Doc No", value: viewingInvoice.DocNo, num: true },
                  { label: "Date", value: fmtDate(viewingInvoice.InvoiceDate), num: true },
                  { label: "Sale Order", value: viewingInvoice.SaleOrderDocNo, num: true },
                  { label: "Created By", value: viewingInvoice.CreatedByName || viewingInvoice.CreatedBy },
                ].map(({ label, value, num }) => (
                  <div key={label} className="px-3 py-2.5 border-r border-b border-foreground/20 min-w-0">
                    <p className={`${LBL} mb-0.5`}>{label}</p>
                    <p className={`text-xs font-semibold text-foreground break-words ${num ? HR_NUM : ""}`}>{value}</p>
                  </div>
                ))}
              </div>

              {detailLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw size={12} className="animate-spin" /> Loading lines…
                </div>
              ) : (viewingDetail?.SaleItems?.length ?? 0) > 0 ? (
                <SaleLinesTable
                  items={viewingDetail!.SaleItems!}
                  basic={viewingDetail!.BasicAmount}
                  tax={viewingDetail!.TaxAmount}
                  total={viewingInvoice.TotalAmount}
                />
              ) : null}

              <div className="border-t border-foreground pt-3 flex items-end justify-between gap-3">
                <div>
                  <p className={`${LBL} mb-1`}>Status</p>
                  {statusMark(viewingInvoice.PaymentStatus)}
                </div>
                <div className="text-right">
                  <p className={`${LBL} mb-0.5`}>Received / Total</p>
                  <p className={`text-base font-bold text-foreground ${HR_NUM}`}>
                    {fmtAmt(viewingInvoice.AmountReceived || 0)} / {fmtAmt(viewingInvoice.TotalAmount)}
                  </p>
                </div>
              </div>

              {viewingInvoice.PaymentStatus === "Pending Payment" && (
                <button
                  onClick={() => {
                    setPayingInvoice(viewingInvoice);
                    setViewingInvoice(null);
                  }}
                  className={`${KEY_INK} h-9 px-5 w-full print:hidden`}
                >
                  <Banknote size={13} /> Collect Cash Payment
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Collect payment modal ────────────────────────────────────────── */}
      {payingInvoice && (
        <CollectPaymentModal
          invoice={payingInvoice}
          dummyBank={dummyBank}
          onClose={() => setPayingInvoice(null)}
        />
      )}
    </SheetBox>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SaleInvoice() {
  const rights = usePageRights("sale-invoice");

  const { data: banksRaw } = useQuery({
    queryKey: ["bank-master"],
    queryFn: getBanks,
    staleTime: 120_000,
  });
  const dummyBank = useMemo(
    () => (banksRaw ?? []).find((b) => /dummy/i.test(b.BName || "")) ?? null,
    [banksRaw],
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Module", "Sale Invoice"]} />

      <SheetShell
        eyebrow="CivilierERP · Sales"
        title="Sale Invoice"
        subtitle="Generate invoices from approved sale orders and collect cash payment against them"
      >
        {!dummyBank && (
          <div className="px-4 py-3 bg-destructive/10 text-destructive border border-destructive/30 flex items-center gap-2 text-sm">
            <AlertCircle size={15} /> No "Dummy Bank" account found in Bank
            Master — payments will still post since the server enforces the
            deposit account, but it can't be named here for display.
          </div>
        )}

        {/* The form on top, every invoice listed below it (no tabs). */}
        {rights.canCreate && <GenerateInvoiceTab />}
        <SaleInvoiceHistory dummyBank={dummyBank} />
      </SheetShell>
    </>
  );
}
