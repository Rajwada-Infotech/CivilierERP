/**
 * ChequeCancellation.tsx — Finance → Transaction → Cheque Cancellation
 *
 * Search a payment by its cheque number, review the full payment document,
 * and cancel that cheque (single or bulk). See backend/routes/chequeCancellation.js
 * for the cancellation semantics (permanent block on reissue, badge flag, etc).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Button } from "@/components/ui/button";
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
  "w-full h-9 pl-8 pr-7 bg-card border border-foreground/40 text-xs focus:border-foreground outline-none";

export default function ChequeCancellation() {
  const rights = usePageRights("cheque-cancellation");

  // ── Single search ──────────────────────────────────────────────────────────
  const [chequeNo, setChequeNo] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ChequeSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [reason, setReason] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // A row's PPaymentID is null for a payment-less cheque (never issued
  // against any payment) — key/match on this instead so both kinds of row
  // still get a stable, unique identity.
  const rowKey = (row: ChequeSearchResult) =>
    row.PPaymentID != null ? `p-${row.PPaymentID}` : `lot-${row.PChequeLotId}-${row.PChequeNo}`;

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
      if (!data.length) toast.info("This cheque number isn't linked to a payment or any active cheque lot.");
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const handleCancel = async (row: ChequeSearchResult) => {
    if (!window.confirm(`Cancel cheque ${row.PChequeNo}? This cannot be undone.`)) return;
    const key = rowKey(row);
    setCancellingId(key);
    try {
      await cancelCheque(row.PPaymentID, row.PChequeNo, reason || undefined, row.PChequeLotId);
      toast.success(`Cheque ${row.PChequeNo} cancelled.`);
      setResults((prev) =>
        prev.map((r) => (rowKey(r) === key ? { ...r, PIsChequeCancelled: 1 } : r)),
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
        chequeLotId: r.payment!.PChequeLotId,
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
      { label: "Total Cancelled", value: String(cancelledList.length), icon: Ban, bg: "bg-destructive/10", color: "text-destructive", ring: "ring-rose-500/15", borderL: "border-l-rose-500" },
      { label: "Cancelled This Month", value: String(thisMonth), icon: CalendarClock, bg: "bg-[#ffe2021a]", color: "text-amber-500", ring: "ring-amber-500/15", borderL: "border-l-amber-500" },
      { label: "Total Amount", value: formatINR(totalAmount), icon: Wallet, bg: "bg-primary/10", color: "text-primary", ring: "ring-primary/15", borderL: "border-l-primary" },
    ];
  }, [cancelledList]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Cheque Cancellation"]} />
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Cheque cancellation"
        subtitle="Find a cheque, see what it is tied to, and cancel it. One at a time or many together."
        action={
          <button
            onClick={() => loadCancelled()}
            disabled={loadingList}
            className="flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingList ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        {/* ── Figures ────────────────────────────────────────────────────────── */}
        <div className="statrow">
          {stats.map(({ label, value }) => (
            <div key={label}>
              <p className="label">{label}</p>
              <p className="figure" style={{ fontSize: "clamp(22px, 2.4vw, 32px)", marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="search" className="w-full">
          <TabsList className="h-auto w-full sm:w-auto p-0 bg-transparent justify-start gap-0" style={{ borderBottom: "1px solid hsl(var(--foreground))", borderRadius: 0 }}>
            {[
              { v: "search", l: "Find and cancel" },
              { v: "bulk", l: "Cancel several" },
              { v: "list", l: `Cancelled · ${cancelledList.length}` },
            ].map((x) => (
              <TabsTrigger
                key={x.v}
                value={x.v}
                className="px-4 py-2.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground border-b-2 border-transparent -mb-px bg-transparent shadow-none data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {x.l}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Tab: Search & Cancel ───────────────────────────────────────── */}
          <TabsContent value="search" className="mt-3">
            <div className="px-4 py-4 space-y-4 bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
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
                <Button
                  onClick={runSearch}
                  disabled={searching}
                  className="gap-1.5 shrink-0 bg-foreground text-card hover:bg-foreground/85 font-heading font-semibold uppercase tracking-[0.1em] text-[0.625rem] px-3 sm:px-4 py-2 h-auto"
                >
                  {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
                </Button>
              </div>

              {searched && results.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <AlertTriangle size={14} /> This cheque number isn't linked to a payment or any active cheque lot.
                </div>
              )}

              {results.map((row) => (
                <div key={rowKey(row)} className="overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
                  {/* Header: cheque + bank/lot chips + status */}
                  <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                    <div className="min-w-0">
                      <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {row.BankName ?? "—"}{row.PChequeAccountNumber ? ` · ${row.PChequeAccountNumber}` : ""} · Lot {row.LotNumber ?? row.PChequeLotNumber ?? "—"}
                      </p>
                      <p className="font-heading text-lg font-bold tabular-nums tracking-tight text-foreground mt-1">Cheque {row.PChequeNo}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {row.PPaymentID == null && <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Not tied to a payment</span>}
                      <SheetMark text={row.PIsChequeCancelled ? "Cancelled" : "Active"} tone={row.PIsChequeCancelled ? "stopped" : "done"} />
                    </div>
                  </div>

                  {/* Payment document — compact definition list (blank for a
                      payment-less cheque, which has no payment document at all) */}
                  {row.PPaymentID != null && (
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
                          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{f.label}</p>
                          <p className="text-[0.8125rem] font-medium text-foreground truncate mt-1">{f.value || "—"}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {!row.PIsChequeCancelled && rights.canCreate && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason for cancellation (optional)"
                        className="text-xs px-3 h-9 border border-foreground/40 bg-card focus:outline-none focus:border-foreground flex-1"
                      />
                      <button
                        onClick={() => handleCancel(row)}
                        disabled={cancellingId === rowKey(row)}
                        className="h-9 flex items-center justify-center gap-1.5 px-4 bg-destructive text-destructive-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] hover:bg-destructive/90 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {cancellingId === rowKey(row) ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
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
            <div className="px-4 py-4 space-y-4 bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
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
                  className="flex-1 min-w-0 px-3 py-2 border border-foreground/40 bg-card text-xs font-heading tabular-nums focus:outline-none focus:border-foreground transition-colors"
                />
                <div className="flex sm:flex-col gap-2 sm:w-36 shrink-0">
                  <button
                    onClick={runBulkSearch}
                    disabled={bulkSearching || !bulkInput.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-foreground text-card font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] hover:bg-foreground/85 disabled:opacity-50 transition-colors"
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
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-foreground/40 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                    >
                      <X size={13} /> Clear
                    </button>
                  )}
                </div>
              </div>

              {bulkResults.length > 0 && (
                <div className="overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
                  {/* Summary strip */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                    <SheetMark text={`${validBulkEntries.length} ready`} tone="done" />
                    {bulkResults.some((r) => r.found && r.alreadyCancelled) && (
                      <SheetMark text={`${bulkResults.filter((r) => r.found && r.alreadyCancelled).length} already cancelled`} tone="stopped" />
                    )}
                    {bulkResults.some((r) => !r.found) && (
                      <SheetMark text={`${bulkResults.filter((r) => !r.found).length} not found`} tone="waiting" />
                    )}
                    <span className="ml-auto text-[0.6875rem] text-muted-foreground">{bulkResults.length} checked</span>
                  </div>

                  {/* Result rows */}
                  <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
                    {bulkResults.map((r) => {
                      const state = !r.found ? "missing" : r.alreadyCancelled ? "cancelled" : "ready";
                      const paymentLess = r.payment && r.payment.PPaymentID == null;
                      return (
                        <div
                          key={r.chequeNo}
                          className={`flex items-center gap-3 px-3 py-2 text-xs ${state === "missing" ? "opacity-60" : ""}`}
                        >
                          <span className="font-heading tabular-nums font-semibold text-foreground w-24 shrink-0">{r.chequeNo}</span>
                          <span className="flex-1 min-w-0 truncate text-muted-foreground">
                            {!r.payment
                              ? "—"
                              : paymentLess
                                ? `Not linked to a payment · Lot ${r.payment.LotNumber ?? r.payment.PChequeLotNumber ?? "—"}`
                                : `${r.payment.DocNo ?? "—"} · ${formatINR(r.payment.PAmount)}`}
                          </span>
                          <span className="shrink-0">
                            <SheetMark
                              text={state === "missing" ? "Not found" : state === "cancelled" ? "Already cancelled" : "Ready"}
                              tone={state === "missing" ? "waiting" : state === "cancelled" ? "stopped" : "done"}
                            />
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
                    <input
                      value={bulkReason}
                      onChange={(e) => setBulkReason(e.target.value)}
                      placeholder="Reason for bulk cancellation (optional)"
                      className="text-xs px-3 h-9 border border-foreground/40 bg-card focus:outline-none focus:border-foreground flex-1"
                    />
                    {rights.canCreate && (
                      <button
                        onClick={runBulkCancel}
                        disabled={bulkCancelling || !validBulkEntries.length}
                        className="h-9 flex items-center justify-center gap-1.5 px-4 bg-destructive text-destructive-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] hover:bg-destructive/90 disabled:opacity-50 transition-colors whitespace-nowrap"
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
            <div className="px-4 py-4 space-y-3 bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        {["Cheque No", "Lot", "Bank", "A/C Number", "Payment Doc", "Company", "Project", "Amount", "Reason", "Cancelled By", "Cancelled At"].map((h) => (
                          <th key={h} className="px-3 py-3 text-left whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cancelledList.map((r) => (
                        <tr key={r.CCId}>
                          <td className="px-3 py-3 font-heading tabular-nums font-semibold text-foreground align-middle">{r.ChequeNo}</td>
                          <td className="px-3 py-3 align-middle">{r.ChequeLotNumber ?? "—"}</td>
                          <td className="px-3 py-3 align-middle">{r.BankName ?? "—"}</td>
                          <td className="px-3 py-3 font-heading tabular-nums align-middle">{r.AccountNumber ?? "—"}</td>
                          {r.PaymentId == null ? (
                            <td className="px-3 py-3 align-middle text-muted-foreground italic" colSpan={4}>
                              Cancelled directly from cheque book — never issued against a payment
                            </td>
                          ) : (
                            <>
                              <td className="px-3 py-3 align-middle">{r.DocNo ?? "—"}</td>
                              <td className="px-3 py-3 align-middle">{r.PCompanyName ?? r.PCompany ?? "—"}</td>
                              <td className="px-3 py-3 align-middle">{r.PProject ?? "—"}</td>
                              <td className="px-3 py-3 font-heading tabular-nums font-semibold text-foreground align-middle whitespace-nowrap">{r.PAmount != null ? formatINR(r.PAmount) : "—"}</td>
                            </>
                          )}
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
      </SheetShell>
    </>
  );
}
