import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SalesShell } from "@/components/sales/SalesShell";
import {
  Receipt,
  FileText,
  Banknote,
  Send,
  ClipboardList,
  ChevronDown,
  Search,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  IndianRupee,
  Eye,
  Printer,
  Hash,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import { getSaleOrders, type SaleOrder } from "@/api/saleOrdersApi";
import {
  getSaleInvoices,
  createSaleInvoice,
  type SaleInvoice as SaleInvoiceDoc,
} from "@/api/saleInvoicesApi";
import { createReceivedPayment } from "@/api/receivedPaymentApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
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

const STATUS_CONFIG: Record<
  string,
  { cls: string; icon: React.ReactNode; label: string }
> = {
  "Pending Payment": {
    cls: "bg-amber-500/10 text-amber-600",
    icon: <Clock size={11} />,
    label: "Pending Payment",
  },
  Paid: {
    cls: "bg-emerald-500/10 text-emerald-600",
    icon: <CheckCircle2 size={11} />,
    label: "Paid",
  },
};

// ─── Field label ──────────────────────────────────────────────────────────────

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

// ─── Eligible Sale Order Picker ────────────────────────────────────────────────

function EligibleOrderPicker({
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
        o.ToCompanyName?.toLowerCase().includes(q),
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
              · {selected.ToCompanyName}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">
            Select an approved sale order…
          </span>
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
              <p className="text-xs text-muted-foreground text-center py-6">
                No eligible sale orders found
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
                        {o.ToCompanyName} · {o.FromProjectName} →{" "}
                        {o.ToProjectName}
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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
              Collect Payment
            </p>
            <p className="font-mono font-bold text-foreground">
              {invoice.DocNo}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-xl bg-amber-500/5 border border-amber-400/20 px-4 py-3 flex items-start gap-2">
            <Banknote size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700">
              Sale invoice payments are cash only and settle through the
              Dummy Bank account — all other modes are disabled for this
              workflow.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                Customer
              </p>
              <p className="font-medium text-foreground text-xs">
                {invoice.ToCompanyName}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                Invoice Amount
              </p>
              <p className="font-bold text-foreground text-xs">
                {fmtAmt(invoice.TotalAmount)}
              </p>
            </div>
          </div>

          <div>
            <FieldLabel>Deposit Account</FieldLabel>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-emerald-400/40 bg-emerald-500/5">
              <Landmark size={14} className="text-emerald-600 shrink-0" />
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

          <div>
            <FieldLabel>Remarks</FieldLabel>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="Optional notes about this receipt"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-2 focus:ring-violet-500/30 transition-colors"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutation.isPending ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Recording…
                </>
              ) : (
                <>
                  <Banknote size={14} /> Record Cash Receipt
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
  const [selectedOrder, setSelectedOrder] = useState<SaleOrder | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { data: soData, isLoading: soLoading } = useQuery({
    queryKey: ["sale-orders"],
    queryFn: () => getSaleOrders({ limit: 500 }),
    staleTime: 60_000,
  });
  const orders: SaleOrder[] = soData?.data ?? [];

  const { data: siData, isLoading: siLoading } = useQuery({
    queryKey: ["sale-invoices"],
    queryFn: () => getSaleInvoices({ limit: 500 }),
    staleTime: 30_000,
  });
  const invoicedSoIds = useMemo(
    () => new Set((siData?.data ?? []).map((i) => i.SaleOrderID)),
    [siData],
  );

  const eligibleOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.Status?.includes("Approved") && !invoicedSoIds.has(o.SaleOrderID),
      ),
    [orders, invoicedSoIds],
  );

  const createMut = useMutation({
    mutationFn: createSaleInvoice,
    onSuccess: (res) => {
      setSuccessMsg(
        `Sale invoice ${res.DocNo} generated — ${fmtAmt(res.TotalAmount)} pending payment.`,
      );
      setErrorMsg("");
      setSelectedOrder(null);
      qc.invalidateQueries({ queryKey: ["sale-invoices"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const handleSubmit = () => {
    if (!selectedOrder) return;
    setErrorMsg("");
    createMut.mutate({ SaleOrderID: selectedOrder.SaleOrderID });
  };

  const loading = soLoading || siLoading;

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="px-4 py-3 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-2 text-sm">
          <CheckCircle2 size={15} /> {successMsg}
          <button onClick={() => setSuccessMsg("")} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 flex items-center gap-2 text-sm">
          <AlertCircle size={15} /> {errorMsg}
          <button onClick={() => setErrorMsg("")} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw size={13} className="animate-spin" /> Loading sale
            orders…
          </div>
        ) : eligibleOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
            <FileText
              size={32}
              className="text-muted-foreground/30 mx-auto mb-3"
            />
            <p className="text-sm text-muted-foreground">
              No approved sale orders awaiting invoicing.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Approve a sale order first, or check History for invoices
              already generated.
            </p>
          </div>
        ) : (
          <>
            <EligibleOrderPicker
              orders={eligibleOrders}
              selected={selectedOrder}
              onSelect={setSelectedOrder}
            />

            {selectedOrder && (
              <div className="rounded-xl bg-violet-500/5 border border-violet-400/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                    Customer
                  </p>
                  <p className="font-medium text-foreground text-xs">
                    {selectedOrder.ToCompanyName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {selectedOrder.ToProjectName}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                    From
                  </p>
                  <p className="font-medium text-foreground text-xs">
                    {selectedOrder.FromCompanyName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {selectedOrder.FromProjectName}
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
                    Invoice Amount
                  </p>
                  <p className="font-bold text-foreground">
                    {fmtAmt(selectedOrder.TotalAmount)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t border-border">
              <p className="text-xs text-muted-foreground pt-3">
                Amount is locked to the sale order total. The invoice starts
                as Pending Payment.
              </p>
              <div className="pt-3">
                {rights.canCreate && (
                  <button
                    onClick={handleSubmit}
                    disabled={!selectedOrder || createMut.isPending}
                    className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {createMut.isPending ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />{" "}
                        Generating…
                      </>
                    ) : (
                      <>
                        <Send size={13} /> Generate Sale Invoice
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sale Invoice History ───────────────────────────────────────────────────────

function SaleInvoiceHistory({ dummyBank }: { dummyBank: BankRecord | null }) {
  const rights = usePageRights("sale-invoice");
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-invoices"],
    queryFn: () => getSaleInvoices({ limit: 100 }),
    staleTime: 30_000,
  });
  const invoices: SaleInvoiceDoc[] = data?.data ?? [];
  const [viewingInvoice, setViewingInvoice] = useState<SaleInvoiceDoc | null>(
    null,
  );
  const [payingInvoice, setPayingInvoice] = useState<SaleInvoiceDoc | null>(
    null,
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-sm font-heading font-semibold text-foreground">
            Sale Invoice History
          </p>
          <p className="text-xs text-muted-foreground">
            Invoices generated from approved sale orders
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />{" "}
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {[
                "Doc No",
                "Sale Order",
                "Customer",
                "Date",
                "Amount",
                "Received",
                "Status",
                "By",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-semibold text-muted-foreground whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No sale invoices yet.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const cfg =
                  STATUS_CONFIG[inv.PaymentStatus] ??
                  STATUS_CONFIG["Pending Payment"];
                return (
                  <tr
                    key={inv.SaleInvoiceID}
                    className="border-b border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-primary font-semibold whitespace-nowrap">
                      {inv.DocNo}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                      {inv.SaleOrderDocNo}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {inv.ToCompanyName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtDate(inv.InvoiceDate)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                      {fmtAmt(inv.TotalAmount)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtAmt(inv.AmountReceived || 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${cfg.cls}`}
                      >
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[120px]">
                      {inv.CreatedBy?.split("@")[0] || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewingInvoice(inv)}
                          className="text-muted-foreground hover:bg-muted p-2 rounded-lg transition-colors"
                          title="View"
                        >
                          <Eye size={15} />
                        </button>
                        {inv.PaymentStatus === "Pending Payment" && (
                          <button
                            onClick={() => setPayingInvoice(inv)}
                            className="text-emerald-600 hover:bg-emerald-500/10 p-2 rounded-lg transition-colors"
                            title="Collect Payment"
                          >
                            <Banknote size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── View modal ────────────────────────────────────────────────────── */}
      {viewingInvoice && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
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
          <div className="si-print-modal bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="font-heading font-bold text-base">
                  {viewingInvoice.DocNo}
                </h2>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                  Sale Invoice
                </p>
              </div>
              <div className="flex items-center gap-2">
                {rights.canPrint && (
                  <button
                    onClick={() => window.print()}
                    title="Print Invoice"
                    className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground print:hidden"
                  >
                    <Printer size={18} />
                  </button>
                )}
                <button
                  onClick={() => setViewingInvoice(null)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors print:hidden"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Doc No", value: viewingInvoice.DocNo, mono: true },
                  { label: "Date", value: fmtDate(viewingInvoice.InvoiceDate) },
                  {
                    label: "Sale Order",
                    value: viewingInvoice.SaleOrderDocNo,
                    mono: true,
                  },
                  { label: "Customer", value: viewingInvoice.ToCompanyName },
                  { label: "From Company", value: viewingInvoice.FromCompanyName },
                  {
                    label: "Created By",
                    value: viewingInvoice.CreatedBy?.split("@")[0] || "—",
                  },
                ].map(({ label, value, mono }) => (
                  <div
                    key={label}
                    className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50"
                  >
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                      {label}
                    </p>
                    <p
                      className={`text-xs font-semibold ${mono ? "font-mono" : ""} text-foreground`}
                    >
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-violet-500/5 border border-violet-400/20 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                    Status
                  </p>
                  {(() => {
                    const cfg =
                      STATUS_CONFIG[viewingInvoice.PaymentStatus] ??
                      STATUS_CONFIG["Pending Payment"];
                    return (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${cfg.cls}`}
                      >
                        {cfg.icon} {cfg.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                    Received / Total
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    {fmtAmt(viewingInvoice.AmountReceived || 0)} /{" "}
                    {fmtAmt(viewingInvoice.TotalAmount)}
                  </p>
                </div>
              </div>

              {viewingInvoice.PaymentStatus === "Pending Payment" && (
                <button
                  onClick={() => {
                    setPayingInvoice(viewingInvoice);
                    setViewingInvoice(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors shadow-sm print:hidden"
                >
                  <Banknote size={14} /> Collect Cash Payment
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
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SaleInvoice() {
  const rights = usePageRights("sale-invoice");
  const [activeTab, setActiveTab] = useState<"generate" | "history">(
    "generate",
  );

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

      <SalesShell
        title="Sale Invoice"
        subtitle="Generate invoices from approved sale orders and collect cash payment against them"
        icon={Receipt}
        action={
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-border">
            {rights.canCreate && (
              <button
                onClick={() => setActiveTab("generate")}
                className={`inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg transition-colors ${
                  activeTab === "generate"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <FileText size={13} /> Generate
              </button>
            )}
            <button
              onClick={() => setActiveTab("history")}
              className={`inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg transition-colors ${
                activeTab === "history"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ClipboardList size={13} /> History
            </button>
          </div>
        }
      >
        {!dummyBank && (
          <div className="px-4 py-3 rounded-lg bg-amber-500/10 text-amber-700 border border-amber-500/20 flex items-center gap-2 text-sm">
            <AlertCircle size={15} /> No "Dummy Bank" account found in Bank
            Master — payments will still post since the server enforces the
            deposit account, but it can't be named here for display.
          </div>
        )}

        {activeTab === "generate" && <GenerateInvoiceTab />}
        {activeTab === "history" && (
          <SaleInvoiceHistory dummyBank={dummyBank} />
        )}
      </SalesShell>
    </>
  );
}