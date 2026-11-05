import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import * as qtApi from "@/api/quotationApi";
import { getSuppliers } from "@/api/purchaseOrdersApi";
import { ChevronDown, Plus, ShoppingCart, RefreshCw, X } from "lucide-react";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageRights } from "@/hooks/usePageRights";

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtAmt = (n: number) =>
  n > 0 ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

// Sheet styles
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const SEL = "w-full px-3 py-2.5 pr-8 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground appearance-none disabled:opacity-60";
const TAG = "inline-flex items-center font-heading text-[0.5rem] font-bold uppercase tracking-[0.1em] px-1 py-px border whitespace-nowrap";
const TH = "px-4 py-3 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

export default function L1Chart() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Adding / removing suppliers is a quotation edit; awarding raises a purchase order.
  const qtRights = usePageRights("quotation");
  const poRights = usePageRights("purchase-orders");
  const [quotationId, setQuotationId] = useState<string>("");
  const [addSupplierId, setAddSupplierId] = useState("");
  const [winningSupplierId, setWinningSupplierId] = useState<string>("");
  const [removing, setRemoving] = useState<{ id: number; name: string; submitted: boolean } | null>(null);

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
        if (p && p.Rate > 0 && (!best || p.Rate < best.rate)) best = { supplierId: s.SupplierLHeadId, rate: p.Rate };
      }
      m[item.QuotationItemId] = best?.supplierId ?? null;
    }
    return m;
  }, [chart, priceMap]);

  // Each supplier's total and how many of the items they priced.
  const { supplierTotals, quotedCount } = useMemo(() => {
    const t: Record<number, number> = {};
    const q: Record<number, number> = {};
    for (const s of chart?.suppliers || []) {
      let sum = 0;
      let n = 0;
      for (const item of chart?.items || []) {
        const rate = priceMap[`${item.QuotationItemId}:${s.SupplierLHeadId}`]?.Rate || 0;
        if (rate > 0) n++;
        sum += rate * (item.Quantity || 0);
      }
      t[s.SupplierLHeadId] = sum;
      q[s.SupplierLHeadId] = n;
    }
    return { supplierTotals: t, quotedCount: q };
  }, [chart, priceMap]);

  const itemCount = chart?.items.length ?? 0;
  const isComplete = (id: number) => itemCount > 0 && quotedCount[id] === itemCount;

  // Lowest overall is only among suppliers who priced every item — a partial quote's
  // total is low because it leaves items out, not because it is cheaper.
  const cheapestSupplierId = useMemo(() => {
    const complete = (chart?.suppliers || []).filter((s) => s.Status === "Submitted" && isComplete(s.SupplierLHeadId));
    if (!complete.length) return null;
    return complete.reduce((best, s) => (supplierTotals[s.SupplierLHeadId] < supplierTotals[best.SupplierLHeadId] ? s : best)).SupplierLHeadId;
  }, [chart, supplierTotals, quotedCount]); // eslint-disable-line react-hooks/exhaustive-deps

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
    onSuccess: (_d, supplierId) => {
      toast.success("Supplier removed");
      if (winningSupplierId === String(supplierId)) setWinningSupplierId("");
      queryClient.invalidateQueries({ queryKey: ["l1-chart", quotationId] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to remove supplier"),
  });

  const createPO = async () => {
    const supplierId = winningSupplierId || String(cheapestSupplierId || "");
    if (!supplierId) {
      toast.error("Select a winning supplier first");
      return;
    }
    try {
      const prefill = await qtApi.getQTPOPrefill(quotationId, supplierId);
      navigate(`/material/purchase-order?sourceQT=${quotationId}&supplierId=${supplierId}`, { state: { qtPrefill: prefill } });
    } catch (err: any) {
      toast.error(err.message || "Failed to prepare PO");
    }
  };

  const taggedSupplierIds = new Set((chart?.suppliers || []).map((s) => s.SupplierLHeadId));
  const submittedSuppliers = (chart?.suppliers || []).filter((s) => s.Status === "Submitted");
  const hasChart = chart && chart.suppliers.length > 0;
  const selected = comparableQuotations.find((q) => String(q.QuotationId) === quotationId);

  const effectiveWinner = winningSupplierId
    ? chart?.suppliers.find((s) => String(s.SupplierLHeadId) === winningSupplierId)
    : chart?.suppliers.find((s) => s.SupplierLHeadId === cheapestSupplierId);

  return (
    <>
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "L1 Chart" }]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="L1 comparative chart"
        subtitle="Supplier prices side by side, the lowest (L1) on each item marked; pick the winner and raise a purchase order."
      >
        {/* ── Quotation + suppliers ── */}
        <div className="bg-card mb-5" style={{ border: RULE }}>
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className={`block ${LBL} mb-1.5`}>Quotation</label>
              <div className="relative">
                <select
                  value={quotationId}
                  onChange={(e) => {
                    setQuotationId(e.target.value);
                    setWinningSupplierId("");
                  }}
                  disabled={loadingQuotations}
                  className={`${SEL} font-heading`}
                >
                  <option value="">
                    {loadingQuotations ? "Loading quotations…" : comparableQuotations.length === 0 ? "No sent quotations found" : "— Pick a quotation —"}
                  </option>
                  {comparableQuotations.map((q) => (
                    <option key={q.QuotationId} value={String(q.QuotationId)}>
                      {q.DocNo} · {q.ProjectName ?? q.CompanyName} [{q.Status}]
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              {selected && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">{selected.ProjectName ?? selected.CompanyName}</span>
                  <SheetMark text={selected.Status} tone={statusTone(selected.Status)} />
                  {selected.DueDate && <span className="text-xs text-muted-foreground">· due {fmtDate(selected.DueDate)}</span>}
                </div>
              )}
            </div>

            {quotationId && qtRights.canEdit && (
              <div>
                <label className={`block ${LBL} mb-1.5`}>Add supplier</label>
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1 min-w-0">
                    <SearchableNativeSelect value={addSupplierId} onChange={(e) => setAddSupplierId(e.target.value)} className={SEL}>
                      <option value="">Select supplier…</option>
                      {(suppliers as any[])
                        .filter((s) => !taggedSupplierIds.has(Number(s.LHeadId ?? s.id)))
                        .map((s) => (
                          <option key={s.LHeadId ?? s.id} value={String(s.LHeadId ?? s.id)}>
                            {s.LHeadName ?? s.label ?? s.name}
                          </option>
                        ))}
                    </SearchableNativeSelect>
                  </div>
                  <button
                    type="button"
                    className={`${KEY_INK} px-4 shrink-0`}
                    disabled={!addSupplierId || addSupplierMutation.isPending}
                    onClick={() => addSupplierMutation.mutate(addSupplierId)}
                  >
                    <Plus size={13} />
                    <span className="hidden sm:inline">Add</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {!quotationId && (
          <div className="bg-card py-20 text-center text-sm text-muted-foreground" style={{ border: RULE }}>
            Pick a quotation above to load its comparison.
          </div>
        )}

        {quotationId && loadingChart && (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Loading chart…</span>
          </div>
        )}

        {quotationId && !loadingChart && !hasChart && (
          <div className="bg-card py-20 text-center text-sm text-muted-foreground" style={{ border: RULE }}>
            No suppliers tagged to this quotation yet.
          </div>
        )}

        {quotationId && !loadingChart && hasChart && (
          <div className="space-y-5">
            {/* ── Comparison ── */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: RULE }}>
                <h3 className={HEAD}>
                  Comparison <span className="ml-1 font-normal tabular-nums text-muted-foreground">{itemCount} items · {chart!.suppliers.length} suppliers</span>
                </h3>
                <p className={LBL}>
                  <span className={`${TAG} border-foreground text-foreground mr-1`}>L1</span> lowest rate on the item
                </p>
              </div>
              <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" } as any}>
                <table className="text-sm border-collapse w-full" style={{ minWidth: `${200 + 80 + chart!.suppliers.length * 160}px` }}>
                  <thead>
                    <tr style={{ borderBottom: RULE }}>
                      <th className={`${TH} text-left sticky left-0 z-20 bg-card w-[150px] sm:w-[200px]`}>Item</th>
                      <th className={`${TH} text-right w-[80px]`}>Qty</th>
                      {chart!.suppliers.map((s) => {
                        const low = s.SupplierLHeadId === cheapestSupplierId;
                        const partial = s.Status === "Submitted" && !isComplete(s.SupplierLHeadId);
                        return (
                          <th key={s.SupplierLHeadId} className={`px-4 py-3 text-left align-top w-[160px] ${low ? "bg-primary/10" : ""}`}>
                            <div className="flex items-start justify-between gap-1">
                              <span className="font-heading text-[0.6875rem] font-semibold leading-tight text-foreground">{s.SupplierName}</span>
                              {qtRights.canEdit && (
                                <button
                                  type="button"
                                  onClick={() => setRemoving({ id: s.SupplierLHeadId, name: s.SupplierName, submitted: s.Status === "Submitted" })}
                                  className="text-muted-foreground hover:text-destructive shrink-0"
                                  title="Remove supplier from this quotation"
                                  aria-label={`Remove ${s.SupplierName}`}
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              <SheetMark text={s.Status === "Submitted" ? "Quoted" : "Waiting"} tone={s.Status === "Submitted" ? "done" : "waiting"} />
                              {low && <span className={`${TAG} border-foreground text-foreground`}>Lowest</span>}
                            </div>
                            {partial && <p className="text-[0.625rem] text-muted-foreground mt-1">{quotedCount[s.SupplierLHeadId]} of {itemCount} items quoted</p>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-foreground/10">
                    {chart!.items.map((item) => (
                      <tr key={item.QuotationItemId}>
                        <td className="px-4 py-3 font-medium sticky left-0 z-10 bg-card text-xs sm:text-sm">
                          <div className="max-w-[140px] sm:max-w-[190px] truncate" title={item.ItemName}>
                            {item.ItemName}
                          </div>
                          <div className="text-[0.625rem] text-muted-foreground mt-0.5">{item.UOMName || item.UOMCode}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums whitespace-nowrap">{item.Quantity}</td>
                        {chart!.suppliers.map((s) => {
                          const p = priceMap[`${item.QuotationItemId}:${s.SupplierLHeadId}`];
                          const isL1 = l1BySupplierId[item.QuotationItemId] === s.SupplierLHeadId;
                          return (
                            <td key={s.SupplierLHeadId} className={`px-4 py-3 ${isL1 ? "bg-primary/10" : ""}`}>
                              {p && p.Rate > 0 ? (
                                <div>
                                  <div className="flex items-center gap-1.5 text-xs sm:text-sm tabular-nums">
                                    <span className={isL1 ? "font-bold" : "font-medium"}>{fmtAmt(p.Rate)}</span>
                                    {isL1 && <span className={`${TAG} border-foreground text-foreground`}>L1</span>}
                                  </div>
                                  {p.SupplyDate && <div className="text-[0.625rem] text-muted-foreground mt-0.5">by {fmtDate(p.SupplyDate)}</div>}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr style={{ borderTop: RULE }}>
                      <td className={`${TH} text-left sticky left-0 z-10 bg-card`}>Grand total</td>
                      <td />
                      {chart!.suppliers.map((s) => (
                        <td key={s.SupplierLHeadId} className={`px-4 py-3 ${s.SupplierLHeadId === cheapestSupplierId ? "bg-primary/10" : ""}`}>
                          <div className="font-heading font-bold text-xs sm:text-sm tabular-nums">{fmtAmt(supplierTotals[s.SupplierLHeadId] ?? 0)}</div>
                          {s.Status === "Submitted" && !isComplete(s.SupplierLHeadId) && supplierTotals[s.SupplierLHeadId] > 0 && (
                            <div className="text-[0.625rem] text-muted-foreground mt-0.5">partial</div>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── Award ── */}
            {submittedSuppliers.length > 0 && poRights.canCreate && (
              <div className="bg-card" style={{ border: RULE }}>
                <div className="px-5 py-3" style={{ borderBottom: RULE }}>
                  <h3 className={HEAD}>Award</h3>
                </div>
                <div className="p-5 flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1 min-w-0">
                    <label className={`block ${LBL} mb-1.5`}>Winning supplier</label>
                    <SearchableNativeSelect value={winningSupplierId || String(cheapestSupplierId || "")} onChange={(e) => setWinningSupplierId(e.target.value)} className={SEL}>
                      <option value="">Select winner…</option>
                      {submittedSuppliers.map((s) => (
                        <option key={s.SupplierLHeadId} value={String(s.SupplierLHeadId)}>
                          {s.SupplierName}
                          {supplierTotals[s.SupplierLHeadId] > 0 ? ` — ${fmtAmt(supplierTotals[s.SupplierLHeadId])}` : ""}
                          {s.SupplierLHeadId === cheapestSupplierId ? " · Lowest" : !isComplete(s.SupplierLHeadId) ? ` · ${quotedCount[s.SupplierLHeadId]} of ${itemCount} items` : ""}
                        </option>
                      ))}
                    </SearchableNativeSelect>
                  </div>
                  {effectiveWinner && (
                    <div className="sm:px-2 pb-1">
                      <p className={LBL}>Total</p>
                      <p className="font-heading text-base font-bold tabular-nums">{fmtAmt(supplierTotals[effectiveWinner.SupplierLHeadId] ?? 0)}</p>
                    </div>
                  )}
                  <button type="button" onClick={createPO} disabled={!effectiveWinner} className={`${KEY_INK} h-10 px-5`}>
                    <ShoppingCart size={13} /> Create purchase order
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetShell>

      {/* ── Remove supplier ── */}
      <Dialog open={!!removing} onOpenChange={(v) => !v && setRemoving(null)}>
        <DialogContent className="sheet-frame max-w-sm p-0 gap-0" style={{ margin: 0 }}>
          <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: RULE }}>
            <p className={LBL}>Quotation {selected?.DocNo}</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Remove {removing?.name}?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              {removing?.submitted
                ? "They have already quoted; their prices drop out of this comparison."
                : "They have not quoted yet and will no longer be asked to."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 px-5 py-4">
            <button type="button" onClick={() => setRemoving(null)} className={`${KEY_LINE} h-9 px-4`}>
              Cancel
            </button>
            <button
              type="button"
              disabled={removeSupplierMutation.isPending}
              onClick={() => {
                removeSupplierMutation.mutate(removing!.id);
                setRemoving(null);
              }}
              className={`${KEY} h-9 px-4 bg-destructive text-destructive-foreground border border-destructive`}
            >
              Remove
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
