/**
 * Brs.tsx — Bank Reconciliation Statement
 *
 * Unified view of outgoing (NewPayment) and incoming (ReceivedPayment) bank
 * transactions. Supports Clear / Unclear reconciliation and Bounce tracking:
 * when a bank dishonours or bounces a payment the operator marks it here,
 * the row turns red, and full bounce details are stored and traceable.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, statusTone, Dimension } from "@/components/sheet/Sheet";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  getBRS,
  getBRSFilters,
  markClear,
  markUnclear,
  markBounced,
  type BrsEntry,
  type BrsFilterOption,
  type BrsSourceType,
} from "@/api/brsApi";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { preventEnterSubmit } from "@/hooks/useDraftForm";
import { getReturnReasonOptions } from "@/api/returnReasonApi";
import {
  CheckCircle2,
  Landmark,
  IndianRupee,
  Clock,
  Search,
  X,
  RotateCw,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Banknote,
  CalendarDays,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Info,
  ArrowRight,
  CornerDownRight,
} from "lucide-react";
import { DateInput } from "@/components/ui/date-input";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

function fmtDT(d: string | null | undefined): { date: string; time: string } {
  if (!d) return { date: "—", time: "" };
  try {
    const parsed = parseISO(d);
    return { date: format(parsed, "dd MMM yyyy"), time: format(parsed, "hh:mm a") };
  } catch { return { date: d, time: "" }; }
}

function isCleared(e: BrsEntry): boolean {
  return e.IsMatched === true || e.IsMatched === 1;
}

function isBounced(e: BrsEntry): boolean {
  return e.IsBounced === true || e.IsBounced === 1;
}

function isCancelled(e: BrsEntry): boolean {
  return e.IsChequeCancelled === true || e.IsChequeCancelled === 1;
}


// ─── Export column definitions ────────────────────────────────────────────────
// Built inside the component (see EXPORT_COLUMNS useMemo below) since the
// Bank column needs the fetched allBanks list to append each bank's last-4
// account digits — the same disambiguator already shown in the Bank filter
// dropdown, so two rows both named e.g. "HDFC Bank" read distinctly in
// exports too, not just on-screen.

// ─── Sub-components ───────────────────────────────────────────────────────────

// What kind of entry it is, as a glyph and a capital label. Direction is the useful part on a bank statement: money in
// (down into the account), money out (up and away), or moved between accounts.
const TYPE_PILL_META: Record<BrsSourceType, { label: string; icon: React.ElementType }> = {
  RECEIVED: { label: "Received", icon: ArrowDownLeft },
  CRM_RECEIVED: { label: "Received", icon: ArrowDownLeft },
  PAYMENT: { label: "Payment", icon: ArrowUpRight },
  FUND_TRANSFER_OUT: { label: "Transfer out", icon: ArrowLeftRight },
  FUND_TRANSFER_IN: { label: "Transfer in", icon: ArrowLeftRight },
  LOAN_DISBURSED: { label: "Loan given", icon: Banknote },
  LOAN_RECEIVED: { label: "Loan received", icon: Banknote },
};

function TypePill({ type }: { type: BrsSourceType }) {
  const meta = TYPE_PILL_META[type] ?? TYPE_PILL_META.PAYMENT;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap">
      <Icon size={10} strokeWidth={2.2} className="shrink-0 text-foreground" />
      {meta.label}
    </span>
  );
}

// Reconciliation state: solid once it is seen in the passbook, hatched while it is not, red when the bank returned it.
function ClearBadge({ cleared, bounced, cancelled }: { cleared: boolean; bounced: boolean; cancelled?: boolean }) {
  if (cancelled) return <SheetMark text="Cheque cancelled" tone="stopped" />;
  if (bounced) return <SheetMark text="Bounced" tone="stopped" />;
  if (cleared) return <SheetMark text="Clear" tone="done" />;
  return <SheetMark text="Unclear" tone="waiting" />;
}

function PayStatusBadge({ status }: { status: string | null }) {
  const text = status || "Draft";
  return <SheetMark text={text} tone={statusTone(text)} />;
}

// The tick against the passbook: an inked square once it is cleared.
// blockedReason: set when the backend says this row can't be cleared. Un-clear
// of an already cleared row stays possible, so mistakes can be fixed.
function PassbookCheck({ checked, loading, onChange, blockedReason }: { checked: boolean; loading: boolean; onChange: () => void; blockedReason?: string }) {
  const blocked = !!blockedReason && !checked;
  return (
    <button
      onClick={onChange}
      disabled={loading || blocked}
      aria-pressed={checked}
      title={blocked ? blockedReason : checked ? "Cleared — click to revert to Unclear" : "Mark as Clear"}
      className={`relative flex items-center justify-center w-5 h-5 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
        loading ? "opacity-40 cursor-wait" : blocked ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-foreground text-card" : "bg-transparent hover:bg-primary/10"}`}
      style={{ border: "1.5px solid hsl(var(--foreground))" }}
    >
      {loading ? (
        <RotateCw size={10} className="animate-spin" />
      ) : checked ? (
        <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-none stroke-current stroke-[2]">
          <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

// ─── Bounce Modal ─────────────────────────────────────────────────────────────

interface BounceModalProps {
  entry: BrsEntry;
  onClose: () => void;
  onConfirm: (bounceDate: string, bounceReason: string, bounceRemarks: string) => void;
  saving: boolean;
}

function BounceModal({ entry, onClose, onConfirm, saving }: BounceModalProps) {
  const [bounceDate, setBounceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [bounceReason, setBounceReason] = useState("");
  const [bounceRemarks, setBounceRemarks] = useState("");
  const { data: bounceReasons = [] } = useQuery({
    queryKey: ["return-reason-options"],
    queryFn: getReturnReasonOptions,
    staleTime: 5 * 60 * 1000,
  });

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-frame relative w-full max-w-md p-6 space-y-5" style={{ margin: 0 }} onKeyDown={preventEnterSubmit}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <div>
            <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-destructive">Returned by the bank</p>
            <h2 className="text-lg font-bold text-foreground font-heading tracking-tight mt-1">Mark as bounced</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {entry.DocNo ?? entry.TxnId ?? `${entry.SourceType} #${entry.SourceID}`}
              {entry.ChequeNo && <> · Cheque <span className="font-heading tabular-nums">{entry.ChequeNo}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Payment summary */}
        <div className="rounded-xl bg-destructive/10 border border-destructive/40 px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Payee / Party</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">{entry.PaymentName || "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-heading tabular-nums font-semibold text-foreground">{formatINR(entry.Amount)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Bank</span>
            <span className="font-medium text-foreground">{entry.BankName || "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Payment Date</span>
            <span className="text-foreground">{fmt(entry.PayDate)}</span>
          </div>
          {entry.ChequeNo && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Cheque No.</span>
              <span className="font-heading tabular-nums text-foreground">{entry.ChequeNo}</span>
            </div>
          )}
        </div>

        {/* Bounce date */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Bounce / Return Date <span className="text-destructive">*</span>
          </label>
          <DateInput
            value={bounceDate}
            onChange={(e) => setBounceDate(e.target.value)}
            className="w-full h-9 px-3 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-destructive/30 outline-none"
          />
        </div>

        {/* Bounce reason */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Reason for Return <span className="text-destructive">*</span>
          </label>
          <select
            value={bounceReason}
            onChange={(e) => setBounceReason(e.target.value)}
            className="w-full h-9 px-3 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-destructive/30 outline-none appearance-none"
          >
            <option value="">— Select reason —</option>
            {bounceReasons.map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>

        {/* Remarks */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Remarks <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <textarea
            value={bounceRemarks}
            onChange={(e) => setBounceRemarks(e.target.value)}
            placeholder="Additional notes e.g. bank memo number, follow-up action…"
            rows={2}
            className="w-full px-3 py-2 bg-input/70 border border-border rounded-lg text-sm resize-none focus:ring-1 focus:ring-destructive/30 outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-9 border border-foreground/40 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(bounceDate, bounceReason, bounceRemarks)}
            disabled={saving || !bounceDate || !bounceReason}
            className="flex-1 h-9 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <RotateCw size={13} className="animate-spin" /> : <Ban size={13} />}
            Confirm Bounce
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Clear Modal ──────────────────────────────────────────────────────────────
// Asks for the actual bank clearing date before marking an entry Clear —
// previously this was an instant one-click toggle with no way to record
// which date the bank itself cleared the transaction (as opposed to
// whenever the operator happened to click), same gap the Bounce flow
// already fixed for bounce dates.

interface ClearModalProps {
  entry: BrsEntry;
  onClose: () => void;
  onConfirm: (bankClearingDate: string) => void;
  saving: boolean;
}

function ClearModal({ entry, onClose, onConfirm, saving }: ClearModalProps) {
  const [bankClearingDate, setBankClearingDate] = useState(format(new Date(), "yyyy-MM-dd"));

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-frame relative w-full max-w-md p-6 space-y-5" style={{ margin: 0 }} onKeyDown={preventEnterSubmit}>
        <div className="flex items-start gap-3">
          <div>
            <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Seen in the passbook</p>
            <h2 className="text-lg font-bold text-foreground font-heading tracking-tight mt-1">Mark as clear</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {entry.DocNo ?? entry.TxnId ?? `${entry.SourceType} #${entry.SourceID}`}
              {entry.ChequeNo && <> · Cheque <span className="font-heading tabular-nums">{entry.ChequeNo}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl bg-primary/10 border border-foreground/40 px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Payee / Party</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">{entry.PaymentName || "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-heading tabular-nums font-semibold text-foreground">{formatINR(entry.Amount)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Bank</span>
            <span className="font-medium text-foreground">{entry.BankName || "—"}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Bank Clearing Date <span className="text-destructive">*</span>
          </label>
          <DateInput
            value={bankClearingDate}
            onChange={(e) => setBankClearingDate(e.target.value)}
            className="w-full h-9 px-3 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-foreground/20 outline-none"
          />
          <p className="text-[0.6875rem] text-muted-foreground">The date this transaction actually cleared in the bank passbook.</p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-9 border border-foreground/40 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(bankClearingDate)}
            disabled={saving || !bankClearingDate}
            className="flex-1 h-9 rounded-lg bg-foreground hover:bg-foreground/85 text-card text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <RotateCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Confirm Clear
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Bounce Detail Tooltip ────────────────────────────────────────────────────

function BounceDetailPanel({ entry }: { entry: BrsEntry }) {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const open = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const left = Math.min(r.left, window.innerWidth - 300);
      setStyle({ position: "fixed", top: r.bottom + 6, left, zIndex: 9999, width: 280 });
    }
    setShow(true);
  };

  useEffect(() => {
    if (!show) return;
    const close = () => setShow(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [show]);

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        onClick={open}
        className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-destructive hover:text-destructive transition-colors"
      >
        <Info size={11} />
        Details
      </button>
      {show && createPortal(
        <div style={style} className="bg-card border border-destructive/40 rounded-xl shadow-xl p-4 space-y-2 text-xs">
          <p className="font-semibold text-destructive flex items-center gap-1.5">
            <Ban size={12} /> Bounce Details
          </p>
          <div className="space-y-1.5">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Date</span>
              <span className="font-medium text-foreground">{fmt(entry.BounceDate)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Reason</span>
              <span className="font-medium text-foreground text-right">{entry.BounceReason || "—"}</span>
            </div>
            {entry.ChequeNo && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Cheque No.</span>
                <span className="font-heading tabular-nums text-foreground">{entry.ChequeNo}</span>
              </div>
            )}
            {entry.BounceRemarks && (
              <div className="pt-1 border-t border-border/60">
                <p className="text-muted-foreground mb-0.5">Remarks</p>
                <p className="text-foreground">{entry.BounceRemarks}</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export default function Brs() {
  const rights = usePageRights("brs");

  // ── Filter state ──────────────────────────────────────────────────────────
  const [allBanks, setAllBanks] = useState<BrsFilterOption[]>([]);
  const [bankId, setBankId] = useState<string | undefined>(undefined);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "clear" | "unclear" | "bounced">("");
  const [hideDummyBank, setHideDummyBank] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // ── Data state ────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<BrsEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [clearAmount, setClearAmount] = useState(0);
  const [unclearAmount, setUnclearAmount] = useState(0);
  const [bounceAmount, setBounceAmount] = useState(0);
  const [clearCount, setClearCount] = useState(0);
  const [unclearCount, setUnclearCount] = useState(0);
  const [bounceCount, setBounceCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ── Bounce modal state ────────────────────────────────────────────────────
  const [bounceEntry, setBounceEntry] = useState<BrsEntry | null>(null);
  const [bounceSaving, setBounceSaving] = useState(false);

  // ── Clear modal state ─────────────────────────────────────────────────────
  const [clearEntry, setClearEntry] = useState<BrsEntry | null>(null);
  const [clearSaving, setClearSaving] = useState(false);

  const navigate = useNavigate();

  // ── Filter options load ───────────────────────────────────────────────────
  useEffect(() => {
    getBRSFilters()
      .then((r) => setAllBanks(r.data?.banks ?? []))
      .catch((err) => console.error("BRS filters error", err));
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: PAGE_SIZE };
      if (bankId)        params.bankId = Number(bankId);
      if (fromDate)      params.fromDate = fromDate;
      if (toDate)        params.toDate = toDate;
      if (statusFilter)  params.status = statusFilter;
      if (hideDummyBank) params.hideDummyBank = "true";

      const r = await getBRS(params as Parameters<typeof getBRS>[0]);
      const d = r.data;
      setEntries(d.data ?? []);
      setTotal(d.total ?? 0);
      setTotalPages(d.totalPages ?? 1);
      setClearAmount(d.clearAmount ?? 0);
      setUnclearAmount(d.unclearAmount ?? 0);
      setBounceAmount(d.bounceAmount ?? 0);
      setClearCount(d.clearCount ?? 0);
      setUnclearCount(d.unclearCount ?? 0);
      setBounceCount(d.bounceCount ?? 0);
    } catch (err) {
      console.error("BRS fetch error", err);
      toast.error("Failed to load BRS data");
    } finally {
      setLoading(false);
    }
  }, [page, bankId, fromDate, toDate, statusFilter, hideDummyBank]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  useEffect(() => { setPage(1); }, [bankId, fromDate, toDate, statusFilter]);

  // ── Toggle clear / unclear ────────────────────────────────────────────────
  // Unclear -> Clear opens the Clear modal (needs a bank clearing date).
  // Clear -> Unclear is a direct call after a native confirm — reverting a
  // mistaken tick no longer needs a form, just a "are you sure" (the lock
  // that used to make this permanent was removed; see PUT .../unclear).
  const toggle = useCallback(async (entry: BrsEntry) => {
    if (isBounced(entry) || isCancelled(entry)) return; // can't toggle a bounced or cancelled-cheque entry
    // The backend refuses it anyway; say why instead of opening the date form.
    if (!isCleared(entry) && entry.Clearable === false) { toast.error(entry.ClearBlockReason || "Approve this document before clearing"); return; }
    if (isCleared(entry)) {
      if (!window.confirm("Revert this entry to Unclear? This clears the bank clearing date and cleared-by record.")) return;
      const key = `${entry.SourceType}-${entry.SourceID}`;
      setTogglingId(key);
      try {
        await markUnclear(entry.SourceType, entry.SourceID);
        toast.success("Reverted to Unclear");
        await fetchData();
      } catch (err) {
        console.error("BRS unclear error", err);
        toast.error("Failed to update status");
      } finally {
        setTogglingId(null);
      }
      return;
    }
    setClearEntry(entry);
  }, [fetchData]);

  const handleConfirmClear = useCallback(async (bankClearingDate: string) => {
    if (!clearEntry) return;
    setClearSaving(true);
    try {
      await markClear(clearEntry.SourceType, clearEntry.SourceID, bankClearingDate);
      toast.success("Marked as Clear ✓");
      setClearEntry(null);
      await fetchData();
    } catch (err) {
      console.error("BRS clear error", err);
      toast.error((err as any)?.response?.data?.error || "Failed to update status");
    } finally {
      setClearSaving(false);
    }
  }, [clearEntry, fetchData]);

  // ── Bounce actions ────────────────────────────────────────────────────────
  const handleConfirmBounce = useCallback(async (bounceDate: string, bounceReason: string, bounceRemarks: string) => {
    if (!bounceEntry) return;
    setBounceSaving(true);
    try {
      await markBounced(bounceEntry.SourceType, bounceEntry.SourceID, { bounceDate, bounceReason, bounceRemarks });
      toast.success("Payment marked as bounced");
      setBounceEntry(null);
      await fetchData();
    } catch (err) {
      console.error("BRS bounce error", err);
      toast.error((err as any)?.response?.data?.error || "Failed to record bounce");
    } finally {
      setBounceSaving(false);
    }
  }, [bounceEntry, fetchData]);

  // ── Re-issue navigation ───────────────────────────────────────────────────
  const handleReissue = useCallback((entry: BrsEntry) => {
    navigate("/payments", {
      state: {
        reissue: {
          replacesPaymentId: entry.SourceID,
          replacesDocNo:     entry.DocNo,
          amount:            entry.Amount,
          paymentName:       entry.PaymentName,
          companyName:       entry.CompanyName,
          expenseRef:        (entry as any).PExpenseRef ?? null,
          project:           (entry as any).PProject ?? null,
          company:           (entry as any).PCompany ?? null,
          bankId:            (entry as any).PBankID ?? null,
          bounceReason:      entry.BounceReason,
        },
      },
    });
  }, [navigate]);

  // ── Client-side search ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        (e.CompanyName ?? "").toLowerCase().includes(q) ||
        (e.BankName ?? "").toLowerCase().includes(q) ||
        (e.TxnId ?? "").toLowerCase().includes(q) ||
        (e.ChequeNo ?? "").toLowerCase().includes(q) ||
        (e.PaymentName ?? "").toLowerCase().includes(q) ||
        (e.DocNo ?? "").toLowerCase().includes(q) ||
        (e.Mode ?? "").toLowerCase().includes(q) ||
        (e.BounceReason ?? "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  const exportData = useMemo(() => filtered as unknown as Record<string, unknown>[], [filtered]);

  const EXPORT_COLUMNS: ExportColumn[] = useMemo(() => [
    { header: "Type",       accessor: (r) => TYPE_PILL_META[r.SourceType as BrsSourceType]?.label ?? String(r.SourceType) },
    { header: "Company",    accessor: "CompanyName" },
    { header: "Bank", accessor: (r) => {
      const bank = allBanks.find((b) => b.name === r.BankName);
      return bank?.accountNoLast4 ? `${r.BankName} •••${bank.accountNoLast4}` : String(r.BankName ?? "—");
    }},
    { header: "Date",       accessor: (r) => fmt(r.PayDate as string) },
    { header: "Amount",     accessor: (r) => `Rs. ${Number(r.Amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` },
    { header: "Mode",       accessor: "Mode" },
    { header: "Cheque No",  accessor: (r) => (r as unknown as BrsEntry).ChequeNo ?? "—" },
    { header: "Doc No.",    accessor: (r) => r.DocNo ?? "—" },
    { header: "Txn ID",     accessor: (r) => r.TxnId ?? "—" },
    { header: "Pay Status", accessor: "PayStatus" },
    { header: "BRS Status", accessor: (r) => {
      const e = r as unknown as BrsEntry;
      if (isCancelled(e)) return "Cheque Cancelled";
      if (e.IsBounced === 1 || e.IsBounced === true) return "Bounced";
      return e.IsMatched === 1 || e.IsMatched === true ? "Clear" : "Unclear";
    }},
    { header: "Bank Clearing Date", accessor: (r) => {
      const e = r as unknown as BrsEntry;
      if (!(e.IsMatched === 1 || e.IsMatched === true)) return "—";
      return e.BankClearingDate ? fmt(e.BankClearingDate) : "—";
    }},
    { header: "Cleared On", accessor: (r) => {
      const e = r as unknown as BrsEntry;
      if (!(e.IsMatched === 1 || e.IsMatched === true)) return "—";
      const { date, time } = fmtDT(e.ClearingDate);
      return time ? `${date}, ${time}` : date;
    }},
    { header: "Cleared By", accessor: (r) => {
      const e = r as unknown as BrsEntry;
      if (!(e.IsMatched === 1 || e.IsMatched === true)) return "—";
      return e.ClearedBy ?? "—";
    }},
    { header: "Bounce Date",   accessor: (r) => fmt((r as unknown as BrsEntry).BounceDate) },
    { header: "Bounce Reason", accessor: (r) => (r as unknown as BrsEntry).BounceReason ?? "—" },
    { header: "Bounce Remarks",accessor: (r) => (r as unknown as BrsEntry).BounceRemarks ?? "—" },
  ], [allBanks]);

  // ── Stats cards ───────────────────────────────────────────────────────────
  const stats = [
    {
      label: "Clear",
      value: String(clearCount),
      sub: formatINR(clearAmount),
      icon: CheckCircle2,
      ring: "ring-foreground/30",
      bg: "bg-primary/10",
      blob: "bg-foreground",
      borderL: "border-l-foreground/40",
      color: "text-foreground",
    },
    {
      label: "Unclear",
      value: String(unclearCount),
      sub: formatINR(unclearAmount),
      icon: Clock,
      ring: "ring-amber-500/20",
      bg: "bg-[#ffe2021a]",
      blob: "bg-amber-500",
      borderL: "border-l-amber-500",
      color: "text-amber-500",
    },
    {
      label: "Bounced",
      value: String(bounceCount),
      sub: formatINR(bounceAmount),
      icon: Ban,
      ring: "ring-destructive/30",
      bg: "bg-destructive/10",
      blob: "bg-destructive",
      borderL: "border-l-destructive/40",
      color: "text-destructive",
    },
    {
      label: "Total Entries",
      value: String(total),
      sub: formatINR(clearAmount + unclearAmount + bounceAmount),
      icon: IndianRupee,
      ring: "ring-primary/20",
      bg: "bg-primary/10",
      blob: "bg-primary",
      borderL: "border-l-primary",
      color: "text-primary",
    },
  ];

  const reconcileRate = total > 0 ? Math.round((clearCount / total) * 100) : 0;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "BRS"]} />
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Bank reconciliation"
        subtitle="Check each entry against the bank passbook: tick the ones that appear in it, and mark a returned cheque as bounced."
        action={
          <div className="flex items-center gap-2 shrink-0">
            <ExportMenu
              data={exportData}
              columns={EXPORT_COLUMNS}
              title="Bank Reconciliation Statement"
              filename="brs-export"
              subtitle={
                [
                  fromDate && `From: ${fmt(fromDate)}`,
                  toDate && `To: ${fmt(toDate)}`,
                  statusFilter && `Status: ${statusFilter}`,
                ].filter(Boolean).join(" · ") || undefined
              }
              disabled={loading || entries.length === 0 || !rights.canExport}
            />
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >

        {/* ── Stats ──────────────────────────────────────────────────────────── */}
        <div className={stats.length === 4 ? "statrow four" : "statrow"}>
          {stats.map(({ label, value, sub }) => {
            const hot = label === "Bounced" && bounceCount > 0;
            return (
              <div key={label}>
                <p className="label" style={hot ? { color: "var(--red)" } : undefined}>{label}</p>
                <p className="figure" style={{ fontSize: "clamp(22px, 2.4vw, 32px)", marginTop: 9, color: hot ? "var(--red)" : undefined }}>{value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</p>
              </div>
            );
          })}
        </div>

        {/* ── Bounced cheques: the one red note on the page ────────────────────── */}
        {bounceCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3" style={{ border: "1px solid var(--red)", background: "var(--red-wash)" }}>
            <AlertTriangle size={15} className="shrink-0" style={{ color: "var(--red)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--red)" }}>
              {bounceCount} payment{bounceCount !== 1 ? "s" : ""} returned by the bank, totalling{" "}
              <span className="font-heading tabular-nums font-bold">{formatINR(bounceAmount)}</span>. Use the <strong>Bounced</strong> filter to review them.
            </p>
          </div>
        )}

        {/* ── How far the reconciliation has got: cleared is solid, the rest is still to be found in the passbook ── */}
        {total > 0 && (
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="label" style={{ color: "var(--ink)" }}>Reconciled</span>
              <span className="figure" style={{ fontSize: 22 }}>{reconcileRate}<span style={{ fontSize: "0.55em", fontWeight: 500, marginLeft: 2 }}>%</span></span>
            </div>
            <div className="flex" style={{ height: 22, border: "1.5px solid var(--ink)", background: "var(--sheet)" }} role="img" aria-label={`${reconcileRate} percent reconciled`}>
              <div className="bar-grow" style={{ width: `${reconcileRate}%`, background: "var(--blue)" }} />
              <div className="hatch" style={{ flex: 1 }} />
            </div>
            <div className="flex">
              <div style={{ width: `${Math.min(Math.max(reconcileRate, 22), 78)}%`, minWidth: 0 }}>
                <Dimension from={0} to={100} text={`${clearCount} clear`} color="var(--blue)" />
              </div>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                {total - clearCount > 0 && <Dimension from={0} to={100} text={`${total - clearCount} to go`} />}
              </div>
            </div>
          </div>
        )}

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="px-4 py-4 space-y-3 bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
          {/* Row 1: search + bank */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
            <div className="relative flex-1 sm:min-w-[180px] sm:max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, bank, cheque, txn ID…"
                className="w-full h-8 pl-8 pr-7 bg-card border border-foreground/40 text-xs focus:border-foreground outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-auto">
              <Landmark size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <select
                value={bankId ?? ""}
                onChange={(e) => setBankId(e.target.value || undefined)}
                className={`h-8 w-full sm:w-auto pl-7 pr-8 bg-card border text-xs appearance-none focus:border-foreground outline-none cursor-pointer ${bankId ? "border-foreground text-foreground font-semibold" : "border-foreground/40"}`}
              >
                <option value="">All Banks</option>
                {allBanks.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}{b.accountNoLast4 ? ` •••${b.accountNoLast4}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: date range + status pills */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
            <div className="relative">
              <CalendarDays size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <DateInput
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 w-full sm:w-auto pl-7 pr-3 bg-card border border-foreground/40 text-xs focus:border-foreground outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>

            <span className="text-muted-foreground text-xs hidden sm:inline">to</span>

            <div className="relative">
              <CalendarDays size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <DateInput
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 w-full sm:w-auto pl-7 pr-3 bg-card border border-foreground/40 text-xs focus:border-foreground outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>

            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(""); setToDate(""); }}
                className="h-8 px-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-dashed border-border"
                title="Clear date range"
              >
                <X size={12} />
              </button>
            )}

            {/* Dummy Bank: shown or hidden */}
            <button
              onClick={() => setHideDummyBank((v) => !v)}
              aria-pressed={!hideDummyBank}
              className={`px-3 h-8 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors border ${
                !hideDummyBank ? "bg-foreground text-card border-foreground" : "bg-card text-muted-foreground border-foreground/40 hover:text-foreground"
              }`}
            >
              Dummy bank
            </button>

            {/* Status: one ruled bar, the choice in force inked in */}
            <div className="seg sm:ml-auto" style={{ flexWrap: "wrap" }}>
              {(["", "clear", "unclear", "bounced"] as const).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} className={statusFilter === s ? "on" : undefined}>
                  {s === "" ? "All" : s === "clear" ? "Clear" : s === "unclear" ? "Unclear" : "Bounced"}
                  {s === "bounced" && bounceCount > 0 && <span style={{ marginLeft: 6, color: statusFilter === s ? undefined : "var(--red)" }}>{bounceCount}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────────────────── */}
        <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
          <div className="flex items-baseline justify-between gap-3 px-3 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <h2 className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-foreground">Statement</h2>
            <p className="text-xs text-muted-foreground ml-auto">
              <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
              entr{filtered.length === 1 ? "y" : "ies"}
              {total !== filtered.length && ` (${total} server-side)`}
            </p>
            {loading && <RotateCw size={13} className="animate-spin text-muted-foreground" />}
          </div>

          <div>
            {/* ── Mobile card list (< md) ───────────────────────────────────── */}
            <div className="md:hidden divide-y divide-border">
              {!loading && filtered.length === 0 && (
                <p className="px-5 py-14 text-center text-muted-foreground text-sm">No entries match your filters.</p>
              )}
              {loading && filtered.length === 0 && (
                <div className="px-5 py-14 text-center text-muted-foreground text-sm">
                  <RotateCw size={18} className="animate-spin mx-auto mb-2 opacity-40" />
                  Loading…
                </div>
              )}
              {filtered.map((entry) => {
                const key = `${entry.SourceType}-${entry.SourceID}`;
                const cleared = isCleared(entry);
                const bounced = isBounced(entry);
                const cancelled = isCancelled(entry);
                const toggling = togglingId === key;
                return (
                  <div
                    key={key}
                    className={`px-4 py-3.5 transition-colors ${
                      cancelled || bounced
                        ? "bg-destructive/10 border-l-2 border-l-destructive/40"
                        : cleared
                          ? "bg-primary/10"
                          : ""
                    }`}
                  >
                    {/* Row 1: checkbox + type + company + amount */}
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5 shrink-0">
                        <PassbookCheck
                          checked={cleared && !bounced && !cancelled}
                          loading={toggling}
                          onChange={() => !bounced && !cancelled && toggle(entry)}
                          blockedReason={entry.Clearable === false ? entry.ClearBlockReason : undefined}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <TypePill type={entry.SourceType} />
                          <span className="text-[0.625rem] text-muted-foreground tabular-nums">{fmt(entry.PayDate)}</span>
                        </div>
                        <p className="text-xs font-semibold text-foreground leading-snug truncate">
                          {entry.CompanyName || "—"}
                        </p>
                        {entry.PaymentName && entry.PaymentName !== entry.CompanyName && (
                          <p className="text-[0.625rem] text-muted-foreground truncate mt-0.5">{entry.PaymentName}</p>
                        )}
                        {entry.DocNo && (
                          <span className="inline-block font-heading tabular-nums text-[0.625rem] px-1.5 py-0.5 mt-1 rounded bg-primary/10 text-primary border border-primary/20">
                            {entry.DocNo}
                          </span>
                        )}
                        {entry.BankName && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <Landmark size={9} className="text-foreground shrink-0" />
                            <span className="text-[0.625rem] text-muted-foreground truncate">{entry.BankName}</span>
                          </div>
                        )}
                        {entry.Mode && (
                          <p className="text-[0.625rem] text-muted-foreground mt-0.5 capitalize">
                            {entry.Mode}
                            {entry.ChequeNo && <span className="font-heading tabular-nums ml-1 text-muted-foreground/60">#{entry.ChequeNo}</span>}
                          </p>
                        )}
                      </div>
                      {/* Amount + BRS on the right */}
                      <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
                        <span className={`text-sm font-heading tabular-nums font-bold ${bounced || cancelled ? "text-destructive line-through decoration-red-500/60" : "text-foreground"}`}>
                          {formatINR(entry.Amount)}
                        </span>
                        <ClearBadge cleared={cleared} bounced={bounced} cancelled={cancelled} />
                        {bounced && <BounceDetailPanel entry={entry} />}
                        {cleared && (entry.BankClearingDate || entry.ClearedBy || entry.ClearingDate) && (
                          <div className="text-right">
                            {/* Bank Clearance (passbook date) vs Cleared On
                                (when it was ticked in the app) — genuinely
                                separate dates, never merged. */}
                            {entry.BankClearingDate && (
                              <p className="text-[0.625rem] text-foreground font-medium">
                                {fmt(entry.BankClearingDate)} <span className="text-muted-foreground/70 font-normal">(bank)</span>
                              </p>
                            )}
                            {entry.ClearingDate && (
                              <p className="text-[0.625rem] text-muted-foreground/70 tabular-nums">
                                {fmtDT(entry.ClearingDate).date}{fmtDT(entry.ClearingDate).time ? `, ${fmtDT(entry.ClearingDate).time}` : ""}
                              </p>
                            )}
                            {entry.ClearedBy && (
                              <p className="text-[0.625rem] text-muted-foreground truncate max-w-[110px]">{entry.ClearedBy}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: action button */}
                    <div className="mt-2.5 pl-8">
                      {bounced ? (
                        entry.ReplacementDocNo ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-primary/10 border border-foreground/40 text-[0.625rem] font-semibold text-foreground">
                            <ArrowRight size={10} className="shrink-0" />
                            <span className="font-heading tabular-nums">{entry.ReplacementDocNo}</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleReissue(entry)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[0.6875rem] font-medium rounded-lg border border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-400 hover:bg-[#ffe2021a] transition-colors"
                          >
                            <CornerDownRight size={11} />
                            Re-issue
                          </button>
                        )
                      ) : entry.OriginalDocNo ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#ffe2021a] border border-amber-500/25 text-[0.625rem] font-semibold text-amber-700 dark:text-amber-400">
                          <CornerDownRight size={10} className="shrink-0" />
                          <span className="font-heading tabular-nums">{entry.OriginalDocNo}</span>
                        </span>
                      ) : entry.ChequeNo && !cleared && entry.Clearable !== false ? (
                        <button
                          onClick={() => setBounceEntry(entry)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[0.6875rem] font-medium rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Ban size={10} />
                          Mark Bounced
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Desktop table (md+) ───────────────────────────────────────── */}
            {/* Scrolls horizontally instead of being clipped by the card's
                own overflow-hidden (rounded corners) — at md-only widths the
                visible columns alone can still exceed the pane, which
                previously hard-cut the rightmost Action column/button. */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-3 text-center w-10">
                    <span>✓</span>
                  </th>
                  <th className="px-3 py-3 text-left w-[72px]">Type</th>
                  <th className="px-3 py-3 text-left w-[130px]">Company / Party</th>
                  <th className="px-3 py-3 text-left hidden lg:table-cell w-[110px]">Bank</th>
                  <th className="px-3 py-3 text-left hidden lg:table-cell w-[90px]">Date</th>
                  <th className="px-3 py-3 text-right w-[90px]">Amount</th>
                  <th className="px-3 py-3 text-left hidden lg:table-cell w-[110px]">Mode / Cheque</th>
                  <th className="px-3 py-3 text-left w-[82px]">Status</th>
                  <th className="px-3 py-3 text-left w-[90px]">BRS</th>
                  <th className="px-3 py-3 text-left w-[90px] hidden xl:table-cell">Bank Clearance</th>
                  <th className="px-3 py-3 text-left w-[130px] hidden xl:table-cell">Cleared On</th>
                  <th className="px-3 py-3 text-left w-[110px] hidden xl:table-cell">Cleared By</th>
                  <th className="px-3 py-3 text-left w-[140px]">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-5 py-14 text-center text-muted-foreground text-sm">
                      No entries match your filters.
                    </td>
                  </tr>
                )}

                {loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-5 py-14 text-center text-muted-foreground text-sm">
                      <RotateCw size={18} className="animate-spin mx-auto mb-2 opacity-40" />
                      Loading…
                    </td>
                  </tr>
                )}

                {filtered.map((entry) => {
                  const key = `${entry.SourceType}-${entry.SourceID}`;
                  const cleared = isCleared(entry);
                  const bounced = isBounced(entry);
                  const cancelled = isCancelled(entry);
                  const toggling = togglingId === key;

                  return (
                    <tr
                      key={key}
                      style={cancelled || bounced ? { boxShadow: "inset 3px 0 0 hsl(var(--destructive))" } : undefined}
                    >
                      <td className="px-3 py-4 text-center align-middle">
                        <PassbookCheck
                          checked={cleared && !bounced && !cancelled}
                          loading={toggling}
                          onChange={() => !bounced && !cancelled && toggle(entry)}
                          blockedReason={entry.Clearable === false ? entry.ClearBlockReason : undefined}
                        />
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <TypePill type={entry.SourceType} />
                      </td>
                      <td className="px-3 py-4 align-middle overflow-hidden">
                        <p className="text-xs font-medium text-foreground leading-snug truncate">
                          {entry.CompanyName || "—"}
                        </p>
                        {entry.PaymentName && entry.PaymentName !== entry.CompanyName && (
                          <p className="text-[0.625rem] text-muted-foreground truncate mt-0.5">
                            {entry.PaymentName}
                          </p>
                        )}
                        {entry.DocNo && (
                          <p className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground mt-1 truncate">{entry.DocNo}</p>
                        )}
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell align-middle">
                        <span className="block text-xs text-foreground truncate max-w-[110px]">{entry.BankName || "—"}</span>
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell align-middle">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmt(entry.PayDate)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right align-middle">
                        <span className={`font-heading text-[0.8125rem] tabular-nums font-semibold ${bounced || cancelled ? "text-destructive line-through" : "text-foreground"}`}>
                          {formatINR(entry.Amount)}
                        </span>
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell align-middle">
                        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{entry.Mode || "—"}</span>
                        {entry.ChequeNo && <p className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground mt-1 truncate">Chq #{entry.ChequeNo}</p>}
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <PayStatusBadge status={entry.PayStatus} />
                        {entry.Clearable === false && !cleared && (
                          <span className="mt-1 block text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground" title={entry.ClearBlockReason}>
                            Awaiting approval
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ClearBadge cleared={cleared} bounced={bounced} cancelled={cancelled} />
                          {bounced && <BounceDetailPanel entry={entry} />}
                        </div>
                      </td>
                      {/* Bank Clearance — the date the bank itself cleared it
                          (passbook date), as typed in the clear popup. Distinct
                          from Cleared On below, which is when this was ticked
                          in the app — the two can genuinely differ by days. */}
                      <td className="px-3 py-4 hidden xl:table-cell align-middle">
                        {cleared && entry.BankClearingDate ? (
                          <p className="text-xs text-foreground font-medium tabular-nums">
                            {fmt(entry.BankClearingDate)}
                          </p>
                        ) : (
                          <span className="text-[0.625rem] text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Cleared On — when the entry was actually ticked clear
                          in the app (system timestamp), date + time. */}
                      <td className="px-3 py-4 hidden xl:table-cell align-middle">
                        {cleared && entry.ClearingDate ? (
                          <>
                            <p className="text-xs text-foreground">{fmtDT(entry.ClearingDate).date}</p>
                            {fmtDT(entry.ClearingDate).time && (
                              <p className="text-[0.625rem] text-muted-foreground/70 tabular-nums">{fmtDT(entry.ClearingDate).time}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-[0.625rem] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4 hidden xl:table-cell align-middle">
                        {cleared && entry.ClearedBy ? (
                          <p className="text-xs text-foreground truncate max-w-[110px]" title={entry.ClearedBy}>{entry.ClearedBy}</p>
                        ) : (
                          <span className="text-[0.625rem] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4 align-middle">
                        {bounced ? (
                          entry.ReplacementDocNo ? (
                            <span className="inline-flex items-center gap-1.5 font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground overflow-hidden max-w-full" title="Replaced by this payment">
                              <ArrowRight size={11} className="shrink-0" />
                              <span className="truncate">{entry.ReplacementDocNo}</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleReissue(entry)}
                              title="Create a replacement payment for this bounced cheque"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] border border-foreground text-foreground hover:bg-primary/10 transition-colors whitespace-nowrap"
                            >
                              <CornerDownRight size={11} />
                              Re-issue
                            </button>
                          )
                        ) : entry.OriginalDocNo ? (
                          <span className="inline-flex items-center gap-1.5 font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground overflow-hidden max-w-full" title="Re-issued in place of this payment">
                            <CornerDownRight size={11} className="shrink-0" />
                            <span className="truncate">{entry.OriginalDocNo}</span>
                          </span>
                        ) : entry.ChequeNo && !cleared && entry.Clearable !== false ? (
                          <button
                            onClick={() => setBounceEntry(entry)}
                            title="Mark this cheque as bounced / dishonoured"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors whitespace-nowrap"
                          >
                            <Ban size={10} />
                            Mark Bounced
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* ── Pagination ─────────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-3" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
              <p className="label">
                Page {page} of {totalPages} · {total} in all
              </p>
              <div className="seg">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading} className="disabled:opacity-40" aria-label="Previous page">
                  <ChevronLeft size={13} />
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading} className="disabled:opacity-40" aria-label="Next page">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Key ─────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.6875rem] text-muted-foreground">
          <span className="inline-flex items-center gap-2"><SheetMark text="Clear" tone="done" /> seen in the bank passbook</span>
          <span className="inline-flex items-center gap-2"><SheetMark text="Unclear" tone="waiting" /> not yet seen</span>
          <span className="inline-flex items-center gap-2"><SheetMark text="Bounced" tone="stopped" /> returned by the bank</span>
          <span className="ml-auto">Only payments with a linked bank account are listed.</span>
        </div>
      </SheetShell>

      {/* ── Bounce Modal (portal) ──────────────────────────────────────────── */}
      {bounceEntry && (
        <BounceModal
          entry={bounceEntry}
          onClose={() => setBounceEntry(null)}
          onConfirm={handleConfirmBounce}
          saving={bounceSaving}
        />
      )}

      {/* ── Clear Modal (portal) ───────────────────────────────────────────── */}
      {clearEntry && (
        <ClearModal
          entry={clearEntry}
          onClose={() => setClearEntry(null)}
          onConfirm={handleConfirmClear}
          saving={clearSaving}
        />
      )}
    </>
  );
}
