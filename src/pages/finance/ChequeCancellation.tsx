/**
 * ChequeCancellation.tsx — Finance → Transaction → Cheque Cancellation
 *
 * Search a payment by its cheque number, review the full payment document,
 * and cancel that cheque (single or bulk). See backend/routes/chequeCancellation.js
 * for the cancellation semantics (permanent block on reissue, badge flag, etc).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { ExportMenu } from "@/components/ExportMenu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExportColumn } from "@/lib/export";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { format, parseISO } from "date-fns";
import { usePageRights } from "@/hooks/usePageRights";
import {
  searchChequeByNumber,
  bulkSearchCheques,
  cancelCheque,
  bulkCancelCheques,
  getCancelledCheques,
  type ChequeSearchResult,
  type BulkSearchResult,
  type CancelledChequeRecord,
} from "@/api/chequeCancellationApi";
import {
  Search,
  Ban,
  Landmark,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Layers,
  X,
  CalendarClock,
  Wallet,
} from "lucide-react";

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Cheque No", accessor: "ChequeNo" },
  { header: "Lot Number", accessor: "ChequeLotNumber" },
  { header: "Bank Name", accessor: "BankName" },
  { header: "Account Number", accessor: "AccountNumber" },
  { header: "Payment Doc No", accessor: "DocNo" },
  { header: "Payment Name", accessor: "PPaymentName" },
  { header: "Amount", accessor: (r) => (r.PAmount != null ? `Rs. ${Number(r.PAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—") },
  { header: "Company", accessor: "PCompanyName" },
  { header: "Project", accessor: "PProject" },
  { header: "Reason", accessor: "Reason" },
  { header: "Cancelled By", accessor: "CancelledBy" },
  { header: "Cancelled At", accessor: (r) => fmt(r.CancelledAt as string) },
];

const searchInputCls =
  "w-full h-8 pl-8 pr-7 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none";

export default function ChequeCancellation() {
  const rights = usePageRights("cheque-cancellation");

  // ── Single search ──────────────────────────────────────────────────────────
  const [chequeNo, setChequeNo] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ChequeSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [reason, setReason] = useState("");
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const runSearch = async () => {
    const trimmed = chequeNo.trim();
    if (!trimmed) {
      toast.error("Enter a cheque number to search.");
      return;
    }
    setSearching(true);
    setSearched(false);
    try {
      const data = await searchChequeByNumber(trimmed);
      setResults(data);
      setSearched(true);
      if (!data.length) toast.info("No payment entry found for this cheque number.");
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const handleCancel = async (row: ChequeSearchResult) => {
    if (!window.confirm(`Cancel cheque ${row.PChequeNo}? This cannot be undone.`)) return;
    setCancellingId(row.PPaymentID);
    try {
      await cancelCheque(row.PPaymentID, row.PChequeNo, reason || undefined);
      toast.success(`Cheque ${row.PChequeNo} cancelled.`);
      setResults((prev) =>
        prev.map((r) =>
          r.PPaymentID === row.PPaymentID ? { ...r, PIsChequeCancelled: 1 } : r,
        ),
      );
      loadCancelled();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Cancellation failed.");
    } finally {
      setCancellingId(null);
    }
  };

  // ── Bulk cancellation ────────────────────────────────────────────────────────
  const [bulkInput, setBulkInput] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkSearchResult[]>([]);
  const [bulkSearching, setBulkSearching] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [bulkReason, setBulkReason] = useState("");

  const runBulkSearch = async () => {
    const numbers = bulkInput
      .split(/[\n,;\s]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (!numbers.length) {
      toast.error("Enter one or more cheque numbers.");
      return;
    }
    setBulkSearching(true);
    try {
      const data = await bulkSearchCheques(numbers);
      setBulkResults(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Bulk search failed.");
    } finally {
      setBulkSearching(false);
    }
  };

  const validBulkEntries = bulkResults.filter((r) => r.found && !r.alreadyCancelled && r.payment);

  const runBulkCancel = async () => {
    if (!validBulkEntries.length) {
      toast.error("No valid cheque entries to cancel.");
      return;
    }
    if (
      !window.confirm(
        `Cancel ${validBulkEntries.length} cheque${validBulkEntries.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setBulkCancelling(true);
    try {
      const items = validBulkEntries.map((r) => ({
        paymentId: r.payment!.PPaymentID,
        chequeNo: r.chequeNo,
      }));
      const result = await bulkCancelCheques(items, bulkReason || undefined);
      if (result.cancelled.length) {
        toast.success(`${result.cancelled.length} cheque(s) cancelled.`);
      }
      if (result.skipped.length) {
        toast.warning(`${result.skipped.length} cheque(s) skipped — see details.`);
      }
      setBulkResults([]);
      setBulkInput("");
      setBulkReason("");
      loadCancelled();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Bulk cancellation failed.");
    } finally {
      setBulkCancelling(false);
    }
  };

  // ── Cancelled Cheques list ────────────────────────────────────────────────────
  const [cancelledList, setCancelledList] = useState<CancelledChequeRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listSearch, setListSearch] = useState("");

  const loadCancelled = async (search = listSearch) => {
    setLoadingList(true);
    try {
      const data = await getCancelledCheques({ search, limit: 500 });
      setCancelledList(data.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed to load cancelled cheques.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadCancelled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalAmount = cancelledList.reduce((sum, r) => sum + (Number(r.PAmount) || 0), 0);
    const now = new Date();
    const thisMonth = cancelledList.filter((r) => {
      if (!r.CancelledAt) return false;
      const d = new Date(r.CancelledAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    return [
      { label: "Total Cancelled", value: String(cancelledList.length), icon: Ban, bg: "bg-rose-500/10", color: "text-rose-500", ring: "ring-rose-500/15", borderL: "border-l-rose-500" },
      { label: "Cancelled This Month", value: String(thisMonth), icon: CalendarClock, bg: "bg-amber-500/10", color: "text-amber-500", ring: "ring-amber-500/15", borderL: "border-l-amber-500" },
      { label: "Total Amount", value: formatINR(totalAmount), icon: Wallet, bg: "bg-primary/10", color: "text-primary", ring: "ring-primary/15", borderL: "border-l-primary" },
    ];
  }, [cancelledList]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Cheque Cancellation"]} />
      <FinanceShell
        title="Cheque Cancellation"
        subtitle="Search, review, and cancel cheques tied to payment entries"
        icon={Ban}
        action={
          <button
            onClick={() => loadCancelled()}
            disabled={loadingList}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            <RefreshCw size={11} className={loadingList ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        {/* ── Stat tiles ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {stats.map(({ label, value, icon: Icon, bg, color, ring, borderL }) => (
            <div
              key={label}
              className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL}`}
            >
              <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold font-heading text-foreground leading-none truncate">{value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 font-heading uppercase tracking-wide">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="search" className="w-full">
          <TabsList className="h-9 w-full sm:w-auto">
            <TabsTrigger value="search" className="text-xs gap-1.5"><Search size={12} /> Search &amp; Cancel</TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs gap-1.5"><Layers size={12} /> Bulk Cancel</TabsTrigger>
            <TabsTrigger value="list" className="text-xs gap-1.5">
              <Ban size={12} /> Cancelled Cheques
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-muted text-[10px] leading-none">{cancelledList.length}</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Search & Cancel ───────────────────────────────────────── */}
          <TabsContent value="search" className="mt-3">
            <div className="glass rounded-xl px-5 py-4 space-y-4 ring-1 ring-border/60">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    value={chequeNo}
                    onChange={(e) => setChequeNo(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Enter cheque number…"
                    className={searchInputCls}
                  />
                  {chequeNo && (
                    <button onClick={() => setChequeNo("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  onClick={runSearch}
                  disabled={searching}
                  className="h-8 flex items-center justify-center gap-1.5 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                >
                  {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
                </button>
              </div>

              {searched && results.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <AlertTriangle size={14} /> No payment entry found for this cheque number.
                </div>
              )}

              {results.map((row) => (
                <div key={row.PPaymentID} className="rounded-xl border border-border overflow-hidden">
                  {/* Header: cheque + bank/lot chips + status */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/20 border-b border-border">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="font-mono font-bold text-foreground">Chq {row.PChequeNo}</span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Landmark size={11} className="text-primary/70" /> {row.BankName ?? "—"}
                        {row.PChequeAccountNumber ? ` · ${row.PChequeAccountNumber}` : ""}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Layers size={11} className="text-amber-500" /> Lot {row.LotNumber ?? row.PChequeLotNumber ?? "—"}
                      </span>
                    </div>
                    {row.PIsChequeCancelled ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-semibold shrink-0">
                        <Ban size={11} /> Cancelled Cheque
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold shrink-0">
                        <CheckCircle2 size={11} /> Active
                      </span>
                    )}
                  </div>

                  {/* Payment document — compact definition list */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-4 py-3.5 text-xs">
                    {[
                      { label: "Doc No", value: row.DocNo },
                      { label: "Payment Name", value: row.PPaymentName },
                      { label: "Amount", value: formatINR(row.PAmount) },
                      { label: "Date", value: fmt(row.PDate) },
                      { label: "Mode", value: row.PMode },
                      { label: "Status", value: row.Status },
                      { label: "Cheque Date", value: fmt(row.PChequeDate) },
                      { label: "IFSC", value: row.PChequeIfsc },
                    ].map((f) => (
                      <div key={f.label} className="min-w-0">
                        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/80">{f.label}</p>
                        <p className="font-medium text-foreground truncate">{f.value || "—"}</p>
                      </div>
                    ))}
                  </div>

                  {!row.PIsChequeCancelled && rights.canCreate && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-3 border-t border-border bg-muted/10">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason for cancellation (optional)"
                        className="text-xs px-3 h-8 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary flex-1"
                      />
                      <button
                        onClick={() => handleCancel(row)}
                        disabled={cancellingId === row.PPaymentID}
                        className="h-8 flex items-center justify-center gap-1.5 px-4 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50 transition-all whitespace-nowrap"
                      >
                        {cancellingId === row.PPaymentID ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                        Cancel Cheque
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── Tab: Bulk Cancel ───────────────────────────────────────────── */}
          <TabsContent value="bulk" className="mt-3">
            <div className="glass rounded-xl px-5 py-4 space-y-4 ring-1 ring-border/60">
              <p className="text-xs text-muted-foreground">
                Paste multiple cheque numbers (comma, space, or newline separated), then check them before cancelling.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <input
                  type="text"
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runBulkSearch();
                  }}
                  placeholder="Cheque numbers — e.g. 100234, 100235, 100236"
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-input/70 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                />
                <div className="flex sm:flex-col gap-2 sm:w-36 shrink-0">
                  <button
                    onClick={runBulkSearch}
                    disabled={bulkSearching || !bulkInput.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                  >
                    {bulkSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Check
                  </button>
                  {(bulkInput || bulkResults.length > 0) && (
                    <button
                      onClick={() => {
                        setBulkInput("");
                        setBulkResults([]);
                        setBulkReason("");
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
                    >
                      <X size={13} /> Clear
                    </button>
                  )}
                </div>
              </div>

              {bulkResults.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  {/* Summary strip */}
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-muted/20 border-b border-border">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
                      <CheckCircle2 size={11} /> {validBulkEntries.length} ready
                    </span>
                    {bulkResults.some((r) => r.found && r.alreadyCancelled) && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-500 text-[11px] font-semibold">
                        <Ban size={11} /> {bulkResults.filter((r) => r.found && r.alreadyCancelled).length} already cancelled
                      </span>
                    )}
                    {bulkResults.some((r) => !r.found) && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-[11px] font-semibold">
                        <XCircle size={11} /> {bulkResults.filter((r) => !r.found).length} not found
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">{bulkResults.length} checked</span>
                  </div>

                  {/* Result rows */}
                  <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
                    {bulkResults.map((r) => {
                      const state = !r.found ? "missing" : r.alreadyCancelled ? "cancelled" : "ready";
                      return (
                        <div
                          key={r.chequeNo}
                          className={`flex items-center gap-3 px-3 py-2 text-xs ${state === "missing" ? "opacity-60" : ""}`}
                        >
                          <span className="font-mono font-semibold text-foreground w-24 shrink-0">{r.chequeNo}</span>
                          <span className="flex-1 min-w-0 truncate text-muted-foreground">
                            {r.payment ? `${r.payment.DocNo ?? "—"} · ${formatINR(r.payment.PAmount)}` : "—"}
                          </span>
                          {state === "missing" && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0">
                              <XCircle size={11} /> No matching payment
                            </span>
                          )}
                          {state === "cancelled" && (
                            <span className="inline-flex items-center gap-1 text-rose-500 shrink-0">
                              <Ban size={11} /> Already cancelled
                            </span>
                          )}
                          {state === "ready" && (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 shrink-0">
                              <CheckCircle2 size={11} /> Ready
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Action bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 border-t border-border bg-muted/10">
                    <input
                      value={bulkReason}
                      onChange={(e) => setBulkReason(e.target.value)}
                      placeholder="Reason for bulk cancellation (optional)"
                      className="text-xs px-3 h-8 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary flex-1"
                    />
                    {rights.canCreate && (
                      <button
                        onClick={runBulkCancel}
                        disabled={bulkCancelling || !validBulkEntries.length}
                        className="h-8 flex items-center justify-center gap-1.5 px-4 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50 transition-all whitespace-nowrap"
                      >
                        {bulkCancelling ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                        Cancel {validBulkEntries.length} Valid Entr{validBulkEntries.length === 1 ? "y" : "ies"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Tab: Cancelled Cheques ─────────────────────────────────────── */}
          <TabsContent value="list" className="mt-3">
            <div className="glass rounded-xl px-5 py-4 space-y-3 ring-1 ring-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadCancelled()}
                    placeholder="Search cheque no, lot, bank, doc no…"
                    className={searchInputCls}
                  />
                  {listSearch && (
                    <button onClick={() => { setListSearch(""); loadCancelled(""); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <ExportMenu
                  data={cancelledList as unknown as Record<string, unknown>[]}
                  columns={EXPORT_COLUMNS}
                  title="Cancelled Cheques"
                  filename="cancelled-cheques"
                  disabled={loadingList || !cancelledList.length || !rights.canExport}
                />
              </div>

              {loadingList ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : cancelledList.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">No cheques have been cancelled yet.</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/10">
                        {["Cheque No", "Lot", "Bank", "A/C Number", "Payment Doc", "Company", "Project", "Amount", "Reason", "Cancelled By", "Cancelled At"].map((h) => (
                          <th key={h} className="px-3 py-3 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cancelledList.map((r) => (
                        <tr key={r.CCId} className="border-b border-border/50 last:border-0 hover:bg-muted/10">
                          <td className="px-3 py-3 font-mono align-middle">{r.ChequeNo}</td>
                          <td className="px-3 py-3 align-middle">{r.ChequeLotNumber ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.BankName ?? "—"}</td>
                          <td className="px-3 py-3 font-mono align-middle">{r.AccountNumber ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.DocNo ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.PCompanyName ?? r.PCompany ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.PProject ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.PAmount != null ? formatINR(r.PAmount) : "—"}</td>
                          <td className="px-3 py-3 text-muted-foreground align-middle">{r.Reason ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.CancelledBy ?? "—"}</td>
                          <td className="px-3 py-3 whitespace-nowrap align-middle">{fmt(r.CancelledAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </FinanceShell>
    </>
  );
}
