import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as spApi from "@/api/supplierPortalApi";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  FileText, Bell, CheckCircle, Clock, ChevronRight,
  IndianRupee, Building2, AlertCircle,
  Package, Search, Save, Edit3, X,
  Truck, MessageCircle, CheckSquare, Square,
  CalendarDays, Hash, ClipboardList, MapPin,
} from "lucide-react";
import { OrderChat } from "@/components/orders/OrderChat";

// ── Utilities ─────────────────────────────────────────────────────────────────
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const isOverdue = (d?: string | null) => !!d && new Date(d) < new Date();
const isDueSoon = (d?: string | null) =>
  !!d && !isOverdue(d) && new Date(d) <= new Date(Date.now() + 3 * 86_400_000);

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ── Welcome hero ──────────────────────────────────────────────────────────────
function WelcomeHero({ name, total, pending, submitted, loading }: {
  name: string; total: number; pending: number; submitted: number; loading: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <section className="px-6 sm:px-10 py-8 sm:py-10 font-body border-b border-border"
      style={{
        background: isDark
          ? "linear-gradient(160deg, rgba(6,78,59,0.18) 0%, rgba(5,46,22,0.10) 50%, transparent 100%)"
          : "linear-gradient(160deg, #ecfdf5 0%, #f0fdf4 50%, #ffffff 100%)",
      }}>
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div>
          <motion.p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-1" {...fade(0)}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            {greeting}
          </motion.p>
          <motion.h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground leading-tight" {...fade(0.08)}>
            {name}
          </motion.h1>
          <motion.p className="text-sm text-muted-foreground mt-1.5" {...fade(0.14)}>
            Respond to open RFQs, manage your price catalog and track submissions.
          </motion.p>
        </div>

        <motion.div className="flex items-center gap-5 sm:gap-7 shrink-0" {...fade(0.18)}>
          {[
            { icon: FileText, label: "Total RFQs", val: loading ? "…" : String(total), col: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
            { icon: Clock, label: "Pending", val: loading ? "…" : String(pending), col: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
            { icon: CheckCircle, label: "Submitted", val: loading ? "…" : String(submitted), col: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center text-center min-w-[56px]">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-1.5 ${s.bg}`}>
                <s.icon size={17} className={s.col} />
              </div>
              <span className="text-xl font-heading font-bold text-foreground">{s.val}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{s.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, due }: { status: string; due?: string | null }) {
  const overdue = isOverdue(due);
  const soon = isDueSoon(due);
  if (status === "Submitted") return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit">Submitted</span>
  );
  if (overdue) return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-1 w-fit">
      <AlertCircle size={10} /> Overdue
    </span>
  );
  if (soon) return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 w-fit">Due Soon</span>
  );
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 w-fit">Open</span>
  );
}

// ── Quotations section ────────────────────────────────────────────────────────
function QuotationsSection({ quotations, loading }: {
  quotations: spApi.SupplierQuotationSummary[]; loading: boolean;
}) {
  const navigate = useNavigate();

  const pending = quotations.filter((q) => q.MySubmissionStatus === "Pending");
  const submitted = quotations.filter((q) => q.MySubmissionStatus === "Submitted");

  return (
    <section id="quotations-section" className="px-6 sm:px-10 py-8 font-body">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex items-center justify-between mb-5" {...fade(0)}>
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Active Quotations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">RFQs you have been tagged on</p>
          </div>
          <button onClick={() => navigate("/supplier")}
            className="flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
            View all <ChevronRight size={14} />
          </button>
        </motion.div>

        {loading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : quotations.length === 0 ? (
          <motion.div className="text-center py-12 rounded-2xl border border-dashed border-border" {...fade(0.1)}>
            <Package size={28} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No quotations yet. You'll be notified when an RFQ arrives.</p>
          </motion.div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <motion.div className="hidden sm:block rounded-2xl border border-border overflow-hidden shadow-sm bg-card" {...fade(0.1)}>
              {/* Tabs */}
              <div className="flex border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
                <div className="px-5 py-2.5 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  Pending ({pending.length})
                </div>
                <div className="px-5 py-2.5">Submitted ({submitted.length})</div>
              </div>

              {/* Header */}
              <div className="grid grid-cols-[2fr_2fr_1.2fr_1fr_1fr] gap-4 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                <span>RFQ No.</span>
                <span>Description / Project</span>
                <span>Company</span>
                <span>Due Date</span>
                <span>Status</span>
              </div>

              {quotations.slice(0, 8).map((q, i) => (
                <motion.div key={q.QuotationId}
                  className="grid grid-cols-[2fr_2fr_1.2fr_1fr_1fr] gap-4 px-5 py-3.5 items-center hover:bg-emerald-500/5 transition-colors cursor-pointer border-b border-border/60 last:border-0"
                  initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                  onClick={() => navigate(`/supplier/quotation/${q.QuotationId}`)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.MySubmissionStatus === "Submitted" ? "bg-emerald-400" : isOverdue(q.DueDate) ? "bg-red-400" : "bg-amber-400"}`} />
                    <span className="text-xs font-mono font-semibold text-foreground truncate">{q.DocNo}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-foreground font-medium truncate">{q.ProjectName ?? q.Remarks ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{q.ItemCount} item{q.ItemCount !== 1 ? "s" : ""}</p>
                  </div>
                  <span className="text-xs text-muted-foreground truncate">{q.CompanyName ?? "—"}</span>
                  <span className={`text-xs ${isOverdue(q.DueDate) ? "text-red-500 font-semibold" : isDueSoon(q.DueDate) ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                    {fmtDate(q.DueDate)}
                  </span>
                  <StatusBadge status={q.MySubmissionStatus} due={q.DueDate} />
                </motion.div>
              ))}
            </motion.div>

            {/* Mobile stacked cards */}
            <div className="sm:hidden space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                Pending ({pending.length}) <span className="text-muted-foreground font-normal">· Submitted ({submitted.length})</span>
              </div>
              {quotations.slice(0, 8).map((q, i) => (
                <motion.div key={q.QuotationId}
                  className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden active:bg-emerald-500/5 transition-colors cursor-pointer p-4 space-y-2"
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                  onClick={() => navigate(`/supplier/quotation/${q.QuotationId}`)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.MySubmissionStatus === "Submitted" ? "bg-emerald-400" : isOverdue(q.DueDate) ? "bg-red-400" : "bg-amber-400"}`} />
                      <span className="text-xs font-mono font-semibold text-foreground truncate">{q.DocNo}</span>
                    </div>
                    <StatusBadge status={q.MySubmissionStatus} due={q.DueDate} />
                  </div>
                  <p className="text-xs text-foreground font-medium truncate">{q.ProjectName ?? q.Remarks ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {q.CompanyName ?? "—"} · {q.ItemCount} item{q.ItemCount !== 1 ? "s" : ""}
                  </p>
                  <p className={`text-[11px] ${isOverdue(q.DueDate) ? "text-red-500 font-semibold" : isDueSoon(q.DueDate) ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                    Due {fmtDate(q.DueDate)}
                  </p>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ── Orders section ─────────────────────────────────────────────────────────────
// Purchase Orders addressed to this supplier — generated from the L1 Chart flow
// once a supplier is picked. Suppliers acknowledge dispatch via the checkbox
// and can chat with procurement about the order (mirrors the Ticket module's
// chat pattern — see src/components/orders/OrderChat.tsx).
// Expected - Supplied, in whole days. Positive = delivered before the
// expected date, negative = delivered after it.
function deliveryDeltaDays(expected?: string | null, supplied?: string | null): number | null {
  if (!expected || !supplied) return null;
  const e = new Date(expected); e.setHours(0, 0, 0, 0);
  const s = new Date(supplied); s.setHours(0, 0, 0, 0);
  return Math.round((e.getTime() - s.getTime()) / 86_400_000);
}

function DeliveryBadge({ expected, supplied }: { expected?: string | null; supplied?: string | null }) {
  const delta = deliveryDeltaDays(expected, supplied);
  if (delta == null) return null;
  if (delta === 0) return <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Delivered on time</span>;
  if (delta > 0) return <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Delivered {delta}d early</span>;
  return <span className="text-[10px] text-amber-600 dark:text-amber-400">Delivered {Math.abs(delta)}d late</span>;
}

// ── Mark-as-supplied confirm popup (optional challan number) ───────────────────
function MarkSuppliedDialog({ order, onClose, onConfirm, submitting }: {
  order: spApi.SupplierOrderSummary;
  onClose: () => void;
  onConfirm: (challanNumber: string) => void;
  submitting: boolean;
}) {
  const [challan, setChallan] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <p className="text-sm font-heading font-bold text-foreground">Mark as supplied</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{order.DocNo || order.PurchaseOrderNo} — {order.ItemDescription}</p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">Challan / DC Number <span className="text-muted-foreground/60">(optional)</span></label>
          <input
            autoFocus
            value={challan}
            onChange={(e) => setChallan(e.target.value)}
            placeholder="e.g. DC-2026-0042"
            className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <p className="text-[11px] text-muted-foreground">Today's date will be recorded as the supplied date.</p>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(challan.trim())}
            disabled={submitting}
            className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Confirm Supplied"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Order detail popup — what procurement actually wants ───────────────────────
function detailRows(detail: spApi.SupplierOrderDetail): { icon: React.ElementType; label: string; value: string | null }[] {
  return [
    { icon: Building2,     label: "Company",        value: detail.CompanyName },
    { icon: MapPin,        label: "Project",        value: detail.ProjectName },
    { icon: CalendarDays,  label: "PO Date",         value: fmtDate(detail.PODate) },
    { icon: Clock,         label: "Expected By",     value: fmtDate(detail.ExpectedDeliveryDate) },
    { icon: ClipboardList, label: "Payment Terms",   value: detail.PaymentTerms },
    { icon: Hash,          label: "GST",             value: detail.GstType && detail.GstRate != null ? `${detail.GstType} · ${detail.GstRate}%` : null },
  ];
}

function OrderDetailDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ["supplier-order-detail", orderId],
    queryFn: () => spApi.getSupplierOrderDetail(orderId),
  });
  const { data: grnOrders = [] } = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
  });
  const grnOrder = grnOrders.find((o) => o.purchaseOrderId === orderId);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }}
        className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-heading font-bold text-foreground truncate">{detail?.DocNo || detail?.PurchaseOrderNo || "Order"}</p>
            <p className="text-[11px] text-muted-foreground">Order details</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {isLoading || !detail ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">{detail.SourceLabel}</span>
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">{detail.Status}</span>
                {detail.SupplierAcknowledged && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle size={10} /> Supplied
                  </span>
                )}
              </div>

              {/* ── Line Items table ──────────────────────────────────── */}
              {(() => {
                const items: any[] = Array.isArray(detail.POItems) && detail.POItems.length > 0
                  ? detail.POItems
                  : detail.ItemDescription
                    ? [{ itemDescription: detail.ItemDescription, quantity: detail.Quantity, uomName: detail.Unit, rate: detail.Rate }]
                    : [];
                const totalAmt = detail.TotalAmount;
                return (
                  <div className="rounded-xl border border-border overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 bg-muted/50 border-b border-border">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Item</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-right w-20">Qty</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-right w-24">Rate</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-right w-28">Total</p>
                    </div>
                    {/* Rows */}
                    {items.map((it: any, idx: number) => {
                      const name = it.itemDescription || it.itemName || it.ItemDescription || it.ItemName || `Item ${idx + 1}`;
                      const qty  = Number(it.quantity  ?? it.Quantity  ?? 0);
                      const uom  = it.uomName ?? it.UomName ?? it.unit ?? it.Unit ?? "";
                      const rate = Number(it.rate ?? it.Rate ?? 0);
                      const lineTotal = it.lineAmount ?? it.LineAmount ?? (qty * rate);
                      return (
                        <div
                          key={idx}
                          className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2.5 text-xs ${
                            idx % 2 === 0 ? "bg-card" : "bg-muted/20"
                          } border-b border-border/50 last:border-0`}
                        >
                          <p className="text-foreground font-medium truncate pr-2" title={name}>{name}</p>
                          <p className="text-muted-foreground text-right w-20 font-mono tabular-nums">
                            {qty.toLocaleString("en-IN")} <span className="text-[10px]">{uom}</span>
                          </p>
                          <p className="text-muted-foreground text-right w-24 font-mono tabular-nums">
                            {rate > 0 ? `₹${rate.toLocaleString("en-IN")}` : "—"}
                          </p>
                          <p className="text-foreground font-semibold text-right w-28 font-mono tabular-nums">
                            {lineTotal > 0 ? `₹${Number(lineTotal).toLocaleString("en-IN")}` : "—"}
                          </p>
                        </div>
                      );
                    })}
                    {/* GST Breakdown footer */}
                    {(() => {
                      const subtotal  = Number(detail.SubtotalAmount ?? 0);
                      const gstRate   = Number(detail.GstRate ?? 0);
                      const gstAmt    = subtotal * gstRate / 100;
                      const isIGST    = (detail.GstType ?? "").toUpperCase().includes("IGST");
                      const hasTax    = gstRate > 0 && subtotal > 0;
                      const fmt       = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      return (
                        <div className="border-t border-border divide-y divide-border/60">
                          {/* Subtotal row */}
                          <div className="flex items-center justify-between px-3 py-2 text-xs">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="font-mono font-medium text-foreground">
                              {subtotal > 0 ? `₹${fmt(subtotal)}` : "—"}
                            </span>
                          </div>
                          {/* GST rows */}
                          {hasTax && (isIGST ? (
                            <div className="flex items-center justify-between px-3 py-2 text-xs">
                              <span className="text-muted-foreground">IGST ({gstRate}%)</span>
                              <span className="font-mono text-foreground">₹{fmt(gstAmt)}</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between px-3 py-2 text-xs">
                                <span className="text-muted-foreground">CGST ({gstRate / 2}%)</span>
                                <span className="font-mono text-foreground">₹{fmt(gstAmt / 2)}</span>
                              </div>
                              <div className="flex items-center justify-between px-3 py-2 text-xs">
                                <span className="text-muted-foreground">SGST ({gstRate / 2}%)</span>
                                <span className="font-mono text-foreground">₹{fmt(gstAmt / 2)}</span>
                              </div>
                            </>
                          ))}
                          {/* Total row */}
                          <div className="flex items-center justify-between px-3 py-3 bg-emerald-500/5">
                            <span className="text-xs font-semibold text-foreground">Total (incl. GST)</span>
                            <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                              {totalAmt != null ? `₹${fmt(Number(totalAmt))}` : subtotal > 0 ? `₹${fmt(subtotal + gstAmt)}` : "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              <div className="space-y-2.5 text-sm">
                {detailRows(detail).map(({ icon: Icon, label, value }) => value ? (
                  <div key={label} className="flex items-start gap-2.5">
                    <Icon size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className="text-foreground">{value}</p>
                    </div>
                  </div>
                ) : null)}
              </div>

              {detail.Remarks && (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Remarks</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{detail.Remarks}</p>
                </div>
              )}

              {detail.SupplierAcknowledged && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wide font-semibold">Supplied</p>
                  <p className="text-sm text-foreground">{fmtDate(detail.SuppliedDate)}</p>
                  <DeliveryBadge expected={detail.ExpectedDeliveryDate} supplied={detail.SuppliedDate} />
                  {detail.ChallanNumber && <p className="text-xs text-muted-foreground">Challan: <span className="font-mono text-foreground">{detail.ChallanNumber}</span></p>}
                </div>
              )}

              {grnOrder && (
                <div
                  className={`rounded-lg border p-3 space-y-2 ${
                    grnOrder.isFullyReceived
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-amber-500/25 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p
                      className={`text-[10px] uppercase tracking-wide font-semibold ${
                        grnOrder.isFullyReceived
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      Received by Customer
                    </p>
                    {grnOrder.isFullyReceived ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle size={11} /> Complete
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {grnOrder.totalRemaining} remaining
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {grnOrder.items.map((it) => (
                      <div key={it.itemId} className="flex items-center justify-between text-xs">
                        <span className="text-foreground truncate">{it.itemName}</span>
                        <span className="font-mono text-muted-foreground shrink-0 ml-2">
                          {it.receivedQty}/{it.orderedQty} {it.uom ?? ""}
                          {it.remainingQty > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {" "}(−{it.remainingQty})
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function OrdersSection({ orders, loading, initialOrderId }: {
  orders: spApi.SupplierOrderSummary[]; loading: boolean; initialOrderId?: number | null;
}) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const [chatOrderId, setChatOrderId] = useState<number | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(initialOrderId ?? null);
  const [markSuppliedOrderId, setMarkSuppliedOrderId] = useState<number | null>(null);

  const ackMutation = useMutation({
    mutationFn: ({ id, acknowledged, challanNumber }: { id: number; acknowledged: boolean; challanNumber?: string }) =>
      spApi.acknowledgeSupplierOrder(id, acknowledged, challanNumber),
    onSuccess: (_data, vars) => {
      toast.success(vars.acknowledged ? "Marked as supplied" : "Unmarked");
      qc.invalidateQueries({ queryKey: ["supplier-orders"] });
      qc.invalidateQueries({ queryKey: ["supplier-order-detail", vars.id] });
      setMarkSuppliedOrderId(null);
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to update"),
  });

  const chatOrder = orders.find((o) => o.PurchaseOrderID === chatOrderId) ?? null;
  const markSuppliedOrder = orders.find((o) => o.PurchaseOrderID === markSuppliedOrderId) ?? null;

  return (
    <section className="px-6 sm:px-10 pt-16 sm:pt-20 pb-8 font-body bg-background border-t border-border">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex items-center justify-between mb-5" {...fade(0)}>
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Orders</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Purchase Orders issued to you — confirm dispatch &amp; chat with procurement</p>
          </div>
        </motion.div>

        {loading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : orders.length === 0 ? (
          <motion.div className="text-center py-12 rounded-2xl border border-dashed border-border" {...fade(0.1)}>
            <Truck size={28} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No orders yet. POs issued to you will appear here.</p>
          </motion.div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <motion.div className="hidden sm:block rounded-2xl border border-border overflow-hidden shadow-sm bg-card" {...fade(0.1)}>
              {/* Header */}
              <div className="grid grid-cols-[1.4fr_2fr_1.2fr_1fr_1.2fr_auto] gap-4 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                <span>PO No.</span>
                <span>Description / Project</span>
                <span>Amount</span>
                <span>Expected By</span>
                <span>Supplied</span>
                <span></span>
              </div>

              {orders.map((o, i) => {
                const overdue = isOverdue(o.ExpectedDeliveryDate) && !o.SupplierAcknowledged;
                return (
                  <motion.div key={o.PurchaseOrderID}
                    className="grid grid-cols-[1.4fr_2fr_1.2fr_1fr_1.2fr_auto] gap-4 px-5 py-3.5 items-center hover:bg-emerald-500/5 transition-colors border-b border-border/60 last:border-0 cursor-pointer"
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                    onClick={() => setDetailOrderId(o.PurchaseOrderID)}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.SupplierAcknowledged ? "bg-emerald-400" : overdue ? "bg-red-400" : "bg-amber-400"}`} />
                      <span className="text-xs font-mono font-semibold text-foreground truncate">{o.DocNo || o.PurchaseOrderNo}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs text-foreground font-medium truncate">{o.ItemDescription || "—"}</p>
                        <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                          {o.SourceLabel}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {[o.CompanyName, o.ProjectName].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {o.TotalAmount != null ? `₹${Number(o.TotalAmount).toLocaleString("en-IN")}` : "—"}
                    </span>
                    <span className={`text-xs ${overdue ? "text-red-500 font-semibold" : isDueSoon(o.ExpectedDeliveryDate) && !o.SupplierAcknowledged ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                      {fmtDate(o.ExpectedDeliveryDate)}
                    </span>

                    {/* Checkbox — mark supplied */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (o.SupplierAcknowledged) {
                            ackMutation.mutate({ id: o.PurchaseOrderID, acknowledged: false });
                          } else {
                            setMarkSuppliedOrderId(o.PurchaseOrderID);
                          }
                        }}
                        disabled={ackMutation.isPending}
                        className="flex flex-col items-start gap-0.5 text-xs font-medium disabled:opacity-50 w-fit"
                        title={o.SupplierAcknowledged ? "Marked as supplied" : "Mark as supplied"}
                      >
                        <span className="flex items-center gap-1.5">
                          {o.SupplierAcknowledged ? (
                            <CheckSquare size={16} className="text-emerald-500" />
                          ) : (
                            <Square size={16} className="text-muted-foreground" />
                          )}
                          <span className={o.SupplierAcknowledged ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                            {o.SupplierAcknowledged ? "Supplied" : "Mark"}
                          </span>
                        </span>
                        {o.SupplierAcknowledged && <DeliveryBadge expected={o.ExpectedDeliveryDate} supplied={o.SuppliedDate} />}
                      </button>
                    </div>

                    {/* Chat icon */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setChatOrderId(o.PurchaseOrderID); }}
                      className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="Chat about this order"
                    >
                      <MessageCircle size={15} />
                      {o.CommentCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
                          {o.CommentCount}
                        </span>
                      )}
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Mobile stacked cards */}
            <div className="sm:hidden space-y-3">
              {orders.map((o, i) => {
                const overdue = isOverdue(o.ExpectedDeliveryDate) && !o.SupplierAcknowledged;
                return (
                  <motion.div key={o.PurchaseOrderID}
                    className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden active:bg-emerald-500/5 transition-colors cursor-pointer"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                    onClick={() => setDetailOrderId(o.PurchaseOrderID)}>
                    <div className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.SupplierAcknowledged ? "bg-emerald-400" : overdue ? "bg-red-400" : "bg-amber-400"}`} />
                          <span className="text-xs font-mono font-semibold text-foreground truncate">{o.DocNo || o.PurchaseOrderNo}</span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-foreground">
                          {o.TotalAmount != null ? `₹${Number(o.TotalAmount).toLocaleString("en-IN")}` : "—"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs text-foreground font-medium">{o.ItemDescription || "—"}</p>
                        <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                          {o.SourceLabel}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {[o.CompanyName, o.ProjectName].filter(Boolean).join(" · ") || "—"}
                      </p>

                      <div className="flex items-center justify-between pt-1">
                        <span className={`text-[11px] ${overdue ? "text-red-500 font-semibold" : isDueSoon(o.ExpectedDeliveryDate) && !o.SupplierAcknowledged ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                          Expected {fmtDate(o.ExpectedDeliveryDate)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border/60 bg-muted/20" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (o.SupplierAcknowledged) {
                            ackMutation.mutate({ id: o.PurchaseOrderID, acknowledged: false });
                          } else {
                            setMarkSuppliedOrderId(o.PurchaseOrderID);
                          }
                        }}
                        disabled={ackMutation.isPending}
                        className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        {o.SupplierAcknowledged ? (
                          <CheckSquare size={16} className="text-emerald-500" />
                        ) : (
                          <Square size={16} className="text-muted-foreground" />
                        )}
                        <span className={o.SupplierAcknowledged ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                          {o.SupplierAcknowledged ? "Supplied" : "Mark as supplied"}
                        </span>
                        {o.SupplierAcknowledged && <DeliveryBadge expected={o.ExpectedDeliveryDate} supplied={o.SuppliedDate} />}
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setChatOrderId(o.PurchaseOrderID); }}
                        className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                        title="Chat about this order"
                      >
                        <MessageCircle size={15} />
                        {o.CommentCount > 0 && (
                          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
                            {o.CommentCount}
                          </span>
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Order detail popup */}
      {detailOrderId && (
        <OrderDetailDialog orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
      )}

      {/* Mark-as-supplied popup */}
      {markSuppliedOrder && (
        <MarkSuppliedDialog
          order={markSuppliedOrder}
          onClose={() => setMarkSuppliedOrderId(null)}
          submitting={ackMutation.isPending}
          onConfirm={(challanNumber) => ackMutation.mutate({ id: markSuppliedOrder.PurchaseOrderID, acknowledged: true, challanNumber })}
        />
      )}

      {/* Chat slide-over */}
      {chatOrder && currentUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="flex-1 bg-black/40" onClick={() => setChatOrderId(null)} />
          <div className="w-full max-w-md shrink-0 bg-background border-l border-border flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <p className="text-sm font-heading font-bold text-foreground">{chatOrder.DocNo || chatOrder.PurchaseOrderNo}</p>
                <p className="text-[11px] text-muted-foreground">{chatOrder.ItemDescription}</p>
              </div>
              <button onClick={() => setChatOrderId(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <X size={16} />
              </button>
            </div>
            <OrderChat
              poId={chatOrder.PurchaseOrderID}
              apiBase="/api/supplier-portal/orders"
              currentUser={{ id: Number(currentUser.id), name: currentUser.name, role: currentUser.role }}
              className="flex-1 rounded-none border-0"
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ── Price catalog section (inline editable) ───────────────────────────────────
function ReceivedItemProgress({ items }: { items: spApi.SupplierGrnItem[] }) {
  return (
    <div className="space-y-1">
      {items.map((it) => {
        const pct = it.orderedQty > 0 ? Math.min(100, (it.receivedQty / it.orderedQty) * 100) : 100;
        return (
          <div key={it.itemId}>
            <div className="flex items-center justify-between text-[10px] mb-0.5 gap-2">
              <span className="text-foreground truncate">{it.itemName}</span>
              <span className="font-mono text-muted-foreground shrink-0">
                {it.receivedQty}/{it.orderedQty} {it.uom ?? ""}
              </span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${it.remainingQty > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReceivedByCustomerSection() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [chatOrderId, setChatOrderId] = useState<number | null>(null);
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
    refetchInterval: 60_000,
  });

  const pending = orders.filter((o) => !o.isFullyReceived);
  const complete = orders.filter((o) => o.isFullyReceived);
  const sorted = [...pending, ...complete];
  const chatOrder = sorted.find((o) => o.purchaseOrderId === chatOrderId) ?? null;

  return (
    <section className="px-6 sm:px-10 pt-8 pb-16 sm:pb-20 font-body bg-background border-t border-border">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex items-center justify-between mb-5" {...fade(0)}>
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
              <Truck size={18} className="text-emerald-500" /> Received by Customer
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pending.length === 0
                ? "All shipments fully received"
                : `${pending.length} order${pending.length !== 1 ? "s" : ""} still awaiting the remaining quantity`}
            </p>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <motion.div className="text-center py-12 rounded-2xl border border-dashed border-border" {...fade(0.1)}>
            <Package size={28} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              No goods receipts yet. Once the customer logs a GRN against one of your orders, its receipt progress will show up here.
            </p>
          </motion.div>
        ) : (
          <>
            {/* Desktop / tablet table — matches Orders/Active Quotations */}
            <motion.div className="hidden sm:block rounded-2xl border border-border overflow-hidden shadow-sm bg-card" {...fade(0.1)}>
              <div className="grid grid-cols-[1.4fr_2.4fr_1.2fr_1fr_auto] gap-4 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                <span>PO No.</span>
                <span>Items / Project</span>
                <span>PO Date</span>
                <span>Status</span>
                <span></span>
              </div>

              {sorted.map((o, i) => (
                <motion.div key={o.purchaseOrderId}
                  className="grid grid-cols-[1.4fr_2.4fr_1.2fr_1fr_auto] gap-4 px-5 py-3.5 items-center hover:bg-emerald-500/5 transition-colors border-b border-border/60 last:border-0 cursor-pointer"
                  initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                  onClick={() => navigate(`/supplier?order=${o.purchaseOrderId}`)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.isFullyReceived ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="text-xs font-mono font-semibold text-foreground truncate">{o.docNo}</span>
                  </div>
                  <div className="min-w-0">
                    <ReceivedItemProgress items={o.items} />
                    <p className="text-[10px] text-muted-foreground truncate mt-1">
                      {[o.companyName, o.projectName].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{fmtDate(o.poDate)}</span>
                  {o.isFullyReceived ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit">Complete</span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 w-fit">{o.totalRemaining} remaining</span>
                  )}

                  {/* Chat icon — same PO-scoped chat as Orders, so a supplier can
                      discuss the vehicle-in/out delivery lots feeding this GRN
                      with procurement in the same thread as the order itself. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setChatOrderId(o.purchaseOrderId); }}
                    className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title="Chat about this delivery"
                  >
                    <MessageCircle size={15} />
                    {o.commentCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
                        {o.commentCount}
                      </span>
                    )}
                  </button>
                </motion.div>
              ))}
            </motion.div>

            {/* Mobile stacked cards */}
            <div className="sm:hidden space-y-3">
              {sorted.map((o, i) => (
                <motion.div key={o.purchaseOrderId}
                  className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden active:bg-emerald-500/5 transition-colors cursor-pointer"
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                  onClick={() => navigate(`/supplier?order=${o.purchaseOrderId}`)}>
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.isFullyReceived ? "bg-emerald-400" : "bg-amber-400"}`} />
                        <span className="text-xs font-mono font-semibold text-foreground truncate">{o.docNo}</span>
                      </div>
                      {o.isFullyReceived ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit shrink-0">Complete</span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 w-fit shrink-0">{o.totalRemaining} remaining</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {[o.companyName, o.projectName].filter(Boolean).join(" · ") || "—"} · {fmtDate(o.poDate)}
                    </p>
                    <ReceivedItemProgress items={o.items} />
                  </div>
                  <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border/60 bg-muted/20" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setChatOrderId(o.purchaseOrderId)}
                      className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                      title="Chat about this delivery"
                    >
                      <MessageCircle size={15} />
                      {o.commentCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
                          {o.commentCount}
                        </span>
                      )}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Chat slide-over — same PO-scoped OrderChat component/backend as Orders */}
      {chatOrder && currentUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="flex-1 bg-black/40" onClick={() => setChatOrderId(null)} />
          <div className="w-full max-w-md shrink-0 bg-background border-l border-border flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <p className="text-sm font-heading font-bold text-foreground">{chatOrder.docNo}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[chatOrder.companyName, chatOrder.projectName].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <button onClick={() => setChatOrderId(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <X size={16} />
              </button>
            </div>
            <OrderChat
              poId={chatOrder.purchaseOrderId}
              apiBase="/api/supplier-portal/orders"
              currentUser={{ id: Number(currentUser.id), name: currentUser.name, role: currentUser.role }}
              className="flex-1 rounded-none border-0"
            />
          </div>
        </div>
      )}
    </section>
  );
}

function PriceCatalogSection({ catalog, loading }: {
  catalog: spApi.SupplierCatalogItem[]; loading: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  // Lock the initial display order (unpriced first) so saving a rate doesn't
  // cause the row to jump to the bottom on re-render.
  const initialOrderRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (catalog.length && !initialOrderRef.current) {
      initialOrderRef.current = [...catalog]
        .sort((a, b) => (a.Rate === null ? -1 : b.Rate === null ? 1 : 0))
        .map((c) => c.ItemId);
    }
  }, [catalog]);

  const mutation = useMutation({
    mutationFn: spApi.updateSupplierCatalog,
    onSuccess: () => {
      toast.success("Rate saved");
      qc.invalidateQueries({ queryKey: ["supplier-catalog"] });
      setEditingId(null);
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to save"),
  });

  const priced = catalog.filter((c) => c.Rate !== null).length;
  const pct = catalog.length ? Math.round((priced / catalog.length) * 100) : 0;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const items = catalog.filter((c) => !q || c.ItemName.toLowerCase().includes(q));
    if (initialOrderRef.current) {
      const orderMap = new Map(initialOrderRef.current.map((id, i) => [id, i]));
      return [...items].sort((a, b) => (orderMap.get(a.ItemId) ?? 999) - (orderMap.get(b.ItemId) ?? 999));
    }
    return items;
  }, [catalog, search]);

  const saveRate = (item: spApi.SupplierCatalogItem) => {
    const raw = edits[item.ItemId];
    const rate = parseFloat(raw ?? "");
    if (isNaN(rate) || rate < 0) { toast.error("Enter a valid rate"); return; }
    mutation.mutate([{ ItemId: item.ItemId, ItemName: item.ItemName, UOMCode: item.UOMCode ?? "", Rate: rate }]);
  };

  return (
    <section className="px-6 sm:px-10 py-8 font-body bg-background border-t border-border">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5" {...fade(0)}>
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Price Catalog</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Set your rates for each item — shown to procurement during L1 comparison</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Coverage */}
            <div className="flex items-center gap-2">
              <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full rounded-full bg-emerald-500"
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }} />
              </div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{pct}% covered</span>
            </div>
            <button onClick={() => navigate("/supplier/catalog")}
              className="flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
              Full view <ChevronRight size={14} />
            </button>
          </div>
        </motion.div>

        {/* Search */}
        <motion.div className="relative mb-4" {...fade(0.06)}>
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full sm:w-72 pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-muted/40 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:bg-background transition-all" />
        </motion.div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : (
          <motion.div className="rounded-2xl border border-border overflow-hidden shadow-sm bg-card" {...fade(0.1)}>
            {/* Header */}
            <div className="grid grid-cols-[3fr_1fr_2fr_1.2fr] gap-4 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
              <span>Item Name</span>
              <span>UOM</span>
              <span>Your Rate (₹)</span>
              <span>Last Updated</span>
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {filtered.slice(0, 30).map((item, i) => {
                const isEditing = editingId === item.ItemId;
                const hasRate = item.Rate !== null;
                return (
                  <div key={item.ItemId}
                    className={`grid grid-cols-[3fr_1fr_2fr_1.2fr] gap-4 px-4 py-2.5 items-center border-b border-border/60 last:border-0 transition-colors ${isEditing ? "bg-emerald-500/5" : "hover:bg-muted/30"}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {!hasRate && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                      <span className="text-xs text-foreground truncate font-medium">{item.ItemName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{item.UOMCode ?? "—"}</span>
                    <div className="flex items-center gap-1.5">
                      {isEditing ? (
                        <>
                          <div className="relative flex items-center">
                            <span className="absolute left-2.5 text-xs text-muted-foreground">₹</span>
                            <input
                              autoFocus
                              type="number"
                              min="0"
                              step="0.01"
                              value={edits[item.ItemId] ?? ""}
                              onChange={(e) => setEdits((p) => ({ ...p, [item.ItemId]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveRate(item); if (e.key === "Escape") setEditingId(null); }}
                              className="w-28 pl-6 pr-2 py-1 text-xs border border-emerald-500/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-background text-foreground"
                              placeholder="0.00"
                            />
                          </div>
                          <button onClick={() => saveRate(item)} disabled={mutation.isPending}
                            className="p-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                            <Save size={11} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                            <X size={11} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setEditingId(item.ItemId); setEdits((p) => ({ ...p, [item.ItemId]: item.Rate !== null ? String(item.Rate) : "" })); }}
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors ${hasRate ? "text-foreground hover:bg-muted" : "text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/15 font-semibold"}`}>
                          {hasRate ? (
                            <><IndianRupee size={10} className="text-muted-foreground" />{Number(item.Rate).toLocaleString("en-IN", { minimumFractionDigits: 2 })}<Edit3 size={10} className="text-muted-foreground/50 ml-1" /></>
                          ) : (
                            <><Edit3 size={10} />Set rate</>
                          )}
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {item.UpdatedAt ? fmtDate(item.UpdatedAt) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            {filtered.length > 30 && (
              <div className="px-4 py-2.5 text-center border-t border-border/60">
                <button onClick={() => navigate("/supplier/catalog")}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                  View all {catalog.length} items in full catalog →
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────
function QuickActions() {
  const navigate = useNavigate();

  const actions: {
    icon: React.ElementType; label: string; desc: string;
    col: string; bg: string; badge?: string;
    onClick: () => void;
  }[] = [
    {
      icon: FileText, label: "My Quotations", desc: "View & respond to RFQs",
      col: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10",
      onClick: () => {
        const el = document.getElementById("quotations-section");
        el ? el.scrollIntoView({ behavior: "smooth", block: "start" }) : navigate("/supplier");
      },
    },
    {
      icon: IndianRupee, label: "Price Catalog", desc: "Update your rates",
      col: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10",
      onClick: () => navigate("/supplier/catalog"),
    },
    {
      icon: Building2, label: "Company Profile", desc: "Contact & address details",
      col: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10",
      onClick: () => navigate("/supplier/profile"),
    },
    {
      icon: Bell, label: "Notifications", desc: "Alerts & reminders",
      col: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10",
      onClick: () => navigate("/supplier/notifications"),
    },
  ];

  return (
    <section className="px-6 sm:px-10 py-8 font-body border-t border-border">
      <div className="max-w-6xl mx-auto">
        <motion.h2 className="font-heading text-lg font-bold text-foreground mb-4" {...fade(0)}>Quick Actions</motion.h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {actions.map((a, i) => (
            <motion.button key={a.label} onClick={a.onClick}
              className="relative flex flex-col items-start p-4 rounded-2xl border border-border bg-card hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.06, duration: 0.4 }}>
              {a.badge && (
                <span className="absolute top-3 right-3 text-[9px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {a.badge}
                </span>
              )}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${a.bg}`}>
                <a.icon size={16} className={a.col} />
              </div>
              <p className="text-sm font-heading font-semibold text-foreground">{a.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{a.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SupplierLanding() {
  const [searchParams] = useSearchParams();
  const deepLinkOrderId = (() => {
    const raw = searchParams.get("order");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  })();

  const { data: profile } = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: spApi.getSupplierProfile,
    staleTime: 5 * 60_000,
  });

  const { data: quotations = [], isLoading: loadingQ } = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
    refetchInterval: 60_000,
  });

  const { data: catalog = [], isLoading: loadingC } = useQuery({
    queryKey: ["supplier-catalog"],
    queryFn: spApi.getSupplierCatalog,
    staleTime: 2 * 60_000,
  });

  const { data: orders = [], isLoading: loadingO } = useQuery({
    queryKey: ["supplier-orders"],
    queryFn: spApi.getSupplierOrders,
    refetchInterval: 60_000,
  });

  const pending = quotations.filter((q) => q.MySubmissionStatus === "Pending").length;
  const submitted = quotations.filter((q) => q.MySubmissionStatus === "Submitted").length;

  return (
    <div className="min-h-screen font-body bg-background">
      <WelcomeHero
        name={profile?.Name ?? "Supplier"}
        total={quotations.length}
        pending={pending}
        submitted={submitted}
        loading={loadingQ}
      />
      <div className="bg-background">
        <QuotationsSection quotations={quotations} loading={loadingQ} />
        <OrdersSection orders={orders} loading={loadingO} initialOrderId={deepLinkOrderId} />
        <ReceivedByCustomerSection />
        <PriceCatalogSection catalog={catalog} loading={loadingC} />
        <QuickActions />
      </div>
    </div>
  );
}
