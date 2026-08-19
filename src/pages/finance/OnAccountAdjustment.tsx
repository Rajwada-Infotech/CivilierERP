import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { preventEnterSubmit } from "@/hooks/useDraftForm";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, RefreshCw, Wallet, Loader2, TrendingUp, Users, X, CheckCircle2, ChevronDown,
  BadgeDollarSign, ArrowUpCircle, ArrowDownCircle,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell, FinanceGlassCard } from "@/components/finance/FinanceShell";
import { getInvoicesForParty, applyOAAdjustment, type OAAdjustmentMode } from "@/api/onAccountApi";
import type { OAInvoice } from "@/api/onAccountApi";
import { previewOAAdjustment, excludeOriginatingInvoice } from "@/api/onAccountAdjustment";
import { toast } from "sonner";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";

// Informational label only — an adjustment is always a pure internal
// transfer (Dr Payable / Cr On Account), never a real bank/cheque movement.
// See applyOAAdjustment's doc comment.
const OA_PAYMENT_MODES: OAAdjustmentMode[] = ["Cash", "Cheque", "Post-Dated Cheque", "NEFT", "UPI", "RTGS", "IMPS", "Card"];

interface PartySummary {
  PartyId: number;
  PartyName: string;
  PartyType: string;
  Balance: number;
}

interface CreditEntry {
  OAId: number;
  PartyId: number;
  PartyName: string;
  PartyTypeCode: string;
  PaymentDate: string;
  PaymentDocNo: string;
  ExcessAmount: number;
  InvoiceRef: string | null;
  PaymentAmount: number | null;
  InvoiceAmount: number | null;
  InvoiceTotalPaid: number | null;
  InvoiceDocNo: string | null;
  AvailableBalance: number;
  Notes: string | null;
  // CRM customer on-account credits (Source='CRM') are visibility-only here —
  // there's no ExpenseBooking invoice to adjust against, so no Adjust action
  // is offered; applying stays a CRM-only flow (Booking Detail / Payment
  // Milestones' own "Apply On-Account"). Booking context substitutes for the
  // invoice columns, which stay null on these rows.
  Source: "Vendor" | "CRM";
  CrmBookingNo: string | null;
  CrmProjectName: string | null;
  CrmUnitNo: string | null;
  CrmApplicantName: string | null;
  // The next still-open milestone on this booking — this credit auto-applies
  // onto it the moment it's created/approved (see autoApplyOnAccount in
  // crmPayments.js); null means every milestone on the booking is already
  // fully paid, so the credit has nothing left to apply to.
  CrmNextMilestoneName: string | null;
  CrmNextMilestoneDue: number | null;
  CrmNextMilestoneDueDate: string | null;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Mirrors the visible desktop table's own column order (Party → Payment
// Voucher → Date → Invoice/Booking → Net Payable → Total Paid → On A/C
// Amt → Party Balance) so the export reads like the page it came from.
const ON_ACCOUNT_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Party", accessor: (r: any) => r.PartyName || "—" },
  { header: "Payment Voucher", accessor: (r: any) => r.PaymentDocNo || "—" },
  { header: "Date", accessor: (r: any) => fmtDate(r.PaymentDate) },
  { header: "Invoice / Booking", accessor: (r: any) => (r.Source === "CRM" ? `${r.CrmBookingNo || "—"}${r.CrmUnitNo ? ` · ${r.CrmUnitNo}` : ""}` : r.InvoiceDocNo || r.InvoiceRef || "—") },
  { header: "Net Payable", accessor: (r: any) => (r.InvoiceAmount != null ? formatINR(r.InvoiceAmount) : "—") },
  { header: "Total Paid", accessor: (r: any) => ((r.InvoiceTotalPaid ?? r.PaymentAmount) != null ? formatINR(r.InvoiceTotalPaid ?? r.PaymentAmount ?? 0) : "—") },
  { header: "On A/C Amt", accessor: (r: any) => formatINR(r.ExcessAmount) },
  { header: "Party Balance", accessor: (r: any) => formatINR(r.AvailableBalance) },
];

function PartyTypePill({ code }: { code: string }) {
  const label = code === "S" ? "Supplier" : code === "C" ? "Contractor" : code === "A" ? "Customer" : code;
  const cls = code === "S"
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
    : code === "A"
    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
    : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

function BalanceBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Inline Adjust Dialog ─────────────────────────────────────────────────────
function AdjustDialog({
  entry,
  currentBalance,
  onClose,
  onSuccess,
}: {
  entry: CreditEntry;
  currentBalance: number;
  onClose: () => void;
  onSuccess: (newBalance: number) => void;
}) {
  const [invoices, setInvoices] = useState<OAInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ applied: number; remaining: number } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Mode — informational label only (how the original advance arrived).
  // An adjustment is always a pure internal transfer, no bank/cheque
  // involved — see applyOAAdjustment's doc comment.
  const [mode, setMode] = useState<OAAdjustmentMode>("Cash");

  useEffect(() => {
    setLoading(true);
    getInvoicesForParty(entry.PartyId)
      .then(setInvoices)
      .catch(() => toast.error("Failed to load invoices"))
      .finally(() => setLoading(false));
  }, [entry.PartyId]);

  // The invoice that generated this on-account credit in the first place
  // shouldn't be offered as a target to adjust the same credit back onto.
  const adjustableInvoices = useMemo(
    () => excludeOriginatingInvoice(invoices, entry.InvoiceRef),
    [invoices, entry.InvoiceRef],
  );

  const selected = adjustableInvoices.find((i) => i.docNo === selectedDoc);
  const invoiceRemaining = selected ? (selected.remaining > 0 ? selected.remaining : selected.invoiceAmount) : 0;

  // Pre-fill amount: as much as this adjustment can cover
  useEffect(() => {
    if (!selected) { setAmount(""); return; }
    const preview = previewOAAdjustment(currentBalance, invoiceRemaining);
    setAmount(String(Math.round(preview.applyAmount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, currentBalance]);

  const adjAmount = parseFloat(amount) || 0;
  const preview = selected ? previewOAAdjustment(currentBalance, invoiceRemaining, adjAmount) : null;
  const previewBalance = preview ? preview.balanceAfter : Math.max(0, currentBalance - adjAmount);
  const canSubmit = selectedDoc && adjAmount > 0 && adjAmount <= currentBalance && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await applyOAAdjustment({
        expenseRef: selectedDoc,
        amount: adjAmount,
        partyId: entry.PartyId,
        paymentDocNo: entry.PaymentDocNo,
        mode,
      });
      setDone({ applied: result.applied, remaining: result.remainingBalance });
      onSuccess(result.remainingBalance);
    } catch (err: any) {
      toast.error(err.message ?? "Adjustment failed");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={preventEnterSubmit}
      >
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-sm">Adjust On A/C Balance</p>
            <p className="text-xs text-muted-foreground mt-0.5">{entry.PartyName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground">
            <X size={15} />
          </button>
        </div>

        {done ? (
          /* ── Success state ── */
          <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 size={24} className="text-emerald-500" />
            </div>
            <p className="font-semibold text-foreground">Adjustment Applied</p>
            <p className="text-xs text-muted-foreground">
              ₹{done.applied.toLocaleString("en-IN")} adjusted against <span className="font-mono text-foreground">{selectedDoc}</span>
            </p>
            <div className="mt-2 w-full rounded-xl border border-border bg-muted/20 px-4 py-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground uppercase tracking-wide text-[10px]">Remaining On A/C Balance</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatINR(done.remaining)}</span>
            </div>
            <Button size="sm" variant="outline" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">

            {/* Current balance strip — spans both columns */}
            <div className="rounded-xl bg-muted/20 border border-border px-4 py-3 flex items-center justify-between mb-4">
              <span className="text-xs text-muted-foreground">Available On A/C Balance</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">{formatINR(currentBalance)}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {/* ── Left column: invoice + amount ── */}
            <div className="space-y-4">
            {/* Invoice selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Select Invoice / Contract
              </label>
              {loading ? (
                <div className="h-10 rounded-lg bg-muted/40 animate-pulse" />
              ) : adjustableInvoices.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No other invoices found for this supplier.</p>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-background text-xs hover:border-primary/50 transition-colors"
                  >
                    {selected ? (
                      <span className="font-mono text-primary">{selected.docNo}</span>
                    ) : (
                      <span className="text-muted-foreground">Choose an invoice…</span>
                    )}
                    <ChevronDown size={13} className={`text-muted-foreground transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-20 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                      {adjustableInvoices.map((inv) => (
                        <button
                          key={inv.docNo}
                          type="button"
                          onClick={() => { setSelectedDoc(inv.docNo); setDropdownOpen(false); }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/40 transition-colors border-b border-border/40 last:border-0 ${selectedDoc === inv.docNo ? "bg-primary/5" : ""}`}
                        >
                          <div>
                            <p className="font-mono text-xs text-primary">{inv.docNo}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {inv.billStatus ?? "Unknown"} · Remaining {formatINR(inv.remaining)}
                            </p>
                          </div>
                          <span className="font-mono text-xs font-semibold text-foreground ml-3 shrink-0">{formatINR(inv.invoiceAmount)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Invoice breakdown when selected */}
            {selected && (
              <div className="rounded-xl border border-border overflow-hidden text-xs">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/10">
                  <span className="text-muted-foreground">Invoice Amount (incl. GST)</span>
                  <span className="font-mono font-semibold">{formatINR(selected.invoiceAmount)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-border/50">
                  <span className="text-emerald-600 dark:text-emerald-400">Total Paid</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(selected.totalPaid)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-border/50">
                  <span className="text-amber-600 dark:text-amber-400">Remaining to Pay</span>
                  <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{formatINR(invoiceRemaining)}</span>
                </div>
                {adjAmount > 0 && preview && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border/50 bg-muted/10">
                    <span className="text-muted-foreground">Remaining After This Adjustment</span>
                    <span className={`font-mono font-semibold ${preview.isFullyCovered ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {formatINR(preview.invoiceRemainingAfter)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Amount to adjust */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Amount to Adjust
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={1}
                max={currentBalance}
                placeholder="Enter amount"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              />
              {adjAmount > currentBalance && (
                <p className="text-xs text-red-500">Exceeds available balance of {formatINR(currentBalance)}</p>
              )}
            </div>
            </div>
            {/* ── end left column ── */}

            {/* ── Right column: payment mode + balance preview ── */}
            <div className="space-y-4">
            {/* Mode — informational label only, describing how the original
                advance arrived. This adjustment itself is always a pure
                internal transfer (Dr Payable / Cr On Account) — no bank or
                cheque is ever touched. */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Mode <span className="normal-case font-normal text-muted-foreground/70">(label only — no bank involved)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {OA_PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                      mode === m
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm"
                        : "border-border text-muted-foreground hover:bg-muted/40 hover:border-border/80"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Balance preview */}
            {adjAmount > 0 && adjAmount <= currentBalance && (
              <div className="rounded-xl border border-border overflow-hidden text-xs">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/10">
                  <span className="text-muted-foreground">Current Balance</span>
                  <span className="font-mono font-semibold">{formatINR(currentBalance)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-border/50">
                  <span className="text-red-500">Adjusting</span>
                  <span className="font-mono font-semibold text-red-500">−{formatINR(adjAmount)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-border/50 bg-muted/20">
                  <span className="font-semibold text-foreground">New Balance</span>
                  <span className={`font-mono font-bold ${previewBalance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    {formatINR(previewBalance)}
                  </span>
                </div>
              </div>
            )}
            </div>
            {/* ── end right column ── */}
            </div>
            {/* ── end two-column grid ── */}
          </div>
        )}

        {!done && (
          <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-border">
            <Button variant="outline" size="sm" className="flex-1" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Confirm Adjust
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function OnAccountAdjustment() {
  const queryClient = useQueryClient();
  const [selectedPartyId, setSelectedPartyId] = useState<string>("all");
  const [adjustingEntry, setAdjustingEntry] = useState<CreditEntry | null>(null);
  // Live balance override after adjustment (partyId → new balance)
  const [liveBalances, setLiveBalances] = useState<Map<number, number>>(new Map());

  const { data: parties = [], isLoading: partiesLoading, refetch: refetchParties } = useQuery<PartySummary[]>({
    queryKey: ["oa-party-summary"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/on-account/party-summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const {
    data: credits = [],
    isLoading: creditsLoading,
    refetch: refetchCredits,
  } = useQuery<CreditEntry[]>({
    queryKey: ["oa-adjustable", selectedPartyId],
    queryFn: async () => {
      const url = selectedPartyId !== "all"
        ? `/api/on-account/adjustable?partyId=${selectedPartyId}`
        : "/api/on-account/adjustable";
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const filteredCredits = selectedPartyId === "all"
    ? credits
    : credits.filter((c) => String(c.PartyId) === selectedPartyId);

  const isLoading = partiesLoading || creditsLoading;

  const balanceMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of parties) m.set(p.PartyId, p.Balance);
    // Apply live overrides
    liveBalances.forEach((v, k) => m.set(k, v));
    return m;
  }, [parties, liveBalances]);

  const totalBalance = useMemo(
    () => Array.from(balanceMap.values()).reduce((s, v) => s + v, 0),
    [balanceMap],
  );
  const maxBalance = useMemo(() => Math.max(...Array.from(balanceMap.values()), 0), [balanceMap]);
  const selectedParty = parties.find((p) => String(p.PartyId) === selectedPartyId);

  function handleAdjust(entry: CreditEntry) {
    setAdjustingEntry(entry);
  }

  function handleAdjustSuccess(partyId: number, newBalance: number) {
    // Update live balance immediately (before refetch)
    setLiveBalances((prev) => new Map(prev).set(partyId, newBalance));
    // Refetch in background to get authoritative data
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["oa-party-summary"] });
      queryClient.invalidateQueries({ queryKey: ["oa-adjustable"] });
    }, 800);
  }

  const displayParties = selectedPartyId === "all" ? parties : parties.filter((p) => String(p.PartyId) === selectedPartyId);

  return (
    <>
    <Breadcrumbs items={["Dashboard", "Finance", "On A/C Adjustment"]} />
    <FinanceShell title="On A/C Adjustment" subtitle="Excess payments available for adjustment against future invoices">
      <div className="space-y-6">

        {/* ── Top stat cards + party panel ──────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Left: stat cards */}
          <div className="flex flex-col gap-3">
            <FinanceGlassCard
              label="Total On A/C Balance"
              icon={Wallet}
              accentColor="#10b981"
              value={
                partiesLoading
                  ? <div className="h-8 w-32 rounded bg-muted/40 animate-pulse mt-1" />
                  : <span className="tabular-nums">{formatINR(totalBalance)}</span>
              }
              sub={`Across ${parties.length} ${parties.length === 1 ? "party" : "parties"}`}
            />

            <FinanceGlassCard
              label="Parties with Balance"
              icon={Users}
              accentColor="#6366f1"
              value={partiesLoading ? "—" : String(parties.length)}
              sub={`${parties.filter((p) => p.PartyType === "Supplier" || p.PartyType === "S").length} Suppliers · ${parties.filter((p) => p.PartyType === "Contractor" || p.PartyType === "C").length} Contractors · ${parties.filter((p) => p.PartyType === "Customer" || p.PartyType === "A").length} Customers`}
            />

            <FinanceGlassCard
              label="Credit Entries"
              icon={BadgeDollarSign}
              accentColor="#f59e0b"
              value={creditsLoading ? "—" : String(filteredCredits.length)}
              sub={selectedPartyId === "all" ? "All parties" : `Filtered · ${selectedParty?.PartyName ?? ""}`}
            />

            <Button variant="outline" size="sm" onClick={() => { refetchParties(); refetchCredits(); }} disabled={isLoading} className="w-fit gap-1.5">
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </Button>
          </div>

          {/* Right: party breakdown panel */}
          <div className="sm:col-span-2 lg:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-emerald-500" />
                <span className="text-sm font-semibold">Party Balances</span>
              </div>
              {selectedPartyId !== "all" && (
                <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setSelectedPartyId("all")}>
                  Show all
                </button>
              )}
            </div>
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {partiesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="h-4 w-32 rounded bg-muted/50 animate-pulse" />
                    <div className="flex-1 h-1.5 rounded bg-muted/50 animate-pulse" />
                    <div className="h-4 w-20 rounded bg-muted/50 animate-pulse" />
                  </div>
                ))
              ) : parties.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No On A/C balances found</div>
              ) : (
                displayParties.map((p) => {
                  const live = balanceMap.get(p.PartyId) ?? p.Balance;
                  return (
                    <button
                      key={p.PartyId}
                      onClick={() => setSelectedPartyId(selectedPartyId === String(p.PartyId) ? "all" : String(p.PartyId))}
                      className={`w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/30 transition-colors ${
                        selectedPartyId === String(p.PartyId) ? "bg-emerald-500/5 border-l-2 border-emerald-500" : ""
                      }`}
                    >
                      <div className="min-w-0 w-36">
                        <p className="text-xs font-medium truncate">{p.PartyName}</p>
                        <p className="text-[10px] text-muted-foreground">{p.PartyType}</p>
                      </div>
                      <BalanceBar value={live} max={maxBalance} />
                      <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                        {formatINR(live)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedParty && (
              <div className="px-5 py-3 border-t border-border bg-emerald-500/5 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Filtered to:</span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{selectedParty.PartyName}</span>
                <span className="font-mono text-xs font-bold text-emerald-500 ml-auto">
                  {formatINR(balanceMap.get(selectedParty.PartyId) ?? selectedParty.Balance)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Credits table ──────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <p className="text-sm font-semibold">On A/C Credit Entries</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedPartyId === "all" ? "All parties" : `Filtered to ${selectedParty?.PartyName ?? ""}`}
                {filteredCredits.length > 0 && ` · ${filteredCredits.length} entr${filteredCredits.length === 1 ? "y" : "ies"}`}
              </p>
            </div>
            <ExportMenu
              data={filteredCredits as unknown as Record<string, unknown>[]}
              columns={ON_ACCOUNT_EXPORT_COLUMNS}
              title="On A/C Adjustment"
              filename="on-account-adjustment"
              disabled={filteredCredits.length === 0}
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : filteredCredits.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Wallet size={32} className="opacity-20" />
              <p>No On Account balances available for adjustment</p>
              {selectedPartyId !== "all" && (
                <button className="text-xs underline" onClick={() => setSelectedPartyId("all")}>Show all parties</button>
              )}
            </div>
          ) : (
            <>
              {/* ── Mobile cards ── */}
              <div className="md:hidden divide-y divide-border">
                {filteredCredits.map((entry) => {
                  const live = balanceMap.get(entry.PartyId) ?? entry.AvailableBalance;
                  return (
                    <div key={entry.OAId} className="px-4 py-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{entry.PartyName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <PartyTypePill code={entry.PartyTypeCode} />
                            <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">{entry.PaymentDocNo || "—"}</span>
                          </div>
                        </div>
                        {entry.Source === "CRM" ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground italic px-2 py-1">
                            Apply via CRM
                          </span>
                        ) : (
                          <Button size="sm" variant="outline"
                            className="shrink-0 h-7 text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                            onClick={() => handleAdjust(entry)}>
                            Adjust <ArrowRight size={11} />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Date</p>
                          <p>{fmtDate(entry.PaymentDate)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {entry.Source === "CRM" ? "Booking" : "Invoice Ref"}
                          </p>
                          <p className="font-mono text-muted-foreground truncate">
                            {entry.Source === "CRM"
                              ? `${entry.CrmBookingNo || "—"}${entry.CrmUnitNo ? ` · ${entry.CrmUnitNo}` : ""}`
                              : entry.InvoiceDocNo || entry.InvoiceRef || "—"}
                          </p>
                        </div>
                      </div>
                      {entry.Source === "CRM" && (entry.CrmProjectName || entry.CrmApplicantName) && (
                        <p className="text-[10px] text-muted-foreground">
                          {entry.CrmApplicantName}{entry.CrmProjectName ? ` · ${entry.CrmProjectName}` : ""}
                        </p>
                      )}
                      {entry.InvoiceAmount != null && (
                        <div className="rounded-xl border border-border overflow-hidden text-xs">
                          <div className="flex items-center justify-between px-3 py-2 bg-muted/10">
                            <p className="text-muted-foreground">Net Payable</p>
                            <p className="font-mono font-semibold tabular-nums">{formatINR(entry.InvoiceAmount)}</p>
                          </div>
                          {(entry.InvoiceTotalPaid ?? entry.PaymentAmount) != null && (
                            <div className="flex items-center justify-between px-3 py-2 border-t border-border/60">
                              <p className="text-emerald-600 dark:text-emerald-400">Total Paid</p>
                              <p className="font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                {formatINR(entry.InvoiceTotalPaid ?? entry.PaymentAmount ?? 0)}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {entry.Source === "CRM" && (
                        <div className="rounded-xl border border-border overflow-hidden text-xs">
                          <div className="flex items-center justify-between px-3 py-2 bg-muted/10">
                            <p className="text-muted-foreground">Next Milestone Due (Underpaid)</p>
                            <p className={`font-mono font-semibold tabular-nums flex items-center gap-1 ${entry.CrmNextMilestoneDue != null ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                              {entry.CrmNextMilestoneDue != null && <ArrowDownCircle size={13} className="shrink-0" />}
                              {entry.CrmNextMilestoneDue != null ? formatINR(entry.CrmNextMilestoneDue) : "—"}
                            </p>
                          </div>
                          <div className="flex items-center justify-between px-3 py-2 border-t border-border/60">
                            <p className="text-muted-foreground">Milestone</p>
                            <p className="font-medium">{entry.CrmNextMilestoneName ?? "All milestones paid"}</p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-border">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">On A/C Amt (Overpaid)</p>
                          <p className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <ArrowUpCircle size={13} className="shrink-0" />{formatINR(entry.ExcessAmount)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Party Balance</p>
                          <p className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatINR(live)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Desktop table ── */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {["Party", "Payment Voucher", "Date", "Invoice / Booking", "Net Payable", "Total Paid", "On A/C Amt", "Party Balance", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredCredits.map((entry) => {
                      const live = balanceMap.get(entry.PartyId) ?? entry.AvailableBalance;
                      return (
                        <tr key={entry.OAId} className="hover:bg-muted/20 transition-colors group">
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-xs">{entry.PartyName}</span>
                              <PartyTypePill code={entry.PartyTypeCode} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{entry.PaymentDocNo || "—"}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(entry.PaymentDate)}</td>
                          <td className="px-4 py-3">
                            {entry.Source === "CRM" ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {entry.CrmBookingNo || "—"}{entry.CrmUnitNo ? ` · ${entry.CrmUnitNo}` : ""}
                                </span>
                                {(entry.CrmApplicantName || entry.CrmProjectName) && (
                                  <span className="text-[10px] text-muted-foreground/80 truncate max-w-[160px]">
                                    {entry.CrmApplicantName}{entry.CrmProjectName ? ` · ${entry.CrmProjectName}` : ""}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">{entry.InvoiceDocNo || entry.InvoiceRef || "—"}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium tabular-nums text-right">
                            {entry.Source === "CRM" ? (
                              entry.CrmNextMilestoneDue != null ? (
                                <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1 justify-end">
                                  <ArrowDownCircle size={12} className="shrink-0" />{formatINR(entry.CrmNextMilestoneDue)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )
                            ) : entry.InvoiceAmount != null ? formatINR(entry.InvoiceAmount) : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs tabular-nums text-right text-emerald-600 dark:text-emerald-400 font-medium">
                            {entry.Source === "CRM" ? (
                              <span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal">
                                {entry.CrmNextMilestoneName ?? "All milestones paid"}
                              </span>
                            ) : (entry.InvoiceTotalPaid ?? entry.PaymentAmount) != null
                              ? formatINR(entry.InvoiceTotalPaid ?? entry.PaymentAmount ?? 0) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 justify-end">
                              <ArrowUpCircle size={12} className="shrink-0" />{formatINR(entry.ExcessAmount)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatINR(live)}</span>
                          </td>
                          <td className="px-4 py-3">
                            {entry.Source === "CRM" ? (
                              <span className="text-[10px] text-muted-foreground italic opacity-0 group-hover:opacity-100 transition-opacity">
                                Apply via CRM
                              </span>
                            ) : (
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleAdjust(entry)}>
                                Adjust <ArrowRight size={12} />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Inline Adjust Dialog ── */}
      {adjustingEntry && (
        <AdjustDialog
          entry={adjustingEntry}
          currentBalance={balanceMap.get(adjustingEntry.PartyId) ?? adjustingEntry.AvailableBalance}
          onClose={() => setAdjustingEntry(null)}
          onSuccess={(newBal) => {
            handleAdjustSuccess(adjustingEntry.PartyId, newBal);
            toast.success("On A/C balance adjusted successfully");
          }}
        />
      )}
    </FinanceShell>
    </>
  );
}
