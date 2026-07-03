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

        {/* ── Quotation reference banner ────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            background: isDark
              ? "linear-gradient(135deg, rgba(5,46,22,0.85) 0%, rgba(6,78,59,0.70) 50%, rgba(4,120,87,0.55) 100%)"
              : "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)",
            border: isDark ? "1px solid rgba(16,185,129,0.25)" : "1px solid rgba(6,78,59,0.3)",
            boxShadow: isDark
              ? "0 8px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(16,185,129,0.10), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 8px 32px rgba(4,120,87,0.30), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        >
          {/* Dot grid texture */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }} />
          {/* Radial glow top-right */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse at 80% -10%, rgba(52,211,153,0.25) 0%, transparent 60%)",
          }} />

          <div className="relative px-6 py-5">
            {/* Top row: DocNo + status badges */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-300/60 mb-1">Quotation Reference</div>
                <h2 className="font-mono text-2xl font-extrabold text-white tracking-tight leading-none">
                  {detail.DocNo}
                </h2>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {submitted ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 bg-emerald-400/15 border border-emerald-400/30 px-3 py-1 rounded-full">
                    <CheckCircle2 size={11} /> Submitted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 px-3 py-1 rounded-full">
                    <Clock size={11} /> Pending
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/60 bg-white/10 border border-white/15 px-3 py-1 rounded-full">
                  <Package size={10} /> {totalCount} item{totalCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="mt-4 mb-3.5 h-px bg-gradient-to-r from-white/[0.12] via-white/[0.08] to-transparent" />

            {/* Meta grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
              {detail.CompanyName && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-300/50 mb-0.5">Company</div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-white/90 truncate">
                    <Building2 size={12} className="text-emerald-400/70 shrink-0" />
                    <span className="truncate">{detail.CompanyName}</span>
                  </div>
                </div>
              )}
              {detail.ProjectName && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-300/50 mb-0.5">Project</div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-white/90 truncate">
                    <Package size={12} className="text-emerald-400/70 shrink-0" />
                    <span className="truncate">{detail.ProjectName}</span>
                  </div>
                </div>
              )}
              {detail.DocDate && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-300/50 mb-0.5">Issued On</div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-white/90">
                    <CalendarDays size={12} className="text-emerald-400/70 shrink-0" />
                    {fmtDate(detail.DocDate)}
                  </div>
                </div>
              )}
              {detail.DueDate && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-300/50 mb-0.5">Due Date</div>
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${new Date(detail.DueDate) < new Date() ? "text-red-300" : "text-white/90"}`}>
                    <CalendarDays size={12} className={`shrink-0 ${new Date(detail.DueDate) < new Date() ? "text-red-400" : "text-emerald-400/70"}`} />
                    {fmtDate(detail.DueDate)}
                    {new Date(detail.DueDate) < new Date() && (
                      <span className="ml-1 text-[9px] font-bold text-red-300 bg-red-400/15 border border-red-400/25 px-1.5 py-0.5 rounded-full">Overdue</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Remarks */}
            {detail.Remarks && (
              <div className="mt-4 pt-3.5 border-t border-white/[0.08] text-xs text-white/50 italic flex items-start gap-1.5">
                <span className="text-emerald-400/50 mt-0.5 shrink-0">✦</span>
                {detail.Remarks}
              </div>
            )}
          </div>
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
