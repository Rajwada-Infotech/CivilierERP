import React, { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Truck,
  User,
  Package,
  Banknote,
  BadgePercent,
  TrendingUp,
  CreditCard,
  Hash,
  Receipt,
  StickyNote,
  CheckCircle2,
  Clock,
  AlertCircle,
  Edit,
  FileText,
  ArrowRight,
  Wallet,
  Printer,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { parseJsonArray } from "@/utils/parseJsonArray";
import { computeBreakdown, fmt } from "@/pages/material/ExpenseBooking/helpers";
import type { ExpenseRecord } from "@/pages/material/ExpenseBooking/types";

interface GRNItemLine {
  itemName?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
  quantity?: number;
  totalAmount?: number;
}

interface ExpenseBookingPreviewModalProps {
  previewRecord: ExpenseRecord | null;
  onClose: () => void;
  onEdit: (record: ExpenseRecord) => void;
}

export function ExpenseBookingPreviewModal({
  previewRecord,
  onClose,
  onEdit,
}: ExpenseBookingPreviewModalProps) {
  // GRN item-level GST breakdown (fetched when eSourceType === 'GRN')
  const [grnBreakdown, setGrnBreakdown] = useState<{
    items: {
      itemName: string;
      gstPercent: number;
      receivedQty: number;
      totalAmountInclGST: number;
      baseAmount: number;
      cgstRate: number;
      cgstAmount: number;
      sgstRate: number;
      sgstAmount: number;
      gstAmount: number;
    }[];
    totals: {
      totalBase: number;
      totalCGST: number;
      totalSGST: number;
      totalGST: number;
      totalInclGST: number;
    };
  } | null>(null);

  useEffect(() => {
    setGrnBreakdown(null);
    if (previewRecord?.eSourceType === "GRN" && previewRecord?.eSourceId) {
      fetchWithAuth(`/api/grns/${previewRecord.eSourceId}/gst-breakdown`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.totals?.totalInclGST > 0) setGrnBreakdown(data);
        })
        .catch(() => {});
    }
  }, [previewRecord?.id]);

  if (!previewRecord) return null;

  const hasEmi = !!(
    previewRecord.emi?.enabled && previewRecord.emi?.installmentCount
  );

  // Normalise billingTerms — the API may return null/undefined when no terms are saved,
  // so always coerce to an array before any checks.
  const billingTerms = parseJsonArray(previewRecord.billingTerms ?? []).filter(
    (t: any) => t?.applicable === true && (t?.masterTermName || t?.value > 0),
  );

  // Use billingTerms array (multi-term) when available, otherwise fall back to
  // the legacy single discount — ensures the total correctly reflects all applied terms.
  const effectiveTerms =
    billingTerms.length > 0 ? billingTerms : previewRecord.discount;

  const rbd = computeBreakdown(
    previewRecord.basicAmount,
    previewRecord.cgstRate,
    previewRecord.sgstRate,
    effectiveTerms,
    previewRecord.igstRate ?? 0,
  );
  const hasIgst = (previewRecord.igstRate || 0) > 0;
  const hasDiscount =
    previewRecord.discount && (previewRecord.discount.value || 0) > 0;
  // Use values computed from rbd (which now includes all billing terms)
  const cgstAmt = rbd.cgstAmount;
  const sgstAmt = rbd.sgstAmount;
  const igstAmt = rbd.igstAmount ?? 0;

  // When GRN breakdown is available, use its exact totals for display.
  // When billing terms are applied, always use the freshly computed rbd.netAmount
  // so the total reflects all terms (not just the DB-stored value which may lag).
  const displayNetAmount = grnBreakdown
    ? grnBreakdown.totals.totalInclGST
    : billingTerms.length > 0
      ? rbd.netAmount
      : (previewRecord.netAmount ?? rbd.netAmount);

  // Recalculate remaining when we have a corrected net amount
  const displayRemainingAmount = grnBreakdown
    ? Math.max(0, displayNetAmount - (previewRecord.totalPaid ?? 0))
    : (previewRecord.remainingAmount ?? 0);

  return (
    <Dialog open={!!previewRecord} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl max-h-[96vh] overflow-y-auto expense-preview-modal">
        <style>{`
          @media print {
            body > * { display: none !important; }
            [data-radix-dialog-overlay] { display: none !important; }
            .expense-preview-modal { display: block !important; position: static !important; background: white !important; box-shadow: none !important; max-height: none !important; overflow: visible !important; border: none !important; border-radius: 0 !important; transform: none !important; }
            .expense-preview-print-hide { display: none !important; }
          }
        `}</style>
        <DialogHeader>
          <DialogTitle>Expense Booking Preview</DialogTitle>
          <DialogDescription>
            Details for booking {previewRecord?.bookingReference}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
          {/* ── Section 1: Booking Info ── */}
          <div>
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CalendarDays size={10} className="text-primary" /> Booking
              Information
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Booking Date
                </p>
                <p className="text-sm font-medium">
                  {previewRecord.bookingDate || "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Due Date
                </p>
                <p className="text-sm font-medium">
                  {previewRecord.dueDate || "—"}
                </p>
                {previewRecord.dueDate &&
                  previewRecord.bookingDate &&
                  previewRecord.dueDate < previewRecord.bookingDate && (
                    <p className="mt-1 text-[10px] font-medium text-destructive flex items-center gap-1">
                      ⚠ Before booking date
                    </p>
                  )}
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Document Type
                </p>
                <p className="text-sm font-medium truncate">
                  {previewRecord.docTypeName ||
                    previewRecord.materialCategory ||
                    "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Source Document
                </p>
                <p className="text-sm font-mono font-semibold text-foreground">
                  {previewRecord.sourceDocNo
                    ? previewRecord.sourceDocNo
                    : previewRecord.eSourceType && previewRecord.eSourceId
                      ? `${previewRecord.eSourceType}-${previewRecord.eSourceId}`
                      : previewRecord.purchaseOrderId
                        ? `PO-${previewRecord.purchaseOrderId}`
                        : previewRecord.workOrderId
                          ? `WO-${previewRecord.workOrderId}`
                          : "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Company
                </p>
                <p className="text-sm font-medium truncate">
                  {previewRecord.companyName ||
                    (previewRecord.companyId
                      ? `Company #${previewRecord.companyId}`
                      : "—")}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Project
                </p>
                <p className="text-sm font-medium truncate">
                  {previewRecord.projectName ||
                    (previewRecord.projectId
                      ? `Project #${previewRecord.projectId}`
                      : "—")}
                </p>
              </div>
            </div>
          </div>

          {/* ── Section 2: Vendor / Supplier ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Truck size={10} className="text-primary" /> Vendor / Supplier
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex items-center gap-3 bg-muted/30 border border-border rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <User size={14} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Supplier / Contractor
                  </p>
                  <p className="text-sm font-semibold truncate">
                    {previewRecord.supplier || "—"}
                  </p>
                </div>
              </div>
              {previewRecord.materialCategory && (
                <div className="flex-1 flex items-center gap-3 bg-muted/30 border border-border rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Package size={14} className="text-blue-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Material Category
                    </p>
                    <p className="text-sm font-semibold truncate">
                      {previewRecord.materialCategory}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 3: Amount Breakdown ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Banknote size={10} className="text-primary" /> Amount Breakdown
            </p>

            {/* ── GRN per-item breakdown (accurate) ── */}
            {grnBreakdown ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.03] overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-500/15 bg-blue-500/5">
                    <Truck size={11} className="text-blue-500 shrink-0" />
                    <span className="text-[10px] font-heading font-semibold text-blue-700 dark:text-blue-300">
                      GST Breakdown by Item
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-blue-500/10 bg-muted/10">
                          <th className="px-3 py-1.5 text-left text-muted-foreground font-heading uppercase tracking-wider text-[9px]">
                            Item
                          </th>
                          <th className="px-3 py-1.5 text-right text-muted-foreground font-heading uppercase tracking-wider text-[9px]">
                            Qty
                          </th>
                          <th className="px-3 py-1.5 text-right text-foreground font-heading uppercase tracking-wider text-[9px]">
                            Incl.
                          </th>
                          <th className="px-3 py-1.5 text-right text-blue-600 dark:text-blue-400 font-heading uppercase tracking-wider text-[9px]">
                            Base
                          </th>
                          <th className="px-3 py-1.5 text-right text-orange-600 dark:text-orange-400 font-heading uppercase tracking-wider text-[9px]">
                            Tax
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-blue-500/8">
                        {grnBreakdown.items.map((item, idx) => (
                          <tr key={idx} className="hover:bg-blue-500/5">
                            <td className="px-3 py-1.5 font-medium text-foreground max-w-[120px] truncate">
                              {item.itemName || `Item ${idx + 1}`}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-foreground">
                              {item.receivedQty}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-foreground">
                              ₹{fmt(item.totalAmountInclGST)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                              ₹{fmt(item.baseAmount)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-orange-600 dark:text-orange-400">
                              ₹{fmt(item.gstAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-blue-500/20 bg-muted/10">
                        <tr>
                          <td
                            colSpan={2}
                            className="px-3 py-1.5 text-[9px] font-heading uppercase text-muted-foreground"
                          >
                            Totals
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-foreground">
                            ₹{fmt(grnBreakdown.totals.totalInclGST)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                            ₹{fmt(grnBreakdown.totals.totalBase)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-orange-600 dark:text-orange-400">
                            ₹{fmt(grnBreakdown.totals.totalGST)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
                {/* Cumulative GST summary */}
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50 text-sm">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                    <div>
                      <p className="text-xs font-medium">Basic Amount</p>
                      <p className="text-[10px] text-muted-foreground">
                        Pre-tax value (excl. GST)
                      </p>
                    </div>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(grnBreakdown.totals.totalBase)}
                    </p>
                  </div>
                  {grnBreakdown.totals.totalCGST > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-xs text-muted-foreground">CGST</p>
                        <p className="text-[10px] text-muted-foreground">
                          Central GST
                        </p>
                      </div>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(grnBreakdown.totals.totalCGST)}
                      </p>
                    </div>
                  )}
                  {grnBreakdown.totals.totalSGST > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-xs text-muted-foreground">SGST</p>
                        <p className="text-[10px] text-muted-foreground">
                          State GST
                        </p>
                      </div>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(grnBreakdown.totals.totalSGST)}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20">
                    <div>
                      <p className="text-xs font-medium">Gross Amount</p>
                      <p className="text-[10px] text-muted-foreground">
                        Basic + CGST + SGST
                      </p>
                    </div>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(grnBreakdown.totals.totalInclGST)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-primary/10 border border-primary/20 rounded-xl">
                  <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider">
                    Net Payable
                  </p>
                  <p className="font-mono text-base font-bold text-primary">
                    ₹{fmt(grnBreakdown.totals.totalInclGST)}
                  </p>
                </div>
              </div>
            ) : (
              /* ── Standard breakdown (non-GRN) ── */
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="divide-y divide-border/60">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                    <p className="text-xs text-muted-foreground">
                      Basic Amount
                    </p>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(previewRecord.basicAmount)}
                    </p>
                  </div>
                  {!hasIgst && (previewRecord.cgstRate || 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">CGST</p>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(cgstAmt)}
                      </p>
                    </div>
                  )}
                  {!hasIgst && (previewRecord.sgstRate || 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">SGST</p>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(sgstAmt)}
                      </p>
                    </div>
                  )}
                  {hasIgst && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">IGST</p>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(igstAmt)}
                      </p>
                    </div>
                  )}
                  {!hasIgst &&
                    (previewRecord.cgstRate || 0) === 0 &&
                    (previewRecord.sgstRate || 0) === 0 && (
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <p className="text-xs text-muted-foreground">GST</p>
                        <p className="text-xs text-muted-foreground">
                          Not applicable
                        </p>
                      </div>
                    )}
                  {/* Billing Terms — pre-GST applied before GST */}
                  {(rbd.preGstTerms ?? []).map((t, i) => {
                    const amt =
                      t.type === "percentage"
                        ? (previewRecord.basicAmount * t.value) / 100
                        : t.value;
                    const isAdd = t.termType === "Addition";
                    return (
                      <div
                        key={t._key ?? i}
                        className={`flex items-center justify-between px-4 py-2.5 ${isAdd ? "bg-emerald-500/5" : "bg-red-500/5"}`}
                      >
                        <p
                          className={`text-xs flex items-center gap-1.5 ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          <TrendingUp size={10} />
                          {t.masterTermName || `Term ${i + 1}`}
                          <span className="font-mono text-[10px] bg-current/10 px-1.5 py-0.5 rounded opacity-70">
                            {t.type === "percentage"
                              ? `${t.value}%`
                              : `₹${fmt(t.value)}`}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            (pre-GST)
                          </span>
                        </p>
                        <p
                          className={`font-mono text-sm font-semibold ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                        >
                          {isAdd ? "+ " : "− "}₹{fmt(amt)}
                        </p>
                      </div>
                    );
                  })}
                  {/* Billing Terms — post-GST applied after GST */}
                  {(rbd.postGstTerms ?? []).map((t, i) => {
                    const grossForCalc =
                      rbd.taxableAmount +
                      rbd.cgstAmount +
                      rbd.sgstAmount +
                      (rbd.igstAmount ?? 0);
                    const amt =
                      t.type === "percentage"
                        ? (grossForCalc * t.value) / 100
                        : t.value;
                    const isAdd = t.termType === "Addition";
                    return (
                      <div
                        key={t._key ?? `post-${i}`}
                        className={`flex items-center justify-between px-4 py-2.5 ${isAdd ? "bg-emerald-500/5" : "bg-red-500/5"}`}
                      >
                        <p
                          className={`text-xs flex items-center gap-1.5 ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          <TrendingUp size={10} />
                          {t.masterTermName || `Term ${i + 1}`}
                          <span className="font-mono text-[10px] bg-current/10 px-1.5 py-0.5 rounded opacity-70">
                            {t.type === "percentage"
                              ? `${t.value}%`
                              : `₹${fmt(t.value)}`}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            (post-GST)
                          </span>
                        </p>
                        <p
                          className={`font-mono text-sm font-semibold ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                        >
                          {isAdd ? "+ " : "− "}₹{fmt(amt)}
                        </p>
                      </div>
                    );
                  })}
                  {/* Legacy single-discount fallback (no billing terms array) */}
                  {billingTerms.length === 0 && hasDiscount && (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-red-500/5">
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                        <TrendingUp size={10} />
                        Discount
                        {previewRecord.discount?.type === "percentage" &&
                        previewRecord.discount?.value ? (
                          <span className="font-mono text-[10px] bg-red-500/10 px-1.5 py-0.5 rounded">
                            {previewRecord.discount.value}%
                          </span>
                        ) : null}
                      </p>
                      <p className="font-mono text-sm text-red-500 dark:text-red-400">
                        − ₹{fmt((rbd as any).discountAmount)}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-primary/10 border-t border-primary/20">
                  <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider">
                    Net Payable
                  </p>
                  <p className="font-mono text-base font-bold text-primary">
                    ₹{fmt(displayNetAmount)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Section 4: EMI Details ── */}
          {hasEmi && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <CreditCard size={10} className="text-primary" /> EMI /
                Installment Plan
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Installments
                  </p>
                  <p className="font-mono text-lg font-bold text-violet-600 dark:text-violet-400">
                    {previewRecord.emi!.installmentCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground">total</p>
                </div>
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Per EMI
                  </p>
                  <p className="font-mono text-base font-bold text-violet-600 dark:text-violet-400">
                    ₹{fmt(previewRecord.emi!.emiAmount ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">amount</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Start Date
                  </p>
                  <p className="text-sm font-semibold">
                    {previewRecord.emi!.startDate || "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">first emi</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Frequency
                  </p>
                  <p className="text-sm font-semibold capitalize">
                    {previewRecord.emi!.frequency || "Monthly"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">cycle</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Section 5: GRN Items ── */}
          {previewRecord.grnItems &&
            Array.isArray(previewRecord.grnItems) &&
            previewRecord.grnItems.length > 0 && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Truck size={10} className="text-primary" /> GRN Items Summary
                  <span className="ml-auto font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full border border-border">
                    {previewRecord.grnItems.length} items
                  </span>
                </p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          <th className="text-left px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Item
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Ordered
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Received
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            Remaining
                          </th>
                          <th className="text-left px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            UOM
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {(previewRecord.grnItems as GRNItemLine[]).map(
                          (item, idx) => (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="px-3 py-2.5 font-medium max-w-[140px] truncate">
                                {item.itemName || `Item ${idx + 1}`}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                {item.orderedQty}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                                {item.receivedQty}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono hidden sm:table-cell">
                                <span
                                  className={
                                    item.remainingQty > 0
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {item.remainingQty}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                                {item.uom || "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

          {/* ── Section 6: Invoice & Allocation ── */}
          {(previewRecord.vendorInvoiceNo ||
            previewRecord.costCenter ||
            previewRecord.glAccount ||
            previewRecord.workDoneRef ||
            (previewRecord.additionalCharges &&
              previewRecord.additionalCharges.length > 0)) && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <FileText size={10} className="text-primary" /> Invoice &amp;
                Allocation
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                {previewRecord.vendorInvoiceNo && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Vendor Invoice No
                    </p>
                    <p className="text-sm font-mono font-semibold">
                      {previewRecord.vendorInvoiceNo}
                    </p>
                  </div>
                )}
                {previewRecord.vendorInvoiceDate && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Vendor Invoice Date
                    </p>
                    <p className="text-sm font-medium">
                      {previewRecord.vendorInvoiceDate}
                    </p>
                  </div>
                )}
                {previewRecord.costCenter && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Cost Centre
                    </p>
                    <p className="text-sm font-medium">
                      {previewRecord.costCenter}
                    </p>
                  </div>
                )}
                {previewRecord.glAccount && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      GL Account
                    </p>
                    <p className="text-sm font-medium">
                      {previewRecord.glAccount}
                    </p>
                  </div>
                )}
                {previewRecord.workDoneRef && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Work Done Ref
                    </p>
                    <p className="text-sm font-mono font-semibold text-violet-600 dark:text-violet-400">
                      {previewRecord.workDoneRef}
                    </p>
                  </div>
                )}
              </div>
              {previewRecord.additionalCharges &&
                previewRecord.additionalCharges.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border overflow-hidden">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/30 border-b border-border">
                      Additional Charges
                    </p>
                    <div className="divide-y divide-border/50">
                      {previewRecord.additionalCharges.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <span className="text-xs text-foreground">
                            {c.label || `Charge ${i + 1}`}
                          </span>
                          <span className="font-mono text-xs font-semibold">
                            ₹{fmt(c.amount || 0)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
                        <span className="text-xs font-semibold">
                          Total Additional
                        </span>
                        <span className="font-mono text-xs font-bold">
                          ₹
                          {fmt(
                            previewRecord.additionalCharges.reduce(
                              (s, c) => s + (c.amount || 0),
                              0,
                            ),
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* ── Section 7: Bill Status & Payment Summary ── */}
          {previewRecord.billStatus && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Wallet size={10} className="text-primary" /> Bill Status
              </p>
              <div className="flex flex-wrap gap-3 mb-3">
                <div
                  className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border font-semibold ${
                    previewRecord.billStatus === "Paid"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : previewRecord.billStatus === "Partially Paid"
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                        : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                  }`}
                >
                  {previewRecord.billStatus === "Paid" ? (
                    <CheckCircle2 size={11} />
                  ) : previewRecord.billStatus === "Partially Paid" ? (
                    <Clock size={11} />
                  ) : (
                    <AlertCircle size={11} />
                  )}
                  {previewRecord.billStatus}
                </div>
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="divide-y divide-border/60">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                    <p className="text-xs text-muted-foreground">Net Payable</p>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(displayNetAmount)}
                    </p>
                  </div>
                  {(previewRecord.totalPaid ?? 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Total Paid
                      </p>
                      <p className="font-mono text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                        ₹{fmt(previewRecord.totalPaid ?? 0)}
                      </p>
                    </div>
                  )}
                  {displayRemainingAmount > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/5">
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Remaining
                      </p>
                      <p className="font-mono text-sm text-amber-600 dark:text-amber-400 font-semibold">
                        ₹{fmt(displayRemainingAmount)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Section 7b: Traceability Chain ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <ArrowRight size={10} className="text-primary" /> Document Chain
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              {previewRecord.workDoneRef && (
                <>
                  <span className="bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-400 px-2.5 py-1.5 rounded-lg font-mono font-semibold">
                    WD: {previewRecord.workDoneRef}
                  </span>
                  <ArrowRight
                    size={10}
                    className="text-muted-foreground shrink-0"
                  />
                </>
              )}
              {(previewRecord.purchaseOrderId ||
                previewRecord.eSourceType === "PO" ||
                previewRecord.eSourceType === "WO_PO") && (
                <>
                  <span className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 px-2.5 py-1.5 rounded-lg font-mono font-semibold">
                    {previewRecord.eSourceType === "WO_PO" ? "WO_PO" : "PO"}
                    {previewRecord.purchaseOrderId
                      ? ` #${previewRecord.purchaseOrderId}`
                      : ""}
                  </span>
                  <ArrowRight
                    size={10}
                    className="text-muted-foreground shrink-0"
                  />
                </>
              )}
              {previewRecord.eSourceType === "GRN" &&
                previewRecord.eSourceId && (
                  <>
                    <span className="bg-teal-500/10 border border-teal-500/20 text-teal-700 dark:text-teal-400 px-2.5 py-1.5 rounded-lg font-mono font-semibold">
                      {previewRecord.sourceDocNo ||
                        `GRN #${previewRecord.eSourceId}`}
                    </span>
                    <ArrowRight
                      size={10}
                      className="text-muted-foreground shrink-0"
                    />
                  </>
                )}
              {previewRecord.bookingReference && (
                <>
                  <span className="bg-primary/10 border border-primary/20 text-primary px-2.5 py-1.5 rounded-lg font-mono font-semibold">
                    {previewRecord.bookingReference}
                  </span>
                  {previewRecord.billStatus && (
                    <ArrowRight
                      size={10}
                      className="text-muted-foreground shrink-0"
                    />
                  )}
                </>
              )}
              {previewRecord.billStatus && (
                <span
                  className={`px-2.5 py-1.5 rounded-lg font-semibold border ${
                    previewRecord.billStatus === "Paid"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : previewRecord.billStatus === "Partially Paid"
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                        : "bg-muted border-border text-muted-foreground"
                  }`}
                >
                  {previewRecord.billStatus}
                </span>
              )}
              {!previewRecord.workDoneRef &&
                !previewRecord.purchaseOrderId &&
                previewRecord.eSourceType !== "GRN" &&
                previewRecord.eSourceType !== "PO" &&
                previewRecord.eSourceType !== "WO_PO" &&
                !previewRecord.billStatus && (
                  <span className="text-muted-foreground italic">
                    No chain data yet
                  </span>
                )}
            </div>
          </div>

          {/* ── Section 8: Billing Terms ── */}
          {billingTerms.length > 0 &&
            (() => {
              // Compute running base amounts so we can show the ₹ impact of each term
              const grossForPostGst =
                rbd.taxableAmount + rbd.cgstAmount + rbd.sgstAmount;
              let rb = previewRecord.basicAmount;
              let pgRb = grossForPostGst;
              const computedAmounts: number[] = billingTerms.map((t: any) => {
                const base = t?.appliedOn === "post-gst" ? pgRb : rb;
                const amt =
                  t?.applicable !== false
                    ? t?.type === "percentage"
                      ? (base * (t?.value ?? 0)) / 100
                      : (t?.value ?? 0)
                    : 0;
                if (t?.applicable !== false) {
                  if (t?.appliedOn === "post-gst") {
                    pgRb =
                      t?.deductionType === "Addition"
                        ? pgRb + amt
                        : Math.max(0, pgRb - amt);
                  } else {
                    rb =
                      t?.deductionType === "Addition"
                        ? rb + amt
                        : Math.max(0, rb - amt);
                  }
                }
                return amt;
              });

              return (
                <div className="border-t border-border/60 pt-4">
                  <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Receipt size={10} className="text-primary" /> Billing Terms
                  </p>
                  <div className="bg-muted/20 border border-border rounded-xl overflow-hidden text-sm text-foreground divide-y divide-border/50">
                    {billingTerms.map((t: any, idx: number) => {
                      const isAddition = t?.deductionType === "Addition";
                      const rupeeAmt = computedAmounts[idx] ?? 0;
                      const isApplied = t?.applicable !== false;
                      return (
                        <div
                          key={t?._key ?? t?.masterTermId ?? idx}
                          className="flex items-center justify-between gap-4 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-sm block truncate">
                              {t?.masterTermName ||
                                t?.TermName ||
                                t?.Name ||
                                `Term ${idx + 1}`}
                            </span>
                            <span className="text-[10px] text-muted-foreground/70">
                              {t?.appliedOn === "post-gst"
                                ? "After GST"
                                : "Before GST"}
                              {!isApplied && " · Not applied"}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span
                              className={`text-sm font-semibold tabular-nums ${
                                !isApplied
                                  ? "text-muted-foreground"
                                  : isAddition
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-destructive"
                              }`}
                            >
                              {isApplied ? (isAddition ? "+" : "−") : ""}₹
                              {fmt(rupeeAmt)}
                            </span>
                            {isApplied && t?.type === "percentage" && (
                              <span className="block text-[10px] text-muted-foreground/60">
                                {t?.value ?? 0}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          {/* ── Section 9: Remarks ── */}
          {previewRecord.remarks && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <StickyNote size={10} className="text-primary" /> Remarks
              </p>
              <div className="bg-muted/20 border border-border rounded-xl px-4 py-3 text-sm text-foreground leading-relaxed">
                {previewRecord.remarks}
              </div>
            </div>
          )}

          {/* ── Section 10: Approval Status ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CheckCircle2 size={10} className="text-primary" /> Approval
              Status
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-xl px-4 py-2.5">
                <StatusBadge status={previewRecord.status} />
                <span className="text-xs text-muted-foreground">
                  Current Status
                </span>
              </div>
              {previewRecord.status === "Approved" && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl">
                  <CheckCircle2 size={11} /> Approved & Processed
                </div>
              )}
              {previewRecord.status === "Pending" && (
                <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl">
                  <Clock size={11} /> Awaiting Approval
                </div>
              )}
              {previewRecord.status === "Rejected" && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
                  <AlertCircle size={11} /> Rejected — Review Required
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row items-center justify-between gap-2 bg-muted/10">
          <p className="text-[10px] text-muted-foreground expense-preview-print-hide">
            ID: <span className="font-mono">{previewRecord.id || "—"}</span>
          </p>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-8 text-xs expense-preview-print-hide"
              onClick={() => {
                onClose();
                onEdit(previewRecord);
              }}
            >
              <Edit size={11} className="mr-1.5" /> Edit
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-8 text-xs expense-preview-print-hide"
              onClick={() => window.print()}
            >
              <Printer size={11} className="mr-1.5" /> Print
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-8 text-xs expense-preview-print-hide"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
