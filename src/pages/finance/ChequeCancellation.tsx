/**
 * ChequeCancellation.tsx — Finance → Transaction → Cheque Cancellation
 *
 * Search a payment by its cheque number, review the full payment document,
 * and cancel that cheque (single or bulk). See backend/routes/chequeCancellation.js
 * for the cancellation semantics (permanent block on reissue, badge flag, etc).
 */

import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { ExportMenu } from "@/components/ExportMenu";
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
  Hash,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Layers,
  FileText,
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
  { header: "Reason", accessor: "Reason" },
  { header: "Cancelled By", accessor: "CancelledBy" },
  { header: "Cancelled At", accessor: (r) => fmt(r.CancelledAt as string) },
];

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
        {/* ── Single Search ─────────────────────────────────────────────────── */}
        <div className="glass rounded-xl p-4 ring-1 ring-border/60 space-y-4">
          <p className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Search size={12} /> Search by Cheque Number
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Hash size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={chequeNo}
                onChange={(e) => setChequeNo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Enter cheque number..."
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={runSearch}
              disabled={searching}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
            </button>
          </div>

          {searched && results.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <AlertTriangle size={14} /> No payment entry found for this cheque number.
            </div>
          )}

          {results.map((row) => (
            <div key={row.PPaymentID} className="rounded-xl border border-border overflow-hidden">
              {/* Bank / lot summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-muted/20">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Bank Name</p>
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Landmark size={11} className="text-primary/70" />{row.BankName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Bank Account Number</p>
                  <p className="text-xs font-semibold font-mono text-foreground">{row.PChequeAccountNumber ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Lot Number</p>
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Layers size={11} className="text-amber-500" />{row.LotNumber ?? row.PChequeLotNumber ?? "—"}</p>
                </div>
              </div>

              {/* Payment document details */}
              <div className="p-4 border-t border-border space-y-2">
                <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <FileText size={11} /> Payment Document
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    <div key={f.label} className="px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{f.label}</p>
                      <p className="text-xs font-semibold text-foreground truncate">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  {row.PIsChequeCancelled ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">
                      <Ban size={11} /> Cancelled Cheque
                    </span>
                  ) : (
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for cancellation (optional)"
                      className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 flex-1 max-w-xs"
                    />
                  )}
                  {!row.PIsChequeCancelled && rights.canCreate && (
                    <button
                      onClick={() => handleCancel(row)}
                      disabled={cancellingId === row.PPaymentID}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50 transition-all"
                    >
                      {cancellingId === row.PPaymentID ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Ban size={12} />
                      )}
                      Cancel Cheque
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Bulk Cancellation ─────────────────────────────────────────────── */}
        <div className="glass rounded-xl p-4 ring-1 ring-border/60 space-y-4">
          <p className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Layers size={12} /> Bulk Cheque Cancellation
          </p>
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder="Enter multiple cheque numbers — one per line, or separated by commas/spaces"
            rows={2}
            className="w-full max-w-md px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
          <button
            onClick={runBulkSearch}
            disabled={bulkSearching}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {bulkSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Check Cheque Numbers
          </button>

          {bulkResults.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2 text-left font-heading uppercase tracking-widest text-[10px] text-muted-foreground">Cheque No</th>
                    <th className="px-3 py-2 text-left font-heading uppercase tracking-widest text-[10px] text-muted-foreground">Payment Doc</th>
                    <th className="px-3 py-2 text-left font-heading uppercase tracking-widest text-[10px] text-muted-foreground">Amount</th>
                    <th className="px-3 py-2 text-left font-heading uppercase tracking-widest text-[10px] text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkResults.map((r) => (
                    <tr key={r.chequeNo} className="border-t border-border/50">
                      <td className="px-3 py-2 font-mono">{r.chequeNo}</td>
                      <td className="px-3 py-2">{r.payment?.DocNo ?? "—"}</td>
                      <td className="px-3 py-2">{r.payment ? formatINR(r.payment.PAmount) : "—"}</td>
                      <td className="px-3 py-2">
                        {!r.found ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <XCircle size={11} /> No matching payment entry
                          </span>
                        ) : r.alreadyCancelled ? (
                          <span className="inline-flex items-center gap-1 text-rose-500">
                            <Ban size={11} /> Already cancelled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 size={11} /> Ready to cancel
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-col sm:flex-row items-center gap-2 p-3 border-t border-border bg-muted/10">
                <input
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value)}
                  placeholder="Reason for bulk cancellation (optional)"
                  className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 flex-1"
                />
                {rights.canCreate && (
                  <button
                    onClick={runBulkCancel}
                    disabled={bulkCancelling || !validBulkEntries.length}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50 transition-all whitespace-nowrap"
                  >
                    {bulkCancelling ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                    Cancel {validBulkEntries.length} Valid Entr{validBulkEntries.length === 1 ? "y" : "ies"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Cancelled Cheques list ────────────────────────────────────────── */}
        <div className="glass rounded-xl p-4 ring-1 ring-border/60 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Ban size={12} /> Cancelled Cheques
              <span className="ml-1 text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full normal-case tracking-normal font-normal">
                {cancelledList.length} records
              </span>
            </p>
            <div className="flex items-center gap-2">
              <input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadCancelled()}
                placeholder="Search cheque no, lot, bank, doc no..."
                className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <ExportMenu
                data={cancelledList as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Cancelled Cheques"
                filename="cancelled-cheques"
                disabled={loadingList || !cancelledList.length || !rights.canExport}
              />
            </div>
          </div>

          {loadingList ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : cancelledList.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">No cheques have been cancelled yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30">
                    {["Cheque No", "Lot", "Bank", "A/C Number", "Payment Doc", "Amount", "Reason", "Cancelled By", "Cancelled At"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left font-heading uppercase tracking-widest text-[10px] text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cancelledList.map((r) => (
                    <tr key={r.CCId} className="border-t border-border/50 hover:bg-muted/10">
                      <td className="px-3 py-2 font-mono">{r.ChequeNo}</td>
                      <td className="px-3 py-2">{r.ChequeLotNumber ?? "—"}</td>
                      <td className="px-3 py-2">{r.BankName ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{r.AccountNumber ?? "—"}</td>
                      <td className="px-3 py-2">{r.DocNo ?? "—"}</td>
                      <td className="px-3 py-2">{r.PAmount != null ? formatINR(r.PAmount) : "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.Reason ?? "—"}</td>
                      <td className="px-3 py-2">{r.CancelledBy ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(r.CancelledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FinanceShell>
    </>
  );
}
