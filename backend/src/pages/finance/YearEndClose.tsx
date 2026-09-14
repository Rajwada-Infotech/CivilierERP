import React, { useEffect, useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import {
  Lock,
  Unlock,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Building,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  ArrowRightLeft,
  ShieldCheck,
  History,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Option { id: number; label: string; }
interface HeadSummary { groupName: string; headName: string; amount: number; }
interface PreviewData {
  fy: { id: number; name: string; startDate: string; endDate: string };
  companyId: number;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  isProfit: boolean;
  headsSummary: HeadSummary[];
}
interface HistoryEntry {
  voucherNo: string;
  voucherDate: string;
  fyId: number;
  details: { headName: string; debit: number; credit: number }[];
}

const fmt = (n: number) => formatINR(Math.abs(n));

// Allowed roles for carry-forward
const ALLOWED_ROLES = new Set(["super_admin", "admin", "dba", "accounts_head"]);

// ─── Main Component ──────────────────────────────────────────────────────────

export default function YearEndClose() {
  const rights = usePageRights("year-end-close");
  const { currentUser } = useAuth();
  const userRole = currentUser?.role ?? "";
  const canExecute = ALLOWED_ROLES.has(userRole);

  // ── Dropdowns ──
  const [companies, setCompanies] = useState<Option[]>([]);
  const [finYears, setFinYears]   = useState<{ id: number; label: string; locked: boolean }[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [fyId, setFyId]           = useState<number | null>(null);

  // ── Data states ──
  const [preview, setPreview]           = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [history, setHistory]             = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [executing, setExecuting]         = useState(false);
  const [result, setResult]               = useState<{ success: boolean; netProfit: number; voucherNo: string } | null>(null);
  const [resultError, setResultError]     = useState<string | null>(null);

  const [showConfirm, setShowConfirm]     = useState(false);
  const [expandedHeads, setExpandedHeads] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  // ── Load dropdowns ──
  useEffect(() => {
    fetchWithAuth("/api/enterprises/options?business_type=C")
      .then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/fin-year?all=true")
      .then((r) => r.json()).then((d) => {
        if (Array.isArray(d)) {
          setFinYears(d.map((fy: any) => ({
            id: fy.FId,
            label: fy.FName || `${fy.FStartDate} – ${fy.FEndDate}`,
            locked: !!fy.FisLocked,
          })));
        }
      }).catch(() => {});
  }, []);

  // ── Load preview ──
  const loadPreview = useCallback(() => {
    if (!companyId || !fyId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    setResultError(null);
    fetchWithAuth(`/api/year-end-close/preview?companyId=${companyId}&financialYearId=${fyId}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error || `HTTP ${r.status}`); });
        return r.json();
      })
      .then((d) => setPreview(d))
      .catch((e) => setPreviewError(e.message))
      .finally(() => setPreviewLoading(false));
  }, [companyId, fyId]);

  // ── Load history ──
  const loadHistory = useCallback(() => {
    if (!companyId) return;
    setHistoryLoading(true);
    fetchWithAuth(`/api/year-end-close/history?companyId=${companyId}`)
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [companyId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Execute carry-forward ──
  const doCarryForward = async () => {
    if (!companyId || !fyId) return;
    setExecuting(true);
    setResultError(null);
    setResult(null);
    try {
      const r = await fetchWithAuth("/api/year-end-close/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, financialYearId: fyId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setResult(d);
      setShowConfirm(false);
      // Refresh data
      loadPreview();
      loadHistory();
      // Refresh FY list to show locked status
      fetchWithAuth("/api/fin-year?all=true")
        .then((r2) => r2.json())
        .then((d2) => {
          if (Array.isArray(d2)) {
            setFinYears(d2.map((fy: any) => ({
              id: fy.FId,
              label: fy.FName || `${fy.FStartDate} – ${fy.FEndDate}`,
              locked: !!fy.FisLocked,
            })));
          }
        }).catch(() => {});
    } catch (e: any) {
      setResultError(e.message);
    } finally {
      setExecuting(false);
    }
  };

  const selectedFy = finYears.find((f) => f.id === fyId);

  if (!canExecute) {
    return (
      <>
        <Breadcrumbs items={["Dashboard", "Finance", "Year-End Close"]} />
        <FinanceShell title="Year-End Closing" subtitle="Financial Year Carry Forward" icon={Lock}>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldCheck size={48} className="text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">Access Restricted</h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              Year-End Closing is restricted to <strong>Admin</strong> and <strong>Accounts Head</strong> roles only.
              Contact your system administrator for access.
            </p>
          </div>
        </FinanceShell>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Year-End Close"]} />
      <FinanceShell
        title="Year-End Closing"
        subtitle="Close Financial Year · Transfer P&L to Retained Earnings · Lock Period"
        icon={Lock}
      >
        {/* ── Selector Bar ── */}
        <div className="mb-5 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Company */}
            <div className="flex-1 min-w-[180px]">
              <label className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-widest text-muted-foreground/70 mb-1.5">
                <Building size={10} /> Company
              </label>
              <select
                className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary/40 transition-all"
                value={companyId ?? ""}
                onChange={(e) => { setCompanyId(e.target.value ? Number(e.target.value) : null); setPreview(null); setResult(null); }}
              >
                <option value="">— Select Company —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            {/* Financial Year */}
            <div className="flex-1 min-w-[180px]">
              <label className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-widest text-muted-foreground/70 mb-1.5">
                <CalendarDays size={10} /> Financial Year
              </label>
              <select
                className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary/40 transition-all"
                value={fyId ?? ""}
                onChange={(e) => { setFyId(e.target.value ? Number(e.target.value) : null); setPreview(null); setResult(null); }}
              >
                <option value="">— Select FY —</option>
                {finYears.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} {f.locked ? " 🔒 (Closed)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Refresh */}
            <button
              onClick={() => { loadPreview(); loadHistory(); }}
              disabled={!companyId || !fyId}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-medium flex items-center gap-1.5 hover:bg-muted transition-all disabled:opacity-40"
            >
              <RefreshCw size={12} /> Load Preview
            </button>
          </div>
        </div>

        {/* ── Status Messages ── */}
        {previewError === "already_closed" && (
          <div className="mb-5 flex items-center gap-2 px-4 py-3 rounded-lg border bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
            <Lock size={14} />
            <span><strong>This Financial Year is already closed and locked.</strong> No further carry-forward is possible.</span>
          </div>
        )}

        {previewError && previewError !== "already_closed" && (
          <div className="mb-5 flex items-center gap-2 px-4 py-3 rounded-lg border bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400 text-xs">
            <AlertTriangle size={14} />
            <span>{previewError}</span>
          </div>
        )}

        {result && (
          <div className="mb-5 flex items-center gap-2 px-4 py-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
            <CheckCircle2 size={14} />
            <span>
              Year-End Closing completed successfully! Net {result.netProfit >= 0 ? "Profit" : "Loss"}: {fmt(result.netProfit)} transferred to Retained Earnings.
              Voucher: <code className="bg-background/60 px-1.5 py-0.5 rounded text-[10px]">{result.voucherNo}</code>. Financial Year locked.
            </span>
          </div>
        )}

        {resultError && (
          <div className="mb-5 flex items-center gap-2 px-4 py-3 rounded-lg border bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400 text-xs">
            <AlertTriangle size={14} />
            <span>Carry-forward failed: {resultError === "already_processed" ? "This FY has already been processed." : resultError}</span>
          </div>
        )}

        {/* ── Preview Panel ── */}
        {previewLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary/60" />
            <span className="ml-2 text-xs text-muted-foreground">Calculating P&L summary…</span>
          </div>
        )}

        {preview && (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/8 to-primary/3 p-4">
                <p className="text-[9px] font-heading uppercase tracking-widest text-primary/60 mb-1">Total Revenue</p>
                <p className="text-lg font-bold tabular-nums text-primary tracking-tight">{fmt(preview.totalIncome)}</p>
              </div>
              <div className="rounded-xl border border-orange-500/20 bg-gradient-to-br from-orange-500/8 to-orange-500/3 p-4">
                <p className="text-[9px] font-heading uppercase tracking-widest text-orange-600/60 dark:text-orange-400/60 mb-1">Total Expenses</p>
                <p className="text-lg font-bold tabular-nums text-orange-700 dark:text-orange-400 tracking-tight">{fmt(preview.totalExpenses)}</p>
              </div>
              <div className={`rounded-xl border p-4 ${
                preview.isProfit
                  ? "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-emerald-500/3"
                  : "border-red-500/20 bg-gradient-to-br from-red-500/10 to-red-500/3"
              }`}>
                <p className={`text-[9px] font-heading uppercase tracking-widest mb-1 ${
                  preview.isProfit ? "text-emerald-600/60 dark:text-emerald-400/60" : "text-red-600/60 dark:text-red-400/60"
                }`}>
                  Net {preview.isProfit ? "Profit" : "Loss"}
                </p>
                <div className="flex items-center gap-2">
                  {preview.isProfit ? <TrendingUp size={16} className="text-emerald-500" /> : <TrendingDown size={16} className="text-red-500" />}
                  <p className={`text-lg font-bold tabular-nums tracking-tight ${
                    preview.isProfit ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
                  }`}>
                    {fmt(preview.netProfit)}
                  </p>
                </div>
              </div>
            </div>

            {/* Closing Journal Preview */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft size={13} className="text-primary/60" />
                    <h3 className="text-xs font-semibold text-foreground">Closing Journal Entry Preview</h3>
                  </div>
                  <span className="text-[9px] text-muted-foreground/60 tabular-nums">
                    Voucher Date: {new Date(preview.fy.endDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>
              <div className="px-5 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="pb-2 text-left text-[9px] font-heading uppercase tracking-widest text-muted-foreground">Particulars</th>
                      <th className="pb-2 text-right text-[9px] font-heading uppercase tracking-widest text-muted-foreground w-28">Debit ₹</th>
                      <th className="pb-2 text-right text-[9px] font-heading uppercase tracking-widest text-muted-foreground w-28">Credit ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.isProfit ? (
                      <>
                        <tr className="border-b border-border/25">
                          <td className="py-2 text-foreground">Income Summary A/c</td>
                          <td className="py-2 text-right tabular-nums font-medium text-foreground">{fmt(preview.netProfit)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">—</td>
                        </tr>
                        <tr className="border-b border-border/25">
                          <td className="py-2 pl-6 text-foreground italic">To Retained Earnings</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">—</td>
                          <td className="py-2 text-right tabular-nums font-medium text-foreground">{fmt(preview.netProfit)}</td>
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr className="border-b border-border/25">
                          <td className="py-2 text-foreground">Retained Earnings A/c</td>
                          <td className="py-2 text-right tabular-nums font-medium text-red-600 dark:text-red-400">{fmt(Math.abs(preview.netProfit))}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">—</td>
                        </tr>
                        <tr className="border-b border-border/25">
                          <td className="py-2 pl-6 text-foreground italic">To Income Summary A/c</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">—</td>
                          <td className="py-2 text-right tabular-nums font-medium text-red-600 dark:text-red-400">{fmt(Math.abs(preview.netProfit))}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
                <p className="mt-2 text-[9px] text-muted-foreground/60 italic">
                  (Being transfer of Net {preview.isProfit ? "Profit" : "Loss"} for FY {preview.fy.name} to Retained Earnings under Reserves & Surplus)
                </p>
              </div>
            </div>

            {/* Heads Summary (collapsible) */}
            {preview.headsSummary.length > 0 && (
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedHeads((v) => !v)}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Info size={13} className="text-muted-foreground/60" />
                    <span className="text-xs font-semibold text-foreground">Revenue & Expense Heads ({preview.headsSummary.length})</span>
                  </div>
                  {expandedHeads ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedHeads && (
                  <div className="px-5 pb-3 max-h-64 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="pb-1.5 text-left text-[9px] font-heading uppercase tracking-widest text-muted-foreground">Group</th>
                          <th className="pb-1.5 text-left text-[9px] font-heading uppercase tracking-widest text-muted-foreground">Head</th>
                          <th className="pb-1.5 text-right text-[9px] font-heading uppercase tracking-widest text-muted-foreground w-24">Amount ₹</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.headsSummary.map((h, i) => (
                          <tr key={i} className="border-b border-border/15 hover:bg-muted/10">
                            <td className="py-1.5 text-muted-foreground">{h.groupName}</td>
                            <td className="py-1.5 text-foreground">{h.headName}</td>
                            <td className="py-1.5 text-right tabular-nums">{fmt(h.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Execute Button */}
            {!selectedFy?.locked && !result && (
              <div className="flex justify-end">
                {!showConfirm ? (
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="h-10 px-6 rounded-lg bg-gradient-to-r from-red-600 to-red-700 text-white text-xs font-semibold shadow-md hover:shadow-lg hover:from-red-700 hover:to-red-800 transition-all flex items-center gap-2"
                  >
                    <Lock size={14} />
                    Execute Year-End Carry Forward
                  </button>
                ) : (
                  <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-red-500/30 bg-red-500/5">
                    <AlertTriangle size={20} className="text-red-600 dark:text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400">Confirm Year-End Closing</p>
                      <p className="text-[10px] text-red-600/70 dark:text-red-400/70 mt-0.5">
                        This will post a closing journal entry and <strong>permanently lock</strong> FY {preview.fy.name}. No further transactions can be posted to this period. This action cannot be undone.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowConfirm(false)}
                        className="h-8 px-4 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={doCarryForward}
                        disabled={executing}
                        className="h-8 px-5 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {executing ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                        {executing ? "Processing…" : "Confirm & Lock"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── No data message ── */}
        {!previewLoading && !preview && !previewError && companyId && fyId && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Unlock size={32} className="text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground">Click "Load Preview" to see the year-end closing summary.</p>
          </div>
        )}

        {!companyId || !fyId ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays size={32} className="text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground">Select a Company and Financial Year to begin.</p>
          </div>
        ) : null}

        {/* ── History Section ── */}
        {companyId && history.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <History size={14} className="text-muted-foreground/60" />
              <h3 className="text-xs font-semibold text-foreground">Carry-Forward History</h3>
            </div>
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="py-2.5 px-4 text-left text-[9px] font-heading uppercase tracking-widest text-muted-foreground">Voucher No.</th>
                    <th className="py-2.5 px-4 text-left text-[9px] font-heading uppercase tracking-widest text-muted-foreground">Date</th>
                    <th className="py-2.5 px-4 text-left text-[9px] font-heading uppercase tracking-widest text-muted-foreground">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <React.Fragment key={h.voucherNo}>
                      <tr
                        className="border-b border-border/25 hover:bg-muted/15 transition-colors cursor-pointer"
                        onClick={() => setExpandedHistory((v) => v === h.voucherNo ? null : h.voucherNo)}
                      >
                        <td className="py-2 px-4 font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            {expandedHistory === h.voucherNo ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <code className="text-[10px]">{h.voucherNo}</code>
                          </div>
                        </td>
                        <td className="py-2 px-4 tabular-nums text-muted-foreground">
                          {new Date(h.voucherDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {h.details.length} entries
                        </td>
                      </tr>
                      {expandedHistory === h.voucherNo && h.details.map((d, i) => (
                        <tr key={`${h.voucherNo}-${i}`} className="bg-muted/5 border-b border-border/10">
                          <td className="py-1.5 pl-12 text-[10px] text-foreground/80">{d.headName}</td>
                          <td className="py-1.5 px-4 text-right tabular-nums text-[10px]">
                            {d.debit > 0 ? fmt(d.debit) : "—"}
                          </td>
                          <td className="py-1.5 px-4 text-right tabular-nums text-[10px]">
                            {d.credit > 0 ? fmt(d.credit) : "—"}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {historyLoading && (
          <div className="mt-6 flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-muted-foreground/40" />
            <span className="ml-2 text-[10px] text-muted-foreground">Loading history…</span>
          </div>
        )}

      </FinanceShell>
    </>
  );
}
