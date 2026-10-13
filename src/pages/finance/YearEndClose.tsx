import React, { useEffect, useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { Lock, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";

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
const fmtDay = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const SEL = "w-full h-9 border border-foreground/40 bg-card px-2.5 text-xs text-foreground focus:outline-none focus:border-foreground";
const KEY = "h-9 px-4 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 transition-colors disabled:opacity-40";
const RULE = "1px solid hsl(var(--foreground))";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";

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
        <SheetShell eyebrow="CivilierERP · Finance" title="Year-end closing" subtitle="Close a financial year and carry its result forward.">
          <div className="bg-card py-16 px-4 text-center" style={{ border: RULE }}>
            <p className={HEAD}>Access restricted</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-2">
              Year-end closing is open to <strong>Admin</strong> and <strong>Accounts Head</strong> roles only.
              Contact your system administrator for access.
            </p>
          </div>
        </SheetShell>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Year-End Close"]} />
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Year-end closing"
        subtitle="Transfer the year's profit or loss to Retained Earnings and lock the financial year against further posting."
      >
        {/* ── Selector Bar ── */}
        <div className="bg-card px-4 py-4" style={{ border: RULE }}>
          <div className="flex flex-wrap items-end gap-4">
            {/* Company */}
            <div className="flex-1 min-w-[180px]">
              <label className={`${LBL} block mb-1`}>Company</label>
              <select
                className={SEL}
                value={companyId ?? ""}
                onChange={(e) => { setCompanyId(e.target.value ? Number(e.target.value) : null); setPreview(null); setResult(null); }}
              >
                <option value="">Select company</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            {/* Financial Year */}
            <div className="flex-1 min-w-[180px]">
              <label className={`${LBL} block mb-1`}>Financial year</label>
              <select
                className={SEL}
                value={fyId ?? ""}
                onChange={(e) => { setFyId(e.target.value ? Number(e.target.value) : null); setPreview(null); setResult(null); }}
              >
                <option value="">Select financial year</option>
                {finYears.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}{f.locked ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Refresh */}
            <button
              onClick={() => { loadPreview(); loadHistory(); }}
              disabled={!companyId || !fyId}
              className={`${KEY} border border-foreground text-foreground hover:bg-primary/10`}
            >
              <RefreshCw size={12} /> Load preview
            </button>

            {selectedFy && (
              <div className="h-9 flex items-center">
                <SheetMark text={selectedFy.locked ? "Closed and locked" : "Open"} tone={selectedFy.locked ? "done" : "waiting"} />
              </div>
            )}
          </div>
        </div>

        {/* ── Status Messages ── */}
        {previewError === "already_closed" && (
          <div className="flex items-center gap-2 px-4 py-3 border border-foreground text-foreground text-xs">
            <Lock size={14} className="shrink-0" />
            <span><strong>This financial year is already closed and locked.</strong> No further carry-forward is possible.</span>
          </div>
        )}

        {previewError && previewError !== "already_closed" && (
          <div className="px-4 py-3 border border-destructive text-destructive text-xs">{previewError}</div>
        )}

        {result && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border border-foreground text-foreground text-xs">
            <SheetMark text="Year closed" tone="done" />
            <span>
              Net {result.netProfit >= 0 ? "profit" : "loss"} of <strong className="font-heading tabular-nums">{fmt(result.netProfit)}</strong> transferred to Retained Earnings by voucher{" "}
              <strong className="font-heading tabular-nums">{result.voucherNo}</strong>. The financial year is locked.
            </span>
          </div>
        )}

        {resultError && (
          <div className="px-4 py-3 border border-destructive text-destructive text-xs">
            Carry-forward failed: {resultError === "already_processed" ? "This financial year has already been processed." : resultError}
          </div>
        )}

        {/* ── Preview Panel ── */}
        {previewLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Calculating the year's result…</span>
          </div>
        )}

        {preview && (
          <>
            {/* Figures */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow" style={{ padding: "16px 16px 18px" }}>
                {[
                  { label: "Total revenue", value: fmt(preview.totalIncome), note: `FY ${preview.fy.name}`, red: false },
                  { label: "Total expenses", value: fmt(preview.totalExpenses), note: `${fmtDay(preview.fy.startDate)} to ${fmtDay(preview.fy.endDate)}`, red: false },
                  { label: preview.isProfit ? "Net profit" : "Net loss", value: preview.isProfit ? fmt(preview.netProfit) : `(${fmt(preview.netProfit)})`, note: "carried to Retained Earnings", red: !preview.isProfit },
                ].map((x) => (
                  <div key={x.label}>
                    <p className="label" style={x.red ? { color: "var(--red)" } : undefined}>{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Closing Journal Preview */}
            <div className="bg-card overflow-hidden" style={{ border: RULE }}>
              <div className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
                <h3 className={HEAD}>Closing journal entry</h3>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">Voucher date {fmtDay(preview.fy.endDate)}</span>
              </div>
              <div className="px-4 py-3 overflow-x-auto">
                <table className="w-full text-xs min-w-[420px]">
                  <thead>
                    <tr>
                      <th className="pb-2 text-left">Particulars</th>
                      <th className="pb-2 text-right w-32">Debit ₹</th>
                      <th className="pb-2 text-right w-32">Credit ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-2.5 text-foreground font-medium">{preview.isProfit ? "Income Summary A/c" : "Retained Earnings A/c"}</td>
                      <td className="py-2.5 text-right font-heading tabular-nums font-semibold text-foreground">{fmt(preview.netProfit)}</td>
                      <td className="py-2.5 text-right text-muted-foreground/50">—</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pl-6 text-foreground">{preview.isProfit ? "To Retained Earnings" : "To Income Summary A/c"}</td>
                      <td className="py-2.5 text-right text-muted-foreground/50">—</td>
                      <td className="py-2.5 text-right font-heading tabular-nums font-semibold text-foreground">{fmt(preview.netProfit)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-3 text-[0.6875rem] text-muted-foreground">
                  (Being transfer of net {preview.isProfit ? "profit" : "loss"} for FY {preview.fy.name} to Retained Earnings under Reserves &amp; Surplus)
                </p>
              </div>
            </div>

            {/* Heads Summary (collapsible) */}
            {preview.headsSummary.length > 0 && (
              <div className="bg-card overflow-hidden" style={{ border: RULE }}>
                <button
                  onClick={() => setExpandedHeads((v) => !v)}
                  aria-expanded={expandedHeads}
                  className="w-full px-4 py-3 flex items-center justify-between text-foreground"
                >
                  <span className="flex items-baseline gap-2.5">
                    <span className={HEAD}>Revenue and expense heads</span>
                    <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{preview.headsSummary.length}</span>
                  </span>
                  {expandedHeads ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedHeads && (
                  <div className="px-4 pb-3 max-h-72 overflow-y-auto" style={{ borderTop: RULE }}>
                    <table className="w-full text-[0.6875rem]">
                      <thead>
                        <tr>
                          <th className="py-2 text-left">Group</th>
                          <th className="py-2 text-left">Head</th>
                          <th className="py-2 text-right w-32">Amount ₹</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.headsSummary.map((h, i) => (
                          <tr key={i}>
                            <td className="py-2 text-muted-foreground">{h.groupName}</td>
                            <td className="py-2 text-foreground">{h.headName}</td>
                            <td className="py-2 text-right font-heading tabular-nums text-foreground">{fmt(h.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Execute: the one irreversible act on the page, so the one place red is used for a control */}
            {!selectedFy?.locked && !result && (
              <div className="flex justify-end">
                {!showConfirm ? (
                  <button onClick={() => setShowConfirm(true)} className={`${KEY} border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground`}>
                    <Lock size={13} />
                    Close and lock the year
                  </button>
                ) : (
                  <div className="w-full flex flex-wrap items-center gap-4 p-4 border-2 border-destructive bg-card">
                    <div className="flex-1 min-w-[240px]">
                      <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-destructive">Confirm year-end closing</p>
                      <p className="text-xs text-foreground mt-1.5 leading-relaxed">
                        This posts the closing journal entry and <strong>permanently locks</strong> FY {preview.fy.name}. Nothing more can be posted to this period, and it cannot be undone.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setShowConfirm(false)} className={`${KEY} border border-foreground text-foreground hover:bg-primary/10`}>
                        Cancel
                      </button>
                      <button onClick={doCarryForward} disabled={executing} className={`${KEY} bg-destructive text-destructive-foreground border border-destructive hover:opacity-90`}>
                        {executing ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                        {executing ? "Processing…" : "Confirm and lock"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── No data message ── */}
        {!previewLoading && !preview && !previewError && companyId && fyId && (
          <div className="bg-card py-14 px-4 text-center text-xs text-muted-foreground" style={{ border: "1px dashed hsl(var(--border))" }}>
            Press "Load preview" to see the year-end closing summary.
          </div>
        )}

        {!companyId || !fyId ? (
          <div className="bg-card py-14 px-4 text-center text-xs text-muted-foreground" style={{ border: "1px dashed hsl(var(--border))" }}>
            Select a company and a financial year to begin.
          </div>
        ) : null}

        {/* ── History Section ── */}
        {companyId && history.length > 0 && (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <div className="px-4 py-3 flex items-baseline gap-2.5" style={{ borderBottom: RULE }}>
              <h3 className={HEAD}>Years closed so far</h3>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{history.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr>
                    <th className="py-2.5 px-4 text-left">Voucher / head</th>
                    <th className="py-2.5 px-4 text-right w-36">Date / debit ₹</th>
                    <th className="py-2.5 px-4 text-right w-36">Lines / credit ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <React.Fragment key={h.voucherNo}>
                      <tr className="cursor-pointer" onClick={() => setExpandedHistory((v) => v === h.voucherNo ? null : h.voucherNo)}>
                        <td className="py-2.5 px-4 text-foreground">
                          <div className="flex items-center gap-1.5">
                            {expandedHistory === h.voucherNo ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <span className="font-heading text-[0.6875rem] font-semibold tabular-nums">{h.voucherNo}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{fmtDay(h.voucherDate)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{h.details.length} lines</td>
                      </tr>
                      {expandedHistory === h.voucherNo && h.details.map((d, i) => (
                        <tr key={`${h.voucherNo}-${i}`}>
                          <td className="py-2 pl-10 pr-4 text-[0.6875rem] text-foreground">{d.headName}</td>
                          <td className="py-2 px-4 text-right font-heading tabular-nums text-[0.6875rem] text-foreground">{d.debit > 0 ? fmt(d.debit) : "—"}</td>
                          <td className="py-2 px-4 text-right font-heading tabular-nums text-[0.6875rem] text-foreground">{d.credit > 0 ? fmt(d.credit) : "—"}</td>
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
          <div className="flex items-center justify-center py-6">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
            <span className="ml-2 text-[0.6875rem] text-muted-foreground">Loading history…</span>
          </div>
        )}

      </SheetShell>
    </>
  );
}
