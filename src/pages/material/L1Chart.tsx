import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import * as qtApi from "@/api/quotationApi";
import { getSuppliers } from "@/api/purchaseOrdersApi";
import {
  BarChart3,
  ChevronDown,
  Plus,
  ShoppingCart,
  Trophy,
  RefreshCw,
  CheckCircle2,
  Clock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaterialShell } from "@/components/material/MaterialShell";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtAmt = (n: number) =>
  n > 0
    ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

export default function L1Chart() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [quotationId, setQuotationId] = useState<string>("");
  const [addSupplierId, setAddSupplierId] = useState("");
  const [winningSupplierId, setWinningSupplierId] = useState<string>("");

  const { data: quotations = [], isLoading: loadingQuotations } = useQuery({
    queryKey: ["l1-quotation-list"],
    queryFn: () => qtApi.getQuotations(),
    staleTime: 30_000,
  });

  const comparableQuotations = (quotations as qtApi.Quotation[]).filter((q) => q.Status !== "Draft");

  const { data: chart, isLoading: loadingChart } = useQuery({
    queryKey: ["l1-chart", quotationId],
    queryFn: () => qtApi.getL1ChartData(quotationId),
    enabled: Boolean(quotationId),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["l1-all-suppliers"],
    queryFn: getSuppliers,
    staleTime: 5 * 60_000,
  });

  const priceMap = useMemo(() => {
    const m: Record<string, { Rate: number; SupplyDate: string | null; Quality: string | null }> = {};
    for (const p of chart?.prices || []) m[`${p.QuotationItemId}:${p.SupplierLHeadId}`] = p;
    return m;
  }, [chart]);

  const l1BySupplierId = useMemo(() => {
    const m: Record<number, number | null> = {};
    for (const item of chart?.items || []) {
      let best: { supplierId: number; rate: number } | null = null;
      for (const s of chart?.suppliers || []) {
        const p = priceMap[`${item.QuotationItemId}:${s.SupplierLHeadId}`];
        if (p && p.Rate > 0 && (!best || p.Rate < best.rate))
          best = { supplierId: s.SupplierLHeadId, rate: p.Rate };
      }
      m[item.QuotationItemId] = best?.supplierId ?? null;
    }
    return m;
  }, [chart, priceMap]);

  const supplierTotals = useMemo(() => {
    const t: Record<number, number> = {};
    for (const s of chart?.suppliers || []) {
      let sum = 0;
      for (const item of chart?.items || [])
        sum += (priceMap[`${item.QuotationItemId}:${s.SupplierLHeadId}`]?.Rate || 0) * (item.Quantity || 0);
      t[s.SupplierLHeadId] = sum;
    }
    return t;
  }, [chart, priceMap]);

  const cheapestSupplierId = useMemo(() => {
    const submitted = (chart?.suppliers || []).filter((s) => s.Status === "Submitted");
    if (!submitted.length) return null;
    return submitted.reduce((best, s) =>
      (supplierTotals[s.SupplierLHeadId] ?? Infinity) < (supplierTotals[best.SupplierLHeadId] ?? Infinity) ? s : best
    ).SupplierLHeadId;
  }, [chart, supplierTotals]);

  const addSupplierMutation = useMutation({
    mutationFn: (id: string) => qtApi.addQuotationSuppliers(quotationId, [id]),
    onSuccess: () => {
      toast.success("Supplier added");
      queryClient.invalidateQueries({ queryKey: ["l1-chart", quotationId] });
      setAddSupplierId("");
    },
    onError: (err: any) => toast.error(err.message || "Failed to add supplier"),
  });

  const removeSupplierMutation = useMutation({
    mutationFn: (supplierId: number) => qtApi.removeQuotationSupplier(quotationId, supplierId),
    onSuccess: () => {
      toast.success("Supplier removed");
      queryClient.invalidateQueries({ queryKey: ["l1-chart", quotationId] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to remove supplier"),
  });

  const createPO = async () => {
    const supplierId = winningSupplierId || String(cheapestSupplierId || "");
    if (!supplierId) { toast.error("Select a winning supplier first"); return; }
    try {
      const prefill = await qtApi.getQTPOPrefill(quotationId, supplierId);
      navigate(`/material/purchase-order?sourceQT=${quotationId}&supplierId=${supplierId}`, {
        state: { qtPrefill: prefill },
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to prepare PO");
    }
  };

  const taggedSupplierIds = new Set((chart?.suppliers || []).map((s) => s.SupplierLHeadId));
  const submittedSuppliers = (chart?.suppliers || []).filter((s) => s.Status === "Submitted");
  const hasChart = chart && chart.suppliers.length > 0;

  const effectiveWinner = winningSupplierId
    ? chart?.suppliers.find((s) => String(s.SupplierLHeadId) === winningSupplierId)
    : chart?.suppliers.find((s) => s.SupplierLHeadId === cheapestSupplierId);

  return (
    <MaterialShell
      title="L1 Price Comparative Chart"
      subtitle="Side-by-side supplier price comparison — pick the winner and raise a PO"
      icon={BarChart3}
    >
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "L1 Chart" }]} />

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 bg-card border border-border rounded-xl px-4 py-3">
        {/* Quotation picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap shrink-0">
            Quotation
          </span>
          <div className="relative flex-1 min-w-0">
            <select
              value={quotationId}
              onChange={(e) => { setQuotationId(e.target.value); setWinningSupplierId(""); }}
              className={selectCls}
              disabled={loadingQuotations}
            >
              <option value="">
                {loadingQuotations ? "Loading…" : comparableQuotations.length === 0 ? "No sent quotations yet" : "Select quotation…"}
              </option>
              {comparableQuotations.map((q) => (
                <option key={q.QuotationId} value={String(q.QuotationId)}>
                  {q.DocNo} · {q.ProjectName ?? q.CompanyName} ({q.Status})
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Add supplier */}
        {quotationId && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap shrink-0">
              Add Supplier
            </span>
            <div className="relative flex-1 min-w-0">
              <select
                value={addSupplierId}
                onChange={(e) => setAddSupplierId(e.target.value)}
                className="text-sm rounded-lg border border-border px-3 py-2.5 pr-7 bg-background appearance-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 w-full"
              >
                <option value="">Select supplier…</option>
                {(suppliers as any[])
                  .filter((s) => !taggedSupplierIds.has(Number(s.LHeadId ?? s.id)))
                  .map((s) => (
                    <option key={s.LHeadId ?? s.id} value={String(s.LHeadId ?? s.id)}>
                      {s.LHeadName ?? s.label ?? s.name}
                    </option>
                  ))}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-1 bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 border-0 shrink-0 h-[42px] px-3"
              disabled={!addSupplierId || addSupplierMutation.isPending}
              onClick={() => addSupplierMutation.mutate(addSupplierId)}
            >
              <Plus size={13} /><span className="hidden sm:inline">Add</span>
            </Button>
          </div>
        )}
      </div>

      {/* ── No quotation selected ────────────────────────────────────────── */}
      {!quotationId && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <BarChart3 size={36} className="opacity-20" />
          <p className="text-sm">Select a quotation above to load the comparison chart.</p>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {quotationId && loadingChart && (
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading chart…</span>
        </div>
      )}

      {/* ── Chart ────────────────────────────────────────────────────────── */}
      {quotationId && !loadingChart && (
        <>
          {!hasChart ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <p className="text-sm">No suppliers tagged to this quotation yet.</p>
            </div>
          ) : (
            <>
              {/* Supplier pills */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Suppliers:</span>
                {chart!.suppliers.map((s) => (
                  <span
                    key={s.SupplierLHeadId}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                      s.SupplierLHeadId === cheapestSupplierId
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : s.Status === "Submitted"
                        ? "border-border bg-muted/40 text-foreground"
                        : "border-border bg-muted/20 text-muted-foreground"
                    }`}
                  >
                    {s.Status === "Submitted" ? (
                      <CheckCircle2 size={11} className={s.SupplierLHeadId === cheapestSupplierId ? "text-emerald-500" : "text-emerald-400"} />
                    ) : (
                      <Clock size={11} className="text-amber-400" />
                    )}
                    <span className="max-w-[120px] truncate">{s.SupplierName}</span>
                    {s.SupplierLHeadId === cheapestSupplierId && <Trophy size={10} className="text-amber-400 shrink-0" />}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove ${s.SupplierName} from this quotation?`))
                          removeSupplierMutation.mutate(s.SupplierLHeadId);
                      }}
                      disabled={removeSupplierMutation.isPending}
                      className="ml-0.5 hover:text-destructive transition-colors disabled:opacity-40 shrink-0"
                      title="Remove supplier"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>

              {/* Comparison table — horizontal scroll on mobile, sticky item column */}
              <div className="rounded-xl border border-border overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" } as any}>
                  <table className="text-sm border-collapse" style={{ minWidth: `${180 + 90 + chart!.suppliers.length * 140}px` }}>
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        {/* Sticky item header */}
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground sticky left-0 z-20 bg-muted/50 w-[150px] sm:w-[200px]">
                          Item
                        </th>
                        <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center whitespace-nowrap w-[80px]">
                          Qty
                        </th>
                        {chart!.suppliers.map((s) => (
                          <th
                            key={s.SupplierLHeadId}
                            className={`px-4 py-3 text-left w-[140px] ${
                              s.SupplierLHeadId === cheapestSupplierId ? "bg-emerald-500/[0.08]" : ""
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              {s.Status === "Submitted" ? (
                                <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                              ) : (
                                <Clock size={11} className="text-amber-400 shrink-0" />
                              )}
                              <span className={`text-[10px] font-semibold leading-tight ${s.SupplierLHeadId === cheapestSupplierId ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                                {s.SupplierName}
                              </span>
                              {s.SupplierLHeadId === cheapestSupplierId && (
                                <Trophy size={9} className="text-amber-400 shrink-0" />
                              )}
                            </div>
                            {supplierTotals[s.SupplierLHeadId] > 0 && (
                              <div className={`text-[10px] mt-0.5 font-semibold ${s.SupplierLHeadId === cheapestSupplierId ? "text-emerald-500" : "text-muted-foreground"}`}>
                                {fmtAmt(supplierTotals[s.SupplierLHeadId])}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {chart!.items.map((item, idx) => (
                        <tr
                          key={item.QuotationItemId}
                          className={`border-b border-border/40 last:border-0 ${idx % 2 === 0 ? "" : "bg-muted/[0.03]"}`}
                        >
                          {/* Sticky item name */}
                          <td className={`px-4 py-3 font-medium sticky left-0 z-10 text-xs sm:text-sm ${idx % 2 === 0 ? "bg-card" : "bg-muted/[0.03]"}`}>
                            <div className="max-w-[140px] sm:max-w-[190px] truncate" title={item.ItemName}>
                              {item.ItemName}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{item.UOMName || item.UOMCode}</div>
                          </td>
                          <td className="px-3 py-3 text-center text-xs text-muted-foreground whitespace-nowrap">
                            <span className="font-semibold text-foreground">{item.Quantity}</span>
                          </td>
                          {chart!.suppliers.map((s) => {
                            const p = priceMap[`${item.QuotationItemId}:${s.SupplierLHeadId}`];
                            const isL1 = l1BySupplierId[item.QuotationItemId] === s.SupplierLHeadId;
                            return (
                              <td
                                key={s.SupplierLHeadId}
                                className={`px-4 py-3 ${isL1 ? "bg-emerald-500/[0.07]" : ""}`}
                              >
                                {p ? (
                                  <div>
                                    <div className={`font-semibold flex items-center gap-1 text-xs sm:text-sm ${isL1 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                                      {isL1 && <Trophy size={9} className="text-amber-400 shrink-0" />}
                                      {fmtAmt(p.Rate)}
                                    </div>
                                    {p.SupplyDate && (
                                      <div className="text-[10px] text-muted-foreground mt-0.5">
                                        {fmtDate(p.SupplyDate)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/40 text-xs">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>

                    {/* Totals footer */}
                    <tfoot>
                      <tr className="bg-muted/60 border-t-2 border-border">
                        <td className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground sticky left-0 z-10 bg-muted/60">
                          Grand Total
                        </td>
                        <td />
                        {chart!.suppliers.map((s) => (
                          <td
                            key={s.SupplierLHeadId}
                            className={`px-4 py-3 ${s.SupplierLHeadId === cheapestSupplierId ? "bg-emerald-500/10" : ""}`}
                          >
                            <div className={`font-bold text-xs sm:text-sm ${s.SupplierLHeadId === cheapestSupplierId ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                              {fmtAmt(supplierTotals[s.SupplierLHeadId] ?? 0)}
                            </div>
                            {s.SupplierLHeadId === cheapestSupplierId && (
                              <div className="text-[10px] text-emerald-500 font-semibold flex items-center gap-0.5 mt-0.5">
                                <Trophy size={9} /> Lowest
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
              </div>

              {/* ── Award bar ──────────────────────────────────────────────── */}
              {submittedSuppliers.length > 0 && (
                <div className="flex flex-col gap-3 bg-card border border-border rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Trophy size={14} className="text-amber-400 shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Award to</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <select
                        value={winningSupplierId || String(cheapestSupplierId || "")}
                        onChange={(e) => setWinningSupplierId(e.target.value)}
                        className={selectCls}
                      >
                        <option value="">Select winner…</option>
                        {submittedSuppliers.map((s) => (
                          <option key={s.SupplierLHeadId} value={String(s.SupplierLHeadId)}>
                            {s.SupplierName}
                            {supplierTotals[s.SupplierLHeadId] > 0 ? ` — ${fmtAmt(supplierTotals[s.SupplierLHeadId])}` : ""}
                            {s.SupplierLHeadId === cheapestSupplierId ? " · Lowest" : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                    {effectiveWinner && (
                      <span className="text-xs text-muted-foreground hidden sm:block whitespace-nowrap shrink-0">
                        Total: <span className="font-semibold text-foreground">{fmtAmt(supplierTotals[effectiveWinner.SupplierLHeadId] ?? 0)}</span>
                      </span>
                    )}
                  </div>
                  {effectiveWinner && (
                    <div className="text-xs text-muted-foreground sm:hidden">
                      Total: <span className="font-semibold text-foreground">{fmtAmt(supplierTotals[effectiveWinner.SupplierLHeadId] ?? 0)}</span>
                    </div>
                  )}
                  <Button
                    type="button"
                    onClick={createPO}
                    className="gap-1.5 w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 border-0"
                  >
                    <ShoppingCart size={14} /> Create Purchase Order
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </MaterialShell>
  );
}
