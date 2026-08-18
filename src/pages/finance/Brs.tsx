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
import { FinanceShell } from "@/components/finance/FinanceShell";
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
  CalendarDays,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Info,
  ArrowRight,
  CornerDownRight,
} from "lucide-react";

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

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Type",       accessor: (r) => (r.SourceType === "RECEIVED" ? "Received" : "Payment") },
  { header: "Company",    accessor: "CompanyName" },
  { header: "Bank",       accessor: "BankName" },
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
  { header: "Clearing Date", accessor: (r) => fmt((r as unknown as BrsEntry).ClearingDate) },
  { header: "Bounce Date",   accessor: (r) => fmt((r as unknown as BrsEntry).BounceDate) },
  { header: "Bounce Reason", accessor: (r) => (r as unknown as BrsEntry).BounceReason ?? "—" },
  { header: "Bounce Remarks",accessor: (r) => (r as unknown as BrsEntry).BounceRemarks ?? "—" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypePill({ type }: { type: "PAYMENT" | "RECEIVED" }) {
  if (type === "RECEIVED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
        <ArrowDownLeft size={9} strokeWidth={2.5} />
        Received
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
      <ArrowUpRight size={9} strokeWidth={2.5} />
      Payment
    </span>
  );
}

function ClearBadge({ cleared, bounced, cancelled }: { cleared: boolean; bounced: boolean; cancelled?: boolean }) {
  if (cancelled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
        <Ban size={10} className="shrink-0" />
        Cheque Cancelled
      </span>
    );
  }
  if (bounced) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
        <Ban size={10} className="shrink-0" />
        Bounced
      </span>
    );
  }
  if (cleared) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
        Clear
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
      Unclear
    </span>
  );
}

function PayStatusBadge({ status }: { status: string | null }) {
  if (!status || status === "Draft")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground border border-border">Draft</span>;
  if (status === "Approved")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"><ShieldCheck size={9} strokeWidth={2.5} />Approved</span>;
  if (status === "Pending")
    return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />Pending</span>;
  if (status === "Rejected")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"><span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />Rejected</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground border border-border">{status}</span>;
}

function PassbookCheck({ checked, loading, onChange }: { checked: boolean; loading: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      disabled={loading}
      title={checked ? "Mark as Unclear" : "Mark as Clear"}
      className={`
        relative flex items-center justify-center w-5 h-5 rounded border-2 transition-all duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
        ${loading ? "opacity-40 cursor-wait" : "cursor-pointer"}
        ${checked
          ? "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
          : "bg-transparent border-border hover:border-emerald-400 hover:bg-emerald-500/5"
        }
      `}
    >
      {loading ? (
        <RotateCw size={10} className="animate-spin text-white" />
      ) : checked ? (
        <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-none stroke-white stroke-[2]">
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
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onKeyDown={preventEnterSubmit}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
            <Ban size={18} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground font-heading">Mark as Bounced</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {entry.DocNo ?? entry.TxnId ?? `${entry.SourceType} #${entry.SourceID}`}
              {entry.ChequeNo && <> · Cheque <span className="font-mono">{entry.ChequeNo}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Payment summary */}
        <div className="rounded-xl bg-red-500/[0.06] border border-red-500/20 px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Payee / Party</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">{entry.PaymentName || "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-mono font-semibold text-foreground">{formatINR(entry.Amount)}</span>
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
              <span className="font-mono text-foreground">{entry.ChequeNo}</span>
            </div>
          )}
        </div>

        {/* Bounce date */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Bounce / Return Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={bounceDate}
            onChange={(e) => setBounceDate(e.target.value)}
            className="w-full h-9 px-3 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-red-400 outline-none"
          />
        </div>

        {/* Bounce reason */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Reason for Return <span className="text-red-500">*</span>
          </label>
          <select
            value={bounceReason}
            onChange={(e) => setBounceReason(e.target.value)}
            className="w-full h-9 px-3 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-red-400 outline-none appearance-none"
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
            className="w-full px-3 py-2 bg-input/70 border border-border rounded-lg text-sm resize-none focus:ring-1 focus:ring-red-400 outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(bounceDate, bounceReason, bounceRemarks)}
            disabled={saving || !bounceDate || !bounceReason}
            className="flex-1 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
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
        className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400 hover:text-red-700 transition-colors"
      >
        <Info size={11} />
        Details
      </button>
      {show && createPortal(
        <div style={style} className="bg-card border border-red-200 dark:border-red-800 rounded-xl shadow-xl p-4 space-y-2 text-xs">
          <p className="font-semibold text-red-600 dark:text-red-400 flex items-center gap-1.5">
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
                <span className="font-mono text-foreground">{entry.ChequeNo}</span>
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
  const toggle = useCallback(async (entry: BrsEntry) => {
    if (isBounced(entry) || isCancelled(entry)) return; // can't toggle a bounced or cancelled-cheque entry
    const key = `${entry.SourceType}-${entry.SourceID}`;
    setTogglingId(key);
    try {
      if (isCleared(entry)) {
        await markUnclear(entry.SourceType, entry.SourceID);
        toast.success("Marked as Unclear");
      } else {
        await markClear(entry.SourceType, entry.SourceID);
        toast.success("Marked as Clear ✓");
      }
      await fetchData();
    } catch (err) {
      console.error("BRS toggle error", err);
      toast.error("Failed to update status");
    } finally {
      setTogglingId(null);
    }
  }, [fetchData]);

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
      toast.error("Failed to record bounce");
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

  // ── Stats cards ───────────────────────────────────────────────────────────
  const stats = [
    {
      label: "Clear",
      value: String(clearCount),
      sub: formatINR(clearAmount),
      icon: CheckCircle2,
      ring: "ring-emerald-500/20",
      bg: "bg-emerald-500/10",
      blob: "bg-emerald-500",
      borderL: "border-l-emerald-500",
      color: "text-emerald-500",
    },
    {
      label: "Unclear",
      value: String(unclearCount),
      sub: formatINR(unclearAmount),
      icon: Clock,
      ring: "ring-amber-500/20",
      bg: "bg-amber-500/10",
      blob: "bg-amber-500",
      borderL: "border-l-amber-500",
      color: "text-amber-500",
    },
    {
      label: "Bounced",
      value: String(bounceCount),
      sub: formatINR(bounceAmount),
      icon: Ban,
      ring: "ring-red-500/20",
      bg: "bg-red-500/10",
      blob: "bg-red-500",
      borderL: "border-l-red-500",
      color: "text-red-500",
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
      <FinanceShell
        title="Bank Reconciliation Statement"
        subtitle="Verify payments against your bank passbook — tick to confirm, mark bounced for dishonoured cheques"
        icon={ShieldCheck}
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
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
              style={{ color: "#818cf8" }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >

        {/* ── Stats ──────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map(({ label, value, sub, icon: Icon, ring, bg, blob, borderL, color }) => (
            <div
              key={label}
              className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL} ${label === "Bounced" && bounceCount > 0 ? "ring-red-500/30" : ""}`}
            >
              <div className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${blob}`} />
              <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold font-heading text-foreground leading-none">{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">{label}</p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">{sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Bounce alert banner ─────────────────────────────────────────────── */}
        {bounceCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/25">
            <AlertTriangle size={15} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400 font-medium">
              {bounceCount} payment{bounceCount !== 1 ? "s" : ""} flagged as bounced/dishonoured totalling{" "}
              <span className="font-mono font-bold">{formatINR(bounceAmount)}</span>.
              {" "}Use the <strong>Bounced</strong> filter to review and take action.
            </p>
          </div>
        )}

        {/* ── Progress bar ───────────────────────────────────────────────────── */}
        {total > 0 && (
          <div className="glass rounded-xl px-5 py-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Reconciliation progress</span>
              <span className="text-xs font-bold text-foreground tabular-nums">
                {reconcileRate}% · {clearCount}/{total}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${reconcileRate}%`,
                  background: reconcileRate === 100
                    ? "linear-gradient(90deg,#10b981,#34d399)"
                    : "linear-gradient(90deg,#f59e0b,#10b981)",
                }}
              />
            </div>
          </div>
        )}

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="glass rounded-xl px-5 py-4 space-y-3">
          {/* Row 1: search + bank */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
            <div className="relative flex-1 sm:min-w-[180px] sm:max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, bank, cheque, txn ID…"
                className="w-full h-8 pl-8 pr-7 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none"
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
                className={`h-8 w-full sm:w-auto pl-7 pr-8 bg-input/70 border rounded-lg text-xs appearance-none focus:ring-1 focus:ring-primary outline-none cursor-pointer ${bankId ? "border-primary/60 text-primary font-medium" : "border-border"}`}
              >
                <option value="">All Banks</option>
                {allBanks.map((b) => (
                  <option key={b.id} value={String(b.id)}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: date range + status pills */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
            <div className="relative">
              <CalendarDays size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 w-full sm:w-auto pl-7 pr-3 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>

            <span className="text-muted-foreground text-xs hidden sm:inline">to</span>

            <div className="relative">
              <CalendarDays size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 w-full sm:w-auto pl-7 pr-3 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
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

            {/* Dummy Bank filter pill */}
            <button
              onClick={() => setHideDummyBank((v) => !v)}
              className={`px-3 h-8 rounded-lg text-xs font-medium transition-all border ${
                !hideDummyBank
                  ? "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30 font-semibold"
                  : "bg-transparent text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              Dummy Bank
            </button>

            {/* Status filter pills */}
            <div className="flex flex-wrap gap-1.5 sm:ml-auto">
              {(["", "clear", "unclear", "bounced"] as const).map((s) => {
                const label = s === "" ? "All" : s === "clear" ? "✓ Clear" : s === "unclear" ? "○ Unclear" : "⚠ Bounced";
                const active = statusFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 h-8 rounded-lg text-xs font-medium transition-all border ${
                      active
                        ? s === "clear"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold"
                          : s === "unclear"
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold"
                            : s === "bounced"
                              ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 font-semibold"
                              : "bg-primary/10 text-primary border-primary/30 font-semibold"
                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {label}
                    {s === "bounced" && bounceCount > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">{bounceCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20 rounded-t-xl">
            <p className="text-xs text-muted-foreground">
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
                        ? "bg-red-500/[0.05] border-l-2 border-l-red-500/50"
                        : cleared
                          ? "bg-emerald-500/[0.03]"
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
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <TypePill type={entry.SourceType} />
                          <span className="text-[10px] text-muted-foreground tabular-nums">{fmt(entry.PayDate)}</span>
                        </div>
                        <p className="text-xs font-semibold text-foreground leading-snug truncate">
                          {entry.CompanyName || "—"}
                        </p>
                        {entry.PaymentName && entry.PaymentName !== entry.CompanyName && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{entry.PaymentName}</p>
                        )}
                        {entry.DocNo && (
                          <span className="inline-block font-mono text-[10px] px-1.5 py-0.5 mt-1 rounded bg-primary/10 text-primary border border-primary/20">
                            {entry.DocNo}
                          </span>
                        )}
                        {entry.BankName && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <Landmark size={9} className="text-blue-400 shrink-0" />
                            <span className="text-[10px] text-muted-foreground truncate">{entry.BankName}</span>
                          </div>
                        )}
                        {entry.Mode && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">
                            {entry.Mode}
                            {entry.ChequeNo && <span className="font-mono ml-1 text-muted-foreground/60">#{entry.ChequeNo}</span>}
                          </p>
                        )}
                      </div>
                      {/* Amount + BRS on the right */}
                      <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
                        <span className={`text-sm font-mono font-bold ${bounced || cancelled ? "text-red-600 dark:text-red-400 line-through decoration-red-500/60" : "text-foreground"}`}>
                          {formatINR(entry.Amount)}
                        </span>
                        <ClearBadge cleared={cleared} bounced={bounced} cancelled={cancelled} />
                        {bounced && <BounceDetailPanel entry={entry} />}
                        {cleared && entry.ClearingDate && (() => {
                          const { date, time } = fmtDT(entry.ClearingDate);
                          return (
                            <div className="text-right">
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{date}</p>
                              {time && <p className="text-[10px] text-muted-foreground">{time}</p>}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Row 2: action button */}
                    <div className="mt-2.5 pl-8">
                      {bounced ? (
                        entry.ReplacementDocNo ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <ArrowRight size={10} className="shrink-0" />
                            <span className="font-mono">{entry.ReplacementDocNo}</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleReissue(entry)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                          >
                            <CornerDownRight size={11} />
                            Re-issue
                          </button>
                        )
                      ) : entry.OriginalDocNo ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          <CornerDownRight size={10} className="shrink-0" />
                          <span className="font-mono">{entry.OriginalDocNo}</span>
                        </span>
                      ) : entry.ChequeNo && !cleared ? (
                        <button
                          onClick={() => setBounceEntry(entry)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-red-300 dark:border-red-700/60 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
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
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-border bg-muted/10">
                  <th className="px-3 py-3 text-center w-10">
                    <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground">✓</span>
                  </th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[72px]">Type</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[180px]">Company / Party</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden lg:table-cell">Bank</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden lg:table-cell w-[90px]">Date</th>
                  <th className="px-3 py-3 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[90px]">Amount</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden lg:table-cell w-[110px]">Mode / Cheque</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[82px]">Status</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[90px]">BRS</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[110px] hidden xl:table-cell">Cleared On</th>
                  <th className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground w-[140px]">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-5 py-14 text-center text-muted-foreground text-sm">
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
                      className={`transition-colors ${
                        cancelled || bounced
                          ? "bg-red-500/[0.05] hover:bg-red-500/[0.09] border-l-2 border-l-red-500/50"
                          : cleared
                            ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07]"
                            : "hover:bg-muted/30"
                      }`}
                    >
                      <td className="px-3 py-4 text-center align-middle">
                        <PassbookCheck
                          checked={cleared && !bounced && !cancelled}
                          loading={toggling}
                          onChange={() => !bounced && !cancelled && toggle(entry)}
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
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {entry.PaymentName}
                          </p>
                        )}
                        {entry.DocNo && (
                          <span className="inline-block font-mono text-[10px] px-1.5 py-0.5 mt-1 rounded bg-primary/10 text-primary border border-primary/20 truncate max-w-full">
                            {entry.DocNo}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell align-middle">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                            <Landmark size={10} className="text-blue-500" />
                          </div>
                          <span className="text-xs text-foreground truncate max-w-[120px]">
                            {entry.BankName || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell align-middle">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmt(entry.PayDate)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right align-middle">
                        <span className={`text-xs font-mono font-semibold ${bounced || cancelled ? "text-red-600 dark:text-red-400 line-through decoration-red-500/60" : "text-foreground"}`}>
                          {formatINR(entry.Amount)}
                        </span>
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell align-middle">
                        <span className="text-xs text-foreground capitalize">{entry.Mode || "—"}</span>
                        {entry.ChequeNo && (
                          <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5 truncate">
                            #{entry.ChequeNo}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <PayStatusBadge status={entry.PayStatus} />
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ClearBadge cleared={cleared} bounced={bounced} cancelled={cancelled} />
                          {bounced && <BounceDetailPanel entry={entry} />}
                        </div>
                      </td>
                      <td className="px-3 py-4 hidden xl:table-cell align-middle">
                        {cleared && entry.ClearingDate ? (() => {
                          const { date, time } = fmtDT(entry.ClearingDate);
                          return (
                            <div>
                              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{date}</p>
                              {time && <p className="text-[10px] text-muted-foreground">{time}</p>}
                            </div>
                          );
                        })() : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4 align-middle">
                        {bounced ? (
                          entry.ReplacementDocNo ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 overflow-hidden max-w-full">
                              <ArrowRight size={10} className="shrink-0" />
                              <span className="font-mono truncate">{entry.ReplacementDocNo}</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleReissue(entry)}
                              title="Create a replacement payment for this bounced cheque"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors whitespace-nowrap"
                            >
                              <CornerDownRight size={11} />
                              Re-issue
                            </button>
                          )
                        ) : entry.OriginalDocNo ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] font-semibold text-amber-700 dark:text-amber-400 overflow-hidden max-w-full">
                            <CornerDownRight size={10} className="shrink-0" />
                            <span className="font-mono truncate">{entry.OriginalDocNo}</span>
                          </span>
                        ) : entry.ChequeNo && !cleared ? (
                          <button
                            onClick={() => setBounceEntry(entry)}
                            title="Mark this cheque as bounced / dishonoured"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-red-300 dark:border-red-700/60 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap"
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

          {/* ── Pagination ─────────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10 rounded-b-xl">
              <p className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {totalPages} · {total} total
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                  className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Legend ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4 mt-4 px-1">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <span className="w-3.5 h-3.5 rounded border-2 border-emerald-500 bg-emerald-500 inline-flex items-center justify-center">
                <svg viewBox="0 0 10 8" className="w-2 h-2 fill-none stroke-white stroke-[2]">
                  <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Tick
            </span>{" "}
            — confirmed in your bank passbook (Clear)
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Ban size={11} className="text-red-500" /> Bounce
            </span>{" "}
            — dishonoured / returned by bank
          </span>
          <p className="text-[11px] text-muted-foreground ml-auto">
            Showing payments with a linked bank account
          </p>
        </div>
      </FinanceShell>

      {/* ── Bounce Modal (portal) ──────────────────────────────────────────── */}
      {bounceEntry && (
        <BounceModal
          entry={bounceEntry}
          onClose={() => setBounceEntry(null)}
          onConfirm={handleConfirmBounce}
          saving={bounceSaving}
        />
      )}
    </>
  );
}
