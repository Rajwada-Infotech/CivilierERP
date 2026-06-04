/**
 * Brs.tsx — Bank Reconciliation Statement
 *
 * Pulls all payments (outgoing NewPayment + incoming ReceivedPayment) that are
 * linked to a bank account and lets the user tick them as "Clear" (verified in
 * passbook) or leave them as "Unclear". Supports:
 *   • Date-range filter (from / to)
 *   • Clear / Unclear status filter
 *   • Company filter
 *   • Bank filter
 *   • Export (PDF / XLSX / CSV) via ExportMenu
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { format, parseISO } from "date-fns";
import {
  getBRS,
  getBRSFilters,
  markClear,
  markUnclear,
  type BrsEntry,
  type BrsFilterOption,
} from "@/api/brsApi";
import {
  CheckCircle2,
  Landmark,
  IndianRupee,
  Clock,
  Search,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Hash,
  ShieldCheck,
  Hourglass,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

function isCleared(e: BrsEntry): boolean {
  return e.IsMatched === true || e.IsMatched === 1;
}

// Derive a display transaction ID from mode-specific fields or TxnId
function txnLabel(e: BrsEntry): string {
  return e.TxnId ?? "—";
}

// ─── Export column definitions ────────────────────────────────────────────────

const EXPORT_COLUMNS: ExportColumn[] = [
  {
    header: "Type",
    accessor: (r) => (r.SourceType === "RECEIVED" ? "Received" : "Payment"),
  },
  { header: "Company", accessor: "CompanyName" },
  { header: "Bank", accessor: "BankName" },
  { header: "Date", accessor: (r) => fmt(r.PayDate as string) },
  {
    header: "Amount",
    accessor: (r) =>
      `Rs. ${Number(r.Amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
  },
  { header: "Mode", accessor: "Mode" },
  { header: "Doc No.", accessor: (r) => r.DocNo ?? "—" },
  { header: "Txn ID", accessor: (r) => r.TxnId ?? "—" },
  { header: "Pay Status", accessor: "PayStatus" },
  {
    header: "BRS Status",
    accessor: (r) =>
      r.IsMatched === true || r.IsMatched === 1 ? "Clear" : "Unclear",
  },
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

function ClearBadge({ cleared }: { cleared: boolean }) {
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
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
        Draft
      </span>
    );
  if (status === "Approved")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
        <ShieldCheck size={9} strokeWidth={2.5} />
        Approved
      </span>
    );
  if (status === "Pending")
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
        Pending
      </span>
    );
  if (status === "Rejected")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
        Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
      {status}
    </span>
  );
}

function PassbookCheck({
  checked,
  loading,
  onChange,
}: {
  checked: boolean;
  loading: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      disabled={loading}
      title={checked ? "Mark as Unclear" : "Mark as Clear"}
      className={`
        relative flex items-center justify-center w-5 h-5 rounded border-2 transition-all duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
        ${loading ? "opacity-40 cursor-wait" : "cursor-pointer"}
        ${
          checked
            ? "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
            : "bg-transparent border-border hover:border-emerald-400 hover:bg-emerald-500/5"
        }
      `}
    >
      {loading ? (
        <RefreshCw size={10} className="animate-spin text-white" />
      ) : checked ? (
        <svg
          viewBox="0 0 10 8"
          className="w-2.5 h-2.5 fill-none stroke-white stroke-[2]"
        >
          <path
            d="M1 4l2.5 2.5L9 1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export default function Brs() {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [allBanks, setAllBanks] = useState<BrsFilterOption[]>([]);
  const [bankId, setBankId] = useState<string | undefined>(undefined);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "clear" | "unclear">(
    "",
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // ── Data state ────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<BrsEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [clearAmount, setClearAmount] = useState(0);
  const [unclearAmount, setUnclearAmount] = useState(0);
  const [clearCount, setClearCount] = useState(0);
  const [unclearCount, setUnclearCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null); // "TYPE-id"

  // ── Filter options load ───────────────────────────────────────────────────
  useEffect(() => {
    getBRSFilters()
      .then((r) => {
        setAllBanks(r.data?.banks ?? []);
      })
      .catch((err) => console.error("BRS filters error", err));
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: PAGE_SIZE };
      if (bankId) params.bankId = Number(bankId);
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      if (statusFilter) params.status = statusFilter;

      const r = await getBRS(params as Parameters<typeof getBRS>[0]);
      const d = r.data;
      setEntries(d.data ?? []);
      setTotal(d.total ?? 0);
      setTotalPages(d.totalPages ?? 1);
      setClearAmount(d.clearAmount ?? 0);
      setUnclearAmount(d.unclearAmount ?? 0);
      setClearCount(d.clearCount ?? 0);
      setUnclearCount(d.unclearCount ?? 0);
    } catch (err) {
      console.error("BRS fetch error", err);
      toast.error("Failed to load BRS data");
    } finally {
      setLoading(false);
    }
  }, [page, bankId, fromDate, toDate, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refetch when user returns to this tab (e.g. after approving a payment elsewhere)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [bankId, fromDate, toDate, statusFilter]);

  // ── Toggle clear / unclear ────────────────────────────────────────────────
  const toggle = useCallback(
    async (entry: BrsEntry) => {
      const key = `${entry.SourceType}-${entry.SourceID}`;
      setTogglingId(key);
      try {
        const cleared = isCleared(entry);
        if (cleared) {
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
    },
    [fetchData],
  );

  // ── Client-side search (on top of server-filtered data) ───────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        (e.CompanyName ?? "").toLowerCase().includes(q) ||
        (e.BankName ?? "").toLowerCase().includes(q) ||
        (e.TxnId ?? "").toLowerCase().includes(q) ||
        (e.PaymentName ?? "").toLowerCase().includes(q) ||
        (e.DocNo ?? "").toLowerCase().includes(q) ||
        (e.Mode ?? "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  // Export data shaped for ExportMenu
  const exportData = useMemo(
    () => filtered as unknown as Record<string, unknown>[],
    [filtered],
  );

  // ── Stats cards ───────────────────────────────────────────────────────────
  const stats = [
    {
      label: "Clear",
      value: String(clearCount),
      sub: formatINR(clearAmount),
      icon: CheckCircle2,
      ring: "ring-emerald-500/20",
      bg: "bg-emerald-500/10",
      color: "text-emerald-500",
    },
    {
      label: "Unclear",
      value: String(unclearCount),
      sub: formatINR(unclearAmount),
      icon: Clock,
      ring: "ring-amber-500/20",
      bg: "bg-amber-500/10",
      color: "text-amber-500",
    },
    {
      label: "Total Entries",
      value: String(total),
      sub: formatINR(clearAmount + unclearAmount),
      icon: IndianRupee,
      ring: "ring-primary/20",
      bg: "bg-primary/10",
      color: "text-primary",
    },
    {
      label: "Banks",
      value: String(allBanks.length),
      sub: "linked",
      icon: Landmark,
      ring: "ring-blue-500/20",
      bg: "bg-blue-500/10",
      color: "text-blue-500",
    },
  ];

  const reconcileRate = total > 0 ? Math.round((clearCount / total) * 100) : 0;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "BRS"]} />
      <div className="relative space-y-8 mt-6">
        {/* ── Page header ────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Bank Reconciliation Statement
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verify payments against your bank passbook — tick each entry once
              confirmed
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <ExportMenu
              data={exportData}
              columns={EXPORT_COLUMNS}
              title="Bank Reconciliation Statement"
              filename="brs-export"
              subtitle={
                [
                  fromDate && `From: ${fmt(fromDate)}`,
                  toDate && `To: ${fmt(toDate)}`,
                  statusFilter &&
                    `Status: ${statusFilter === "clear" ? "Clear" : "Unclear"}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              disabled={filtered.length === 0}
            />
          </div>
        </div>

        {/* ── Stats ──────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map(({ label, value, sub, icon: Icon, ring, bg, color }) => (
            <div
              key={label}
              className={`glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 ${ring}`}
            >
              <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold font-heading text-foreground leading-none">
                  {value}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                  {label}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                  {sub}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Progress bar ───────────────────────────────────────────────────── */}
        {total > 0 && (
          <div className="glass rounded-xl px-5 py-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Reconciliation progress
              </span>
              <span className="text-xs font-bold text-foreground tabular-nums">
                {reconcileRate}% · {clearCount}/{total}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${reconcileRate}%`,
                  background:
                    reconcileRate === 100
                      ? "linear-gradient(90deg,#10b981,#34d399)"
                      : "linear-gradient(90deg,#f59e0b,#10b981)",
                }}
              />
            </div>
          </div>
        )}

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="glass rounded-xl px-5 py-4 space-y-3">
          {/* Row 1: search + company + bank */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, bank, txn ID…"
                className="w-full h-8 pl-8 pr-7 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Bank */}
            <div className="relative">
              <Landmark
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={bankId ?? ""}
                onChange={(e) => setBankId(e.target.value || undefined)}
                className={`h-8 pl-7 pr-8 bg-input/70 border rounded-lg text-xs appearance-none focus:ring-1 focus:ring-primary outline-none cursor-pointer ${bankId ? "border-primary/60 text-primary font-medium" : "border-border"}`}
              >
                <option value="">All Banks</option>
                {allBanks.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: date range + status pills */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Date from */}
            <div className="relative">
              <CalendarDays
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 pl-7 pr-3 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary outline-none cursor-pointer"
              />
            </div>

            <span className="text-muted-foreground text-xs">to</span>

            {/* Date to */}
            <div className="relative">
              <CalendarDays
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 pl-7 pr-3 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary outline-none cursor-pointer"
              />
            </div>

            {/* Clear date range */}
            {(fromDate || toDate) && (
              <button
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                }}
                className="h-8 px-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-dashed border-border"
                title="Clear date range"
              >
                <X size={12} />
              </button>
            )}

            {/* Status filter pills */}
            <div className="flex gap-1.5 ml-auto">
              {(["", "clear", "unclear"] as const).map((s) => {
                const label =
                  s === "" ? "All" : s === "clear" ? "✓ Clear" : "○ Unclear";
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
                            : "bg-primary/10 text-primary border-primary/30 font-semibold"
                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-visible">
          {/* Table header row */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20 rounded-t-xl">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {filtered.length}
              </span>{" "}
              entr{filtered.length === 1 ? "y" : "ies"}
              {total !== filtered.length && ` (${total} server-side)`}
            </p>
            {loading && (
              <RefreshCw
                size={13}
                className="animate-spin text-muted-foreground"
              />
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10">
                  {/* Passbook tick */}
                  <th className="px-4 py-2.5 text-center w-10">
                    <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                      ✓
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Type
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Company
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden md:table-cell">
                    Bank
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden lg:table-cell">
                    Date
                  </th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Amount
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">
                    Mode
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden xl:table-cell">
                    Doc / Txn ID
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    Pay Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                    BRS
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-5 py-14 text-center text-muted-foreground text-sm"
                    >
                      No entries match your filters.
                    </td>
                  </tr>
                )}

                {loading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-5 py-14 text-center text-muted-foreground text-sm"
                    >
                      <RefreshCw
                        size={18}
                        className="animate-spin mx-auto mb-2 opacity-40"
                      />
                      Loading…
                    </td>
                  </tr>
                )}

                {filtered.map((entry) => {
                  const key = `${entry.SourceType}-${entry.SourceID}`;
                  const cleared = isCleared(entry);
                  const toggling = togglingId === key;

                  return (
                    <tr
                      key={key}
                      className={`transition-colors ${
                        cleared
                          ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07]"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      {/* Passbook tick checkbox */}
                      <td className="px-4 py-3 text-center">
                        <PassbookCheck
                          checked={cleared}
                          loading={toggling}
                          onChange={() => toggle(entry)}
                        />
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <TypePill type={entry.SourceType} />
                      </td>

                      {/* Company */}
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-foreground leading-snug">
                          {entry.CompanyName || "—"}
                        </p>
                        {entry.PaymentName &&
                          entry.PaymentName !== entry.CompanyName && (
                            <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                              {entry.PaymentName}
                            </p>
                          )}
                      </td>

                      {/* Bank */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                            <Landmark size={10} className="text-blue-500" />
                          </div>
                          <span className="text-xs text-foreground truncate max-w-[120px]">
                            {entry.BankName || "—"}
                          </span>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {fmt(entry.PayDate)}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-mono font-semibold text-foreground whitespace-nowrap">
                          {formatINR(entry.Amount)}
                        </span>
                      </td>

                      {/* Mode */}
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {entry.Mode || "—"}
                        </span>
                      </td>

                      {/* Doc / Txn ID */}
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <div className="space-y-0.5">
                          {entry.DocNo && (
                            <span className="block font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 w-fit">
                              {entry.DocNo}
                            </span>
                          )}
                          {entry.TxnId && (
                            <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                              <Hash size={9} />
                              {entry.TxnId}
                            </span>
                          )}
                          {!entry.DocNo && !entry.TxnId && (
                            <span className="text-muted-foreground/40 text-xs">
                              —
                            </span>
                          )}
                        </div>
                      </td>

                      {/* BRS Status */}
                      <td className="px-4 py-3">
                        <PayStatusBadge status={entry.PayStatus} />
                      </td>

                      {/* BRS Clear/Unclear */}
                      <td className="px-4 py-3">
                        <ClearBadge cleared={cleared} />
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
          <p className="text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <span className="w-3.5 h-3.5 rounded border-2 border-emerald-500 bg-emerald-500 inline-flex items-center justify-center">
                <svg
                  viewBox="0 0 10 8"
                  className="w-2 h-2 fill-none stroke-white stroke-[2]"
                >
                  <path
                    d="M1 4l2.5 2.5L9 1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              Tick
            </span>{" "}
            — confirmed in your bank passbook (Clear)
          </p>
          <p className="text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <span className="w-3.5 h-3.5 rounded border-2 border-border inline-block" />
              Empty
            </span>{" "}
            — not yet verified (Unclear)
          </p>
          <p className="text-[11px] text-muted-foreground ml-auto">
            Showing payments and received payments with a linked bank account
          </p>
        </div>
      </div>
      {/* end p-6 space-y-8 */}
    </>
  );
}
