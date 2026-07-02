import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as spApi from "@/api/supplierPortalApi";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  RefreshCw,
  Send,
  CheckCircle2,
  Clock,
  Package,
  Building2,
  CalendarDays,
  IndianRupee,
  Truck,
  Star,
} from "lucide-react";

const inputCls =
  "w-full text-sm rounded-lg border border-border/60 px-3 py-2 bg-background/60 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition";

interface RowState {
  QuotationItemId: number;
  Rate: string;
  SupplyDate: string;
  Quality: string;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

export default function SupplierQuotationDetail() {
  const { qtId } = useParams<{ qtId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<number, RowState>>({});

  const { data: detail, isLoading } = useQuery({
    queryKey: ["supplier-quotation-detail", qtId],
    queryFn: () => spApi.getSupplierQuotationDetail(qtId!),
    enabled: Boolean(qtId),
  });

  useEffect(() => {
    if (!detail) return;
    const next: Record<number, RowState> = {};
    for (const it of detail.items) {
      next[it.QuotationItemId] = {
        QuotationItemId: it.QuotationItemId,
        Rate: it.Rate != null ? String(it.Rate) : "",
        SupplyDate: it.SupplyDate ? String(it.SupplyDate).slice(0, 10) : "",
        Quality: it.Quality ?? "",
      };
    }
    setRows(next);
  }, [detail]);

  const setRow = <K extends keyof RowState>(id: number, key: K, value: RowState[K]) =>
    setRows((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));

  const submitMutation = useMutation({
    mutationFn: () =>
      spApi.submitSupplierPrices(
        qtId!,
        Object.values(rows).map((r) => ({
          QuotationItemId: r.QuotationItemId,
          Rate: Number(r.Rate) || 0,
          SupplyDate: r.SupplyDate || null,
          Quality: r.Quality || null,
        })),
      ),
    onSuccess: () => {
      toast.success("Prices submitted successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier-quotation-detail", qtId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-quotations"] });
      navigate(-1);
    },
    onError: (err: any) => toast.error(err.message || "Failed to submit prices"),
  });

  const { theme } = useTheme();
  const isDark = theme !== "light";
  const submitted = detail?.MySubmissionStatus === "Submitted";
  const filledCount = Object.values(rows).filter((r) => r.Rate && Number(r.Rate) > 0).length;
  const totalCount = detail?.items.length ?? 0;
  const canSubmit = filledCount === totalCount && totalCount > 0;

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin" /> Loading quotation…
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      {/* Page glow — subtle in both modes */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div style={{
          position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)",
          width: "70vw", height: "40vh",
          background: `radial-gradient(ellipse at 50% 0%, rgba(16,185,129,${isDark ? "0.06" : "0.04"}) 0%, transparent 70%)`,
        }} />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 space-y-5">

        {/* ── Breadcrumb ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <span className="text-border">|</span>
          <span className="font-mono font-bold text-sm text-emerald-500">{detail.DocNo}</span>
          {submitted ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <CheckCircle2 size={9} /> Submitted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <Clock size={9} /> Pending
            </span>
          )}
        </div>

        {/* ── Hero info bar ─────────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-2xl px-6 py-5"
          style={isDark ? {
            background: "rgba(15,17,26,0.52)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 4px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
            backdropFilter: "blur(22px) saturate(160%)",
          } : submitted ? {
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
            border: "1px solid #6ee7b7",
            boxShadow: "0 4px 20px rgba(16,185,129,0.12)",
          } : {
            background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
            border: "1px solid #fcd34d",
            boxShadow: "0 4px 20px rgba(245,158,11,0.10)",
          }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle, ${isDark ? "rgba(255,255,255,0.07)" : submitted ? "rgba(5,150,105,0.10)" : "rgba(180,83,9,0.08)"} 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
          }} />

          <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2">
            {detail.CompanyName && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Building2 size={13} className="text-muted-foreground/60" />
                {detail.CompanyName}
              </div>
            )}
            {detail.ProjectName && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Package size={13} className="text-muted-foreground/60" />
                {detail.ProjectName}
              </div>
            )}
            {detail.DueDate && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${new Date(detail.DueDate) < new Date() ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                <CalendarDays size={13} className="opacity-60" />
                Due {fmtDate(detail.DueDate)}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground ml-auto">
              <Package size={12} />
              {totalCount} item{totalCount !== 1 ? "s" : ""}
            </div>
          </div>

          {detail.Remarks && (
            <div className="relative mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground italic">
              "{detail.Remarks}"
            </div>
          )}
        </div>

        {/* ── Progress bar (only if pending) ───────────────────────────── */}
        {!submitted && totalCount > 0 && (
          <div className="flex items-center gap-3 px-1">
            <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${(filledCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {filledCount}/{totalCount} rates filled
            </span>
          </div>
        )}

        {/* ── Item cards ───────────────────────────────────────────────── */}
        <div className="space-y-3">
          {detail.items.map((it, idx) => {
            const r = rows[it.QuotationItemId];
            if (!r) return null;
            const hasRate = r.Rate && Number(r.Rate) > 0;

            return (
              <div
                key={it.QuotationItemId}
                className={`rounded-xl border transition-all ${hasRate ? "border-emerald-500/25 bg-emerald-500/[0.03]" : "border-border bg-card"}`}
              >
                {/* Item header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-md bg-muted/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-sm text-foreground">{it.ItemName}</span>
                    {it.UOMCode && (
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                        {it.UOMCode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Package size={11} />
                    Qty: <span className="font-semibold text-foreground">{it.Quantity}</span>
                    {it.UOMName || it.UOMCode}
                  </div>
                </div>

                {/* Input grid */}
                <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Rate */}
                  <div>
                    <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      <IndianRupee size={10} /> Your Rate *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">₹</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.Rate}
                        onChange={(e) => setRow(it.QuotationItemId, "Rate", e.target.value)}
                        disabled={submitted}
                        className={`${inputCls} pl-7 ${hasRate ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 font-semibold" : ""}`}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {/* Supply date */}
                  <div>
                    <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      <Truck size={10} /> Date of Supply
                    </label>
                    <input
                      type="date"
                      value={r.SupplyDate}
                      onChange={(e) => setRow(it.QuotationItemId, "SupplyDate", e.target.value)}
                      disabled={submitted}
                      className={inputCls}
                    />
                  </div>

                  {/* Quality */}
                  <div>
                    <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      <Star size={10} /> Quality
                    </label>
                    <input
                      type="text"
                      value={r.Quality}
                      onChange={(e) => setRow(it.QuotationItemId, "Quality", e.target.value)}
                      disabled={submitted}
                      className={inputCls}
                      placeholder="e.g. Grade A / ISI marked"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer action ─────────────────────────────────────────────── */}
        {submitted ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-emerald-500 font-medium">
            <CheckCircle2 size={16} /> Prices already submitted — thank you!
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              {canSubmit
                ? "All rates filled — ready to submit."
                : `Fill in rates for all ${totalCount - filledCount} remaining item${totalCount - filledCount !== 1 ? "s" : ""} to submit.`}
            </p>
            <Button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={!canSubmit || submitMutation.isPending}
              className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 text-white hover:opacity-90 border-0 disabled:opacity-40 min-w-[140px]"
            >
              {submitMutation.isPending
                ? <><RefreshCw size={14} className="animate-spin" /> Submitting…</>
                : <><Send size={14} /> Submit Prices</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
